from __future__ import annotations

from typing import Any

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.api._helpers import _df_to_blob, _err_msg
from backend.database import DataSource as DBSource
from backend.database import get_db
from backend.services.indicator_calculator import compute_indicator, get_indicator_defs

router = APIRouter(tags=["bt-gui"])


class ComputeIndicatorRequest(BaseModel):
    symbol: str
    start: str | None = None
    end: str | None = None
    type: str
    params: dict[str, Any] = {}
    save: bool = True
    name: str | None = None


@router.get("/indicators")
def list_indicators(db: Session = Depends(get_db)):  # noqa: B008
    rows = db.query(DBSource).filter(DBSource.type == "indicator").order_by(DBSource.id.desc()).all()
    return [{"id": r.id, "name": r.name, "type": r.type, "source": r.source, "meta": r.meta_json, "path_or_tickers": r.path_or_tickers} for r in rows]


@router.get("/indicators/defs")
def list_indicator_defs():
    return get_indicator_defs()


def _build_price_df(rows: list[dict[str, Any]], symbol: str) -> pd.DataFrame:
    """Build a price DataFrame from a list of row dicts (both local and market sources)."""
    price_df = pd.DataFrame([{"date": r["date"], symbol.upper(): r["close"]} for r in rows])
    price_df = price_df.set_index("date").sort_index()
    price_df.columns = [str(c).upper() for c in price_df.columns]
    price_df = price_df.ffill()
    return price_df


@router.post("/indicators/compute", status_code=201)
def compute_indicator_route(req: ComputeIndicatorRequest, db: Session = Depends(get_db)):  # noqa: B008
    from backend.database import get_price_source
    from backend.services.price_source import load_price_rows

    if get_price_source() == "market":
        rows = load_price_rows(req.symbol, req.start, req.end)
    else:
        from backend.database import PriceData as DBPriceData

        q = db.query(DBPriceData).filter(DBPriceData.symbol == req.symbol.upper())
        if req.start:
            q = q.filter(DBPriceData.date >= pd.to_datetime(req.start))
        if req.end:
            q = q.filter(DBPriceData.date <= pd.to_datetime(req.end))
        q = q.order_by(DBPriceData.date.asc())
        raw_rows = q.all()
        rows = [
            {
                "date": str(r.date)[:10],
                "open": float(r.open) if r.open is not None else None,
                "high": float(r.high) if r.high is not None else None,
                "low": float(r.low) if r.low is not None else None,
                "close": float(r.close) if r.close is not None else None,
                "adj_close": float(r.adj_close) if r.adj_close is not None else None,
                "volume": int(r.volume) if r.volume is not None else None,
            }
            for r in raw_rows
        ]

    # ponytail: detect staled price data and auto-recalculate (local only)
    warnings: list[str] = []
    if rows:
        price_df = _build_price_df(rows, req.symbol)
        if req.end and get_price_source() == "local":
            from backend.database import PriceData as DBPriceData

            latest_row = db.query(DBPriceData).filter(
                DBPriceData.symbol == req.symbol.upper(),
                DBPriceData.date > pd.to_datetime(req.end),
            ).order_by(DBPriceData.date.desc()).first()
            if latest_row:
                all_rows = db.query(DBPriceData).filter(DBPriceData.symbol == req.symbol.upper()).order_by(DBPriceData.date.asc()).all()
                rows_full = [
                    {
                        "date": str(r.date)[:10],
                        "close": float(r.close) if r.close is not None else None,
                    }
                    for r in all_rows
                ]
                price_df = _build_price_df(rows_full, req.symbol)
                warnings.append(f"Prezzi più recenti per {req.symbol.upper()} disponibili (dal {str(latest_row.date)[:10]}): l'indicatore è stato ricalcolato con tutto il range.")
    else:
        from backend.services.data_loader import fetch_yf_df

        price_df = fetch_yf_df(req.symbol, req.start, req.end)
    if price_df.empty:
        raise HTTPException(status_code=404, detail=f"no price data for symbol {req.symbol}")
    try:
        result, meta = compute_indicator(req.type, price_df, req.params)
    except Exception as e:
        raise HTTPException(status_code=422, detail=_err_msg(e))
    meta["indicator_type"] = req.type
    meta["params"] = req.params
    if not req.save:
        shape = list(result.shape) if isinstance(result, pd.DataFrame) else None
        return {"meta": meta, "shape": shape, "warnings": warnings}
    if req.name:
        fname = req.name
    else:
        fname = f"indicator_{req.type}_{meta['params'].get('period', '')}"
    df_out = result if isinstance(result, pd.DataFrame) else next(iter(result.values()))
    blob = _df_to_blob(df_out)
    row = DBSource(
        name=fname,
        type="indicator",
        source="computed",
        path_or_tickers=req.symbol.upper(),
        meta_json=meta,
        parquet_blob=blob,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"id": row.id, "name": row.name, "meta": meta, "warnings": warnings}

from __future__ import annotations

from typing import Any

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.api._helpers import _df_to_blob
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


@router.post("/indicators/compute", status_code=201)
def compute_indicator_route(req: ComputeIndicatorRequest, db: Session = Depends(get_db)):  # noqa: B008
    from backend.services.data_loader import fetch_yf_df

    from backend.database import PriceData as DBPriceData

    rows = db.query(DBPriceData).filter(DBPriceData.symbol == req.symbol.upper())
    if start := req.start:
        rows = rows.filter(DBPriceData.date >= pd.to_datetime(start))
    if end := req.end:
        rows = rows.filter(DBPriceData.date <= pd.to_datetime(end))
    rows = rows.order_by(DBPriceData.date.asc()).all()

    if rows:
        price_df = pd.DataFrame(
            [
                {
                    "date": r.date,
                    req.symbol.upper(): r.close,
                }
                for r in rows
            ]
        )
        price_df = price_df.set_index("date").sort_index()
        price_df.columns = [str(c).upper() for c in price_df.columns]
        price_df = price_df.ffill()
    else:
        price_df = fetch_yf_df(req.symbol, req.start, req.end)
    if price_df.empty:
        raise HTTPException(status_code=404, detail=f"no price data for symbol {req.symbol}")
    try:
        result, meta = compute_indicator(req.type, price_df, req.params)
    except Exception as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    meta["indicator_type"] = req.type
    meta["params"] = req.params
    if not req.save:
        shape = list(result.shape) if isinstance(result, pd.DataFrame) else None
        return {"meta": meta, "shape": shape}
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
    return {"id": row.id, "name": row.name, "meta": meta}

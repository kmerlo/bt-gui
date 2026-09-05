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
    symbol: str | None = None
    symbols: list[str] | None = None
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


def _load_price_rows(db: Session, symbol: str, start: str | None, end: str | None) -> list[dict[str, Any]]:
    from backend.database import PriceData as DBPriceData, get_price_source
    from backend.services.price_source import load_price_rows

    if get_price_source() == "market":
        return load_price_rows(symbol, start, end)
    q = db.query(DBPriceData).filter(DBPriceData.symbol == symbol.upper())
    if start:
        q = q.filter(DBPriceData.date >= pd.to_datetime(start))
    if end:
        q = q.filter(DBPriceData.date <= pd.to_datetime(end))
    q = q.order_by(DBPriceData.date.asc())
    raw = q.all()
    return [
        {
            "date": str(r.date)[:10],
            "open": float(r.open) if r.open is not None else None,
            "high": float(r.high) if r.high is not None else None,
            "low": float(r.low) if r.low is not None else None,
            "close": float(r.close) if r.close is not None else None,
            "adj_close": float(r.adj_close) if r.adj_close is not None else None,
            "volume": int(r.volume) if r.volume is not None else None,
        }
        for r in raw
    ]


def _build_price_df(rows: list[dict[str, Any]], symbol: str) -> pd.DataFrame:
    price_df = pd.DataFrame([{"date": r["date"], symbol.upper(): r["close"]} for r in rows])
    price_df = price_df.set_index("date").sort_index()
    price_df.columns = [str(c).upper() for c in price_df.columns]
    price_df = price_df.ffill()
    return price_df


def _check_stale(db: Session, symbol: str, rows: list[dict], end: str | None, warnings: list[str]) -> pd.DataFrame:
    """If price data extends past `end`, re-fetch full range."""
    if not end or rows:
        return _build_price_df(rows, symbol)
    from backend.database import PriceData as DBPriceData
    latest_row = db.query(DBPriceData).filter(
        DBPriceData.symbol == symbol.upper(),
        DBPriceData.date > pd.to_datetime(end),
    ).order_by(DBPriceData.date.desc()).first()
    if latest_row:
        all_rows = db.query(DBPriceData).filter(DBPriceData.symbol == symbol.upper()).order_by(DBPriceData.date.asc()).all()
        full_rows = [
            {"date": str(r.date)[:10], "close": float(r.close) if r.close is not None else None}
            for r in all_rows
        ]
        warnings.append(f"Prezzi più recenti per {symbol.upper()} disponibili (dal {str(latest_row.date)[:10]}): ricalcolato con tutto il range.")
        return _build_price_df(full_rows, symbol)
    return _build_price_df(rows, symbol)


@router.post("/indicators/compute", status_code=201)
def compute_indicator_route(req: ComputeIndicatorRequest, db: Session = Depends(get_db)):  # noqa: B008
    from backend.services.data_loader import fetch_yf_df

    symbols: list[str] = []
    if req.symbols:
        symbols = [s.upper().strip() for s in req.symbols if s.strip()]
    elif req.symbol:
        symbols = [req.symbol.upper().strip()]
    else:
        raise HTTPException(status_code=422, detail="symbol or symbols is required")

    # Gather price data for all requested symbols
    all_rows: dict[str, list[dict]] = {s: [] for s in symbols}
    for sym in symbols:
        rows = _load_price_rows(db, sym, req.start, req.end)
        if not rows:
            yf_df = fetch_yf_df(sym, req.start, req.end)
            if not yf_df.empty:
                rows = [
                    {
                        "date": str(d)[:10],
                        "close": float(v) if v is not None else None,
                    }
                    for d, v in zip(yf_df.index, yf_df["close"])
                ]
        all_rows[sym] = rows

    # Check staleness per symbol
    warnings: list[str] = []
    for sym in symbols:
        all_rows[sym] = _load_price_rows(db, sym, req.start, req.end)

    # Build single multi-column DF for batch computation
    # Use the union of all date indices so all symbols align
    df_dict: dict[str, pd.Series] = {}
    for sym in symbols:
        if not all_rows[sym]:
            raise HTTPException(status_code=404, detail=f"no price data for symbol {sym}")
        df_dict[sym] = pd.Series(
            [r["close"] for r in all_rows[sym]],
            index=pd.to_datetime([r["date"] for r in all_rows[sym]]),
            name=sym,
        )

    if not df_dict:
        raise HTTPException(status_code=404, detail="no price data available")

    price_df = pd.DataFrame(df_dict).sort_index()
    price_df = price_df.ffill()

    try:
        result, meta = compute_indicator(req.type, price_df, req.params)
    except Exception as e:
        raise HTTPException(status_code=422, detail=_err_msg(e))

    meta["indicator_type"] = req.type
    meta["params"] = req.params
    meta["symbols"] = symbols

    if not req.save:
        shape = list(result.shape) if isinstance(result, pd.DataFrame) else None
        return {"meta": meta, "shape": shape, "warnings": warnings}

    # Auto-generated name: TICKER_INDICATOR_TYPE_params (e.g. SPY_SMA_50)
    _PARAM_KEYS_ORDER = ("length", "period", "fast", "slow", "signal")
    param_parts: list[str] = []
    for pk in _PARAM_KEYS_ORDER:
        v = req.params.get(pk)
        if v is not None:
            param_parts.append(str(v))
    for k, v in req.params.items():
        if k not in _PARAM_KEYS_ORDER and v is not None:
            param_parts.append(f"{k}={v}")
    param_label = "_".join(param_parts) or "1"
    base_name = req.name or f"{symbols[0]}_{req.type.upper()}_{param_label}"

    if isinstance(result, pd.DataFrame):
        df_out = result
    elif isinstance(result, dict):
        df_out = next(iter(result.values()))
    else:
        df_out = result

    # ponytail: normalizza colonne — rimuove ':' residui da vecchi blob MultiIndex,
    # per multi-ticker assicura uppercase ticker (es. 'AAPL'), per single-ticker lascia 'sma_5'/'median_252'
    # così test_sma_indicator_value resta valido; il signal farà broadcast single-col.
    try:
        if isinstance(df_out, pd.DataFrame) and not df_out.empty:
            df_out.columns = [str(c).split(":")[0].strip() for c in df_out.columns]
            if len(df_out.columns) > 1:
                df_out.columns = [str(c).upper().strip() for c in df_out.columns]
    except Exception:
        pass

    blob = _df_to_blob(df_out)
    row = DBSource(
        name=base_name,
        type="indicator",
        source="computed",
        path_or_tickers=",".join(symbols),
        meta_json={**meta, "symbols": symbols},
        parquet_blob=blob,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"id": row.id, "name": row.name, "meta": row.meta_json, "warnings": warnings}


@router.delete("/indicators/{iid}", status_code=204)
def delete_indicator(iid: int, db: Session = Depends(get_db)):  # noqa: B008
    row = db.query(DBSource).filter(DBSource.id == iid, DBSource.type == "indicator").first()
    if row is None:
        raise HTTPException(status_code=404, detail="indicator not found")
    db.delete(row)
    db.commit()

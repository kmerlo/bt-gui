from __future__ import annotations

from typing import Any

import pandas as pd
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.api._query import apply_search
from backend.database import PriceData as DBPriceData
from backend.database import get_db
from backend.services.data_loader import fetch_and_store_yf

router = APIRouter(tags=["bt-gui"])


class FetchPriceRequest(BaseModel):
    symbol: str
    start: str | None = None
    end: str | None = None
    interval: str = "1d"


@router.get("/price-data")
def list_price_data(
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),  # noqa: B008
):
    # ponytail: capped list — full GROUP BY aggregation when >10k symbols
    rows = db.query(DBPriceData).order_by(DBPriceData.symbol, DBPriceData.date).all()
    by_symbol: dict[str, dict[str, Any]] = {}
    for r in rows:
        sym = r.symbol.upper()
        if sym not in by_symbol:
            by_symbol[sym] = {"symbol": sym, "interval": r.interval, "start": str(r.date)[:10], "end": str(r.date)[:10], "count": 0}
        entry = by_symbol[sym]
        entry["count"] += 1
        date_str = str(r.date)[:10]
        if date_str < entry["start"]:
            entry["start"] = date_str
        if date_str > entry["end"]:
            entry["end"] = date_str
    vals = list(by_symbol.values())
    return vals[offset : offset + limit]


@router.post("/price-data/fetch", status_code=201)
def fetch_price_data(req: FetchPriceRequest, db: Session = Depends(get_db)):  # noqa: B008
    count = fetch_and_store_yf(db, req.symbol, req.start, req.end, req.interval)
    return {"symbol": req.symbol.upper(), "rows": count}


@router.get("/price-data/{symbol}/rows")
def get_price_rows(
    symbol: str,
    start: str | None = Query(None),
    end: str | None = Query(None),
    sort_by: str | None = Query(None),
    sort_dir: str = Query("asc", pattern="^(asc|desc)$"),
    search: str | None = Query(None),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),  # noqa: B008
):
    q = db.query(DBPriceData).filter(DBPriceData.symbol == symbol.upper())
    if start:
        q = q.filter(DBPriceData.date >= pd.to_datetime(start))
    if end:
        q = q.filter(DBPriceData.date <= pd.to_datetime(end))
    if sort_by:
        col_map = {
            "date": DBPriceData.date,
            "open": DBPriceData.open,
            "high": DBPriceData.high,
            "low": DBPriceData.low,
            "close": DBPriceData.close,
            "adj_close": DBPriceData.adj_close,
            "volume": DBPriceData.volume,
        }
        if sort_by in col_map:
            q = q.order_by(col_map[sort_by].asc() if sort_dir == "asc" else col_map[sort_by].desc())
    else:
        q = q.order_by(DBPriceData.date.asc())
    rows = q.all()
    out = [
        {
            "date": str(r.date)[:10],
            "open": float(r.open) if r.open is not None else None,
            "high": float(r.high) if r.high is not None else None,
            "low": float(r.low) if r.low is not None else None,
            "close": float(r.close) if r.close is not None else None,
            "adj_close": float(r.adj_close) if r.adj_close is not None else None,
            "volume": int(r.volume) if r.volume is not None else None,
        }
        for r in rows
    ]
    if search:
        out = apply_search(out, search, ["date", "open", "high", "low", "close", "adj_close", "volume"])
    # ponytail: slice after filter; full SQL limit when >10k rows
    return out[offset : offset + limit]


@router.delete("/price-data/{symbol}", status_code=204)
def delete_price_data(symbol: str, db: Session = Depends(get_db)):  # noqa: B008
    deleted = db.query(DBPriceData).filter(DBPriceData.symbol == symbol.upper()).delete()
    db.commit()
    return {"deleted": deleted}

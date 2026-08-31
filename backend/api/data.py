from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.api._helpers import _df_to_blob
from backend.database import DataSource as DBSource
from backend.database import get_db
from backend.services.data_loader import fetch_ffn, fetch_and_store_yf

router = APIRouter(prefix="/data", tags=["bt-gui"])


class DataFetchRequest(BaseModel):
    adapter: str
    tickers: list[str] | None = None
    symbol: str | None = None
    name: str | None = None
    type: str | None = None
    start: str | None = None
    end: str | None = None


@router.post("/fetch", status_code=201)
def fetch_data(req: DataFetchRequest, db: Session = Depends(get_db)):  # noqa: B008
    if req.adapter == "ffn":
        if not req.tickers:
            raise HTTPException(status_code=422, detail="tickers required for ffn adapter")
        if not req.name:
            raise HTTPException(status_code=422, detail="name required for ffn adapter")
        df = fetch_ffn(req.tickers, req.start, req.end)
        if df.empty:
            raise HTTPException(status_code=422, detail="empty result from ffn")
        from backend.api._helpers import _meta

        blob = _df_to_blob(df)
        meta = _meta(df)
        if db.query(DBSource).filter(DBSource.name == req.name).first():
            raise HTTPException(status_code=409, detail=f"data source {req.name} exists")
        row = DBSource(
            name=req.name,
            type=req.type or "price",
            source="ffn",
            path_or_tickers=",".join(req.tickers),
            meta_json=meta,
            parquet_blob=blob,
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        return {"adapter": "ffn", "id": row.id, "name": row.name, "rows": len(df)}

    if req.adapter == "yfinance":
        if not req.symbol:
            raise HTTPException(status_code=422, detail="symbol required for yfinance adapter")
        count = fetch_and_store_yf(db, req.symbol, req.start, req.end)
        return {"adapter": "yfinance", "symbol": req.symbol.upper(), "rows": count}

    raise HTTPException(status_code=422, detail=f"unknown adapter: {req.adapter}")


class DataListResponse(BaseModel):
    adapter: str
    items: list[dict[str, Any]]


@router.get("/list")
def list_data(db: Session = Depends(get_db)):  # noqa: B008
    from backend.database import DataSource as DBSource, get_price_source
    from backend.services.price_source import list_price_tickers as _list_market_tickers

    sources = db.query(DBSource).order_by(DBSource.id).all()

    source = get_price_source()
    if source == "market":
        prices = _list_market_tickers()
    else:
        from backend.database import PriceData as DBPriceData

        prices_raw = db.query(DBPriceData).order_by(DBPriceData.symbol, DBPriceData.date).all()
        by_symbol: dict[str, dict[str, Any]] = {}
        for r in prices_raw:
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
        prices = list(by_symbol.values())

    return {
        "adapter": "yfinance",
        "sources": [{"id": r.id, "name": r.name, "type": r.type, "source": r.source, "path_or_tickers": r.path_or_tickers} for r in sources],
        "prices": prices,
    }

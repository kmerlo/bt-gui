from __future__ import annotations

from typing import Any

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.api._helpers import _blob_to_df, _df_to_blob, _err_msg
from backend.database import DataSource as DBSource, get_db

router = APIRouter(tags=["bt-gui"])


class ComputeSignalRequest(BaseModel):
    name: str
    expression: dict[str, Any]
    symbols: list[str]
    start: str | None = None
    end: str | None = None
    indicator_ids: list[int] = []
    save: bool = True


@router.post("/signals/compute", status_code=201)
def compute_signal(req: ComputeSignalRequest, db: Session = Depends(get_db)):  # noqa: B008
    from backend.services.backtest_runner import _load_prices_from_local
    from backend.services.signal_engine import evaluate_expression

    try:
        price_df = _load_prices_from_local(req.symbols, req.start, req.end, "close")
    except Exception as e:
        raise HTTPException(status_code=422, detail=str(e))

    indicators: dict[str, pd.DataFrame] = {}
    for iid in req.indicator_ids:
        row = db.query(DBSource).filter(DBSource.id == iid, DBSource.type == "indicator").first()
        if row is None or row.parquet_blob is None:
            raise HTTPException(status_code=422, detail=f"indicator #{iid} not found")
        ind_df = _blob_to_df(row.parquet_blob)
        ind_df.index = pd.to_datetime(ind_df.index)
        indicators[str(iid)] = ind_df

    try:
        signal_df = evaluate_expression(req.expression, indicators, price_df)
    except Exception as e:
        raise HTTPException(status_code=422, detail=_err_msg(e))

    signal_df = signal_df.astype(bool)

    if signal_df.empty:
        raise HTTPException(status_code=422, detail="resulting signal is empty")

    meta: dict[str, Any] = {
        "expression": req.expression,
        "symbols": req.symbols,
        "indicator_ids": req.indicator_ids,
        "date_range": {
            "start": str(signal_df.index[0])[:10],
            "end": str(signal_df.index[-1])[:10],
        },
    }

    if not req.save:
        return {"name": req.name, "shape": list(signal_df.shape), "meta": meta}

    blob = _df_to_blob(signal_df)
    row = DBSource(
        name=req.name,
        type="signal",
        source="computed",
        path_or_tickers=",".join(req.symbols),
        meta_json=meta,
        parquet_blob=blob,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"id": row.id, "name": row.name, "meta": row.meta_json}


@router.get("/signals")
def list_signals(db: Session = Depends(get_db)):  # noqa: B008
    rows = db.query(DBSource).filter(DBSource.type == "signal").order_by(DBSource.id.desc()).all()
    return [
        {
            "id": r.id,
            "name": r.name,
            "type": r.type,
            "source": r.source,
            "meta": r.meta_json,
            "path_or_tickers": r.path_or_tickers,
        }
        for r in rows
    ]


@router.delete("/signals/{sid}", status_code=204)
def delete_signal(sid: int, db: Session = Depends(get_db)):  # noqa: B008
    row = db.query(DBSource).filter(DBSource.id == sid, DBSource.type == "signal").first()
    if row is None:
        raise HTTPException(status_code=404, detail="signal not found")
    db.delete(row)
    db.commit()

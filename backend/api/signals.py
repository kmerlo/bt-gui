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
        # ponytail: normalizza colonne con ':' (es. 'AAPL:median_252' da vecchi blob o MultiIndex)
        try:
            ind_df.columns = [str(c).split(":")[0].strip() for c in ind_df.columns]
        except Exception:
            pass
        indicators[str(iid)] = ind_df

    # validazione pre-evaluate: se indicatore single-column tipo 'sma_50' ma richiesti N ticker -> messaggio chiaro
    for iid, ind_df in indicators.items():
        if len(ind_df.columns) == 1 and len(req.symbols) > 1:
            only_col = str(ind_df.columns[0])
            if only_col.upper() not in [s.upper() for s in req.symbols] and only_col.lower().startswith(("sma", "ema", "rsi", "median", "bbands")):
                raise HTTPException(
                    status_code=422,
                    detail=(
                        f"indicator #{iid} '{only_col}' è single-column (creato su 1 ticker) "
                        f"ma hai richiesto signal su {req.symbols}. Ricrea l'indicatore selezionando tutti i ticker nel pannello Indicators "
                        f"oppure seleziona solo il ticker corrispondente ({only_col})."
                    ),
                )

    try:
        signal_df = evaluate_expression(req.expression, indicators, price_df)
    except ValueError as e:
        # errori di allineamento colonne/indici -> messaggio utente, non 'internal error'
        msg = str(e)
        if "identically-labeled" in msg or "columns" in msg.lower():
            raise HTTPException(
                status_code=422,
                detail=(
                    f"colonne indicatore/price non allineate: {msg}. "
                    f"price cols {list(price_df.columns)} vs indicator cols { {k: list(v.columns) for k, v in indicators.items()} }. "
                    f"Ricrea l'indicatore selezionando gli stessi ticker del signal."
                ),
            )
        raise HTTPException(status_code=422, detail=_err_msg(e))
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


class ComputeWeightSignalRequest(BaseModel):
    name: str | None = None
    fast_indicator_id: int
    slow_indicator_id: int
    symbols: list[str]
    start: str | None = None
    end: str | None = None
    save: bool = True
    mode: str = "1/-1"


@router.post("/signals/compute-weights", status_code=201)
def compute_weight_signal(req: ComputeWeightSignalRequest, db: Session = Depends(get_db)):  # noqa: B008
    indicators: dict[str, pd.DataFrame] = {}
    for iid in (req.fast_indicator_id, req.slow_indicator_id):
        row = db.query(DBSource).filter(DBSource.id == iid, DBSource.type == "indicator").first()
        if row is None or row.parquet_blob is None:
            raise HTTPException(status_code=422, detail=f"indicator #{iid} not found")
        ind_df = _blob_to_df(row.parquet_blob)
        ind_df.index = pd.to_datetime(ind_df.index)
        indicators[str(iid)] = ind_df

    fast = indicators[str(req.fast_indicator_id)]
    slow = indicators[str(req.slow_indicator_id)]
    fast_col = (str(list(fast.columns)[0]) if len(fast.columns) else None) or 'ind1'
    slow_col = (str(list(slow.columns)[0]) if len(slow.columns) else None) or 'ind2'

    # Auto-generate name from indicator names when not provided
    if not req.name:
        mode_suffix = "-long_only" if req.mode == "1/0" else "-long/short"
        req.name = f"weight-{fast_col}-{slow_col}{mode_suffix}"

    # Align indices (union) and forward-fill NaNs from the slower indicator
    tw = slow.copy()
    common_idx = fast.index.union(slow.index)
    tw = tw.reindex(common_idx)
    tw = tw.ffill()

    mask_fast = fast.reindex(common_idx).ffill()
    slow_aligned = slow.reindex(common_idx)

    if req.mode == "1/0":
        # 1/0 mode: +1 when fast > slow, 0 otherwise (no negative weights)
        mask = mask_fast.values > tw.values
        tw[:] = 0.0
        tw[mask] = 1.0
        tw[slow_aligned.isnull().values] = 0.0
    else:
        # 1/-1 mode: +1 when fast > slow, -1 otherwise, 0 where slow is NaN
        mask = mask_fast.values > tw.values
        tw[mask] = 1.0
        tw[~mask] = -1.0
        tw[slow_aligned.isnull().values] = 0.0

    # Rename columns to ticker names so WeighTarget allocates to real securities
    # ponytail: guard multi-symbol vs single-column mismatch
    if len(req.symbols) != len(tw.columns):
        raise HTTPException(
            status_code=422,
            detail=(
                f"symbols {req.symbols} len {len(req.symbols)} != "
                f"cols {len(tw.columns)} {list(tw.columns)}. "
                "For single-security weight, select only matching ticker (e.g. ['GE'])."
            ),
        )
    tw.columns = [s.upper() for s in req.symbols[:len(tw.columns)]]

    if tw.empty:
        raise HTTPException(status_code=422, detail="resulting weight signal is empty")

    meta: dict[str, Any] = {
        "fast_indicator_id": req.fast_indicator_id,
        "slow_indicator_id": req.slow_indicator_id,
        "symbols": req.symbols,
        "date_range": {
            "start": str(tw.index[0])[:10],
            "end": str(tw.index[-1])[:10],
        },
    }

    if not req.save:
        return {"name": req.name, "shape": list(tw.shape), "meta": meta}

    blob = _df_to_blob(tw)
    row = DBSource(
        name=req.name,
        type="signal",
        source="computed_weight",
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

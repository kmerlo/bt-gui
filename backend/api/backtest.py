from __future__ import annotations

from typing import Any

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.api._helpers import _blob_to_df, _err_msg
from backend.database import BacktestRun as DBRun
from backend.database import DataSource as DBSource
from backend.database import get_db
from backend.models.backtest_config import BacktestConfig
from backend.models.strategy_tree import StrategyTree
from backend.services.persistence import get_strategy

router = APIRouter(tags=["bt-gui"])


class RunRequest(BaseModel):
    strategy_id: int | None = None
    tree: StrategyTree | None = None
    config: BacktestConfig = BacktestConfig()  # type: ignore[call-arg]
    tickers: list[str] = []
    price_source_id: int | None = None
    extra_source_ids: dict[str, int] = {}
    indicator_source_ids: list[int] = []


@router.post("/backtest", status_code=201)
def create_backtest(req: RunRequest, db: Session = Depends(get_db)):  # noqa: B008
    from backend.services.backtest_runner import schedule_backtest

    if req.tree is None and req.strategy_id is None:
        raise HTTPException(status_code=422, detail="tree or strategy_id required")
    tree = req.tree
    strategy_id = req.strategy_id
    if tree is None and strategy_id is not None:
        srow = get_strategy(db, strategy_id)
        if srow is None:
            raise HTTPException(status_code=404, detail="strategy not found")
        tree = StrategyTree.model_validate(srow.tree_json)
        strategy_id = srow.id
    assert tree is not None

    cfg_dict = req.config.model_dump()
    if tree is not None and getattr(tree, "name", None):
        cfg_dict["strategy_name"] = tree.name
    cfg_dict["start"] = req.config.start
    cfg_dict["end"] = req.config.end

    row = DBRun(strategy_id=strategy_id, config_json=cfg_dict, stats_json=None)
    db.add(row)
    db.commit()
    db.refresh(row)
    run_id = row.id

    tickers = [t.upper() for t in req.tickers] if req.tickers else []
    if tickers:
        from backend.services.backtest_runner import _load_prices_from_db

        price_df = _load_prices_from_db(
            tickers,
            req.config.start,
            req.config.end,
            req.config.price_column,
        )
    elif req.price_source_id is not None:
        prow = db.query(DBSource).filter(DBSource.id == req.price_source_id).first()
        if prow is None:
            raise HTTPException(status_code=404, detail="price source not found")
        if prow.parquet_blob is None:
            raise HTTPException(status_code=422, detail="price source has no data")
        price_df = _blob_to_df(prow.parquet_blob)
        price_df.index = pd.to_datetime(price_df.index)
    else:
        raise HTTPException(status_code=422, detail="tickers or price_source_id required")

    additional: dict[str, pd.DataFrame] = {}
    volume = None
    volatility = None
    # ponytail: batch IN query for extra/indicator fetches
    extra_ids = list(req.extra_source_ids.values())
    extra_rows = {r.id: r for r in db.query(DBSource).filter(DBSource.id.in_(extra_ids)).all()} if extra_ids else {}
    for k, vid in req.extra_source_ids.items():
        erow = extra_rows.get(vid)
        if erow is None or erow.parquet_blob is None:
            continue
        df = _blob_to_df(erow.parquet_blob)
        df.index = pd.to_datetime(df.index)
        if k == "volume":
            volume = df
        elif k == "volatility":
            volatility = df
        else:
            additional[k] = df
    indicators: dict[str, pd.DataFrame] = {}
    preset_ids = getattr(getattr(tree, "preset", None), "indicator_source_ids", []) or []
    all_ind_ids = list(dict.fromkeys([*req.indicator_source_ids, *preset_ids]))
    ind_rows_map = {r.id: r for r in db.query(DBSource).filter(DBSource.id.in_(all_ind_ids)).all()} if all_ind_ids else {}
    missing_inds = [iid for iid in all_ind_ids if iid not in ind_rows_map]
    if missing_inds:
        names = ", ".join(f"{iid}(#{iid})" for iid in missing_inds)
        raise HTTPException(status_code=422, detail=f"Indicatori non trovati: {names}")
    indicator_warnings: list[str] = []
    for ind_id in all_ind_ids:
        ind_row = ind_rows_map.get(ind_id)
        if ind_row is None or ind_row.parquet_blob is None:
            continue
        ind_df = _blob_to_df(ind_row.parquet_blob)
        ind_df.index = pd.to_datetime(ind_df.index)
        indicators[str(ind_id)] = ind_df
        # check date coverage against strategy range
        ind_meta: dict[str, Any] = ind_row.meta_json or {}
        ind_range: dict[str, str] = ind_meta.get("date_range") or {}
        ind_start: str | None = ind_range.get("start")
        ind_end: str | None = ind_range.get("end")
        strat_start = req.config.start
        strat_end = req.config.end
        if ind_start and strat_start and pd.to_datetime(ind_start) > pd.to_datetime(strat_start):
            msg_start = (f"Indicatore {ind_row.name}: range ({ind_start}→{ind_end}) "
                         f"più ristretto di start strategia ({strat_start}). "
                         f"Il backtest userà solo dati fino a {ind_end}.")
            indicator_warnings.append(msg_start)
        if ind_end and strat_end and pd.to_datetime(ind_end) < pd.to_datetime(strat_end):
            msg_end = (f"Indicatore {ind_row.name}: range ({ind_start}→{ind_end}) "
                       f"più corto di end strategia ({strat_end}). "
                       f"Ricalcola l'indicatore nella sezione Indicators.")
            indicator_warnings.append(msg_end)
    # Also load saved signals (type="signal") referenced in preset
    preset_signals = getattr(getattr(tree, "preset", None), "signal_source_ids", []) or []
    for sid in preset_signals:
        srow = db.query(DBSource).filter(DBSource.id == sid, DBSource.type == "signal").first()
        if srow and srow.parquet_blob:
            s_df = _blob_to_df(srow.parquet_blob)
            s_df.index = pd.to_datetime(s_df.index)
            indicators[str(sid)] = s_df
    try:
        from backend.services.backtest_runner import schedule_backtest

        schedule_backtest(run_id, tree, req.config, price_df, additional, volume, volatility, indicators)
    except Exception as e:
        raise HTTPException(status_code=500, detail=_err_msg(e))
    return {"id": run_id, "status": "running", "warnings": indicator_warnings}

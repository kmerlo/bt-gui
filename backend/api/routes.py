from __future__ import annotations

import io
import math
from typing import Any

import pandas as pd
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.database import BacktestRun as DBRun
from backend.database import DataSource as DBSource
from backend.database import get_db
from backend.models.backtest_config import BacktestConfig
from backend.models.strategy_tree import StrategyTree
from backend.services.algo_registry import REGISTRY, algo_json_schema
from backend.services.data_loader import fetch_ffn, load_csv, load_parquet
from backend.services.indicator_calculator import compute_indicator, get_indicator_defs
from backend.services.persistence import delete_strategy, get_strategy, list_strategies, save_strategy, update_strategy
from backend.services.tree_serializer import to_bt_strategy

router = APIRouter(prefix="/api/bt", tags=["bt-gui"])


# ---- DB switch (main/test) ----


@router.get("/db")
def get_db_info():
    from backend.database import get_active_db

    active = get_active_db()
    # counts per DB (lightweight)

    from backend.database import SessionLocal_main, SessionLocal_test, Strategy as DBStrategy

    def counts_for(session_factory):
        db = session_factory()
        try:
            return {
                "strategies": db.query(DBStrategy).count(),
                "data_sources": db.query(DBSource).count(),
                "runs": db.query(DBRun).count(),
            }
        except Exception:
            return {"strategies": 0, "data_sources": 0, "runs": 0}
        finally:
            db.close()

    return {
        "active": active,
        "dbs": [
            {"name": "main", "file": "bt_gui.db", "counts": counts_for(SessionLocal_main)},
            {"name": "test", "file": "bt_gui_test.db", "counts": counts_for(SessionLocal_test)},
        ],
    }


class SwitchDbRequest(BaseModel):
    db: str


@router.post("/db/switch")
def switch_db(req: SwitchDbRequest):
    from backend.database import get_active_db, set_active_db

    if req.db not in ("main", "test"):
        raise HTTPException(status_code=422, detail="db must be 'main' or 'test'")
    prev = get_active_db()
    cur = set_active_db(req.db)
    return {"active": cur, "previous": prev}


@router.get("/health")
def health(db: Session = Depends(get_db)):  # noqa: B008
    # check DB connectivity + counts (no extra deps)
    try:
        from backend.database import Strategy as DBStrategy

        db_ok = True
        db_error: str | None = None
        # lightweight ping
        db.execute(__import__("sqlalchemy").text("SELECT 1"))
        counts = {
            "strategies": db.query(DBStrategy).count(),
            "data_sources": db.query(DBSource).count(),
            "runs": db.query(DBRun).count(),
        }
    except Exception as e:  # noqa: BLE001
        db_ok = False
        db_error = str(e)
        counts = {"strategies": 0, "data_sources": 0, "runs": 0}
    import importlib.metadata as _im

    try:
        version = _im.version("bt-gui")
    except Exception:  # noqa: BLE001
        version = "0.1.0"
    return {"status": "ok" if db_ok else "error", "version": version, "db": "ok" if db_ok else "error", "db_error": db_error, "counts": counts}


@router.get("/stats")
def get_stats(db: Session = Depends(get_db)):  # noqa: B008
    from backend.database import Strategy as DBStrategy

    return {
        "strategies": db.query(DBStrategy).count(),
        "data_sources": db.query(DBSource).count(),
        "runs": db.query(DBRun).count(),
    }


@router.get("/algos")
def list_algos():
    return [
        {"name": name, "category": info["category"], "doc": info["doc"], "requires": info["requires"], "sets": info["sets"]}
        for name, info in sorted(REGISTRY.items())
    ]


@router.get("/algos/{name}/schema")
def algo_schema(name: str):
    try:
        return algo_json_schema(name)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"algo {name} not found")


@router.post("/strategies", status_code=201)
def create_strategy(tree: StrategyTree, db: Session = Depends(get_db)):  # noqa: B008
    try:
        to_bt_strategy(tree)
    except Exception as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    from backend.database import Strategy as DBStrategy

    existing = db.query(DBStrategy).filter(DBStrategy.name == tree.name).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"strategy name {tree.name} already exists")
    row = save_strategy(db, tree.name, tree.model_dump())
    return {"id": row.id, "name": row.name, "tree": row.tree_json, "created_at": row.created_at}


@router.get("/strategies")
def list_strategies_route(  # noqa: B008
    search: str | None = Query(None),
    sort_by: str | None = Query(None),
    sort_dir: str = Query("asc", pattern="^(asc|desc)$"),
    filter_id: str | None = Query(None),
    filter_name: str | None = Query(None),
    filter_created_at: str | None = Query(None),
    db: Session = Depends(get_db),  # noqa: B008
):
    rows = list_strategies(db)
    out = [{"id": r.id, "name": r.name, "tree": r.tree_json, "created_at": r.created_at} for r in rows]
    if search:
        q = search.lower()
        out = [r for r in out if q in str(r["name"]).lower() or q in str(r["id"]).lower() or q in str(r["created_at"]).lower()]
    if filter_id:
        q = filter_id.lower()
        out = [r for r in out if q in str(r["id"]).lower()]
    if filter_name:
        q = filter_name.lower()
        out = [r for r in out if q in str(r["name"]).lower()]
    if filter_created_at:
        q = filter_created_at.lower()
        out = [r for r in out if q in str(r["created_at"]).lower()]
    if sort_by:
        allowed = {"id", "name", "created_at"}
        if sort_by not in allowed:
            raise HTTPException(status_code=422, detail=f"sort_by {sort_by} not allowed (use {sorted(allowed)})")
        rev = sort_dir == "desc"
        out.sort(key=lambda r: (r[sort_by] is None, str(r[sort_by]).lower() if r[sort_by] is not None else ""), reverse=rev)
    return out


class BulkDeleteStrategiesRequest(BaseModel):
    ids: list[int]


@router.post("/strategies/bulk-delete")
def bulk_delete_strategies(req: BulkDeleteStrategiesRequest, db: Session = Depends(get_db)):  # noqa: B008
    if not req.ids:
        raise HTTPException(status_code=422, detail="ids required")
    from backend.database import Strategy as DBStrategy

    rows = db.query(DBStrategy).filter(DBStrategy.id.in_(req.ids)).all()
    found = {r.id for r in rows}
    for r in rows:
        db.delete(r)
    db.commit()
    return {"deleted": len(rows), "not_found": [i for i in req.ids if i not in found]}


@router.get("/strategies/{sid}")
def get_strategy_route(sid: int, db: Session = Depends(get_db)):  # noqa: B008
    row = get_strategy(db, sid)
    if row is None:
        raise HTTPException(status_code=404, detail="not found")
    return {"id": row.id, "name": row.name, "tree": row.tree_json, "created_at": row.created_at}


@router.put("/strategies/{sid}")
def update_strategy_route(sid: int, tree: StrategyTree, db: Session = Depends(get_db)):  # noqa: B008
    try:
        to_bt_strategy(tree)
    except Exception as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    from backend.database import Strategy as DBStrategy

    dup = db.query(DBStrategy).filter(DBStrategy.name == tree.name, DBStrategy.id != sid).first()
    if dup:
        raise HTTPException(status_code=409, detail=f"strategy name {tree.name} already exists")
    row = update_strategy(db, sid, tree.name, tree.model_dump())
    if row is None:
        raise HTTPException(status_code=404, detail="not found")
    return {"id": row.id, "name": row.name, "tree": row.tree_json, "created_at": row.created_at}


@router.delete("/strategies/{sid}", status_code=204)
def delete_strategy_route(sid: int, db: Session = Depends(get_db)):  # noqa: B008
    ok = delete_strategy(db, sid)
    if not ok:
        raise HTTPException(status_code=404, detail="not found")


# ---- DataSource routes ----


def _df_to_blob(df: pd.DataFrame) -> bytes:
    buf = io.BytesIO()
    df.to_parquet(buf)
    return buf.getvalue()


def _blob_to_df(blob: bytes) -> pd.DataFrame:
    return pd.read_parquet(io.BytesIO(blob))


def _meta(df: pd.DataFrame) -> dict[str, Any]:
    return {"shape": list(df.shape), "columns": list(df.columns), "start": str(df.index[0]), "end": str(df.index[-1])}


@router.post("/data-sources/upload", status_code=201)
def upload_data_source(
    name: str = Query(...),
    type: str = Query(...),
    file: UploadFile = File(...),  # noqa: B008
    db: Session = Depends(get_db),  # noqa: B008
):
    if file.filename and file.filename.endswith(".csv"):
        df = load_csv(file)
        source = "csv"
    elif file.filename and file.filename.endswith(".parquet"):
        df = load_parquet(file)
        source = "parquet"
    else:
        raise HTTPException(status_code=400, detail="only .csv/.parquet")
    if df.empty:
        raise HTTPException(status_code=422, detail="empty DataFrame")
    blob = _df_to_blob(df)
    meta = _meta(df)
    # unique name check
    if db.query(DBSource).filter(DBSource.name == name).first():
        raise HTTPException(status_code=409, detail=f"data source {name} exists")
    row = DBSource(name=name, type=type, source=source, path_or_tickers=file.filename, meta_json=meta, parquet_blob=blob)
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"id": row.id, "name": row.name, "meta": meta}


class FetchRequest(BaseModel):
    name: str
    type: str
    tickers: list[str]
    start: str | None = None
    end: str | None = None


@router.post("/data-sources/fetch", status_code=201)
def fetch_data_source(req: FetchRequest, db: Session = Depends(get_db)):  # noqa: B008
    if not req.tickers:
        raise HTTPException(status_code=422, detail="tickers required")
    try:
        df = fetch_ffn(req.tickers, req.start or "", req.end or "")
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
    if df.empty:
        raise HTTPException(status_code=422, detail="empty result from ffn")
    blob = _df_to_blob(df)
    meta = _meta(df)
    if db.query(DBSource).filter(DBSource.name == req.name).first():
        raise HTTPException(status_code=409, detail=f"data source {req.name} exists")
    row = DBSource(name=req.name, type=req.type, source="ffn", path_or_tickers=",".join(req.tickers), meta_json=meta, parquet_blob=blob)
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"id": row.id, "name": row.name, "meta": meta}


@router.get("/data-sources")
def list_data_sources(  # noqa: B008
    search: str | None = Query(None),
    sort_by: str | None = Query(None),
    sort_dir: str = Query("asc", pattern="^(asc|desc)$"),
    db: Session = Depends(get_db),  # noqa: B008
):
    rows = db.query(DBSource).order_by(DBSource.id).all()
    out = [{"id": r.id, "name": r.name, "type": r.type, "source": r.source, "meta": r.meta_json, "path_or_tickers": r.path_or_tickers} for r in rows]
    if search:
        q = search.lower()
        out = [  # noqa: E501
            r
            for r in out
            if q in str(r["name"]).lower()
            or q in str(r["type"]).lower()
            or q in str(r["source"]).lower()
            or q in str(r["path_or_tickers"]).lower()
            or q in str(r["id"]).lower()
        ]
    if sort_by:
        rev = sort_dir == "desc"
        allowed = {"id", "name", "type", "source"}
        if sort_by not in allowed:
            raise HTTPException(status_code=422, detail=f"sort_by {sort_by} not allowed (use {sorted(allowed)})")
        out.sort(key=lambda r: (r[sort_by] is None, str(r[sort_by]).lower()), reverse=rev)
    return out


class BulkDeleteDataSourcesRequest(BaseModel):
    ids: list[int]


@router.post("/data-sources/bulk-delete")
def bulk_delete_data_sources(req: BulkDeleteDataSourcesRequest, db: Session = Depends(get_db)):  # noqa: B008
    if not req.ids:
        raise HTTPException(status_code=422, detail="ids required")
    rows = db.query(DBSource).filter(DBSource.id.in_(req.ids)).all()
    found_ids = {r.id for r in rows}
    for r in rows:
        db.delete(r)
    db.commit()
    return {"deleted": len(rows), "not_found": [i for i in req.ids if i not in found_ids]}


@router.delete("/data-sources/{sid}", status_code=204)
def delete_data_source(sid: int, db: Session = Depends(get_db)):  # noqa: B008
    row = db.query(DBSource).filter(DBSource.id == sid).first()
    if row is None:
        raise HTTPException(status_code=404, detail="not found")
    db.delete(row)
    db.commit()


class DeleteRowsRequest(BaseModel):
    dates: list[str]


@router.post("/data-sources/{sid}/rows/delete")
def delete_rows(sid: int, req: DeleteRowsRequest, db: Session = Depends(get_db)):  # noqa: B008
    row = db.query(DBSource).filter(DBSource.id == sid).first()
    if row is None:
        raise HTTPException(status_code=404, detail="not found")
    if row.parquet_blob is None:
        raise HTTPException(status_code=422, detail="no data")
    if not req.dates:
        raise HTTPException(status_code=422, detail="dates required")
    df = _blob_to_df(row.parquet_blob)
    # allow empty df after delete (opzione A)
    try:
        idx = pd.to_datetime(df.index)
    except Exception:
        idx = df.index
    df.index = idx  # type: ignore[assignment]
    to_drop = pd.to_datetime(req.dates, errors="coerce")
    # keep only valid parsed dates
    to_drop = [d for d in to_drop if not pd.isna(d)]  # type: ignore[union-attr]
    if not to_drop:
        raise HTTPException(status_code=422, detail="no valid dates")
    before = len(df)
    df = df.drop(index=to_drop, errors="ignore")
    deleted = before - len(df)
    # recompute blob + meta (allow empty)
    if df.empty:
        # keep columns, empty index
        blob = _df_to_blob(df)
        meta: dict[str, Any] = {"shape": list(df.shape), "columns": list(df.columns), "start": None, "end": None}
    else:
        blob = _df_to_blob(df)
        meta = _meta(df)
    row.parquet_blob = blob
    row.meta_json = meta
    db.commit()
    return {"deleted": deleted, "remaining": len(df), "shape": list(df.shape)}


@router.get("/data-sources/{sid}")
def get_data_source(sid: int, db: Session = Depends(get_db)):  # noqa: B008
    row = db.query(DBSource).filter(DBSource.id == sid).first()
    if row is None:
        raise HTTPException(status_code=404, detail="not found")
    return {"id": row.id, "name": row.name, "type": row.type, "source": row.source, "meta": row.meta_json, "path_or_tickers": row.path_or_tickers}


@router.get("/data-sources/{sid}/preview")
def preview_data_source(sid: int, limit: int = 5, db: Session = Depends(get_db)):  # noqa: B008
    row = db.query(DBSource).filter(DBSource.id == sid).first()
    if row is None:
        raise HTTPException(status_code=404, detail="not found")
    if row.parquet_blob is None:
        raise HTTPException(status_code=422, detail="no data")
    df = _blob_to_df(row.parquet_blob)
    head = df.sort_index(ascending=False).head(limit)
    rows = []
    for idx, r in head.iterrows():
        rec: dict[str, Any] = {"date": str(idx)}
        for c in df.columns:
            v = r[c]
            if pd.isna(v):
                rec[str(c)] = None
            else:
                try:
                    rec[str(c)] = float(v)  # type: ignore[arg-type]
                except Exception:
                    rec[str(c)] = str(v)
        rows.append(rec)
    return {"columns": list(df.columns), "rows": rows, "shape": list(df.shape)}


@router.get("/data-sources/{sid}/table")
def table_data_source(
    sid: int,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    sort_by: str | None = Query(None),
    sort_dir: str = Query("asc", pattern="^(asc|desc)$"),
    search: str | None = Query(None),
    db: Session = Depends(get_db),  # noqa: B008
):
    row = db.query(DBSource).filter(DBSource.id == sid).first()
    if row is None:
        raise HTTPException(status_code=404, detail="not found")
    if row.parquet_blob is None:
        raise HTTPException(status_code=422, detail="no data")
    df = _blob_to_df(row.parquet_blob)
    # normalize index to string date for filtering/sorting
    df = df.copy()
    # keep original shape before filter
    original_shape = list(df.shape)
    # filtering: global search across date and all columns
    if search:
        q = search.lower()
        mask = df.index.astype(str).str.lower().str.contains(q, na=False)
        for c in df.columns:
            mask = mask | df[c].astype(str).str.lower().str.contains(q, na=False)
        df = df[mask]
    # sorting
    if sort_by:
        asc = sort_dir == "asc"
        if sort_by == "date":
            df = df.sort_index(ascending=asc)
        elif sort_by in df.columns:
            df = df.sort_values(by=sort_by, ascending=asc, na_position="last")
        else:
            raise HTTPException(status_code=422, detail=f"sort_by {sort_by} not found")
    total = len(df)
    page = df.iloc[offset : offset + limit]
    rows: list[dict[str, Any]] = []
    for idx, r in page.iterrows():
        rec: dict[str, Any] = {"date": str(idx)}
        for c in df.columns:
            v = r[c]
            if pd.isna(v):
                rec[str(c)] = None
            else:
                try:
                    rec[str(c)] = float(v)  # type: ignore[arg-type]
                except Exception:
                    rec[str(c)] = str(v)
        rows.append(rec)
    return {
        "columns": list(df.columns),
        "rows": rows,
        "total": total,
        "shape": original_shape,
        "filtered_shape": [total, len(df.columns)],
        "offset": offset,
        "limit": limit,
    }


# ---- Indicator routes ----


class ComputeIndicatorRequest(BaseModel):
    price_source_id: int
    type: str
    params: dict[str, Any] = {}
    save: bool = True
    name: str | None = None  # optional custom name; auto-generated if not provided


@router.get("/indicators")
def list_indicators(db: Session = Depends(get_db)):  # noqa: B008
    rows = db.query(DBSource).filter(DBSource.type == "indicator").order_by(DBSource.id.desc()).all()
    return [{"id": r.id, "name": r.name, "type": r.type, "source": r.source, "meta": r.meta_json, "path_or_tickers": r.path_or_tickers} for r in rows]


@router.get("/indicators/defs")
def list_indicator_defs():
    return get_indicator_defs()


@router.post("/indicators/compute", status_code=201)
def compute_indicator_route(req: ComputeIndicatorRequest, db: Session = Depends(get_db)):  # noqa: B008
    prow = db.query(DBSource).filter(DBSource.id == req.price_source_id).first()
    if prow is None:
        raise HTTPException(status_code=404, detail="price source not found")
    if prow.parquet_blob is None:
        raise HTTPException(status_code=422, detail="price source has no data")
    price_df = _blob_to_df(prow.parquet_blob)
    price_df.index = pd.to_datetime(price_df.index)
    try:
        result, meta = compute_indicator(req.type, price_df, req.params)
    except Exception as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    meta["indicator_type"] = req.type
    meta["params"] = req.params
    if not req.save:
        # Return computed result without saving — only meta + shape
        shape = list(result.shape) if isinstance(result, pd.DataFrame) else None
        return {"meta": meta, "shape": shape}
    # Save computed indicator as a DataSource
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
        path_or_tickers=str(prow.id),
        meta_json=meta,
        parquet_blob=blob,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"id": row.id, "name": row.name, "meta": meta}


# ---- Backtest routes (imported lazily to avoid circular) ----


class RunRequest(BaseModel):
    strategy_id: int | None = None
    tree: StrategyTree | None = None
    config: BacktestConfig = BacktestConfig()  # type: ignore[call-arg]
    price_source_id: int
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
    prow = db.query(DBSource).filter(DBSource.id == req.price_source_id).first()
    if prow is None:
        raise HTTPException(status_code=404, detail="price source not found")
    if prow.parquet_blob is None:
        raise HTTPException(status_code=422, detail="price source has no data")
    for vid in req.extra_source_ids.values():
        if db.query(DBSource).filter(DBSource.id == vid).first() is None:
            raise HTTPException(status_code=404, detail=f"extra source {vid} not found")
    # ponytail: persist tree name + price range so Results shows strategy/start/end even when run from unsaved tree
    cfg_dict = req.config.model_dump()
    if tree is not None and getattr(tree, "name", None):
        cfg_dict["strategy_name"] = tree.name
    try:
        _p_df = _blob_to_df(prow.parquet_blob)
        cfg_dict["start"] = str(_p_df.index.min())[:10] if len(_p_df) else None  # type: ignore[union-attr]
        cfg_dict["end"] = str(_p_df.index.max())[:10] if len(_p_df) else None  # type: ignore[union-attr]
    except Exception:
        pass
    row = DBRun(strategy_id=strategy_id, config_json=cfg_dict, stats_json=None)
    db.add(row)
    db.commit()
    db.refresh(row)
    run_id = row.id
    # load dataframes from the same db session (avoids SessionLocal mismatch in tests)
    price_df = _blob_to_df(prow.parquet_blob)
    price_df.index = pd.to_datetime(price_df.index)
    additional: dict[str, pd.DataFrame] = {}
    volume = None
    volatility = None
    for k, vid in req.extra_source_ids.items():
        erow = db.query(DBSource).filter(DBSource.id == vid).first()
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
    # Load indicator dataframes for algo param resolution
    indicators: dict[str, pd.DataFrame] = {}
    for ind_id in req.indicator_source_ids:
        ind_row = db.query(DBSource).filter(DBSource.id == ind_id).first()
        if ind_row is None or ind_row.parquet_blob is None:
            continue
        ind_df = _blob_to_df(ind_row.parquet_blob)
        ind_df.index = pd.to_datetime(ind_df.index)
        indicators[str(ind_id)] = ind_df
    try:
        schedule_backtest(run_id, tree, req.config, price_df, additional, volume, volatility, indicators)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
    return {"id": run_id, "status": "running"}


@router.get("/runs")
def list_runs(  # noqa: B008
    search: str | None = Query(None),
    sort_by: str | None = Query(None),
    sort_dir: str = Query("asc", pattern="^(asc|desc)$"),
    filter_id: str | None = Query(None),
    filter_strategy_id: str | None = Query(None),
    filter_strategy_name: str | None = Query(None),
    filter_created_at: str | None = Query(None),
    filter_stats: str | None = Query(None),
    filter_start: str | None = Query(None),
    filter_end: str | None = Query(None),
    filter_total_return: str | None = Query(None),
    filter_max_drawdown: str | None = Query(None),
    filter_sharpe: str | None = Query(None),
    filter_sortino: str | None = Query(None),
    db: Session = Depends(get_db),  # noqa: B008
):
    rows = db.query(DBRun).order_by(DBRun.id.desc()).all()
    # build strategy id -> name map (avoids N+1 query)
    from backend.database import Strategy as DBStrategy

    strat_rows = db.query(DBStrategy).all()
    name_by_id = {s.id: s.name for s in strat_rows}

    def _run_start_end(r: DBRun) -> tuple[str | None, str | None]:
        cfg = r.config_json if isinstance(r.config_json, dict) else {}
        s = cfg.get("start")
        e = cfg.get("end")
        if s and e:
            return str(s)[:10], str(e)[:10]
        # fallback for old runs: decode prices_parquet
        if r.prices_parquet:
            try:
                df = _blob_to_df(r.prices_parquet)
                return str(df.index.min())[:10], str(df.index.max())[:10]  # type: ignore[union-attr]
            except Exception:
                pass
        return (str(s)[:10] if s else None), (str(e)[:10] if e else None)

    out = []
    for r in rows:
        s, e = _run_start_end(r)
        cfg = r.config_json if isinstance(r.config_json, dict) else {}
        stats = r.stats_json if isinstance(r.stats_json, dict) else {}
        def _num(v: object) -> float | None:  # noqa: ANN401
            if v is None:
                return None
            try:
                f = float(v)  # type: ignore[arg-type]
                return None if (math.isnan(f) or math.isinf(f)) else f
            except Exception:
                return None
        cagr = _num(stats.get("cagr"))
        total_return = _num(stats.get("total_return"))
        max_drawdown = _num(stats.get("max_drawdown")) or _num(stats.get("max_dd"))
        sharpe = _num(stats.get("daily_sharpe")) or _num(stats.get("monthly_sharpe"))
        sortino = _num(stats.get("daily_sortino")) or _num(stats.get("monthly_sortino"))
        out.append(
            {
                "id": r.id,
                "strategy_id": r.strategy_id,
                "strategy_name": (
                    name_by_id.get(r.strategy_id) if r.strategy_id is not None else None
                ) or cfg.get("strategy_name"),
                "stats": r.stats_json,
                "config": r.config_json,
                "created_at": r.created_at,
                "start": s,
                "end": e,
                "cagr": cagr,
                "total_return": total_return,
                "max_drawdown": max_drawdown,
                "sharpe": sharpe,
                "sortino": sortino,
                "_cagr": cagr,
                "_total_return": total_return,
                "_max_drawdown": max_drawdown,
                "_sharpe": sharpe,
                "_sortino": sortino,
            }
        )
    if search:
        q = search.lower()
        out = [
            r
            for r in out
            if q in str(r["id"]).lower()
            or q in str(r["strategy_id"]).lower()
            or q in str(r["strategy_name"] or "").lower()
            or q in str(r["created_at"]).lower()
            or q in str(r["stats"]).lower()
            or q in str(r["start"] or "").lower()
            or q in str(r["end"] or "").lower()
        ]
    # per-column filters (substring match)
    if filter_id:
        q = filter_id.lower()
        out = [r for r in out if q in str(r["id"]).lower()]
    if filter_strategy_id:
        q = filter_strategy_id.lower()
        out = [r for r in out if q in str(r["strategy_id"]).lower()]
    if filter_strategy_name:
        q = filter_strategy_name.lower()
        out = [r for r in out if q in str(r["strategy_name"] or "").lower()]
    if filter_created_at:
        q = filter_created_at.lower()
        out = [r for r in out if q in str(r["created_at"]).lower()]
    if filter_start:
        q = filter_start.lower()
        out = [r for r in out if q in str(r["start"] or "").lower()]
    if filter_end:
        q = filter_end.lower()
        out = [r for r in out if q in str(r["end"] or "").lower()]
    if filter_total_return:
        q = filter_total_return.lower()
        out = [r for r in out if q in str(r["total_return"] or "").lower()]
    if filter_max_drawdown:
        q = filter_max_drawdown.lower()
        out = [r for r in out if q in str(r["max_drawdown"] or "").lower()]
    if filter_sharpe:
        q = filter_sharpe.lower()
        out = [r for r in out if q in str(r["sharpe"] or "").lower()]
    if filter_sortino:
        q = filter_sortino.lower()
        out = [r for r in out if q in str(r["sortino"] or "").lower()]
    if filter_stats:
        q = filter_stats.lower()
        out = [r for r in out if q in str(r["stats"]).lower()]
    _NUMERIC_SORT_KEYS = {"cagr", "total_return", "max_drawdown", "sharpe", "sortino"}
    if sort_by:
        allowed = {"id", "strategy_name", "created_at", "start", "end"} | _NUMERIC_SORT_KEYS
        if sort_by not in allowed:
            raise HTTPException(status_code=422, detail=f"sort_by {sort_by} not allowed (use {sorted(allowed)})")
        rev = sort_dir == "desc"
        if sort_by in _NUMERIC_SORT_KEYS:
            out.sort(key=lambda r: (r[sort_by] is None, r.get(f"_{sort_by}") or 0), reverse=rev)
        else:
            out.sort(key=lambda r: (r[sort_by] is None, str(r[sort_by]).lower() if r[sort_by] is not None else ""), reverse=rev)
    for r in out:
        for k in [f"_{kk}" for kk in ["cagr","total_return","max_drawdown","sharpe","sortino"]]:
            r.pop(k, None)
    return out


class BulkDeleteRunsRequest(BaseModel):
    ids: list[int]


@router.post("/runs/bulk-delete")
def bulk_delete_runs(req: BulkDeleteRunsRequest, db: Session = Depends(get_db)):  # noqa: B008
    if not req.ids:
        raise HTTPException(status_code=422, detail="ids required")
    rows = db.query(DBRun).filter(DBRun.id.in_(req.ids)).all()
    found = {r.id for r in rows}
    for r in rows:
        db.delete(r)
    db.commit()
    return {"deleted": len(rows), "not_found": [i for i in req.ids if i not in found]}


@router.delete("/runs/{run_id}", status_code=204)
def delete_run(run_id: int, db: Session = Depends(get_db)):  # noqa: B008
    row = db.query(DBRun).filter(DBRun.id == run_id).first()
    if row is None:
        raise HTTPException(status_code=404, detail="not found")
    db.delete(row)
    db.commit()


@router.get("/runs/{run_id}")
def get_run(run_id: int, db: Session = Depends(get_db)):  # noqa: B008
    row = db.query(DBRun).filter(DBRun.id == run_id).first()
    if row is None:
        raise HTTPException(status_code=404, detail="not found")
    from backend.database import Strategy as DBStrategy

    strat_name = None
    if row.strategy_id is not None:
        s = db.query(DBStrategy).filter(DBStrategy.id == row.strategy_id).first()
        if s is not None:
            strat_name = s.name
    # fallback for runs created from unsaved tree
    if not strat_name and isinstance(row.config_json, dict):
        strat_name = row.config_json.get("strategy_name")
    # decode transactions if available
    tx = None
    if row.transactions_parquet:
        try:
            df = _blob_to_df(row.transactions_parquet)
            tx = df.head(100).to_dict(orient="records")
        except Exception:  # noqa: BLE001
            tx = None
    # start/end from config or prices_parquet
    start = end = None
    if isinstance(row.config_json, dict):
        start = row.config_json.get("start")
        end = row.config_json.get("end")
        if start:
            start = str(start)[:10]
        if end:
            end = str(end)[:10]
    if (not start or not end) and row.prices_parquet:
        try:
            dfp = _blob_to_df(row.prices_parquet)
            start = start or str(dfp.index.min())[:10]  # type: ignore[union-attr]
            end = end or str(dfp.index.max())[:10]  # type: ignore[union-attr]
        except Exception:
            pass
    return {
        "id": row.id,
        "strategy_id": row.strategy_id,
        "strategy_name": strat_name,
        "stats": row.stats_json,
        "config": row.config_json,
        "created_at": row.created_at,
        "start": start,
        "end": end,
        "transactions": tx,
    }


@router.get("/runs/{run_id}/prices")
def get_run_prices(run_id: int, db: Session = Depends(get_db)):  # noqa: B008
    row = db.query(DBRun).filter(DBRun.id == run_id).first()
    if row is None:
        raise HTTPException(status_code=404, detail="not found")
    if row.prices_parquet is None:
        return {"dates": [], "values": [], "weights": {}}
    df = _blob_to_df(row.prices_parquet)
    # prices parquet contains Date index + columns: price, optionally weights
    # Normalize: if single column assume price series
    dates = [str(i) for i in df.index]
    if "price" in df.columns:
        values = df["price"].tolist()
        # weights: remaining columns
        weights: dict[str, list] = {}
        for c in df.columns:
            if c != "price":
                weights[c] = df[c].tolist()
        return {"dates": dates, "values": values, "weights": weights}
    # fallback: first column is price
    first = df.columns[0]
    return {"dates": dates, "values": df[first].tolist(), "weights": {}}


@router.websocket("/backtest/{run_id}/progress")
async def ws_progress(websocket: WebSocket, run_id: int):
    await websocket.accept()
    try:
        import asyncio

        from backend.services.backtest_runner import get_progress

        while True:
            prog = get_progress(run_id)
            await websocket.send_json(prog)
            if prog.get("done") or prog.get("error"):
                break
            await asyncio.sleep(0.2)
    except WebSocketDisconnect:
        pass
    except Exception:  # noqa: BLE001
        try:
            await websocket.close()
        except Exception:  # noqa: BLE001
            pass

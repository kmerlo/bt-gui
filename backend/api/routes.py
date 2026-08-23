from __future__ import annotations

import io
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
from backend.services.persistence import delete_strategy, get_strategy, list_strategies, save_strategy, update_strategy
from backend.services.tree_serializer import to_bt_strategy

router = APIRouter(prefix="/api/bt", tags=["bt-gui"])


@router.get("/health")
def health():
    return {"status": "ok"}


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
def list_strategies_route(db: Session = Depends(get_db)):  # noqa: B008
    rows = list_strategies(db)
    return [{"id": r.id, "name": r.name, "tree": r.tree_json, "created_at": r.created_at} for r in rows]


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
def list_data_sources(db: Session = Depends(get_db)):  # noqa: B008
    rows = db.query(DBSource).order_by(DBSource.id).all()
    return [{"id": r.id, "name": r.name, "type": r.type, "source": r.source, "meta": r.meta_json, "path_or_tickers": r.path_or_tickers} for r in rows]


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
    head = df.head(limit)
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


# ---- Backtest routes (imported lazily to avoid circular) ----


class RunRequest(BaseModel):
    strategy_id: int | None = None
    tree: StrategyTree | None = None
    config: BacktestConfig = BacktestConfig()  # type: ignore[call-arg]
    price_source_id: int
    extra_source_ids: dict[str, int] = {}


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
    row = DBRun(strategy_id=strategy_id, config_json=req.config.model_dump(), stats_json=None)
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
    try:
        schedule_backtest(run_id, tree, req.config, price_df, additional, volume, volatility)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
    return {"id": run_id, "status": "running"}


@router.get("/runs")
def list_runs(db: Session = Depends(get_db)):  # noqa: B008
    rows = db.query(DBRun).order_by(DBRun.id.desc()).all()
    return [{"id": r.id, "strategy_id": r.strategy_id, "stats": r.stats_json, "config": r.config_json, "created_at": r.created_at} for r in rows]


@router.get("/runs/{run_id}")
def get_run(run_id: int, db: Session = Depends(get_db)):  # noqa: B008
    row = db.query(DBRun).filter(DBRun.id == run_id).first()
    if row is None:
        raise HTTPException(status_code=404, detail="not found")
    # decode transactions if available
    tx = None
    if row.transactions_parquet:
        try:
            df = _blob_to_df(row.transactions_parquet)
            tx = df.head(100).to_dict(orient="records")
        except Exception:  # noqa: BLE001
            tx = None
    return {"id": row.id, "strategy_id": row.strategy_id, "stats": row.stats_json, "config": row.config_json, "created_at": row.created_at, "transactions": tx}


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

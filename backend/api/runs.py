from __future__ import annotations

import math

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.api._helpers import _blob_to_df
from backend.api._query import apply_sort
from backend.database import BacktestRun as DBRun
from backend.database import get_db

router = APIRouter(tags=["bt-gui"])


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
    from backend.database import Strategy as DBStrategy

    strat_rows = db.query(DBStrategy).all()
    name_by_id = {s.id: s.name for s in strat_rows}

    def _run_start_end(r: DBRun) -> tuple[str | None, str | None]:
        cfg = r.config_json if isinstance(r.config_json, dict) else {}
        s = cfg.get("start")
        e = cfg.get("end")
        if s and e:
            return str(s)[:10], str(e)[:10]
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
                "strategy_name": (name_by_id.get(r.strategy_id) if r.strategy_id is not None else None) or cfg.get("strategy_name"),
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
    # ponytail: single pass over out instead of 12 sequential scans
    q_search = search.lower() if search else None
    q_id = filter_id.lower() if filter_id else None
    q_sid = filter_strategy_id.lower() if filter_strategy_id else None
    q_sname = filter_strategy_name.lower() if filter_strategy_name else None
    q_created = filter_created_at.lower() if filter_created_at else None
    q_start = filter_start.lower() if filter_start else None
    q_end = filter_end.lower() if filter_end else None
    q_tr = filter_total_return.lower() if filter_total_return else None
    q_dd = filter_max_drawdown.lower() if filter_max_drawdown else None
    q_sharpe = filter_sharpe.lower() if filter_sharpe else None
    q_sortino = filter_sortino.lower() if filter_sortino else None
    q_stats = filter_stats.lower() if filter_stats else None
    if any((q_search, q_id, q_sid, q_sname, q_created, q_start, q_end, q_tr, q_dd, q_sharpe, q_sortino, q_stats)):
        filtered: list[dict] = []
        for r in out:
            if q_search and not (
                q_search in str(r["id"]).lower()
                or q_search in str(r["strategy_id"]).lower()
                or q_search in str(r["strategy_name"] or "").lower()
                or q_search in str(r["created_at"]).lower()
                or q_search in str(r["stats"]).lower()
                or q_search in str(r["start"] or "").lower()
                or q_search in str(r["end"] or "").lower()
            ):
                continue
            if q_id and q_id not in str(r["id"]).lower():
                continue
            if q_sid and q_sid not in str(r["strategy_id"]).lower():
                continue
            if q_sname and q_sname not in str(r["strategy_name"] or "").lower():
                continue
            if q_created and q_created not in str(r["created_at"]).lower():
                continue
            if q_start and q_start not in str(r["start"] or "").lower():
                continue
            if q_end and q_end not in str(r["end"] or "").lower():
                continue
            if q_tr and q_tr not in str(r["total_return"] or "").lower():
                continue
            if q_dd and q_dd not in str(r["max_drawdown"] or "").lower():
                continue
            if q_sharpe and q_sharpe not in str(r["sharpe"] or "").lower():
                continue
            if q_sortino and q_sortino not in str(r["sortino"] or "").lower():
                continue
            if q_stats and q_stats not in str(r["stats"]).lower():
                continue
            filtered.append(r)
        out = filtered
    _NUMERIC_SORT_KEYS = {"cagr", "total_return", "max_drawdown", "sharpe", "sortino"}
    if sort_by:
        allowed = {"id", "strategy_name", "created_at", "start", "end"} | _NUMERIC_SORT_KEYS
        if sort_by not in allowed:
            raise HTTPException(status_code=422, detail=f"sort_by {sort_by} not allowed (use {sorted(allowed)})")
        rev = sort_dir == "desc"
        if sort_by in _NUMERIC_SORT_KEYS:
            out.sort(key=lambda r: (r[sort_by] is None, r.get(f"_{sort_by}") or 0), reverse=rev)
        else:
            # reuse shared helper for non-numeric keys
            apply_sort(out, sort_by, sort_dir, allowed - _NUMERIC_SORT_KEYS | {"id", "strategy_name", "created_at", "start", "end"})  # noqa: E501
            # fallback if helper altered behaviour: keep original string lower sort
            # (helper already sorted; keep no-op)
    for r in out:
        for k in [f"_{kk}" for kk in ["cagr", "total_return", "max_drawdown", "sharpe", "sortino"]]:
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
    if not strat_name and isinstance(row.config_json, dict):
        strat_name = row.config_json.get("strategy_name")
    tx = None
    if row.transactions_parquet:
        try:
            df = _blob_to_df(row.transactions_parquet)
            tx = df.reset_index().head(100).to_dict(orient="records")
        except Exception:  # noqa: BLE001
            tx = None
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
        "warnings": (row.stats_json or {}).get("warnings") if isinstance(row.stats_json, dict) else None,
    }


@router.get("/runs/{run_id}/prices")
def get_run_prices(run_id: int, db: Session = Depends(get_db)):  # noqa: B008
    row = db.query(DBRun).filter(DBRun.id == run_id).first()
    if row is None:
        raise HTTPException(status_code=404, detail="not found")
    if row.prices_parquet is None:
        return {"dates": [], "values": [], "weights": {}}
    df = _blob_to_df(row.prices_parquet)
    dates = [str(i) for i in df.index]
    if "price" in df.columns:
        values = df["price"].tolist()
        weights: dict[str, list] = {}
        for c in df.columns:
            if c != "price":
                weights[c] = df[c].tolist()
        return {"dates": dates, "values": values, "weights": weights}
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

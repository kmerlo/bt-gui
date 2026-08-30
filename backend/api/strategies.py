from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.api._query import apply_search, apply_sort
from backend.database import get_db
from backend.models.strategy_tree import StrategyTree
from backend.services.persistence import delete_strategy, get_strategy, list_strategies, save_strategy, update_strategy
from backend.services.tree_serializer import to_bt_strategy

router = APIRouter(tags=["bt-gui"])


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
        out = apply_search(out, search, ["name", "id", "created_at"])
    if filter_id:
        out = apply_search(out, filter_id, ["id"])
    if filter_name:
        out = apply_search(out, filter_name, ["name"])
    if filter_created_at:
        out = apply_search(out, filter_created_at, ["created_at"])
    apply_sort(out, sort_by, sort_dir, {"id", "name", "created_at"})
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

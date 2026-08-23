from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models.strategy_tree import StrategyTree
from backend.services.algo_registry import REGISTRY, algo_json_schema
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
    # Validate tree can be built into bt.Strategy (fail-fast)
    try:
        to_bt_strategy(tree)
    except Exception as e:
        raise HTTPException(status_code=422, detail=str(e)) from e

    # Check duplicate name
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

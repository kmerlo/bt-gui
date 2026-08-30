from __future__ import annotations

from fastapi import APIRouter, HTTPException

from backend.services.algo_registry import REGISTRY, algo_json_schema

router = APIRouter(tags=["bt-gui"])


@router.get("/algos")
def list_algos():
    return [{"name": name, "category": info["category"], "doc": info["doc"], "requires": info["requires"], "sets": info["sets"]} for name, info in sorted(REGISTRY.items())]


@router.get("/algos/{name}/schema")
def algo_schema(name: str):
    try:
        return algo_json_schema(name)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"algo {name} not found")

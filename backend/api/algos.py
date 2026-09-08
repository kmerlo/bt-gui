from __future__ import annotations

import importlib
import json
from fastapi import APIRouter, HTTPException

from backend.services.algo_registry import REGISTRY, algo_json_schema

router = APIRouter(tags=["bt-gui"])


@router.get("/algos")
def list_algos():
    return [
        {"name": name, "category": info["category"], "doc": info["doc"], "requires": info["requires"], "sets": info["sets"], "param_docs": info["param_docs"]}
        for name, info in sorted(REGISTRY.items())
    ]


@router.get("/algos/{name}/schema")
def algo_schema(name: str):
    try:
        return algo_json_schema(name)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"algo {name} not found")


@router.post("/algos/{name}/validate")
def algo_validate(name: str, params: dict, available_tickers: list[str] | None = None):
    """Validate algo params against available tickers. Returns list of warning strings."""
    # ponytail: lazy import custom algos module to access RegimeRotation.validate_params
    try:
        mod = importlib.import_module("backend.services.regime_rotation")
        cls = getattr(mod, name, None)
        if cls and hasattr(cls, "validate_params"):
            return cls.validate_params(params, available_tickers or [])
    except Exception:
        pass
    return []


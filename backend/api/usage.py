from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.database import DataSource as DBSource
from backend.database import get_db
from backend.services.persistence import list_strategies

router = APIRouter(tags=["bt-gui"])


class UsageResponse(BaseModel):
    indicators: dict[int, list[str]]
    signals: dict[int, list[str]]


def _collect_ids(tree_json: dict) -> set[int]:
    """Mirror of frontend utils/collectIds: numeric algo params + preset lists."""
    ids: set[int] = set()

    def walk(node: object) -> None:
        if not isinstance(node, dict):
            return
        for a in node.get("algos") or []:
            if not isinstance(a, dict):
                continue
            for v in (a.get("params") or {}).values():
                if isinstance(v, str) and v.strip().isdigit():
                    ids.add(int(v.strip()))
                elif isinstance(v, int) and not isinstance(v, bool):
                    ids.add(v)
        for c in node.get("children") or []:
            walk(c)

    if isinstance(tree_json, dict):
        root = tree_json.get("root", tree_json)
        walk(root)
        preset = tree_json.get("preset") or {}
        if isinstance(preset, dict):
            for key in ("indicator_source_ids", "signal_source_ids"):
                for v in preset.get(key) or []:
                    if isinstance(v, int) and not isinstance(v, bool):
                        ids.add(v)
    return ids


@router.get("/usage", response_model=UsageResponse)
def get_usage(db: Session = Depends(get_db)):  # noqa: B008
    rows = db.query(DBSource).filter(DBSource.type.in_(["indicator", "signal"])).all()
    kind_by_id = {r.id: r.type for r in rows}
    ind: dict[int, set[str]] = {}
    sig: dict[int, set[str]] = {}
    for s in list_strategies(db):
        for iid in _collect_ids(s.tree_json or {}):
            kind = kind_by_id.get(iid)
            if kind == "indicator":
                ind.setdefault(iid, set()).add(s.name)
            elif kind == "signal":
                sig.setdefault(iid, set()).add(s.name)
    return UsageResponse(
        indicators={k: sorted(v) for k, v in ind.items()},
        signals={k: sorted(v) for k, v in sig.items()},
    )

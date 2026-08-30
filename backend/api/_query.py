from __future__ import annotations

from fastapi import HTTPException


def apply_search(out: list[dict], q: str, fields: list[str]) -> list[dict]:
    ql = q.lower()
    return [r for r in out if any(ql in str(r.get(f) or "").lower() for f in fields)]


def apply_sort(out: list[dict], sort_by: str | None, sort_dir: str, allowed: set[str]) -> None:
    if not sort_by:
        return
    if sort_by not in allowed:
        raise HTTPException(status_code=422, detail=f"sort_by {sort_by} not allowed (use {sorted(allowed)})")
    rev = sort_dir == "desc"
    out.sort(key=lambda r: (r[sort_by] is None, str(r[sort_by]).lower() if r[sort_by] is not None else ""), reverse=rev)

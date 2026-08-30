from __future__ import annotations

import importlib.metadata as _im

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from backend.database import BacktestRun as DBRun
from backend.database import DataSource as DBSource
from backend.database import get_db

router = APIRouter(tags=["bt-gui"])


@router.get("/db")
def get_db_info():
    from backend.database import get_active_db
    from backend.database import SessionLocal_main, SessionLocal_test, Strategy as DBStrategy

    active = get_active_db()

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
    try:
        from backend.database import Strategy as DBStrategy

        db_ok = True
        db_error: str | None = None
        db.execute(text("SELECT 1"))
        counts = {
            "strategies": db.query(DBStrategy).count(),
            "data_sources": db.query(DBSource).count(),
            "runs": db.query(DBRun).count(),
        }
    except Exception as e:  # noqa: BLE001
        db_ok = False
        db_error = str(e)
        counts = {"strategies": 0, "data_sources": 0, "runs": 0}
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

from __future__ import annotations

from sqlalchemy.orm import Session

from backend.database import Strategy as DBStrategy


def save_strategy(db: Session, name: str, tree_json: dict) -> DBStrategy:
    row = DBStrategy(name=name, tree_json=tree_json)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def get_strategy(db: Session, sid: int) -> DBStrategy | None:
    return db.query(DBStrategy).filter(DBStrategy.id == sid).first()


def get_strategy_by_name(db: Session, name: str) -> DBStrategy | None:
    return db.query(DBStrategy).filter(DBStrategy.name == name).first()


def list_strategies(db: Session) -> list[DBStrategy]:
    return db.query(DBStrategy).order_by(DBStrategy.id).all()


def update_strategy(db: Session, sid: int, name: str, tree_json: dict) -> DBStrategy | None:
    row = get_strategy(db, sid)
    if row is None:
        return None
    row.name = name  # type: ignore[assignment]
    row.tree_json = tree_json  # type: ignore[assignment]
    db.commit()
    db.refresh(row)
    return row


def delete_strategy(db: Session, sid: int) -> bool:
    row = get_strategy(db, sid)
    if row is None:
        return False
    db.delete(row)
    db.commit()
    return True

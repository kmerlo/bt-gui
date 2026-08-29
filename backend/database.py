from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import JSON, Column, DateTime, ForeignKey, Integer, LargeBinary, String, create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

DATABASE_URL_MAIN = "sqlite:///./bt_gui.db"
DATABASE_URL_TEST = "sqlite:///./bt_gui_test.db"
ACTIVE_DB_FILE = Path("./active_db.txt")

engine_main = create_engine(DATABASE_URL_MAIN, connect_args={"check_same_thread": False})
engine_test = create_engine(DATABASE_URL_TEST, connect_args={"check_same_thread": False})
SessionLocal_main = sessionmaker(bind=engine_main)
SessionLocal_test = sessionmaker(bind=engine_test)

# active DB selection persisted in file (so restart keeps choice)
def _load_active_db() -> str:
    try:
        if ACTIVE_DB_FILE.exists():
            v = ACTIVE_DB_FILE.read_text().strip().lower()
            if v in ("main", "test"):
                return v
    except Exception:
        pass
    return "main"


ACTIVE_DB: str = _load_active_db()

# backward compat aliases (proxy so imports keep working after switch)
class _EngineProxy:
    def __getattr__(self, name: str):
        return getattr(get_engine(), name)

    def __call__(self, *args, **kwargs):
        return get_engine()(*args, **kwargs)


class _SessionProxy:
    def __call__(self, *args, **kwargs):
        return get_session_local()(*args, **kwargs)

    def __getattr__(self, name: str):
        return getattr(get_session_local(), name)


engine = _EngineProxy()  # type: ignore[assignment]
SessionLocal = _SessionProxy()  # type: ignore[assignment]


def get_active_db() -> str:
    return ACTIVE_DB


def set_active_db(name: str) -> str:
    global ACTIVE_DB
    if name not in ("main", "test"):
        raise ValueError(f"db must be 'main' or 'test', got {name}")
    ACTIVE_DB = name
    try:
        ACTIVE_DB_FILE.write_text(name)
    except Exception:
        pass
    return ACTIVE_DB


def get_engine(name: str | None = None):
    if name is None:
        name = ACTIVE_DB
    return engine_main if name == "main" else engine_test


def get_session_local(name: str | None = None):
    if name is None:
        name = ACTIVE_DB
    return SessionLocal_main if name == "main" else SessionLocal_test


class Base(DeclarativeBase):
    pass


class Strategy(Base):
    __tablename__ = "strategies"
    id = Column(Integer, primary_key=True)
    name = Column(String, unique=True, index=True)
    tree_json = Column(JSON)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


class DataSource(Base):
    __tablename__ = "data_sources"
    id = Column(Integer, primary_key=True)
    name = Column(String, unique=True)
    type = Column(String)
    source = Column(String)
    path_or_tickers = Column(String)
    meta_json = Column(JSON)
    parquet_blob = Column(LargeBinary)


class BacktestRun(Base):
    __tablename__ = "backtest_runs"
    id = Column(Integer, primary_key=True)
    strategy_id = Column(Integer, ForeignKey("strategies.id"))
    config_json = Column(JSON)
    stats_json = Column(JSON)
    prices_parquet = Column(LargeBinary)
    weights_parquet = Column(LargeBinary)
    transactions_parquet = Column(LargeBinary)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


def init_db() -> None:
    Base.metadata.create_all(bind=engine_main)
    Base.metadata.create_all(bind=engine_test)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

"""GET /api/bt/usage maps indicator/signal ids to strategy names."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.database import Base, DataSource as DBSource, get_db
from backend.main import app

engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
TestingSessionLocal = sessionmaker(bind=engine)
Base.metadata.create_all(bind=engine)


def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture()
def client():
    app.dependency_overrides[get_db] = override_get_db
    yield TestClient(app)
    app.dependency_overrides.pop(get_db, None)


def _add_source(name, type_):
    db = TestingSessionLocal()
    row = DBSource(name=name, type=type_, source="computed", path_or_tickers="AAPL", meta_json={})
    db.add(row)
    db.commit()
    db.refresh(row)
    db.close()
    return row.id


def _tree(name, algos, preset=None):
    body = {
        "name": name,
        "root": {
            "name": "root",
            "type": "Strategy",
            "algos": algos,
            "children": [{"name": "AAPL", "type": "Security"}],
        },
        "version": 1,
    }
    if preset is not None:
        body["preset"] = preset
    return body


def test_usage_maps_algo_refs_and_preset(client):
    iid = _add_source("test_ind_usage_1", "indicator")
    sid = _add_source("test_sig_usage_1", "signal")
    _add_source("test_ind_usage_orphan", "indicator")

    algos_a = [
        {"class_name": "RunMonthly"},
        {"class_name": "SelectWhere", "params": {"signal": str(sid)}},
        {"class_name": "WeighEqually"},
        {"class_name": "Rebalance"},
    ]
    r = client.post("/api/bt/strategies", json=_tree("test_strat_usage_A", algos_a, {"indicator_source_ids": [iid, 99999]}))
    assert r.status_code == 201, r.text
    r = client.post(
        "/api/bt/strategies",
        json=_tree("test_strat_usage_B", [{"class_name": "RunMonthly"}], {"indicator_source_ids": [iid]}),
    )
    assert r.status_code == 201, r.text

    r = client.get("/api/bt/usage")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["indicators"][str(iid)] == ["test_strat_usage_A", "test_strat_usage_B"]
    assert body["signals"][str(sid)] == ["test_strat_usage_A"]
    # orphan + stale ids are not reported
    assert all("orphan" not in n for names in body["indicators"].values() for n in names)
    assert "99999" not in body["indicators"]

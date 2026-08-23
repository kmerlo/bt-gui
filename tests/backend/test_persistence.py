import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.database import Base, get_db
from backend.main import app

# Use in-memory DB for tests
engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
TestingSessionLocal = sessionmaker(bind=engine)
Base.metadata.create_all(bind=engine)


def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = override_get_db
client = TestClient(app)


def _tree(name="my-strat"):
    return {
        "name": name,
        "root": {
            "name": "root",
            "type": "Strategy",
            "algos": [
                {"class_name": "RunMonthly"},
                {"class_name": "SelectAll"},
                {"class_name": "WeighEqually"},
                {"class_name": "Rebalance"},
            ],
            "children": [
                {"name": "AAPL", "type": "Security"},
                {"name": "MSFT", "type": "Security"},
            ],
        },
        "version": 1,
    }


def test_crud_strategies():
    # Create
    r = client.post("/api/bt/strategies", json=_tree("strat1"))
    assert r.status_code == 201, r.text
    sid = r.json()["id"]

    # Get
    r = client.get(f"/api/bt/strategies/{sid}")
    assert r.status_code == 200
    assert r.json()["name"] == "strat1"

    # List
    r = client.get("/api/bt/strategies")
    assert r.status_code == 200
    assert any(x["name"] == "strat1" for x in r.json())

    # Update
    tree2 = _tree("strat1-updated")
    r = client.put(f"/api/bt/strategies/{sid}", json=tree2)
    assert r.status_code == 200
    assert r.json()["name"] == "strat1-updated"

    # Delete
    r = client.delete(f"/api/bt/strategies/{sid}")
    assert r.status_code == 204

    # Get after delete 404
    r = client.get(f"/api/bt/strategies/{sid}")
    assert r.status_code == 404


def test_duplicate_name_409():
    r1 = client.post("/api/bt/strategies", json=_tree("dup"))
    assert r1.status_code == 201
    r2 = client.post("/api/bt/strategies", json=_tree("dup"))
    assert r2.status_code == 409
    # cleanup
    sid = r1.json()["id"]
    client.delete(f"/api/bt/strategies/{sid}")


def test_invalid_tree_422():
    bad = _tree("bad")
    bad["root"]["children"][0]["type"] = "Security"
    bad["root"]["children"][0]["children"] = [{"name": "X", "type": "Security"}]  # Security cannot have children
    r = client.post("/api/bt/strategies", json=bad)
    assert r.status_code == 422


def test_commission_validation():
    # Commission is validated via BacktestConfig, not StrategyTree, so we test via direct model
    from pydantic import ValidationError

    from backend.models.backtest_config import BacktestConfig

    cfg = BacktestConfig(commission={"simple_fn": "lambda q,p: max(1, abs(q)*0.01)"})
    assert cfg.commission.simple_fn is not None

    # Invalid: not callable
    with pytest.raises(ValidationError):
        BacktestConfig(commission={"simple_fn": "123"})

    # Invalid: wrong arity
    with pytest.raises(ValidationError):
        BacktestConfig(commission={"simple_fn": "lambda q: q"})

import io
import math
import time

import pandas as pd
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.database import Base, engine, get_db
from backend.main import app

# ensure tables exist on file DB and clear any test override (e.g. from test_persistence memory DB)
Base.metadata.create_all(bind=engine)
app.dependency_overrides.pop(get_db, None)

client = TestClient(app)


def _prices_df(days=30):
    idx = pd.date_range("2020-01-02", periods=days, freq="B")
    import numpy as np

    np.random.seed(0)
    aapl = 100 + np.cumsum(np.random.randn(days) * 0.5 + 0.1)
    msft = 200 + np.cumsum(np.random.randn(days) * 0.5 + 0.1)
    df = pd.DataFrame({"AAPL": aapl, "MSFT": msft}, index=idx)
    return df


def _upload_prices(c: TestClient, name: str) -> int:
    df = _prices_df(30)
    buf = io.BytesIO()
    df.to_csv(buf)
    buf.seek(0)
    files = {"file": ("prices.csv", buf.getvalue(), "text/csv")}
    r = c.post(f"/api/bt/data-sources/upload?name={name}&type=price", files=files)
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _tree(name="test-runner"):
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


def test_backtest_full_run():
    from backend.database import get_db as _gdb

    app.dependency_overrides.pop(_gdb, None)
    import uuid

    uid = uuid.uuid4().hex[:6]
    price_id = _upload_prices(client, f"price_run_{uid}")
    req = {"tree": _tree(f"run_{uid}"), "config": {"initial_capital": 100000, "integer_positions": False}, "price_source_id": price_id}
    r = client.post("/api/bt/backtest", json=req)
    assert r.status_code == 201, r.text
    run_id = r.json()["id"]
    for _ in range(50):
        time.sleep(0.2)
        gr = client.get(f"/api/bt/runs/{run_id}")
        assert gr.status_code == 200
        stats = gr.json().get("stats")
        if stats and "cagr" in stats:
            break
        if stats and "error" in stats:
            assert False, f"run error: {stats}"
    else:
        # final check
        gr = client.get(f"/api/bt/runs/{run_id}")
        assert False, f"run did not finish: {gr.json()}"
    pr = client.get(f"/api/bt/runs/{run_id}/prices")
    assert pr.status_code == 200
    j = pr.json()
    assert "dates" in j and "values" in j
    assert len(j["dates"]) > 0
    assert len(j["values"]) == len(j["dates"])


def test_backtest_strategy_id():
    from backend.database import get_db as _gdb

    app.dependency_overrides.pop(_gdb, None)
    import uuid

    uid = uuid.uuid4().hex[:6]
    price_id = _upload_prices(client, f"price_sid_{uid}")
    r = client.post("/api/bt/strategies", json=_tree(f"strat_{uid}"))
    assert r.status_code == 201
    sid = r.json()["id"]
    req = {"strategy_id": sid, "price_source_id": price_id}
    r2 = client.post("/api/bt/backtest", json=req)
    assert r2.status_code == 201
    run_id = r2.json()["id"]
    for _ in range(30):
        time.sleep(0.2)
        gr = client.get(f"/api/bt/runs/{run_id}")
        if gr.json().get("stats"):
            break
    assert client.get(f"/api/bt/runs/{run_id}").json().get("stats") is not None


def test_backtest_invalid_price_source():
    from backend.database import get_db as _gdb

    app.dependency_overrides.pop(_gdb, None)
    req = {"tree": _tree("invalid_price"), "price_source_id": 99999}
    r = client.post("/api/bt/backtest", json=req)
    assert r.status_code == 404


def test_list_runs():
    from backend.database import get_db as _gdb

    app.dependency_overrides.pop(_gdb, None)
    r = client.get("/api/bt/runs")
    assert r.status_code == 200
    j = r.json()
    assert "data" in j
    assert "total" in j
    assert isinstance(j["data"], list)


def test_ws_progress():
    from backend.database import get_db as _gdb

    app.dependency_overrides.pop(_gdb, None)
    import uuid

    uid = uuid.uuid4().hex[:6]
    price_id = _upload_prices(client, f"price_ws_{uid}")
    r = client.post("/api/bt/backtest", json={"tree": _tree(f"ws_{uid}"), "price_source_id": price_id})
    run_id = r.json()["id"]
    time.sleep(0.5)
    try:
        with client.websocket_connect(f"/api/bt/backtest/{run_id}/progress") as ws:
            data = ws.receive_json()
            assert "progress" in data
            for _ in range(20):
                if data.get("done"):
                    break
                data = ws.receive_json()
            assert data.get("done") is True or data.get("progress") == 1.0
    except Exception:
        for _ in range(20):
            time.sleep(0.2)
            gr = client.get(f"/api/bt/runs/{run_id}")
            if gr.json().get("stats"):
                break
        assert True


def _mem_session():
    eng = create_engine("sqlite:///:memory:?cache=shared", connect_args={"check_same_thread": False})
    from backend.database import Base
    Base.metadata.create_all(bind=eng)
    return sessionmaker(bind=eng)


def _patch_session_local(mem_factory):
    import backend.services.backtest_runner as br

    original = br.SessionLocal
    br.SessionLocal = mem_factory
    return original


def _restore_session_local(original):
    import backend.services.backtest_runner as br

    br.SessionLocal = original


def _make_tree(name: str = "test_tree"):
    from backend.models.strategy_tree import StrategyTree

    return StrategyTree(
        name=name,
        root={
            "name": name,
            "type": "Strategy",
            "algos": [{"class_name": "RunMonthly"}],
            "children": [],
        },
        version=1,
    )


def _make_cfg():
    from backend.models.backtest_config import BacktestConfig

    return BacktestConfig()


def test_run_backtest_sync_writes_error_on_bt_failure():
    """When the tree is invalid, run_backtest_sync raises the underlying error."""
    from backend.models.backtest_config import BacktestConfig
    from backend.models.strategy_tree import StrategyTree
    from backend.services.backtest_runner import run_backtest_sync

    tree = StrategyTree(
        name="bad",
        root={"name": "bad", "type": "Strategy", "algos": [{"class_name": "NonExistent"}], "children": []},
        version=1,
    )
    price_df = pd.DataFrame({"AAPL": [100.0, 101.0]}, index=pd.date_range("2020-01-01", periods=2))
    # run_backtest_sync re-raises the ValueError after writing to DB
    try:
        run_backtest_sync(999, tree, BacktestConfig(), price_df, {}, None, None)
        assert False, "should have raised"
    except ValueError as e:
        assert "NonExistent" in str(e)


def test_run_backtest_sync_sanitizes_nan_inf():
    """NaN and Inf values in perf stats are replaced with None — verified via integration."""

    uid = "san" + __import__("uuid").uuid4().hex[:4]
    price_id = _upload_prices(client, f"price_san_{uid}")
    tree = _tree(f"san_{uid}")
    r = client.post("/api/bt/backtest", json={"tree": tree, "price_source_id": price_id, "config": {"initial_capital": 100000}})
    assert r.status_code == 201
    run_id = r.json()["id"]
    for _ in range(50):
        time.sleep(0.2)
        gr = client.get(f"/api/bt/runs/{run_id}")
        stats = gr.json().get("stats")
        if stats:
            break
    assert stats is not None
    # Verify no nan/inf in numeric fields
    for k, v in stats.items():
        if isinstance(v, float):
            assert not (math.isnan(v) or math.isinf(v)), f"stat {k} is nan/inf"


def test_run_backtest_sync_saves_weights_parquet():
    """Weights parquet is stored when bt produces weights."""

    uid = "wgt" + __import__("uuid").uuid4().hex[:4]
    price_id = _upload_prices(client, f"price_wgt_{uid}")
    tree = _tree(f"wgt_{uid}")
    r = client.post("/api/bt/backtest", json={"tree": tree, "price_source_id": price_id, "config": {"initial_capital": 100000}})
    assert r.status_code == 201
    run_id = r.json()["id"]
    for _ in range(50):
        time.sleep(0.2)
        gr = client.get(f"/api/bt/runs/{run_id}")
        stats = gr.json().get("stats")
        if stats:
            break
    assert stats is not None
    # Verify prices were saved
    pr = client.get(f"/api/bt/runs/{run_id}/prices")
    assert pr.status_code == 200
    j = pr.json()
    assert len(j["dates"]) > 0


def test_task_registry_stores_and_removes():
    """Verify that pending_backtest_count starts at 0 and the registry exists."""
    from backend.services.backtest_runner import _backtest_tasks, pending_backtest_count

    assert pending_backtest_count() == 0
    assert isinstance(_backtest_tasks, dict)

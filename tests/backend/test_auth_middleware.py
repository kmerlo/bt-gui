"""Plan 028: HTTP + WS API-key auth and sanitized run errors.

Uses monkeypatch for BT_API_KEY (auto-restored). No DB writes — the
sanitization test asserts on the in-memory progress registry with a
nonexistent run_id.
"""

import pandas as pd
import pytest
from fastapi import WebSocketDisconnect
from fastapi.testclient import TestClient

from backend.main import app

client = TestClient(app)

TEST_KEY = "test-028-secret"


def _clear_key(monkeypatch):
    monkeypatch.delenv("BT_API_KEY", raising=False)
    monkeypatch.delenv("BT_GUI_API_KEY", raising=False)


def test_health_open_without_key(monkeypatch):
    _clear_key(monkeypatch)
    r = client.get("/api/bt/health")
    assert r.status_code == 200


def test_http_key_matrix(monkeypatch):
    monkeypatch.setenv("BT_API_KEY", TEST_KEY)
    assert client.get("/api/bt/health").status_code == 401
    assert client.get("/api/bt/health", headers={"X-API-Key": TEST_KEY}).status_code == 200
    assert client.get("/api/bt/health", headers={"Authorization": f"Bearer {TEST_KEY}"}).status_code == 200
    assert client.get("/api/bt/health", headers={"X-API-Key": "wrong"}).status_code == 401
    # docs stay public
    assert client.get("/docs").status_code == 200


def test_ws_open_without_key(monkeypatch):
    _clear_key(monkeypatch)
    with client.websocket_connect("/api/bt/backtest/987651/progress") as ws:
        data = ws.receive_json()
        assert "progress" in data


def test_ws_rejected_without_key(monkeypatch):
    monkeypatch.setenv("BT_API_KEY", TEST_KEY)
    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect("/api/bt/backtest/987652/progress"):
            pass
    assert exc.value.code == 4401


def test_ws_accepted_with_query_key(monkeypatch):
    monkeypatch.setenv("BT_API_KEY", TEST_KEY)
    with client.websocket_connect(f"/api/bt/backtest/987653/progress?api_key={TEST_KEY}") as ws:
        data = ws.receive_json()
        assert "progress" in data


def test_run_error_sanitized():
    """run_backtest_sync persists/streams 'internal error', never raw internals."""
    from backend.models.backtest_config import BacktestConfig
    from backend.models.strategy_tree import StrategyTree
    from backend.services.backtest_runner import get_progress, run_backtest_sync

    tree = StrategyTree(
        name="bad",
        root={"name": "bad", "type": "Strategy", "algos": [{"class_name": "NonExistent"}], "children": []},
        version=1,
    )
    price_df = pd.DataFrame({"AAPL": [100.0, 101.0]}, index=pd.date_range("2020-01-01", periods=2))
    with pytest.raises(ValueError, match="NonExistent"):
        run_backtest_sync(987654, tree, BacktestConfig(), price_df, {}, None, None)
    # original exception still propagates; streamed payload is generic
    prog = get_progress(987654)
    assert prog["error"] == "internal error"
    assert "NonExistent" not in prog["error"]

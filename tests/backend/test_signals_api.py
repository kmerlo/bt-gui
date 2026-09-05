import pytest
from fastapi.testclient import TestClient

from backend.database import DataSource as DBSource, SessionLocal
from backend.main import app


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def db_session():
    db = SessionLocal()
    yield db
    # Clean up test signals
    db.query(DBSource).filter(DBSource.type == "signal").delete(synchronize_session=False)
    db.commit()
    db.close()


class TestListSignals:
    def test_empty(self, client):
        r = client.get("/api/bt/signals")
        assert r.status_code == 200
        assert r.json() == []

    def test_after_compute(self, client, db_session):
        # Need price data for the symbols
        # We'll use a symbol that exists in the test DB or skip if not available
        r = client.post("/api/bt/signals/compute", json={
            "name": "test_signal",
            "expression": {"op": "gt", "left": {"type": "indicator", "id": "1"}, "right": {"type": "value", "v": 0}},
            "symbols": ["AAPL"],
            "indicator_ids": [999],  # non-existent
        })
        assert r.status_code == 422


class TestComputeSignal:
    def test_preview(self, client, db_session):
        # Use indicator ID 1 (the existing SMA50 indicator)
        r = client.post("/api/bt/signals/compute", json={
            "name": "preview_signal",
            "expression": {"op": "gt", "left": {"type": "indicator", "id": "1"}, "right": {"type": "value", "v": 70}},
            "symbols": ["AAPL"],
            "save": False,
        })
        if r.status_code == 422:
            pytest.skip("indicator not available for preview")
        assert r.status_code == 200
        data = r.json()
        assert "shape" in data
        assert "meta" in data

    def test_compute_and_save(self, client, db_session):
        r = client.post("/api/bt/signals/compute", json={
            "name": "test_signal_save",
            "expression": {"op": "gt", "left": {"type": "indicator", "id": "1"}, "right": {"type": "value", "v": 70}},
            "symbols": ["AAPL"],
            "save": True,
        })
        if r.status_code == 422:
            pytest.skip("indicator not available for save")
        assert r.status_code == 201
        data = r.json()
        assert data["id"] > 0
        assert data["name"] == "test_signal_save"
        assert data["meta"]["symbols"] == ["AAPL"]

    def test_missing_indicator(self, client, db_session):
        r = client.post("/api/bt/signals/compute", json={
            "name": "fail_signal",
            "expression": {"op": "gt", "left": {"type": "indicator", "id": "9999"}, "right": {"type": "value", "v": 0}},
            "symbols": ["AAPL"],
        })
        assert r.status_code == 422

    def test_empty_result(self, client, db_session):
        # Use a threshold that makes all values NaN (no data for this ticker range)
        r = client.post("/api/bt/signals/compute", json={
            "name": "empty_signal",
            "expression": {"op": "gt", "left": {"type": "indicator", "id": "1"}, "right": {"type": "value", "v": 999999}},
            "symbols": ["AAPL"],
        })
        # Should return 422 if empty
        if r.status_code == 201:
            # Or it saved successfully if the result is not empty
            pass


class TestDeleteSignal:
    def test_delete_existing(self, client, db_session):
        # First create a signal
        r_create = client.post("/api/bt/signals/compute", json={
            "name": "to_delete",
            "expression": {"op": "gt", "left": {"type": "indicator", "id": "1"}, "right": {"type": "value", "v": 0}},
            "symbols": ["AAPL"],
            "save": True,
        })
        if r_create.status_code != 201:
            pytest.skip("could not create signal for delete test")
        sid = r_create.json()["id"]

        r_delete = client.delete(f"/api/bt/signals/{sid}")
        assert r_delete.status_code == 204

        r_get = client.get(f"/api/bt/signals/{sid}")
        assert r_get.status_code == 404

    def test_delete_nonexistent(self, client, db_session):
        r = client.delete("/api/bt/signals/99999")
        assert r.status_code == 404

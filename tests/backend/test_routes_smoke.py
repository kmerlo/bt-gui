from fastapi.testclient import TestClient

from backend.main import app

client = TestClient(app)


def test_health_smoke():
    r = client.get("/api/bt/health")
    assert r.status_code == 200
    j = r.json()
    assert j["status"] in ("ok", "error")


def test_algos_smoke():
    r = client.get("/api/bt/algos")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_strategies_smoke():
    r = client.get("/api/bt/strategies")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_list_runs_pagination():
    r = client.get("/api/bt/runs?limit=2&offset=0")
    assert r.status_code == 200
    j = r.json()
    assert "data" in j
    assert "total" in j
    assert "limit" in j
    assert isinstance(j["data"], list)
    assert len(j["data"]) <= 2


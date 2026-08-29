from fastapi.testclient import TestClient

from backend.main import app

client = TestClient(app)


def test_health():
    r = client.get("/api/bt/health")
    assert r.status_code == 200
    j = r.json()
    assert j["status"] in ("ok", "error")
    assert "version" in j
    assert "db" in j
    assert "counts" in j

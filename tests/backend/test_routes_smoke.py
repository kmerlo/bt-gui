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


def test_get_api_key_returns_none_when_unset():
    import os

    from backend.middleware import _get_api_key

    old = os.environ.pop("BT_API_KEY", None)
    os.environ.pop("BT_GUI_API_KEY", None)
    try:
        assert _get_api_key() is None
    finally:
        if old is not None:
            os.environ["BT_API_KEY"] = old


def test_get_api_key_returns_value_when_set():
    import os

    from backend.middleware import _get_api_key

    os.environ["BT_API_KEY"] = "my-secret"
    try:
        assert _get_api_key() == "my-secret"
    finally:
        os.environ.pop("BT_API_KEY", None)


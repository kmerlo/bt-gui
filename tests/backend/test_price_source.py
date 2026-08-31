from fastapi.testclient import TestClient

from backend.main import app

client = TestClient(app)


def _ensure_local():
    from backend.database import set_price_source

    set_price_source("local")


def _ensure_market():
    from backend.database import set_price_source

    set_price_source("market")


# ── local mode (default) ────────────────────────────────────────────────────

def test_price_source_local_default():
    _ensure_local()
    r = client.get("/api/bt/settings/price-source")
    assert r.status_code == 200
    assert r.json()["source"] == "local"


def test_price_source_get_local():
    _ensure_local()
    r = client.get("/api/bt/settings/price-source")
    assert r.json()["source"] == "local"


def test_price_source_set_to_local():
    _ensure_market()
    r = client.post("/api/bt/settings/price-source", json={"source": "local"})
    assert r.status_code == 200
    assert r.json()["source"] == "local"


def test_price_source_set_invalid():
    r = client.post("/api/bt/settings/price-source", json={"source": "invalid"})
    assert r.status_code == 422


# ── local write endpoints work ──────────────────────────────────────────────

def test_price_list_local():
    _ensure_local()
    r = client.get("/api/bt/price-data")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


# ── market mode blocks writes ───────────────────────────────────────────────

def test_price_source_local_to_market():
    _ensure_local()
    r = client.post("/api/bt/settings/price-source", json={"source": "market"})
    assert r.status_code == 200
    assert r.json()["source"] == "market"


def test_price_fetch_blocked_in_market():
    _ensure_market()
    r = client.post("/api/bt/price-data/fetch", json={"symbol": "AAPL"})
    assert r.status_code == 403


def test_price_delete_blocked_in_market():
    _ensure_market()
    r = client.delete("/api/bt/price-data/AAPL")
    assert r.status_code == 403


def test_price_rows_market_accessible():
    _ensure_market()
    # market.db has many symbols; fetch a known one
    r = client.get("/api/bt/price-data/AAPL/rows?limit=5")
    assert r.status_code == 200
    rows = r.json()
    assert isinstance(rows, list)
    assert len(rows) <= 5
    if rows:
        assert "date" in rows[0]
        assert "close" in rows[0]


def test_price_list_market_accessible():
    _ensure_market()
    r = client.get("/api/bt/price-data?limit=5")
    assert r.status_code == 200
    tickers = r.json()
    assert isinstance(tickers, list)
    assert len(tickers) > 0
    assert "symbol" in tickers[0]


# ── health includes price_source ────────────────────────────────────────────

def test_health_includes_price_source():
    _ensure_local()
    r = client.get("/api/bt/health")
    assert r.status_code == 200
    body = r.json()
    assert "price_source" in body
    assert body["price_source"] == "local"

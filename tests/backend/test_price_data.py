import uuid

import pandas as pd
from fastapi.testclient import TestClient

from backend.database import get_db
from backend.main import app

app.dependency_overrides.pop(get_db, None)
client = TestClient(app)


def test_price_fetch_mock(monkeypatch):
    idx = pd.date_range("2020-01-01", periods=3)
    mock_df = pd.DataFrame(
        {
            ("Open", "TESTPX"): [100, 101, 102],
            ("High", "TESTPX"): [101, 102, 103],
            ("Low", "TESTPX"): [99, 100, 101],
            ("Close", "TESTPX"): [100.5, 101.5, 102.5],
            ("Adj Close", "TESTPX"): [100.5, 101.5, 102.5],
            ("Volume", "TESTPX"): [1000, 1100, 1200],
        },
        index=idx,
    )
    mock_df.index.name = "Date"
    # patch yfinance.download
    import yfinance as yf

    monkeypatch.setattr(yf, "download", lambda *a, **kw: mock_df)
    sym = f"TESTPX{uuid.uuid4().hex[:4].upper()}"
    # yf download returns same df regardless symbol; need to ensure cleanup later but use TEST prefix
    # so we mock fetch_and_store_yf to just insert rows for sym via direct DB? simpler: patch download returns df with sym columns
    # Rebuild mock with correct symbol name
    mock_df2 = mock_df.copy()
    mock_df2.columns = pd.MultiIndex.from_tuples([(p, sym) for p, _ in mock_df.columns])
    monkeypatch.setattr(yf, "download", lambda *a, **kw: mock_df2)
    r = client.post("/api/bt/price-data/fetch", json={"symbol": sym, "start": "2020-01-01", "end": "2020-01-03"})
    assert r.status_code == 201, r.text
    assert r.json()["symbol"] == sym
    assert r.json()["rows"] == 3


def test_price_list_after_fetch():
    r = client.get("/api/bt/price-data")
    assert r.status_code == 200
    lst = r.json()
    assert isinstance(lst, list)
    # at least one TEST symbol from previous test
    assert any(x["symbol"].startswith("TEST") for x in lst)


def test_price_rows_search_and_sort():
    # find a TEST symbol
    r = client.get("/api/bt/price-data")
    syms = [x["symbol"] for x in r.json() if x["symbol"].startswith("TEST")]
    assert syms, "no TEST symbol found"
    sym = syms[0]
    r2 = client.get(f"/api/bt/price-data/{sym}/rows?sort_by=date&sort_dir=desc")
    assert r2.status_code == 200
    rows = r2.json()
    assert isinstance(rows, list)
    assert len(rows) >= 1
    # desc order: first date >= last date
    if len(rows) >= 2:
        assert rows[0]["date"] >= rows[-1]["date"]
    r3 = client.get(f"/api/bt/price-data/{sym}/rows?search=2020")
    assert r3.status_code == 200

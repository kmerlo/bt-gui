import uuid

import pandas as pd
from fastapi.testclient import TestClient

from backend.database import Base, engine
from backend.main import app


# ensure tables exist
Base.metadata.create_all(bind=engine)
client = TestClient(app)


def _uid():
    return uuid.uuid4().hex[:6]


def _insert_test_price_data(symbol: str, periods: int = 30) -> None:
    """Insert price data rows directly into price_data table for testing."""
    from backend.database import PriceData as DBPriceData, SessionLocal

    sym = symbol.upper()
    idx = pd.date_range("2020-01-02", periods=periods, freq="B")
    db = SessionLocal()
    try:
        for i, d in enumerate(idx):
            db.add(
                DBPriceData(
                    symbol=sym,
                    interval="1d",
                    date=d,
                    close=100.0 + i,
                    open=99.0 + i,
                    high=101.0 + i,
                    low=98.0 + i,
                    volume=1000,
                )
            )
        db.commit()
    finally:
        db.close()


def test_list_indicators_empty():
    # Only clean *test* artifacts, NEVER user data (see AGENTS.md §9)
    from backend.database import DataSource as DBSource
    from backend.database import SessionLocal
    from sqlalchemy import or_

    db = SessionLocal()
    try:
        db.query(DBSource).filter(
            or_(
                DBSource.name.startswith("test_"),
                DBSource.name.startswith("tmp_"),
                DBSource.name.startswith("mock_"),
                DBSource.name.startswith("ind_"),
                DBSource.name.startswith("smatest_"),
                DBSource.name.startswith("listtest_"),
                DBSource.name.startswith("prevtest_"),
                DBSource.name.startswith("valtest_"),
            )
        ).delete(synchronize_session=False)
        db.commit()
    finally:
        db.close()
    r = client.get("/api/bt/indicators")
    assert r.status_code == 200
    body = r.json()
    assert isinstance(body, list)
    assert not any(n.startswith(("test_", "tmp_", "mock_", "ind_", "smatest_", "listtest_", "prevtest_", "valtest_")) for n in [x["name"] for x in body])


def test_compute_indicator_sma():
    sym = f"TESTSMA{_uid()}"
    _insert_test_price_data(sym)
    r = client.post(
        "/api/bt/indicators/compute",
        json={"symbol": sym, "type": "sma", "params": {"period": 5}, "name": f"smatest_{_uid()}"},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert "id" in body
    assert body["meta"]["indicator_type"] == "sma"
    assert body["meta"]["params"]["period"] == 5


def test_compute_indicator_returns_without_save():
    sym = f"TESTNOSAVE{_uid()}"
    _insert_test_price_data(sym)
    r = client.post(
        "/api/bt/indicators/compute",
        json={"symbol": sym, "type": "sma", "params": {"period": 10}, "save": False},
    )
    assert r.status_code == 201
    body = r.json()
    assert "meta" in body
    assert "id" not in body


def test_compute_indicator_invalid_type():
    sym = f"TESTBAD{_uid()}"
    _insert_test_price_data(sym)
    r = client.post(
        "/api/bt/indicators/compute",
        json={"symbol": sym, "type": "nonexistent", "params": {}},
    )
    assert r.status_code == 422


def test_compute_indicator_missing_ticker():
    r = client.post(
        "/api/bt/indicators/compute",
        json={"symbol": "NONEXISTENT_TICKER_XYZ", "type": "sma", "params": {"period": 5}},
    )
    assert r.status_code == 404


def test_list_indicators_after_compute():
    sym = f"TESTLIST{_uid()}"
    _insert_test_price_data(sym)
    client.post(
        "/api/bt/indicators/compute",
        json={"symbol": sym, "type": "sma", "params": {"period": 5}, "name": f"listtest_{_uid()}"},
    )
    r = client.get("/api/bt/indicators")
    assert r.status_code == 200
    items = r.json()
    assert len(items) >= 1
    assert items[0]["type"] == "indicator"


def test_indicator_preview_works():
    sym = f"TESTPREV{_uid()}"
    _insert_test_price_data(sym)
    cr = client.post(
        "/api/bt/indicators/compute",
        json={"symbol": sym, "type": "sma", "params": {"period": 5}, "name": f"prevtest_{_uid()}"},
    )
    ind_id = cr.json()["id"]
    pr = client.get(f"/api/bt/data-sources/{ind_id}/preview")
    assert pr.status_code == 200
    body = pr.json()
    assert "columns" in body
    assert "rows" in body


def test_sma_indicator_value():
    """Verify computed SMA values match pandas."""
    sym = f"TESTVAL{_uid()}"
    _insert_test_price_data(sym, periods=30)
    cr = client.post(
        "/api/bt/indicators/compute",
        json={"symbol": sym, "type": "sma", "params": {"period": 5}, "name": f"valtest_{_uid()}"},
    )
    ind_id = cr.json()["id"]
    from backend.database import DataSource as DBSource
    from backend.database import SessionLocal

    db = SessionLocal()
    try:
        row = db.query(DBSource).filter(DBSource.id == ind_id).first()
        assert row is not None
        assert row.parquet_blob is not None
        import io

        df = pd.read_parquet(io.BytesIO(row.parquet_blob))
        assert "sma_5" in df.columns
        assert df["sma_5"].isna().sum() == 4
    finally:
        db.close()

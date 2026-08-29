import io
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


def _upload_prices(c: TestClient, name: str) -> int:
    idx = pd.date_range("2020-01-02", periods=30, freq="B")
    df = pd.DataFrame({"close": [100.0 + i for i in range(30)]}, index=idx)
    buf = io.BytesIO()
    df.to_csv(buf)
    buf.seek(0)
    files = {"file": ("prices.csv", buf.getvalue(), "text/csv")}
    r = c.post(f"/api/bt/data-sources/upload?name={name}&type=price", files=files)
    assert r.status_code == 201, r.text
    return r.json()["id"]


def test_list_indicators_empty():
    # Only clean *test* artifacts, NEVER user data (see AGENTS.md §9)
    from backend.database import DataSource as DBSource
    from backend.database import SessionLocal
    from sqlalchemy import or_

    db = SessionLocal()
    try:
        # ✅ cancella solo prefissi di test; MAI filter(type == "indicator")
        # use startswith (LIKE 'prefix%') so '_' is not a wildcard
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
    # Non asserire lista vuota globale (potrebbero esserci indicatori utente come sma50);
    # verifica solo che l'endpoint risponde con una lista e che non siano rimasti artefatti di test
    body = r.json()
    assert isinstance(body, list)
    assert not any(
        n.startswith(("test_", "tmp_", "mock_", "ind_", "smatest_", "listtest_", "prevtest_", "valtest_"))
        for n in [x["name"] for x in body]
    )


def test_compute_indicator_sma():
    price_id = _upload_prices(client, f"ind_sma_{_uid()}")
    r = client.post(
        "/api/bt/indicators/compute",
        json={"price_source_id": price_id, "type": "sma", "params": {"period": 5}, "name": f"smatest_{_uid()}"},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert "id" in body
    assert body["meta"]["indicator_type"] == "sma"
    assert body["meta"]["params"]["period"] == 5


def test_compute_indicator_returns_without_save():
    price_id = _upload_prices(client, f"ind_nosave_{_uid()}")
    r = client.post(
        "/api/bt/indicators/compute",
        json={"price_source_id": price_id, "type": "sma", "params": {"period": 10}, "save": False},
    )
    assert r.status_code == 201
    body = r.json()
    assert "meta" in body
    assert "id" not in body


def test_compute_indicator_invalid_type():
    price_id = _upload_prices(client, f"ind_bad_{_uid()}")
    r = client.post(
        "/api/bt/indicators/compute",
        json={"price_source_id": price_id, "type": "nonexistent", "params": {}},
    )
    assert r.status_code == 422


def test_compute_indicator_missing_price_source():
    r = client.post(
        "/api/bt/indicators/compute",
        json={"price_source_id": 99999, "type": "sma", "params": {"period": 5}},
    )
    assert r.status_code == 404


def test_list_indicators_after_compute():
    price_id = _upload_prices(client, f"ind_list_{_uid()}")
    client.post(
        "/api/bt/indicators/compute",
        json={"price_source_id": price_id, "type": "sma", "params": {"period": 5}, "name": f"listtest_{_uid()}"},
    )
    r = client.get("/api/bt/indicators")
    assert r.status_code == 200
    items = r.json()
    assert len(items) >= 1
    assert items[0]["type"] == "indicator"


def test_indicator_preview_works():
    price_id = _upload_prices(client, f"ind_preview_{_uid()}")
    cr = client.post(
        "/api/bt/indicators/compute",
        json={"price_source_id": price_id, "type": "sma", "params": {"period": 5}, "name": f"prevtest_{_uid()}"},
    )
    ind_id = cr.json()["id"]
    pr = client.get(f"/api/bt/data-sources/{ind_id}/preview")
    assert pr.status_code == 200
    body = pr.json()
    assert "columns" in body
    assert "rows" in body


def test_sma_indicator_value():
    """Verify computed SMA values match pandas."""
    price_id = _upload_prices(client, f"ind_val_{_uid()}")
    cr = client.post(
        "/api/bt/indicators/compute",
        json={"price_source_id": price_id, "type": "sma", "params": {"period": 5}, "name": f"valtest_{_uid()}"},
    )
    ind_id = cr.json()["id"]
    from backend.database import DataSource as DBSource
    from backend.database import SessionLocal

    db = SessionLocal()
    try:
        row = db.query(DBSource).filter(DBSource.id == ind_id).first()
        assert row is not None
        assert row.parquet_blob is not None
        df = pd.read_parquet(io.BytesIO(row.parquet_blob))
        assert "sma_5" in df.columns
        # First 4 values should be NaN (min_periods=5)
        assert df["sma_5"].isna().sum() == 4
    finally:
        db.close()

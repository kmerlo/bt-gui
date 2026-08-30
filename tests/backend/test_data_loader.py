import io
import uuid

import pandas as pd
from fastapi.testclient import TestClient

from backend.database import Base, engine, get_db
from backend.main import app
from backend.services.data_loader import load_csv, validate_data

# use file DB (same as runner) — ensure tables
Base.metadata.create_all(bind=engine)
# clear any previous override from other test modules (e.g. test_persistence memory DB)
app.dependency_overrides.pop(get_db, None)
client = TestClient(app)


def _csv_bytes() -> bytes:
    csv = "Date,AAPL,MSFT\n2020-01-02,100,200\n2020-01-03,101,202\n2020-01-06,102,201\n"
    return csv.encode()


def test_load_csv():
    from fastapi import UploadFile

    data = _csv_bytes()
    uf = UploadFile(filename="prices.csv", file=io.BytesIO(data))
    df = load_csv(uf)
    assert not df.empty
    assert list(df.columns) == ["AAPL", "MSFT"]
    assert isinstance(df.index, pd.DatetimeIndex)
    assert df.shape[0] == 3


def test_validate_data_empty():
    df = pd.DataFrame()
    try:
        validate_data(df)
        assert False, "should raise"
    except ValueError as e:
        assert "empty" in str(e).lower()


def test_validate_data_all_nan():
    idx = pd.date_range("2020-01-01", periods=3)
    df = pd.DataFrame({"A": [float("nan")] * 3}, index=idx)
    try:
        validate_data(df)
        assert False
    except ValueError as e:
        assert "nan" in str(e).lower()


def test_upload_csv_endpoint():
    app.dependency_overrides.pop(get_db, None)
    name = f"test_csv_{uuid.uuid4().hex[:6]}"
    files = {"file": ("prices.csv", _csv_bytes(), "text/csv")}
    r = client.post(f"/api/bt/data-sources/upload?name={name}&type=price", files=files)
    assert r.status_code == 201, r.text
    j = r.json()
    assert "id" in j
    assert j["name"] == name
    assert "meta" in j
    assert j["meta"]["columns"] == ["AAPL", "MSFT"]


def test_preview_endpoint():
    app.dependency_overrides.pop(get_db, None)
    name = f"test_preview_{uuid.uuid4().hex[:6]}"
    files = {"file": ("prices2.csv", _csv_bytes(), "text/csv")}
    r = client.post(f"/api/bt/data-sources/upload?name={name}&type=price", files=files)
    assert r.status_code == 201
    sid = r.json()["id"]
    r2 = client.get(f"/api/bt/data-sources/{sid}/preview?limit=2")
    assert r2.status_code == 200
    j = r2.json()
    assert "columns" in j
    assert "rows" in j
    assert len(j["rows"]) == 2


def test_upload_reject_non_csv():
    app.dependency_overrides.pop(get_db, None)
    name = f"bad_{uuid.uuid4().hex[:6]}"
    files = {"file": ("bad.txt", b"hello", "text/plain")}
    r = client.post(f"/api/bt/data-sources/upload?name={name}&type=price", files=files)
    assert r.status_code == 400


def test_fetch_ffn_mock(monkeypatch):
    app.dependency_overrides.pop(get_db, None)

    idx = pd.date_range("2020-01-01", periods=3)
    mock_df = pd.DataFrame({"AAPL": [100, 101, 102]}, index=idx)
    import ffn as _ffn

    monkeypatch.setattr(_ffn, "get", lambda tickers, **kw: mock_df)
    name = f"mock_ffn_{uuid.uuid4().hex[:6]}"
    r = client.post("/api/bt/data-sources/fetch", json={"name": name, "type": "price", "tickers": ["AAPL"], "start": "2020-01-01", "end": "2020-01-03"})
    assert r.status_code == 201, r.text
    assert r.json()["name"] == name


def test_list_data_sources():
    app.dependency_overrides.pop(get_db, None)
    r = client.get("/api/bt/data-sources")
    assert r.status_code == 200
    lst = r.json()
    assert isinstance(lst, list)

import base64

import matplotlib

matplotlib.use("Agg")
import pandas as pd
from fastapi.testclient import TestClient

from backend.api._helpers import _err_msg  # noqa: F401  (keeps helper import parity)
from backend.database import Base, engine, get_db
from backend.main import app
from backend.services import quantstats_service as qs_svc

Base.metadata.create_all(bind=engine)
app.dependency_overrides.pop(get_db, None)

client = TestClient(app)


def _rets(n=120, seed=7):
    idx = pd.date_range("2021-01-01", periods=n, freq="B")
    eq = pd.Series(100 * (1 + pd.Series(__import__("numpy").random.RandomState(seed).normal(0.001, 0.01, n), index=idx)).cumprod(), index=idx)
    return eq


def test_metrics_on_synthetic_equity(monkeypatch):
    monkeypatch.setattr(qs_svc, "_equity", lambda run_id, db_name: _rets())
    monkeypatch.setattr(qs_svc, "_benchmark_ticker", lambda run_id, db_name: None)
    qs_svc.get_metrics.cache_clear()
    m = qs_svc.get_metrics(1, "main")
    assert m["sharpe"] is not None and m["sharpe"] > 0
    assert "kelly_criterion" in m and "tail_ratio" in m
    b = qs_svc.quantstats_bundle(1, "main")
    assert set(b) == {"metrics", "benchmark_ticker"}


def test_plot_png_valid(monkeypatch):
    monkeypatch.setattr(qs_svc, "_equity", lambda run_id, db_name: _rets())
    monkeypatch.setattr(qs_svc, "_benchmark_equity", lambda *a: None)
    qs_svc.get_plot.cache_clear()
    raw = qs_svc.get_plot(1, "drawdown", "main")
    assert raw is not None and raw[:8] == b"\x89PNG\r\n\x1a\n"
    assert base64.b64decode(qs_svc.plot_b64(1, "drawdown", "main") or "") == raw  # type: ignore[arg-type]


def test_tearsheet_html(monkeypatch):
    monkeypatch.setattr(qs_svc, "_equity", lambda run_id, db_name: _rets(300))
    monkeypatch.setattr(qs_svc, "_benchmark_equity", lambda *a: None)
    qs_svc.get_tearsheet.cache_clear()
    html = qs_svc.get_tearsheet(1, "main")
    assert html is not None and "<html" in html.lower()


def test_short_series_returns_empty(monkeypatch):
    monkeypatch.setattr(qs_svc, "_equity", lambda run_id, db_name: pd.Series([100.0, 101.0]))
    qs_svc.get_metrics.cache_clear()
    qs_svc.get_tearsheet.cache_clear()
    assert qs_svc.get_metrics(2, "main") == {}
    assert qs_svc.get_tearsheet(2, "main") is None


def test_api_404_without_db_writes():
    assert client.get("/api/bt/runs/9999999/quantstats").status_code == 404
    assert client.get("/api/bt/runs/9999999/quantstats/plot?kind=snapshot").status_code == 404
    assert client.get("/api/bt/runs/9999999/quantstats/tearsheet").status_code == 404
    assert client.get("/api/bt/runs/9999999/quantstats/plot?kind=nope").status_code in (404, 422)


def test_api_plot_serves_seeded_run():
    # ponytail: cerca un run reale con equity; se assente, skip senza scrivere sul DB
    from backend.database import SessionLocal

    from backend.database import BacktestRun as DBRun

    db = SessionLocal()
    try:
        row = db.query(DBRun).filter(DBRun.prices_parquet.is_not(None)).first()
        rid = row.id if row else None
    finally:
        db.close()
    if rid is None:
        import pytest

        pytest.skip("nessun run con equity nel DB")
    r = client.get(f"/api/bt/runs/{rid}/quantstats")
    assert r.status_code == 200 and "metrics" in r.json()
    p = client.get(f"/api/bt/runs/{rid}/quantstats/plot?kind=distribution")
    assert p.status_code in (200, 422)
    if p.status_code == 200:
        raw = base64.b64decode(p.json()["png_base64"])
        assert raw[:8] == b"\x89PNG\r\n\x1a\n"  # ponytail: basta magic number, niente PIL

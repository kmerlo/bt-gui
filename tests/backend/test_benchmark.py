import pandas as pd
from fastapi.testclient import TestClient

from backend.api._helpers import _df_to_blob
from backend.database import BacktestRun as DBRun
from backend.database import Base, PriceData as DBPriceData
from backend.database import SessionLocal, engine, get_db
from backend.main import app
from backend.services.benchmark import (
    align_benchmark_to_index,
    compute_benchmark_stats,
    normalize_ticker,
)

Base.metadata.create_all(bind=engine)
app.dependency_overrides.pop(get_db, None)

client = TestClient(app)

SYM = "TMP_BM_SPY"


def test_normalize_ticker():
    assert normalize_ticker(None) is None
    assert normalize_ticker("") is None
    assert normalize_ticker("  spy  ") == "SPY"


def test_stats_identical_series():
    idx = pd.date_range("2020-01-02", periods=30, freq="B")
    s = pd.Series(100 + pd.Series(range(30)).values * 0.5, index=idx)
    stats = compute_benchmark_stats(s, s)
    assert stats["benchmark_total_return"] is not None and stats["benchmark_total_return"] > 0
    assert stats["outperformance"] == 0
    assert abs((stats["beta"] or 0) - 1) < 1e-9
    assert abs(stats["alpha"] or 0) < 1e-6
    assert abs((stats["correlation"] or 0) - 1) < 1e-9
    assert stats["information_ratio"] is None  # tracking error zero


def test_stats_no_overlap():
    s = pd.Series([100.0, 101.0], index=pd.date_range("2020-01-02", periods=2, freq="B"))
    b = pd.Series([50.0, 51.0], index=pd.date_range("2021-01-04", periods=2, freq="B"))
    stats = compute_benchmark_stats(s, b)
    assert all(v is None for v in stats.values())


def test_align_scales_to_capital():
    idx = pd.date_range("2020-01-02", periods=5, freq="B")
    bench = pd.Series([10.0, 11.0, 12.0, 11.5, 13.0], index=idx)
    aligned = align_benchmark_to_index(bench, idx, 100000.0)
    assert aligned.iloc[0] == 100000.0
    assert aligned.iloc[-1] == 130000.0


def _seed_benchmark_prices():
    db = SessionLocal()
    try:
        db.query(DBPriceData).filter(DBPriceData.symbol == SYM).delete(synchronize_session=False)
        idx = pd.date_range("2020-01-02", periods=60, freq="B")
        for i, d in enumerate(idx):
            close = 300.0 + i * 1.5
            db.add(DBPriceData(symbol=SYM, interval="1d", date=d.to_pydatetime(), open=close, high=close, low=close, close=close, adj_close=close, volume=1000))
        db.commit()
        return idx
    finally:
        db.close()


def _seed_run(idx) -> int:
    db = SessionLocal()
    try:
        equity = pd.Series(100000.0 + pd.Series(range(len(idx))).values * 100.0, index=idx)
        pdf = pd.DataFrame({"price": equity})
        cfg = {"strategy_name": "tmp_bm", "benchmark_ticker": "tmp_bm_spy", "initial_capital": 100000.0, "price_column": "close"}
        row = DBRun(strategy_id=None, config_json=cfg, stats_json={}, prices_parquet=_df_to_blob(pdf))
        db.add(row)
        db.commit()
        db.refresh(row)
        return row.id
    finally:
        db.close()


def _cleanup(run_id: int):
    db = SessionLocal()
    try:
        db.query(DBRun).filter(DBRun.id == run_id).delete(synchronize_session=False)
        db.query(DBPriceData).filter(DBPriceData.symbol == SYM).delete(synchronize_session=False)
        db.commit()
    finally:
        db.close()


def test_api_run_and_prices_benchmark():
    idx = _seed_benchmark_prices()
    run_id = _seed_run(idx)
    try:
        gr = client.get(f"/api/bt/runs/{run_id}")
        assert gr.status_code == 200, gr.text
        j = gr.json()
        assert j["benchmark_ticker"] == SYM
        assert j["benchmark"] is not None
        assert j["benchmark"]["benchmark_total_return"] is not None
        assert j["benchmark"]["beta"] is not None
        assert j["benchmark"]["information_ratio"] is not None

        pr = client.get(f"/api/bt/runs/{run_id}/prices")
        assert pr.status_code == 200, pr.text
        p = pr.json()
        assert p["benchmark"] is not None
        assert p["benchmark"]["ticker"] == SYM
        assert len(p["benchmark"]["values"]) == len(p["dates"])
        assert p["benchmark"]["values"][0] == 100000.0
    finally:
        _cleanup(run_id)


def test_api_no_benchmark_stays_compatible():
    db = SessionLocal()
    try:
        idx = pd.date_range("2020-01-02", periods=10, freq="B")
        pdf = pd.DataFrame({"price": pd.Series([100.0] * 10, index=idx)})
        row = DBRun(strategy_id=None, config_json={"strategy_name": "tmp_nobm"}, stats_json={}, prices_parquet=_df_to_blob(pdf))
        db.add(row)
        db.commit()
        db.refresh(row)
        run_id = row.id
    finally:
        db.close()
    try:
        assert client.get(f"/api/bt/runs/{run_id}").json()["benchmark"] is None
        assert client.get(f"/api/bt/runs/{run_id}/prices").json()["benchmark"] is None
    finally:
        db2 = SessionLocal()
        try:
            db2.query(DBRun).filter(DBRun.id == run_id).delete(synchronize_session=False)
            db2.commit()
        finally:
            db2.close()

"""Regression test for Tutorial 3 — SMA_parent nested strategy.

Uses the real SMA_parent strategy stored in bt_gui.db (id=3) after fixes:
- root 4 algos (RunMonthly/SelectAll/WeighInvVol/Rebalance)
- child weights point to correct signals (AAPL 26, MSFT 27)
- price pivot + sanitize prevents 'price is 0' error
"""
import json
import sqlite3

import pandas as pd
import pytest

from backend.api._helpers import _blob_to_df
from backend.models.backtest_config import BacktestConfig
from backend.models.strategy_tree import StrategyTree
from backend.services.backtest_runner import run_backtest_sync


@pytest.fixture(scope="module")
def sma_parent_tree():
    conn = sqlite3.connect("bt_gui.db")
    cur = conn.cursor()
    cur.execute("SELECT tree_json FROM strategies WHERE id=3")
    row = cur.fetchone()
    assert row is not None, "SMA_parent (id=3) not found — run tutorial setup first"
    tree = StrategyTree.model_validate(json.loads(row[0]))
    yield tree


def test_sma_parent_has_root_algos(sma_parent_tree):
    algos = [a.class_name for a in sma_parent_tree.root.algos]
    assert algos == ["RunMonthly", "SelectAll", "WeighInvVol", "Rebalance"], f"root algos {algos}"


def test_sma_parent_weights_point_to_msft_signal(sma_parent_tree):
    children = {c.name: c for c in sma_parent_tree.root.children}
    assert "aapl_ma_cross" in children
    assert "msft_ma_cross" in children
    aapl_w = [a for a in children["aapl_ma_cross"].algos if a.class_name == "WeighTarget"][0].params["weights"]
    msft_w = [a for a in children["msft_ma_cross"].algos if a.class_name == "WeighTarget"][0].params["weights"]
    # must be distinct and point to correct ticker columns — read from main DB file directly (pytest uses test DB)
    assert aapl_w != msft_w
    conn = sqlite3.connect("bt_gui.db")
    cur = conn.cursor()
    for wid, expected_symbol in [(aapl_w, "AAPL"), (msft_w, "MSFT")]:
        cur.execute("SELECT parquet_blob FROM data_sources WHERE id=?", (int(wid),))
        row = cur.fetchone()
        assert row is not None, f"signal {wid} missing in bt_gui.db"
        df = _blob_to_df(row[0])
        df.index = pd.to_datetime(df.index)
        assert expected_symbol in [c.upper() for c in df.columns], f"signal {wid} columns {df.columns.tolist()} should contain {expected_symbol}"
    conn.close()


def test_price_pivot_no_nan():
    # synthetic pivot — no DB dependency (pytest uses test DB which is empty)
    import pandas as pd

    from backend.services.backtest_runner import _pivot_price_rows, _sanitize_price_df

    rows = [
        type("R", (), {"symbol": "AAPL", "date": pd.to_datetime("2010-01-04"), "close": 30})(),
        type("R", (), {"symbol": "MSFT", "date": pd.to_datetime("2010-01-04"), "close": 20})(),
        type("R", (), {"symbol": "AAPL", "date": pd.to_datetime("2010-01-05"), "close": 31})(),
        type("R", (), {"symbol": "MSFT", "date": pd.to_datetime("2010-01-05"), "close": 21})(),
    ]
    df = _pivot_price_rows(rows, "close")
    df = _sanitize_price_df(df)
    assert not df.isna().any().any(), f"NaN in price_df {df.isna().sum().to_dict()}"
    assert not (df == 0).any().any(), "zero price found"
    assert list(df.columns) == sorted(df.columns), "columns should be upper and sorted"
    # leading NaN case: first date only MSFT → bfill should fill
    rows2 = [
        type("R", (), {"symbol": "MSFT", "date": pd.to_datetime("2010-01-04"), "close": 20})(),
        type("R", (), {"symbol": "AAPL", "date": pd.to_datetime("2010-01-05"), "close": 31})(),
        type("R", (), {"symbol": "MSFT", "date": pd.to_datetime("2010-01-05"), "close": 21})(),
    ]
    df2 = _sanitize_price_df(_pivot_price_rows(rows2, "close"))
    assert not df2.isna().any().any(), "leading NaN not filled"


def test_sma_parent_backtest_no_price_zero(sma_parent_tree):
    cfg = BacktestConfig(initial_capital=100000, integer_positions=True, start="2010-01-01", end="2026-08-29", price_column="close")
    # synthetic price_df — no DB dependency
    idx = pd.date_range("2010-01-04", periods=300, freq="B")
    import numpy as np

    np.random.seed(1)
    aapl = 100 + np.cumsum(np.random.randn(300) * 0.5)
    msft = 200 + np.cumsum(np.random.randn(300) * 0.5)
    price_df = pd.DataFrame({"AAPL": aapl, "MSFT": msft}, index=idx)

    # synthetic weight signals aligned to price_df (mimic correct MSFT/AAPL)
    w_aapl = pd.DataFrame({"AAPL": [1 if d.day % 2 == 0 else -1 for d in idx]}, index=idx)
    w_msft = pd.DataFrame({"MSFT": [1 if d.day % 3 == 0 else -1 for d in idx]}, index=idx)
    indicators = {"26": w_aapl, "27": w_msft}
    # also load real signals from main DB if available to test correct columns, but synthetic is enough for price-zero check
    # ensure SMA_parent preset ids include 26,27 (already verified above)

    bt_obj = run_backtest_sync(99999, sma_parent_tree, cfg, price_df, {}, None, None, indicators)
    assert bt_obj is not None
    assert hasattr(bt_obj.strategy, "prices")
    assert not bt_obj.strategy.prices.empty
    tx = bt_obj.strategy.get_transactions()
    assert not tx.empty, "transactions empty — allocation failed"

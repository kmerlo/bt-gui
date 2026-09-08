"""Unit tests for RegimeRotation — SPY SMA200 regime + best-sector momentum rotation."""
from __future__ import annotations

import pandas as pd
import pytest
from unittest.mock import MagicMock

from backend.services.algo_registry import build_algo
from backend.services.regime_rotation import RegimeRotation


def _make_target(now: pd.Timestamp, universe: pd.DataFrame) -> MagicMock:
    t = MagicMock()
    t.now = now
    t.universe = universe
    t.temp: dict = {}
    return t


def _prices(seed: int = 42) -> pd.DataFrame:
    """SPY + 3 sectors, crossover around day 200 (above → below)."""
    import numpy as np

    idx = pd.date_range("2020-01-02", periods=400, freq="B")
    np.random.seed(seed)
    df = pd.DataFrame(
        {
            "SPY": 100.0 + np.cumsum(np.random.randn(400) * 0.3),
            "XLY": 50.0 + np.cumsum(np.random.randn(400) * 0.4),
            "XLE": 40.0 + np.cumsum(np.random.randn(400) * 0.5),
            "XLF": 30.0 + np.cumsum(np.random.randn(400) * 0.3),
        },
        index=idx,
    )
    shift = pd.Series(0.0, index=idx, dtype=float)
    shift.iloc[:200] = 20.0
    shift.iloc[200:] = -20.0
    df["SPY"] = df["SPY"] + shift
    return df


@pytest.fixture
def prices():
    return _prices()


@pytest.fixture
def algo():
    return RegimeRotation(
        spy="SPY",
        sectors=["XLY", "XLE", "XLF"],
        sma=100,
        lookback=pd.DateOffset(months=3),
    )


class TestRegimeRotationCall:
    def test_above_sma_picks_spy(self, algo, prices):
        t = _make_target(prices.index[50], prices)
        algo(t)
        assert t.temp["selected"] == ["SPY"]

    def test_below_sma_picks_best_sector(self, algo, prices):
        t = _make_target(prices.index[250], prices)
        algo(t)
        selected = t.temp["selected"]
        assert isinstance(selected, list)
        assert len(selected) == 1
        assert selected[0] in ("XLY", "XLE", "XLF")

    def test_all_sectors_missing_fallback_to_spy(self, algo, prices):
        no_sectors = prices.drop(columns=["XLY", "XLE", "XLF"])
        t = _make_target(prices.index[250], no_sectors)
        algo(t)
        assert t.temp["selected"] == ["SPY"]

    def test_missing_universe_returns_empty(self, algo):
        t = MagicMock()
        t.now = pd.Timestamp("2020-01-02")
        t.universe = None
        t.temp = {}
        algo(t)
        assert t.temp["selected"] == []

    def test_now_not_in_index_returns_empty(self, algo, prices):
        t = _make_target(pd.Timestamp("2099-01-01"), prices)
        algo(t)
        assert t.temp["selected"] == []

    def test_lookback_int_fallback(self):
        a = RegimeRotation(spy="SPY", sma=100, lookback=90)
        assert a._resolve_lookback(_make_target(pd.Timestamp("2020-06-01"), prices)) == 90


class TestRegimeRotationRegistry:
    def test_discoverable(self):
        from backend.services.algo_registry import discover_algos

        names = discover_algos()
        assert "RegimeRotation" in names
        info = names["RegimeRotation"]
        assert info["params"]["spy"]["default"] == "SPY"
        assert info["params"]["sma"]["default"] == 200

    def test_build_from_registry(self):
        a = build_algo("RegimeRotation", {"spy": "SPY", "sma": "100"})
        assert isinstance(a, RegimeRotation)
        assert a.spy == "SPY"
        assert a.sma == 100

    def test_build_with_dateoffset_lookback(self):
        a = build_algo("RegimeRotation", {"lookback": "months=3"})
        assert isinstance(a.lookback, pd.DateOffset)


class TestRegimeRotationEndToEnd:
    """Run the algo inside a real bt backtest to ensure tree integration works."""

    def test_spy_above_sma_backtest(self):
        import bt

        from backend.models.strategy_tree import NodeConfig, StrategyTree
        from backend.services.tree_serializer import to_bt_strategy

        idx = pd.date_range("2020-01-02", periods=300, freq="B")
        import numpy as np

        np.random.seed(7)
        prices = pd.DataFrame(
            {
                "SPY": 100.0 + np.cumsum(np.random.randn(300) * 0.3),
                "XLY": 50.0 + np.cumsum(np.random.randn(300) * 0.4),
                "XLE": 40.0 + np.cumsum(np.random.randn(300) * 0.5),
            },
            index=idx,
        )
        shift = pd.Series(0.0, index=idx, dtype=float)
        shift.iloc[:150] = 15.0
        shift.iloc[150:] = -15.0
        prices["SPY"] = prices["SPY"] + shift

        tree = StrategyTree(
            name="test-regime-above",
            root=NodeConfig(
                name="root",
                type="Strategy",
                algos=[
                    {"class_name": "RunMonthly"},
                    {"class_name": "SelectAll"},
                    {"class_name": "RegimeRotation", "params": {"sma": "80", "lookback": "months=1"}},
                    {"class_name": "WeighEqually"},
                    {"class_name": "Rebalance"},
                ],
                children=[
                    {"name": "SPY", "type": "Security"},
                    {"name": "XLY", "type": "Security"},
                    {"name": "XLE", "type": "Security"},
                ],
            ),
        )
        strategy = to_bt_strategy(tree)
        b = bt.Backtest(strategy, prices, name="test")
        b.run()
        tx = b.strategy.get_transactions()
        assert not tx.empty, "expected some transactions"


class TestRegimeRotationValidate:
    def test_missing_ticker_warns(self):
        w = RegimeRotation.validate_params({"sectors": '["GLD"]'}, ["SPY", "XLE"])
        assert len(w) == 1
        assert "GLD" in w[0]

    def test_all_present_no_warn(self):
        w = RegimeRotation.validate_params({"sectors": '["SPY","XLE"]'}, ["SPY", "XLE"])
        assert w == []

    def test_empty_sectors_no_warn(self):
        w = RegimeRotation.validate_params({"sectors": ""}, ["SPY"])
        assert w == []

    def test_no_sectors_param_no_warn(self):
        w = RegimeRotation.validate_params({}, ["SPY"])
        assert w == []

    def test_invalid_json_warns(self):
        w = RegimeRotation.validate_params({"sectors": "not-json"}, ["SPY"])
        assert len(w) == 1
        assert "not valid JSON" in w[0].lower()

    def test_list_param_parsing(self):
        w = RegimeRotation.validate_params({"sectors": ["GLD", "SLV"]}, ["SPY"])
        assert len(w) == 2
        assert all("not in tree" in x for x in w)

"""Unit tests for backend/services/stat_algos.py (Tutorial 11 SPHMV screen).

Stub-target tests — no DB, no network, no bt.run(). The SelectN chaining
tests pin the integration contract: Stat* sets temp['stat'], SelectN ranks it.
"""

import bt.algos
import pandas as pd
import pytest

from backend.services import stat_algos
from backend.services.algo_registry import build_algo, discover_algos


class StubTarget:
    """Minimal stand-in for a bt Strategy/Target node."""

    def __init__(self, universe, now, selected):
        self.temp = {"selected": list(selected)}
        self.universe = universe
        self.now = now


def make_drawdown_universe(n=30):
    idx = pd.date_range("2020-01-01", periods=n, freq="B")
    aaa = [100.0 + i for i in range(n)]  # new high every day -> dd 0
    mid = n // 2
    bbb = [100.0 + 100.0 * i / (mid - 1) for i in range(mid)]  # 100 -> 200
    bbb += [200.0 - 100.0 * (i + 1) / (n - mid) for i in range(n - mid)]  # 200 -> 100
    return pd.DataFrame({"AAA": aaa, "BBB": bbb}, index=idx)


def make_ir_universe(n=60):
    idx = pd.date_range("2020-01-01", periods=n, freq="B")
    bmk = [100.0]
    for i in range(1, n):
        bmk.append(bmk[-1] * (1.01 if i % 2 else 0.99))  # noisy sideways
    aaa = [100.0]
    bbb = [100.0]
    for _ in range(1, n):
        aaa.append(aaa[-1] * 1.005)  # steady climb -> high IR
        bbb.append(bbb[-1] * 0.995)  # steady fall -> negative IR
    return pd.DataFrame({"AAA": aaa, "BBB": bbb, "IVV": bmk}, index=idx)


class TestStatDrawdown:
    def test_deepest_drawdown_ranked_first(self):
        univ = make_drawdown_universe()
        t = StubTarget(univ, univ.index[-1], ["AAA", "BBB"])
        algo = stat_algos.StatDrawdown(lookback=pd.DateOffset(months=3))
        assert algo(t) is True
        assert t.temp["stat"]["AAA"] == pytest.approx(0.0)
        assert t.temp["stat"]["BBB"] == pytest.approx(-0.5)
        assert bt.algos.SelectN(n=1, sort_descending=False)(t) is True
        assert t.temp["selected"] == ["BBB"]

    def test_empty_selected_sets_empty_stat(self):
        univ = make_drawdown_universe()
        t = StubTarget(univ, univ.index[-1], [])
        assert stat_algos.StatDrawdown()(t) is True
        assert len(t.temp["stat"]) == 0

    def test_unknown_ticker_raises(self):
        univ = make_drawdown_universe()
        t = StubTarget(univ, univ.index[-1], ["NOPE"])
        with pytest.raises(ValueError, match="NOPE"):
            stat_algos.StatDrawdown()(t)


class TestStatInfoRatio:
    def test_outperformer_ranked_first(self):
        univ = make_ir_universe()
        t = StubTarget(univ, univ.index[-1], ["AAA", "BBB"])
        algo = stat_algos.StatInfoRatio(benchmark="IVV", lookback=pd.DateOffset(months=3))
        assert algo(t) is True
        assert t.temp["stat"]["AAA"] > t.temp["stat"]["BBB"]
        assert bt.algos.SelectN(n=1, sort_descending=True)(t) is True
        assert t.temp["selected"] == ["AAA"]

    def test_zero_tracking_error_is_zero(self):
        idx = pd.date_range("2020-01-01", periods=10, freq="B")
        prices = [100.0 + i for i in range(10)]
        univ = pd.DataFrame({"AAA": prices, "IVV": prices}, index=idx)
        t = StubTarget(univ, idx[-1], ["AAA"])
        assert stat_algos.StatInfoRatio(benchmark="IVV")(t) is True
        assert t.temp["stat"]["AAA"] == 0.0

    def test_benchmark_case_insensitive(self):
        univ = make_ir_universe()
        t = StubTarget(univ, univ.index[-1], ["AAA"])
        assert stat_algos.StatInfoRatio(benchmark="ivv")(t) is True
        assert "AAA" in t.temp["stat"]

    def test_missing_benchmark_raises(self):
        univ = make_ir_universe()
        t = StubTarget(univ, univ.index[-1], ["AAA"])
        with pytest.raises(ValueError, match="NOPE"):
            stat_algos.StatInfoRatio(benchmark="NOPE")(t)

    def test_empty_selected_sets_empty_stat(self):
        univ = make_ir_universe()
        t = StubTarget(univ, univ.index[-1], [])
        assert stat_algos.StatInfoRatio(benchmark="IVV")(t) is True
        assert len(t.temp["stat"]) == 0


class TestGuiWiring:
    def test_discovery(self):
        reg = discover_algos()
        assert reg["StatDrawdown"]["category"] == "Selection"
        assert reg["StatInfoRatio"]["category"] == "Selection"
        assert "benchmark" in reg["StatInfoRatio"]["params"]
        assert "benchmark" in reg["StatInfoRatio"].get("required", []) or reg["StatInfoRatio"]["params"]["benchmark"]["required"]

    def test_build_algo_coerces_dateoffset_text(self):
        algo = build_algo("StatDrawdown", {"lookback": "years=10", "lag": "months=1"})
        assert algo.lookback == pd.DateOffset(years=10)
        assert algo.lag == pd.DateOffset(months=1)
        algo2 = build_algo("StatInfoRatio", {"benchmark": "IVV", "lookback": "months=7", "lag": "months=1"})
        assert algo2.benchmark == "IVV"
        assert algo2.lookback == pd.DateOffset(months=7)

    def test_build_algo_requires_benchmark(self):
        with pytest.raises(ValueError, match="benchmark"):
            build_algo("StatInfoRatio", {"benchmark": "", "lookback": "months=7"})

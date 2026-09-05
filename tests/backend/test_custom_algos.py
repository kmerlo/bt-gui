"""Characterization tests for backend/services/custom_algos.py.

Pure unit tests with a stub target — no DB, no network, no bt.run().
Pin current behavior; plan 026 flips the marked blocked-day assertion.
"""

import pandas as pd

from backend.services import custom_algos


class StubTarget:
    """Minimal stand-in for a bt Strategy/Target node."""

    def __init__(self, universe, now, data=None):
        self.temp = {}
        self.universe = universe
        self.now = now
        self._data = data or {}

    def get_data(self, name):
        if name in self._data:
            return self._data[name]
        raise KeyError(name)


def make_universe(dates, prices):
    idx = pd.DatetimeIndex(dates)
    return pd.DataFrame(prices, index=idx)


def sl_only(**kw):
    params = {
        "stop_loss_long": 0.0,
        "take_profit_long": 0.0,
        "stop_loss_short": 0.0,
        "take_profit_short": 0.0,
        "trailing_long": 0.0,
        "trailing_short": 0.0,
    }
    params.update(kw)
    return custom_algos.StopLossTakeProfit(**params)


D0, D1, D2, D3 = "2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08"


def drive(algo, universe, weights, day):
    t = StubTarget(universe, pd.Timestamp(day))
    t.temp["weights"] = weights
    assert algo(t) is True
    return t


class TestFixedLongSLTP:
    def test_fixed_long_sl_triggers(self):
        univ = make_universe([D0, D1], {"AAA": [100.0, 89.0]})
        algo = sl_only(stop_loss_long=0.1)
        drive(algo, univ, {"AAA": 1.0}, D0)
        assert algo._entry == {"AAA": 100.0}
        t = drive(algo, univ, {"AAA": 1.0}, D1)
        assert t.temp["weights"] == {}
        assert algo._entry == {}

    def test_fixed_long_sl_holds_above_level(self):
        univ = make_universe([D0, D1], {"AAA": [100.0, 91.0]})
        algo = sl_only(stop_loss_long=0.1)
        drive(algo, univ, {"AAA": 1.0}, D0)
        t = drive(algo, univ, {"AAA": 1.0}, D1)
        assert t.temp["weights"] == {"AAA": 1.0}
        assert algo._entry == {"AAA": 100.0}

    def test_fixed_long_tp_triggers(self):
        univ = make_universe([D0, D1], {"AAA": [100.0, 151.0]})
        algo = sl_only(take_profit_long=0.5)
        drive(algo, univ, {"AAA": 1.0}, D0)
        t = drive(algo, univ, {"AAA": 1.0}, D1)
        assert t.temp["weights"] == {}
        assert algo._entry == {}

    def test_multi_ticker_isolation(self):
        univ = make_universe([D0, D1], {"AAA": [100.0, 89.0], "BBB": [100.0, 101.0]})
        algo = sl_only(stop_loss_long=0.1)
        drive(algo, univ, {"AAA": 0.5, "BBB": 0.5}, D0)
        t = drive(algo, univ, {"AAA": 0.5, "BBB": 0.5}, D1)
        assert t.temp["weights"] == {"BBB": 0.5}
        assert algo._entry == {"BBB": 100.0}


class TestTrailingLong:
    def test_trailing_ratchets_and_exits(self):
        univ = make_universe([D0, D1, D2, D3], {"AAA": [100.0, 120.0, 115.0, 107.0]})
        algo = sl_only(trailing_long=0.1)
        drive(algo, univ, {"AAA": 1.0}, D0)
        assert algo._trail_high == {"AAA": 100.0}
        t = drive(algo, univ, {"AAA": 1.0}, D1)
        assert algo._trail_high == {"AAA": 120.0}
        assert t.temp["weights"] == {"AAA": 1.0}
        t = drive(algo, univ, {"AAA": 1.0}, D2)  # 115 > 120*0.9=108 -> hold
        assert algo._trail_high == {"AAA": 120.0}
        assert t.temp["weights"] == {"AAA": 1.0}
        t = drive(algo, univ, {"AAA": 1.0}, D3)  # 107 <= 108 -> exit
        assert t.temp["weights"] == {}
        assert algo._entry == {}


class TestShortSide:
    def test_fixed_short_sl_triggers(self):
        univ = make_universe([D0, D1], {"AAA": [100.0, 104.0]})
        algo = sl_only(stop_loss_short=0.03)
        drive(algo, univ, {"AAA": -1.0}, D0)
        assert algo._entry == {"AAA": 100.0}
        t = drive(algo, univ, {"AAA": -1.0}, D1)
        assert t.temp["weights"] == {}
        assert algo._entry == {}

    def test_fixed_short_tp_triggers(self):
        univ = make_universe([D0, D1], {"AAA": [100.0, 94.0]})
        algo = sl_only(take_profit_short=0.05)
        drive(algo, univ, {"AAA": -1.0}, D0)
        t = drive(algo, univ, {"AAA": -1.0}, D1)
        assert t.temp["weights"] == {}
        assert algo._entry == {}


class TestStateClearing:
    def test_weight_zero_clears_state(self):
        univ = make_universe([D0, D1], {"AAA": [100.0, 101.0]})
        algo = sl_only(stop_loss_long=0.1)
        drive(algo, univ, {"AAA": 1.0}, D0)
        assert "AAA" in algo._entry
        t = drive(algo, univ, {"AAA": 0.0}, D1)
        assert t.temp["weights"] == {}
        assert algo._entry == {}
        assert algo._trail_high == {}

    def test_deselected_ticker_clears_state(self):
        univ = make_universe([D0, D1], {"AAA": [100.0, 101.0], "BBB": [100.0, 101.0]})
        algo = sl_only(stop_loss_long=0.1)
        drive(algo, univ, {"AAA": 0.5, "BBB": 0.5}, D0)
        t = drive(algo, univ, {"AAA": 0.5}, D1)
        assert t.temp["weights"] == {"AAA": 0.5}
        assert algo._entry == {"AAA": 100.0}

    def test_series_weights_type_preserved(self):
        univ = make_universe([D0, D1], {"AAA": [100.0, 89.0], "BBB": [100.0, 101.0]})
        algo = sl_only(stop_loss_long=0.1)
        drive(algo, univ, pd.Series({"AAA": 0.5, "BBB": 0.5}), D0)
        t = drive(algo, univ, pd.Series({"AAA": 0.5, "BBB": 0.5}), D1)
        w = t.temp["weights"]
        assert isinstance(w, pd.Series)
        assert w.to_dict() == {"BBB": 0.5}
        algo2 = sl_only(stop_loss_long=0.1)
        t2 = drive(algo2, univ, pd.Series({"AAA": 1.0}), D0)
        assert isinstance(t2.temp["weights"], pd.Series)
        t2.now = pd.Timestamp(D1)
        algo2(t2)
        assert isinstance(t2.temp["weights"], pd.Series)
        assert len(t2.temp["weights"]) == 0


class TestBlockedDay:
    def _entered(self, dates_prices):
        univ = make_universe(list(dates_prices[0]), dates_prices[1])
        algo = sl_only(stop_loss_long=0.1)
        drive(algo, univ, {"AAA": 1.0, "BBB": 1.0}, D0)
        return algo, univ

    def test_blocked_day_breach_exits_whole_portfolio(self):
        # plan-026 will change this to per-ticker exit
        algo, univ = self._entered(( [D0, D1], {"AAA": [100.0, 89.0], "BBB": [100.0, 101.0]}))
        t = StubTarget(univ, pd.Timestamp(D1))  # w is None: RunMonthly-blocked day
        assert algo(t) is True
        assert t.temp["weights"] == {}
        assert "AAA" not in algo._entry

    def test_blocked_day_no_breach_leaves_weights_missing(self):
        algo, univ = self._entered(([D0, D1], {"AAA": [100.0, 101.0], "BBB": [100.0, 102.0]}))
        t = StubTarget(univ, pd.Timestamp(D1))
        assert algo(t) is True
        assert "weights" not in t.temp
        assert set(algo._entry) == {"AAA", "BBB"}


G0, G1, G2 = "2026-01-28", "2026-01-29", "2026-02-02"  # G2 is a monthly period start


def gate_universe(dates=(G0, G1, G2)):
    return make_universe(list(dates), {"AAA": [100.0] * len(dates)})


def sig_df(dates, vals, ticker="AAA"):
    return pd.DataFrame({ticker: vals}, index=pd.DatetimeIndex(list(dates)))


def gate_call(algo, universe, day):
    t = StubTarget(universe, pd.Timestamp(day))
    out = algo(t)
    return out, t.temp["selected"]


class TestEntryGateMemory:
    def test_pending_promoted_at_period_start(self):
        univ = gate_universe()
        cross = sig_df((G0, G1, G2), [False, True, False])
        algo = custom_algos.EntryGateMemory(cross_signal=cross, period="monthly")
        out, sel = gate_call(algo, univ, G0)
        assert (out, sel) == (False, [])
        out, sel = gate_call(algo, univ, G1)
        assert (out, sel) == (False, [])  # trigger remembered, entry blocked
        assert "AAA" in algo._pending
        out, sel = gate_call(algo, univ, G2)
        assert (out, sel) == (True, ["AAA"])

    def test_pending_consumed_after_period(self):
        univ = gate_universe((G0, G1, G2, "2026-03-02"))
        cross = sig_df((G0, G1, G2, "2026-03-02"), [False, True, False, False])
        algo = custom_algos.EntryGateMemory(cross_signal=cross, period="monthly")
        gate_call(algo, univ, G1)
        gate_call(algo, univ, G2)
        assert algo._pending == {}
        out, sel = gate_call(algo, univ, "2026-03-02")
        assert (out, sel) == (False, [])

    def test_cross_on_period_start_selected_immediately(self):
        univ = gate_universe()
        cross = sig_df((G0, G1, G2), [False, False, True])
        algo = custom_algos.EntryGateMemory(cross_signal=cross, period="monthly")
        out, sel = gate_call(algo, univ, G2)
        assert (out, sel) == (True, ["AAA"])

    def test_filter_mode_at_entry(self):
        univ = gate_universe()
        cross = sig_df((G0, G1, G2), [False, True, False])
        filt = sig_df((G0, G1, G2), [False, False, True])  # false at trigger, true at entry
        algo = custom_algos.EntryGateMemory(cross_signal=cross, filter_signal=filt, filter_mode="at_entry")
        gate_call(algo, univ, G1)
        out, sel = gate_call(algo, univ, G2)
        assert (out, sel) == (True, ["AAA"])

    def test_filter_mode_at_trigger(self):
        univ = gate_universe()
        cross = sig_df((G0, G1, G2), [False, True, False])
        filt = sig_df((G0, G1, G2), [False, True, False])  # true at trigger, false at entry
        algo = custom_algos.EntryGateMemory(cross_signal=cross, filter_signal=filt, filter_mode="at_trigger")
        gate_call(algo, univ, G1)
        out, sel = gate_call(algo, univ, G2)
        assert (out, sel) == (True, ["AAA"])
        algo2 = custom_algos.EntryGateMemory(cross_signal=cross, filter_signal=sig_df((G0, G1, G2), [False, False, True]), filter_mode="at_trigger")
        gate_call(algo2, univ, G1)
        out, sel = gate_call(algo2, univ, G2)
        assert (out, sel) == (False, [])

    def test_filter_mode_both(self):
        univ = gate_universe()
        cross = sig_df((G0, G1, G2), [False, True, False])
        both_true = sig_df((G0, G1, G2), [False, True, True])
        algo = custom_algos.EntryGateMemory(cross_signal=cross, filter_signal=both_true, filter_mode="both")
        gate_call(algo, univ, G1)
        out, sel = gate_call(algo, univ, G2)
        assert (out, sel) == (True, ["AAA"])
        algo2 = custom_algos.EntryGateMemory(cross_signal=cross, filter_signal=sig_df((G0, G1, G2), [False, True, False]), filter_mode="both")
        gate_call(algo2, univ, G1)
        out, sel = gate_call(algo2, univ, G2)
        assert (out, sel) == (False, [])

    def test_filter_only_without_cross(self):
        univ = gate_universe()
        filt = sig_df((G0, G1, G2), [False, False, True])
        algo = custom_algos.EntryGateMemory(cross_signal=None, filter_signal=filt, period="monthly")
        out, sel = gate_call(algo, univ, G2)
        assert (out, sel) == (True, ["AAA"])
        out, sel = gate_call(algo, univ, G1)
        assert (out, sel) == (False, [])

    def test_daily_period_selects_same_day(self):
        univ = gate_universe()
        cross = sig_df((G0, G1, G2), [False, True, False])
        algo = custom_algos.EntryGateMemory(cross_signal=cross, period="daily")
        out, sel = gate_call(algo, univ, G1)
        assert (out, sel) == (True, ["AAA"])


class TestRebalanceAlways:
    def test_no_weights_is_noop(self):
        algo = custom_algos.RebalanceAlways()
        t = StubTarget(gate_universe(), pd.Timestamp(G1))
        assert algo(t) is True
        assert "weights" not in t.temp

    def test_delegates_to_inner_rebalance(self):
        algo = custom_algos.RebalanceAlways()
        calls = {}

        class FakeRB:
            def __call__(self, target):
                calls["weights"] = dict(target.temp["weights"])
                return True

        algo._rb = FakeRB()
        t = StubTarget(gate_universe(), pd.Timestamp(G1))
        t.temp["weights"] = {"AAA": 1.0}
        assert algo(t) is True
        assert calls == {"weights": {"AAA": 1.0}}

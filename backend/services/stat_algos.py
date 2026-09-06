from __future__ import annotations

import ffn  # noqa: F401  # registers to_drawdown_series / calc_information_ratio on pandas
import pandas as pd
from bt.core import Algo


def _resolve_columns(universe: pd.DataFrame, names: list[str], owner: str) -> list:
    """Match requested names to universe columns case-insensitively."""
    upper = {str(c).upper(): c for c in universe.columns}
    missing = [n for n in names if str(n).upper() not in upper]
    if missing:
        raise ValueError(f"{owner}: {missing} not in universe columns {list(universe.columns)}")
    return [upper[str(n).upper()] for n in names]


class StatDrawdown(Algo):
    """
    Value stat: current drawdown of each selected security over lookback.

    Drawdown = price / rolling-max - 1 (0 at highs, negative below).
    Pair with SelectN(n=5, sort_descending=False) to keep the deepest
    drawdowns ("cheap" candidates) — Tutorial 11 (SPHMV value leg).

    Args:
        * lookback (DateOffset): window for the rolling maximum, e.g. years=10.
        * lag (DateOffset): shift the window end back, e.g. days=0.

    Requires:
        * selected

    Sets:
        * stat
    """

    def __init__(self, lookback=pd.DateOffset(months=3), lag=pd.DateOffset(days=0)):
        super().__init__()
        self.lookback = lookback
        self.lag = lag

    def __call__(self, target):
        selected = list(target.temp.get("selected", []))
        if not selected:
            target.temp["stat"] = pd.Series(dtype=float)
            return True
        cols = _resolve_columns(target.universe, selected, "StatDrawdown")
        t0 = target.now - self.lag
        prc = target.universe.loc[(t0 - self.lookback) : t0, cols]
        if prc.empty:
            target.temp["stat"] = pd.Series(dtype=float)
            return True
        dd = prc.to_drawdown_series().iloc[-1]
        target.temp["stat"] = dd if isinstance(dd, pd.Series) else pd.Series({cols[0]: float(dd)})
        return True


class StatInfoRatio(Algo):
    """
    Momentum stat: information ratio of each selected security vs benchmark.

    IR = mean(active return) / tracking error over lookback, with lag to
    avoid look-ahead. Pair with SelectN(n=3, sort_descending=True) to keep
    the best risk-adjusted momentum — Tutorial 11 (SPHMV momentum leg).

    Args:
        * benchmark (str): benchmark ticker in the universe, e.g. IVV.
        * lookback (DateOffset): return window, e.g. months=7.
        * lag (DateOffset): shift the window end back, e.g. months=1.

    Requires:
        * selected

    Sets:
        * stat
    """

    def __init__(self, benchmark, lookback=pd.DateOffset(months=3), lag=pd.DateOffset(days=0)):
        super().__init__()
        self.benchmark = benchmark
        self.lookback = lookback
        self.lag = lag

    def __call__(self, target):
        selected = list(target.temp.get("selected", []))
        if not selected:
            target.temp["stat"] = pd.Series(dtype=float)
            return True
        bmk_col = _resolve_columns(target.universe, [self.benchmark], "StatInfoRatio")[0]
        cols = _resolve_columns(target.universe, selected, "StatInfoRatio")
        t0 = target.now - self.lag
        window = target.universe.loc[(t0 - self.lookback) : t0]
        if window.empty:
            target.temp["stat"] = pd.Series(dtype=float)
            return True
        prc = window[cols].pct_change().dropna()
        bmk = window[bmk_col].pct_change().dropna()
        target.temp["stat"] = pd.Series({p: prc[p].calc_information_ratio(bmk) for p in prc})
        return True

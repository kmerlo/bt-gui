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
        # ponytail: preloaded benchmark prices (set by backtest_runner so the
        # benchmark need NOT be a Security in the tree / column in universe —
        # Tutorial 11 SPHMV uses IVV as benchmark over a sectors-only universe)
        self._benchmark_series: pd.Series | None = None

    def _benchmark_prices(self) -> pd.Series:
        """Benchmark price series outside universe: preloaded first, else DB fallback (cached)."""
        if self._benchmark_series is not None:
            return self._benchmark_series
        bm = _load_benchmark_series(self.benchmark)
        self._benchmark_series = bm
        return bm

    def __call__(self, target):
        selected = list(target.temp.get("selected", []))
        if not selected:
            target.temp["stat"] = pd.Series(dtype=float)
            return True
        cols = _resolve_columns(target.universe, selected, "StatInfoRatio")
        t0 = target.now - self.lag
        window = target.universe.loc[(t0 - self.lookback) : t0]
        if window.empty:
            target.temp["stat"] = pd.Series(dtype=float)
            return True
        prc = window[cols].pct_change().dropna()
        try:
            bmk_col = _resolve_columns(target.universe, [self.benchmark], "StatInfoRatio")[0]
            bmk = window[bmk_col].pct_change().dropna()
        except ValueError:
            # ponytail: benchmark outside universe (Tutorial 11: IVV vs sectors)
            # — use preloaded/DB series aligned on the same window instead of crashing
            bm_series = self._benchmark_prices()
            bmk = bm_series.loc[(t0 - self.lookback) : t0].pct_change().dropna()
            common = prc.index.intersection(bmk.index)
            if common.empty:
                target.temp["stat"] = pd.Series(dtype=float)
                return True
            prc = prc.loc[common]
            bmk = bmk.loc[common]
        target.temp["stat"] = pd.Series({p: prc[p].calc_information_ratio(bmk) for p in prc})
        return True


def _load_benchmark_series(
    benchmark: str,
    start: str | None = None,
    end: str | None = None,
    price_column: str = "close",
) -> pd.Series:
    """Load a single-ticker benchmark price series from the active price source.

    Used when the benchmark (e.g. IVV) is not a Security in the tree, so it is
    absent from the bt universe. Raises ValueError naming the benchmark when no
    data exists — caller surfaces it as 422 / actionable message, never silent.
    """
    from backend.services.price_loading import _load_prices_from_db

    name = str(benchmark).strip().upper()
    try:
        df = _load_prices_from_db([name], start, end, price_column)
    except ValueError as e:
        raise ValueError(
            f"StatInfoRatio: benchmark '{name}' has no price data for range {start}->{end} "
            f"(price_column={price_column}). Fetch {name} in Ticker Catalog. ({e})"
        ) from e
    if df.empty:
        raise ValueError(f"StatInfoRatio: benchmark '{name}' has no price data — Fetch {name} in Ticker Catalog.")
    col = next((c for c in df.columns if str(c).upper() == name), df.columns[0])
    s = pd.to_numeric(df[col], errors="coerce").dropna()
    s.index = pd.to_datetime(s.index)
    if s.empty:
        raise ValueError(f"StatInfoRatio: benchmark '{name}' has only NaN prices.")
    return s


def collect_stat_benchmarks(tree) -> list[str]:
    """Benchmark tickers referenced by StatInfoRatio algos in a StrategyTree.

    Accepts a StrategyTree / NodeConfig / plain dict (model_dump). Returns
    sorted upper-case names, empty strings skipped. Pure walk, no DB access.
    """
    found: set[str] = set()

    def _algos_of(node) -> list:
        if isinstance(node, dict):
            return node.get("algos") or []
        return getattr(node, "algos", None) or []

    def _children_of(node) -> list:
        if isinstance(node, dict):
            return node.get("children") or []
        return getattr(node, "children", None) or []

    def _walk(node) -> None:
        for a in _algos_of(node):
            cls = a.get("class_name") if isinstance(a, dict) else getattr(a, "class_name", None)
            if cls != "StatInfoRatio":
                continue
            params = a.get("params") if isinstance(a, dict) else (getattr(a, "params", None) or {})
            bmk = (params or {}).get("benchmark")
            if isinstance(bmk, str) and bmk.strip():
                found.add(bmk.strip().upper())
        for ch in _children_of(node):
            _walk(ch)

    if hasattr(tree, "root"):
        root = tree.root
    elif isinstance(tree, dict):
        root = tree.get("root", tree)
    else:
        root = tree
    _walk(root if root is not None else tree)
    return sorted(found)


def preload_stat_benchmarks(bt_root, start=None, end=None, price_column: str = "close") -> None:
    """Preload benchmark series onto every StatInfoRatio in a built bt tree.

    Best-effort: failures are left for call-time fallback (which raises the
    actionable ValueError). Uses the run's own start/end/price_column so the
    IR matches the backtest prices exactly.
    """
    stack = [bt_root]
    while stack:
        node = stack.pop()
        algos = getattr(getattr(node, "stack", None), "algos", None) or []
        for a in algos:
            if type(a).__name__ == "StatInfoRatio" and getattr(a, "_benchmark_series", None) is None:
                try:
                    a._benchmark_series = _load_benchmark_series(a.benchmark, start, end, price_column)
                except Exception:
                    pass  # ponytail: call-time fallback raises the actionable error
        children = getattr(node, "children", None) or {}
        try:
            stack.extend(children.values() if hasattr(children, "values") else children)
        except Exception:
            pass  # ponytail: bt children shape varies pre/post setup — walk best-effort

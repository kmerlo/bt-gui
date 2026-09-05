from __future__ import annotations

import math

import pandas as pd

TRADING_DAYS = 252


def normalize_ticker(v: str | None) -> str | None:
    """Trim/upper a benchmark ticker; empty -> None (no benchmark)."""
    if v is None:
        return None
    t = v.strip().upper()
    return t or None


def load_benchmark_series(
    ticker: str,
    start: str | None,
    end: str | None,
    price_column: str = "close",
) -> pd.Series:
    """Load one price column for the benchmark ticker from the configured price source."""
    from backend.services.backtest_runner import _load_prices_from_db

    df = _load_prices_from_db([ticker], start, end, price_column)
    if df.empty:
        raise ValueError(f"No price data found for benchmark {ticker}")
    col = ticker.upper()
    if col not in (str(c).upper() for c in df.columns):
        raise ValueError(f"price data missing benchmark column {col}")
    s = df[col] if col in df.columns else df[[c for c in df.columns if str(c).upper() == col][0]]
    s = pd.to_numeric(s, errors="coerce").dropna()
    if s.empty:
        raise ValueError(f"No price data found for benchmark {ticker}")
    return s  # type: ignore[return-value]


def align_benchmark_to_index(
    bench: pd.Series,
    idx: pd.DatetimeIndex,
    scale_to: float,
) -> pd.Series:
    """Reindex benchmark to the strategy index (ffill) and scale buy&hold to start at scale_to.

    scale_to must be the strategy's first equity value: bt stores equity normalized
    (base 100), NOT at initial_capital — scaling to capital would squash the strategy flat.
    """
    b = bench.copy()
    b.index = pd.to_datetime(b.index)
    idx = pd.to_datetime(idx)
    b = b.reindex(idx).ffill()
    first = b[b.notna()]
    if first.empty:
        return pd.Series(float("nan"), index=idx)
    return (b / float(first.iloc[0]) * scale_to).rename("benchmark")


def _clean(v: float) -> float | None:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if math.isnan(f) or math.isinf(f):
        return None
    return f


def _max_drawdown(equity: pd.Series) -> float | None:
    try:
        peak = equity.cummax()
        dd = (equity / peak - 1).min()
        return _clean(float(dd))
    except Exception:
        return None


def _cagr(equity: pd.Series) -> float | None:
    try:
        first = float(equity.iloc[0])
        last = float(equity.iloc[-1])
        if first <= 0:
            return None
        years = len(equity) / TRADING_DAYS
        if years <= 0:
            return None
        return _clean((last / first) ** (1 / years) - 1)
    except Exception:
        return None


def compute_benchmark_stats(
    strat_equity: pd.Series,
    bench_equity: pd.Series,
) -> dict[str, float | None]:
    """Compare strategy vs buy&hold benchmark on the overlapping valid index.

    Returns benchmark TR/CAGR/maxDD, outperformance, alpha/beta/correlation,
    tracking error and information ratio (daily returns, rf=0, 252 days).
    """
    out: dict[str, float | None] = {
        "benchmark_total_return": None,
        "benchmark_cagr": None,
        "benchmark_max_drawdown": None,
        "outperformance": None,
        "outperformance_cagr": None,
        "alpha": None,
        "beta": None,
        "correlation": None,
        "tracking_error": None,
        "information_ratio": None,
    }
    try:
        df = pd.DataFrame({"s": strat_equity, "b": bench_equity}).dropna()
        if len(df) < 2:
            return out
        s, b = df["s"], df["b"]
        b_tr = float(b.iloc[-1] / b.iloc[0] - 1) if float(b.iloc[0]) else None
        s_tr = float(s.iloc[-1] / s.iloc[0] - 1) if float(s.iloc[0]) else None
        out["benchmark_total_return"] = _clean(b_tr) if b_tr is not None else None
        out["benchmark_cagr"] = _cagr(b)
        out["benchmark_max_drawdown"] = _max_drawdown(b)
        if s_tr is not None and out["benchmark_total_return"] is not None:
            out["outperformance"] = _clean(s_tr - out["benchmark_total_return"])
        s_cagr = _cagr(s)
        if s_cagr is not None and out["benchmark_cagr"] is not None:
            out["outperformance_cagr"] = _clean(s_cagr - out["benchmark_cagr"])
        rs = s.pct_change().dropna()
        rb = b.pct_change().dropna()
        paired = pd.DataFrame({"rs": rs, "rb": rb}).dropna()
        if len(paired) < 2:
            return out
        var_b = float(paired["rb"].var())
        if var_b > 0:
            beta = float(paired["rs"].cov(paired["rb"]) / var_b)
            out["beta"] = _clean(beta)
            out["alpha"] = _clean(float((paired["rs"] - beta * paired["rb"]).mean() * TRADING_DAYS))
        try:
            out["correlation"] = _clean(float(paired["rs"].corr(paired["rb"])))
        except Exception:
            pass
        active = paired["rs"] - paired["rb"]
        te = float(active.std() * math.sqrt(TRADING_DAYS))
        out["tracking_error"] = _clean(te)
        if te and te > 0:
            out["information_ratio"] = _clean(float(active.mean() / active.std() * math.sqrt(TRADING_DAYS)))
        return out
    except Exception:
        return out

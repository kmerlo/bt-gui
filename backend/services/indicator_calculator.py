from __future__ import annotations

import inspect
from typing import Any

import pandas as pd

# ponytail: pandas-ta-classic — single-source-of-truth per tutti gli indicatori
# (193 indicatori nativi, senza TA-Lib; talib=False forza implementazione pure-pandas)
import pandas_ta_classic as ta  # noqa: E402  # must be imported once, not inline


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _close_col(df: pd.DataFrame) -> pd.Series:
    if "close" in df.columns:
        return df["close"]
    numeric = df.select_dtypes(include="number")
    if numeric.empty:
        raise ValueError("no numeric column found (need 'close' or at least one numeric column)")
    return numeric.iloc[:, 0]


def _is_multi_ticker(df: pd.DataFrame) -> bool:
    # Multi-ticker price DF from ffnn — no "close" column, multiple numeric cols
    if "close" in df.columns:
        return False
    ohlc = {"open", "high", "low", "close", "volume", "adj close", "adj_close"}
    if any(c.lower() in ohlc for c in df.columns):
        return False
    numeric = df.select_dtypes(include="number")
    return len(numeric.columns) > 1 and len(df.columns) > 1


def _normalise_columns(df: pd.DataFrame) -> pd.DataFrame:
    """Lowercase all column names so downstream code is stable."""
    df = df.copy()
    df.columns = [str(c).lower() for c in df.columns]
    return df


def _series_to_df(s: pd.Series, df: pd.DataFrame) -> pd.DataFrame:
    """Wrap a Series in a DataFrame with a lowercase column name."""
    col_name = str(s.name or "value").lower()
    return pd.DataFrame({col_name: s}, index=df.index)


def _result_to_output(result: Any, df: pd.DataFrame) -> pd.DataFrame | dict[str, pd.DataFrame]:
    """Normalise any pandas-ta result into a consistent output shape."""
    if isinstance(result, pd.Series):
        return _series_to_df(result, df)
    if isinstance(result, dict):
        out: dict[str, pd.DataFrame] = {}
        for k, v in result.items():
            key = str(k).lower()
            if isinstance(v, pd.Series):
                out[key] = _series_to_df(v, df)
            elif isinstance(v, pd.DataFrame):
                out[key] = _normalise_columns(v)
            else:
                out[key] = pd.DataFrame({key: pd.Series(v, index=df.index)})
        return out
    if isinstance(result, pd.DataFrame):
        return _normalise_columns(result)
    # Fallback: scalar or other — wrap
    return pd.DataFrame({"value": pd.Series(result, index=df.index)})


# ---------------------------------------------------------------------------
# Indicator registry — built dynamically from pandas_ta_classic.Category
# ---------------------------------------------------------------------------

# Columns that pandas-ta-classic requires beyond 'close' — skip these from the list
_INDICATORS_NEEDING_EXTRA_COLS: set[str] = {
    "ad", "adosc", "cmf", "ebsw", "ht_dcperiod", "ht_dcphase", "ht_phasor",
    "ht_sine", "ht_trendline", "ht_trendmode", "psl", "pvol", "vwma",
}
# Candlestick wrappers are not standalone indicators for our use-case
_SKIP_NAMES: set[str] = {"cdl_pattern", "cdl_doji", "cdl_inside", "cdl_z", "ha"}


def _make_wrapper(ind_name: str):
    """Return a function(indicator_calculator._close_col(df), **kwargs) -> DataFrame|dict."""

    def wrapper(df: pd.DataFrame, **kwargs: Any):
        is_multi = _is_multi_ticker(df)

        if is_multi:
            # pandas-ta-classic needs a 'close' column — delegate per-ticker column to pta
            out_parts: dict[str, pd.Series] = {}
            for col in df.columns:
                # ponytail: strip ':' da vecchi ticker normalizzati male (es. 'AAPL:close')
                clean_col = str(col).split(":")[0].strip().upper()
                s = df[col]
                single = pd.DataFrame({"close": s})
                r = getattr(single.ta, ind_name)(talib=False, **kwargs)
                if isinstance(r, pd.Series):
                    # Use original column name so backtest ticker filter matches
                    out_parts[clean_col] = r
                elif isinstance(r, pd.DataFrame):
                    for c in r.columns:
                        out_parts[f"{clean_col}_{str(c).lower()}"] = r[c]
            if not out_parts:
                return pd.DataFrame(index=df.index)
            if len(out_parts) == 1:
                return list(out_parts.values())[0]
            return pd.DataFrame(out_parts, index=df.index)

        # Single-column / OHLC path — ensure 'close' exists for pandas-ta-classic
        if "close" not in df.columns:
            close_series = _close_col(df)
            df = df.copy()
            df["close"] = close_series

        fn = getattr(getattr(df, "ta"), ind_name)
        sig = inspect.signature(fn)
        sig_params = set(sig.parameters.keys())
        filtered = {k: v for k, v in kwargs.items() if k in sig_params or k == "talib"}
        result = fn(talib=False, **filtered)

        if isinstance(result, pd.Series):
            col_name = (str(result.name) if result.name else ind_name).lower()
            return pd.DataFrame({col_name: result}, index=df.index)

        if isinstance(result, dict):
            return {str(k).lower(): pd.DataFrame({str(k).lower(): v}, index=v.index if hasattr(v, "index") else df.index)  # type: ignore[union-attr]
                    for k, v in result.items()}

        return _normalise_columns(result)

    return wrapper


def _params_for(ind_name: str) -> list[dict]:
    """Return param specs for the frontend indicator form."""
    # Common indicators have None as signature default but use internal defaults at runtime.
    # Hardcode known defaults to avoid exposing "length: str, default: None" in the UI.
    KNOWN_DEFAULTS: dict[str, dict[str, Any]] = {
        "sma": {"length": 10},
        "ema": {"length": 10},
        "rsi": {"length": 14},
        "macd": {"fast": 12, "slow": 26, "signal": 9},
        "bbands": {"length": 20, "std": 2.0},
    }
    sample_df = pd.DataFrame({"close": [1.0]})
    fn = getattr(sample_df.ta, ind_name)
    sig = inspect.signature(fn)
    params = []
    defaults = KNOWN_DEFAULTS.get(ind_name, {})
    for pname, param in sig.parameters.items():
        if pname in ("self", "offset", "talib", "kwargs", "append"):
            continue
        default = defaults.get(pname, param.default)
        if default is inspect.Parameter.empty:
            default = defaults.get(pname, 14 if pname in ("length",) else None)
        ptype = "int" if isinstance(default, int) else ("float" if isinstance(default, float) else "str")
        params.append({"name": pname, "type": ptype, "default": default})
    return params


# Build INDICATOR_DEFS from pandas_ta_classic.Category
INDICATOR_DEFS: dict[str, dict] = {}
for cat_items in ta.Category.values():
    for item in cat_items:
        ind_name = item if isinstance(item, str) else getattr(item, "name", None)
        if not ind_name or ind_name in _SKIP_NAMES or ind_name in _INDICATORS_NEEDING_EXTRA_COLS:
            continue
        func = _make_wrapper(ind_name)
        params = _params_for(ind_name)
        INDICATOR_DEFS[ind_name] = {
            "display": ind_name.upper(),
            "func": func,
            "params": params,
            "output_key": ind_name,
        }

# Ensure display names are human-readable for known common indicators
_DISPLAY_NAMES: dict[str, str] = {
    "sma": "SMA",
    "ema": "EMA",
    "rsi": "RSI",
    "macd": "MACD",
    "bbands": "Bollinger Bands",
}
for k, disp in _DISPLAY_NAMES.items():
    if k in INDICATOR_DEFS:
        INDICATOR_DEFS[k]["display"] = disp


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def get_indicator_defs() -> list[dict]:
    return [
        {
            "type": k,
            "display": v["display"],
            "params": v["params"],
            "output_key": v["output_key"],
        }
        for k, v in INDICATOR_DEFS.items()
    ]


def compute_indicator(type_str: str, df: pd.DataFrame, params: dict) -> tuple[pd.DataFrame | dict[str, pd.DataFrame], dict]:
    if type_str not in INDICATOR_DEFS:
        raise ValueError(f"Unknown indicator type: {type_str}")
    fn = INDICATOR_DEFS[type_str]["func"]
    # Merge user-provided params with defaults from the def
    merged: dict = {}
    for p in INDICATOR_DEFS[type_str]["params"]:
        key = p["name"]
        merged[key] = params.get(key, p["default"])
    result = fn(df, **merged)
    if isinstance(result, pd.DataFrame):
        idx = pd.to_datetime(result.index)
    elif isinstance(result, dict):
        sample = next(iter(result.values()))
        idx = pd.to_datetime(sample.index if hasattr(sample, "index") else [])
    else:
        idx = pd.DatetimeIndex([])
    meta = {
        "indicator_type": type_str,
        "params": merged,
        "date_range": {
            "start": str(idx.min())[:10] if len(idx) else "",
            "end": str(idx.max())[:10] if len(idx) else "",
        },
    }
    return result, meta


# Backward-compat wrappers: existing callers (tests + algos) import these directly.
def compute_sma(df: pd.DataFrame, period: int) -> pd.DataFrame:
    result, _ = compute_indicator("sma", df, {"length": period})
    return result if isinstance(result, pd.DataFrame) else result[next(iter(result))]  # type: ignore[index]


def compute_ema(df: pd.DataFrame, period: int) -> pd.DataFrame:
    result, _ = compute_indicator("ema", df, {"length": period})
    return result if isinstance(result, pd.DataFrame) else result[next(iter(result))]  # type: ignore[index]


def compute_rsi(df: pd.DataFrame, period: int = 14) -> pd.DataFrame:
    result, _ = compute_indicator("rsi", df, {"length": period})
    return result if isinstance(result, pd.DataFrame) else result[next(iter(result))]  # type: ignore[index]


def compute_macd(df: pd.DataFrame, fast: int = 12, slow: int = 26, signal: int = 9) -> pd.DataFrame:
    result, _ = compute_indicator("macd", df, {"fast": fast, "slow": slow, "signal": signal})
    assert isinstance(result, pd.DataFrame)
    return result


def compute_bollinger(df: pd.DataFrame, period: int = 20, std_dev: float = 2.0) -> pd.DataFrame:
    result, _ = compute_indicator("bbands", df, {"length": period, "std": std_dev})
    assert isinstance(result, pd.DataFrame)
    return result

from __future__ import annotations

import pandas as pd


def _close_col(df: pd.DataFrame) -> pd.Series:
    if "close" in df.columns:
        return df["close"]
    numeric = df.select_dtypes(include="number")
    if numeric.empty:
        raise ValueError("no numeric column found (need 'close' or at least one numeric column)")
    return numeric.iloc[:, 0]


def compute_sma(df: pd.DataFrame, period: int) -> pd.DataFrame:
    close = _close_col(df)
    result = close.rolling(period, min_periods=period).mean()
    return pd.DataFrame({f"sma_{period}": result}, index=df.index)


def compute_ema(df: pd.DataFrame, period: int) -> pd.DataFrame:
    close = _close_col(df)
    result = close.ewm(span=period, adjust=False).mean()
    return pd.DataFrame({f"ema_{period}": result}, index=df.index)


def compute_rsi(df: pd.DataFrame, period: int = 14) -> pd.DataFrame:
    close = _close_col(df)
    delta = close.diff()
    gain = delta.where(delta > 0, 0.0)
    loss = (-delta).where(delta < 0, 0.0)
    avg_gain = gain.rolling(period, min_periods=period).mean()
    avg_loss = loss.rolling(period, min_periods=period).mean()
    rs = avg_gain / avg_loss
    result = 100.0 - (100.0 / (1.0 + rs))
    # fill initial NaN with 50 (no data yet)
    result = result.fillna(50.0)
    return pd.DataFrame({f"rsi_{period}": result}, index=df.index)


def compute_macd(
    df: pd.DataFrame,
    fast: int = 12,
    slow: int = 26,
    signal: int = 9,
) -> dict[str, pd.DataFrame]:
    close = _close_col(df)
    ema_fast = close.ewm(span=fast, adjust=False).mean()
    ema_slow = close.ewm(span=slow, adjust=False).mean()
    macd_line = ema_fast - ema_slow
    signal_line = macd_line.ewm(span=signal, adjust=False).mean()
    hist = macd_line - signal_line
    return {
        "macd": pd.DataFrame({"macd": macd_line}, index=df.index),
        "macd_signal": pd.DataFrame({"macd_signal": signal_line}, index=df.index),
        "macd_hist": pd.DataFrame({"macd_hist": hist}, index=df.index),
    }


def compute_bollinger(
    df: pd.DataFrame,
    period: int = 20,
    std_dev: float = 2.0,
) -> dict[str, pd.DataFrame]:
    close = _close_col(df)
    middle = close.rolling(period, min_periods=period).mean()
    std = close.rolling(period, min_periods=period).std()
    upper = middle + std_dev * std
    lower = middle - std_dev * std
    return {
        "boll_upper": pd.DataFrame({"boll_upper": upper}, index=df.index),
        "boll_middle": pd.DataFrame({"boll_middle": middle}, index=df.index),
        "boll_lower": pd.DataFrame({"boll_lower": lower}, index=df.index),
    }


# Registry of available indicators with their display name and required params
INDICATOR_DEFS: dict[str, dict] = {
    "sma": {
        "display": "SMA",
        "func": compute_sma,
        "params": [{"name": "period", "type": "int", "default": 50}],
        "output_key": "sma",
    },
    "ema": {
        "display": "EMA",
        "func": compute_ema,
        "params": [{"name": "period", "type": "int", "default": 20}],
        "output_key": "ema",
    },
    "rsi": {
        "display": "RSI",
        "func": compute_rsi,
        "params": [{"name": "period", "type": "int", "default": 14}],
        "output_key": "rsi",
    },
    "macd": {
        "display": "MACD",
        "func": compute_macd,
        "params": [
            {"name": "fast", "type": "int", "default": 12},
            {"name": "slow", "type": "int", "default": 26},
            {"name": "signal", "type": "int", "default": 9},
        ],
        "output_key": "macd",
    },
    "bollinger": {
        "display": "Bollinger Bands",
        "func": compute_bollinger,
        "params": [
            {"name": "period", "type": "int", "default": 20},
            {"name": "std_dev", "type": "float", "default": 2.0},
        ],
        "output_key": "boll",
    },
}


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
    merged: dict = {}
    for p in INDICATOR_DEFS[type_str]["params"]:
        key = p["name"]
        if key in params:
            merged[key] = params[key]
        else:
            merged[key] = p["default"]
    result = fn(df, **merged)
    meta = {"indicator_type": type_str, "params": merged}
    return result, meta

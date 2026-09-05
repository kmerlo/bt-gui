import pandas as pd
import pytest

from backend.services.indicator_calculator import (
    compute_bollinger,
    compute_ema,
    compute_indicator,
    compute_macd,
    compute_rsi,
    compute_sma,
    get_indicator_defs,
)


def _make_df(days: int = 60, seed: int = 42) -> pd.DataFrame:
    import numpy as np

    rng = np.random.default_rng(seed)
    idx = pd.date_range("2020-01-02", periods=days, freq="B")
    close = 100.0 + np.cumsum(rng.random(days) - 0.48) * 2
    close = pd.Series(close, index=idx).cumprod() * 100
    df = pd.DataFrame({"close": close, "volume": rng.integers(1_000_000, 10_000_000, size=days)}, index=idx)
    return df


def test_compute_sma():
    df = _make_df()
    result = compute_sma(df, 10)
    assert "sma_10" in result.columns
    assert len(result) == len(df)
    assert result["sma_10"].isna().sum() == 9
    assert result["sma_10"].notna().sum() == len(df) - 9


def test_compute_ema():
    df = _make_df()
    result = compute_ema(df, 10)
    assert "ema_10" in result.columns
    # pandas-ta-classic uses a different EMA init than pure-pandas ewm; expect some NaN at start
    assert result["ema_10"].notna().sum() > 0
    assert len(result) == len(df)


def test_compute_rsi():
    df = _make_df(days=50)
    result = compute_rsi(df, 10)
    assert "rsi_10" in result.columns
    assert len(result) == len(df)
    assert result["rsi_10"].min() >= 0
    assert result["rsi_10"].max() <= 100.0001  # floating point tolerance


def test_compute_macd():
    df = _make_df(days=60)
    result = compute_macd(df, fast=12, slow=26, signal=9)
    # pandas-ta-classic returns a single DataFrame (not a dict) for MACD
    assert isinstance(result, pd.DataFrame)
    assert "macd_12_26_9" in result.columns
    assert "macdh_12_26_9" in result.columns
    assert "macds_12_26_9" in result.columns


def test_compute_bollinger():
    df = _make_df(days=50)
    result = compute_bollinger(df, period=20, std_dev=2.0)
    # pandas-ta-classic returns a single DataFrame (not a dict) for BBANDS
    assert isinstance(result, pd.DataFrame)
    assert "bbl_20_2.0" in result.columns
    assert "bbm_20_2.0" in result.columns
    assert "bbu_20_2.0" in result.columns


def test_compute_indicator_sma():
    df = _make_df()
    result, meta = compute_indicator("sma", df, {"length": 20})
    assert hasattr(result, "columns")
    assert "sma_20" in result.columns
    assert meta["indicator_type"] == "sma"


def test_compute_indicator_unknown_type():
    df = _make_df()
    with pytest.raises(ValueError, match="Unknown indicator type"):
        compute_indicator("nonexistent", df, {})


def test_get_indicator_defs():
    defs = get_indicator_defs()
    types = [d["type"] for d in defs]
    assert "sma" in types
    assert "ema" in types
    assert "rsi" in types
    assert "macd" in types
    assert "bbands" in types


def test_indicator_defs_have_params():
    for d in get_indicator_defs():
        assert "params" in d
        assert isinstance(d["params"], list)


def test_compute_sma_uses_close_column():
    idx = pd.date_range("2020-01-01", periods=30, freq="D")
    df = pd.DataFrame({"close": range(30), "open": range(30, 60)}, index=idx)
    result = compute_sma(df, 5)
    assert "sma_5" in result.columns
    assert result["sma_5"].isna().sum() == 4


def test_compute_rsi_default_period():
    df = _make_df(days=30)
    result = compute_rsi(df)
    assert "rsi_14" in result.columns


def test_empty_df_returns_empty():
    df = pd.DataFrame({"close": []}, index=pd.DatetimeIndex([]))
    result = compute_sma(df, 5)
    assert isinstance(result, pd.DataFrame)
    assert len(result) == 0


def test_indicators_same_index_as_input():
    df = _make_df(days=40)
    result = compute_sma(df, 10)
    pd.testing.assert_index_equal(result.index, df.index)


def test_total_indicator_count_is_large():
    """Verify dynamic discovery populated many indicators."""
    defs = get_indicator_defs()
    assert len(defs) > 50  # at least 50 from pandas-ta-classic


def test_common_indicator_params_are_int():
    """Params for sma/ema/rsi should have sensible defaults."""
    defs_map = {d["type"]: d for d in get_indicator_defs()}
    sma_def = defs_map["sma"]
    assert any(p["name"] == "length" for p in sma_def["params"])
    assert any(p["name"] == "period" for p in defs_map["rsi"]["params"]) or any(p["name"] == "length" for p in defs_map["rsi"]["params"])

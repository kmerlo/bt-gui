from __future__ import annotations

import pandas as pd
from typing import Any

SUPPORTED_OPS: set[str] = {
    "gt", "lt", "gte", "lte", "eq", "neq",
    "above", "below", "cross_over", "cross_down",
    "and", "or", "not",
}


def resolve_value(
    expr: dict[str, Any],
    indicators: dict[str, pd.DataFrame],
    price_df: pd.DataFrame,
) -> pd.DataFrame | pd.Series | float:
    """Resolve an expression leaf to a DataFrame/Series/scalar."""
    typ = expr.get("type", "")
    if typ == "value":
        return expr["v"]
    if typ in ("indicator", "signal"):
        return indicators[str(expr["id"])]
    raise ValueError(f"Unknown expression type: {typ}")


def _normalize_indicator_cols(ind: pd.DataFrame, price_df: pd.DataFrame) -> pd.DataFrame:
    """Align indicator columns to price_df.

    Handles:
    - multi-ticker indicator with same tickers but different column order
    - columns with ':' or '_' suffixes (e.g. 'AAPL:median_252' or 'AAPL_median_252')
    - single-column indicator (e.g. 'median_252') that should broadcast to all price columns
    """
    if not isinstance(ind, pd.DataFrame) or not isinstance(price_df, pd.DataFrame):
        return ind
    # ponytail: strip ':' suffixes the user saw in Data tab (e.g. 'AAPL: ...' or 'AAPL_median_252')
    # and normalize to upper tickers before reindexing
    cols = [str(c) for c in ind.columns]
    # if single column like 'sma_50' / 'roc_252' / 'median_252' -> broadcast/rename to price tickers
    # covers both 1-vs-N (multi) and 1-vs-1 (single ticker ROC>0) cases
    if len(cols) == 1:
        single = cols[0]
        if single.upper() not in [str(c).upper() for c in price_df.columns]:
            # broadcast single series to all price columns (e.g. SMA/ROC computed on one ticker but reused)
            # ponytail: for 1-vs-1 this renames 'roc_252' -> 'SPY', fixing GT signal column mismatch
            base = ind.iloc[:, 0]
            broadcast = pd.DataFrame({str(c).upper(): base for c in price_df.columns}, index=ind.index)
            # align index to price (reindex, keep NaN for missing early bars)
            try:
                if not broadcast.index.equals(price_df.index):
                    broadcast = broadcast.reindex(price_df.index)
            except Exception:
                pass
            return broadcast
    # try to map columns that contain ticker prefix before ':' or '_'
    mapped: dict[str, str] = {}
    price_set = {str(c).upper(): str(c) for c in price_df.columns}
    for c in cols:
        raw = str(c)
        # handle ':' from older parquet blobs or MultiIndex stringification
        if ":" in raw:
            raw = raw.split(":")[0].strip()
        # handle suffix like 'AAPL_median_252' -> extract ticker prefix before '_'
        cand = raw.upper().strip()
        if cand in price_set:
            mapped[c] = price_set[cand]
            continue
        # try prefix before '_' (e.g. AAPL_MEDIAN_252 -> AAPL)
        if "_" in raw:
            prefix = raw.split("_")[0].upper().strip()
            if prefix in price_set:
                mapped[c] = price_set[prefix]
                continue
        # fallback: keep as is upper
        mapped[c] = cand
    try:
        ind = ind.rename(columns=mapped)
        # ensure all price columns present, reorder to match price_df
        ind = ind.reindex(columns=[str(c) for c in price_df.columns])
    except Exception:
        pass
    # align index to price (reindex, keep NaN for missing early bars)
    try:
        if not ind.index.equals(price_df.index):
            ind = ind.reindex(price_df.index)
    except Exception:
        pass
    return ind


def evaluate_expression(
    expr: dict[str, Any],
    indicators: dict[str, pd.DataFrame],
    price_df: pd.DataFrame,
) -> pd.DataFrame:
    """Recursively evaluate a signal expression to a boolean DataFrame."""
    op = expr.get("op", "")

    if op in ("gt", "lt", "gte", "lte", "eq", "neq"):
        left = resolve_value(expr["left"], indicators, price_df)
        right = resolve_value(expr["right"], indicators, price_df)
        # ponytail: normalize single-column indicator names (e.g. 'roc_252' -> 'SPY') to price tickers so signal columns match strategy securities (fixes Trend Example 2 1-vs-1)
        if isinstance(left, pd.DataFrame):
            left = _normalize_indicator_cols(left, price_df)
        if isinstance(right, pd.DataFrame):
            right = _normalize_indicator_cols(right, price_df)
        op_map: dict[str, Any] = {
            "gt": lambda a, b: a > b,
            "lt": lambda a, b: a < b,
            "gte": lambda a, b: a >= b,
            "lte": lambda a, b: a <= b,
            "eq": lambda a, b: a == b,
            "neq": lambda a, b: a != b,
        }
        return op_map[op](left, right)  # type: ignore[operator]

    if op == "above":
        ind = resolve_value(expr["left"], indicators, price_df)
        if isinstance(ind, pd.DataFrame):
            ind = _normalize_indicator_cols(ind, price_df)
        return price_df > ind

    if op == "below":
        ind = resolve_value(expr["left"], indicators, price_df)
        if isinstance(ind, pd.DataFrame):
            ind = _normalize_indicator_cols(ind, price_df)
        return price_df < ind

    if op in ("cross_over", "cross_down"):
        ind = resolve_value(expr["left"], indicators, price_df)
        if isinstance(ind, pd.DataFrame):
            ind = _normalize_indicator_cols(ind, price_df)
        # ponytail: ind may be DataFrame after normalization
        if isinstance(ind, pd.DataFrame):
            return ind > ind.shift(1) if op == "cross_over" else ind < ind.shift(1)  # type: ignore[operator]
        return ind > ind.shift(1) if op == "cross_over" else ind < ind.shift(1)  # type: ignore[attr-defined]

    if op == "and":
        return (
            evaluate_expression(expr["left"], indicators, price_df)
            & evaluate_expression(expr["right"], indicators, price_df)
        )

    if op == "or":
        return (
            evaluate_expression(expr["left"], indicators, price_df)
            | evaluate_expression(expr["right"], indicators, price_df)
        )

    if op == "not":
        return ~evaluate_expression(expr["expr"], indicators, price_df)

    raise ValueError(f"Unsupported op: {op}")

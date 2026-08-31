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
        return price_df > ind

    if op == "below":
        ind = resolve_value(expr["left"], indicators, price_df)
        return price_df < ind

    if op in ("cross_over", "cross_down"):
        ind = resolve_value(expr["left"], indicators, price_df)
        return ind > ind.shift(1) if op == "cross_over" else ind < ind.shift(1)

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

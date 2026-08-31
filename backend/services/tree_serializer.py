from __future__ import annotations

from typing import Any

import bt
import pandas as pd
from bt.core import AlgoStack

from backend.models.strategy_tree import NodeConfig, StrategyTree
from backend.services.algo_registry import algo_json_schema, build_algo

TYPE_MAP: dict[str, Any] = {
    "Strategy": bt.Strategy,
    "Security": bt.Security,
    "FixedIncomeStrategy": bt.FixedIncomeStrategy,
    "HedgeSecurity": bt.HedgeSecurity,
    "CouponPayingSecurity": bt.CouponPayingSecurity,
}


def _apply_signal_condition(
    indicator_df: pd.DataFrame,
    condition: dict | None,
    price_df: pd.DataFrame,
) -> pd.DataFrame:
    """Apply a signal condition to an indicator DataFrame, returning a boolean DataFrame."""
    if condition is None or not isinstance(condition, dict):
        # backward-compatible: raw values → notna
        return indicator_df.notna()

    op = condition.get("op", "")
    threshold = condition.get("value", 0)

    if op == "gt":
        return indicator_df > threshold
    if op == "lt":
        return indicator_df < threshold
    if op == "gte":
        return indicator_df >= threshold
    if op == "lte":
        return indicator_df <= threshold
    if op == "above":
        return price_df > indicator_df
    if op == "below":
        return price_df < indicator_df
    if op == "cross_over":
        return indicator_df > indicator_df.shift(1)
    if op == "cross_down":
        return indicator_df < indicator_df.shift(1)
    return indicator_df.notna()


def _resolve_indicator_params(algo_cfg: Any, indicators: dict[str, pd.DataFrame] | None, price_df: pd.DataFrame) -> dict:
    """If an algo param is marked as indicator kind and its value is a string,
    resolve it to the actual DataFrame from the indicators dict."""
    if not indicators or not algo_cfg.params:
        return dict(algo_cfg.params)
    params = dict(algo_cfg.params)
    schema = algo_json_schema(algo_cfg.class_name)
    for k, v in schema.get("properties", {}).items():
        if v.get("kind") != "indicator":
            continue
        val = params.get(k)
        if isinstance(val, str) and val.strip():
            # Try to interpret as integer ID for lookup
            try:
                ind_id = int(val)
                df = indicators.get(str(ind_id))
                if df is not None:
                    condition = getattr(algo_cfg, "signal_condition", None)
                    df = _apply_signal_condition(df, condition, price_df)
                    params[k] = df
            except (ValueError, TypeError):
                pass  # not an ID, leave as-is (could be a name string)
    return params


def _build_algos(algo_configs: list, indicators: dict[str, pd.DataFrame] | None = None, price_df: pd.DataFrame | None = None) -> list:
    return [build_algo(a.class_name, _resolve_indicator_params(a, indicators or {}, price_df if price_df is not None else pd.DataFrame())) for a in algo_configs]


def _validate_unique_children(cfg: NodeConfig) -> None:
    if not cfg.children:
        return
    seen: dict[str, str] = {}
    for c in cfg.children:
        if c.name in seen:
            raise ValueError(
                f"Duplicate child name '{c.name}' under '{cfg.name}' — Security/Strategy names must be unique per parent. Rename one of them (ids {seen[c.name]} vs {c.id})."
            )
        seen[c.name] = c.id or c.name
        _validate_unique_children(c)


def _build_node(cfg: NodeConfig, indicators: dict[str, pd.DataFrame] | None = None, price_df: pd.DataFrame | None = None):
    _validate_unique_children(cfg)
    cls = TYPE_MAP.get(cfg.type)
    if cls is None:
        raise ValueError(f"Unknown node type {cfg.type}")

    # Security types are leaves — children must be empty
    if cfg.type in ("Security", "HedgeSecurity", "CouponPayingSecurity", "FixedIncomeSecurity"):
        if cfg.children:
            raise ValueError(f"Security node {cfg.name} cannot have children")
        kwargs = dict(cfg.params or {})
        try:
            return cls(cfg.name, **kwargs)
        except TypeError as e:
            raise ValueError(f"Failed to create {cfg.type} {cfg.name} with params {kwargs}: {e}") from e

    # Strategy types
    children = [_build_node(c, indicators, price_df) for c in cfg.children]
    algos = _build_algos(cfg.algos, indicators, price_df) if cfg.algos else []
    kwargs = dict(cfg.params or {})

    # Strategy and FixedIncomeStrategy accept (name, algos, children)
    # Try with algos kw, fallback to positional
    try:
        if algos:
            kwargs["algos"] = algos
        if children:
            kwargs["children"] = children
        return cls(cfg.name, **kwargs)
    except TypeError:
        try:
            if algos:
                return cls(cfg.name, algos=algos, children=children, **{k: v for k, v in kwargs.items() if k not in ("algos", "children")})
            return cls(cfg.name, children=children, **kwargs)
        except Exception as e:
            raise ValueError(f"Failed to create {cfg.type} {cfg.name}: {e}") from e


def to_bt_strategy(tree: StrategyTree, indicators: dict[str, pd.DataFrame] | None = None, price_df: pd.DataFrame | None = None) -> Any:
    """Convert StrategyTree Pydantic model to bt.Strategy tree."""
    node = _build_node(tree.root, indicators, price_df)
    if not isinstance(node, bt.core.StrategyBase):
        raise ValueError(f"Root node must be a Strategy type, got {tree.root.type}")
    if hasattr(node, "stack") and isinstance(node.stack, AlgoStack):
        pass
    elif tree.root.algos:
        algos = _build_algos(tree.root.algos, indicators, price_df) if tree.root.algos else []
        node.stack = AlgoStack(*algos)
    return node


def from_bt_strategy(strategy) -> StrategyTree:
    raise NotImplementedError("Reverse conversion not implemented for v1")

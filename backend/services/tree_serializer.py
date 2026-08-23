from __future__ import annotations

from typing import Any

import bt
from bt.core import AlgoStack

from backend.models.strategy_tree import NodeConfig, StrategyTree

TYPE_MAP: dict[str, Any] = {
    "Strategy": bt.Strategy,
    "Security": bt.Security,
    "FixedIncomeStrategy": bt.FixedIncomeStrategy,
    "HedgeSecurity": bt.HedgeSecurity,
    "CouponPayingSecurity": bt.CouponPayingSecurity,
}


def _build_algos(algo_configs: list) -> list:
    from backend.services.algo_registry import build_algo

    return [build_algo(a.class_name, a.params) for a in algo_configs]


def _build_node(cfg: NodeConfig):
    cls = TYPE_MAP.get(cfg.type)
    if cls is None:
        raise ValueError(f"Unknown node type {cfg.type}")

    # Security types are leaves — children must be empty
    if cfg.type in ("Security", "HedgeSecurity", "CouponPayingSecurity", "FixedIncomeSecurity"):
        if cfg.children:
            raise ValueError(f"Security node {cfg.name} cannot have children")
        kwargs = dict(cfg.params or {})
        # Security supports multiplier param
        try:
            return cls(cfg.name, **kwargs)
        except TypeError as e:
            raise ValueError(f"Failed to create {cfg.type} {cfg.name} with params {kwargs}: {e}") from e

    # Strategy types
    children = [_build_node(c) for c in cfg.children]
    algos = _build_algos(cfg.algos) if cfg.algos else []
    kwargs = dict(cfg.params or {})

    # Strategy and FixedIncomeStrategy accept (name, algos, children)
    # Try with algos kw, fallback to positional
    try:
        # Use AlgoStack-compatible algos list
        if algos:
            kwargs["algos"] = algos
        if children:
            kwargs["children"] = children
        return cls(cfg.name, **kwargs)
    except TypeError:
        # Fallback: positional children
        try:
            if algos:
                return cls(cfg.name, algos=algos, children=children, **{k: v for k, v in kwargs.items() if k not in ("algos", "children")})
            return cls(cfg.name, children=children, **kwargs)
        except Exception as e:
            raise ValueError(f"Failed to create {cfg.type} {cfg.name}: {e}") from e


def to_bt_strategy(tree: StrategyTree):
    """Convert StrategyTree Pydantic model to bt.Strategy tree."""
    node = _build_node(tree.root)
    # Ensure root is a Strategy type
    if not isinstance(node, bt.core.StrategyBase):
        raise ValueError(f"Root node must be a Strategy type, got {tree.root.type}")  # noqa: TRY004
    # If AlgoStack was set via kwargs, bt.Strategy already has it; otherwise ensure AlgoStack
    if hasattr(node, "stack") and isinstance(node.stack, AlgoStack):
        pass
    elif hasattr(tree.root, "algos") and tree.root.algos:
        # Fallback: manually set stack if not set by constructor
        from backend.services.algo_registry import build_algo

        algos = [build_algo(a.class_name, a.params) for a in tree.root.algos]
        node.stack = AlgoStack(*algos)
    return node


def from_bt_strategy(strategy) -> StrategyTree:
    raise NotImplementedError("Reverse conversion not implemented for v1")

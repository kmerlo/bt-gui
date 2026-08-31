from __future__ import annotations

from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, Field

from backend.models.backtest_config import BacktestConfig


class AlgoConfig(BaseModel):
    class_name: str
    params: dict[str, Any] = {}
    signal_condition: dict[str, Any] | None = None


class NodeConfig(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    name: str
    type: Literal["Strategy", "Security", "FixedIncomeStrategy", "HedgeSecurity", "CouponPayingSecurity"]
    params: dict[str, Any] = {}
    algos: list[AlgoConfig] = []
    children: list[NodeConfig] = []


class BuilderPreset(BaseModel):
    ticker_start: str | None = None
    ticker_end: str | None = None
    price_column: Literal["close", "adj_close"] = "close"
    extra_source_ids: dict[str, int] = Field(default_factory=dict)
    indicator_source_ids: list[int] = Field(default_factory=list)
    config: BacktestConfig = Field(default_factory=BacktestConfig)  # type: ignore[call-arg]
    selected_node_id: str | None = None


class StrategyTree(BaseModel):
    name: str
    root: NodeConfig
    version: int = 1
    preset: BuilderPreset | None = None

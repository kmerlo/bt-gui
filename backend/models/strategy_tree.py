from __future__ import annotations

from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, Field


class AlgoConfig(BaseModel):
    class_name: str
    params: dict[str, Any] = {}


class NodeConfig(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    name: str
    type: Literal["Strategy", "Security", "FixedIncomeStrategy", "HedgeSecurity", "CouponPayingSecurity"]
    params: dict[str, Any] = {}
    algos: list[AlgoConfig] = []
    children: list[NodeConfig] = []


class StrategyTree(BaseModel):
    name: str
    root: NodeConfig
    version: int = 1

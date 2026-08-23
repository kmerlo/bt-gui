from __future__ import annotations

from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, Field


class DataSourceConfig(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    name: str
    type: Literal["price", "volume", "volatility", "bidoffer", "coupons", "cost_long", "cost_short"]
    source: Literal["csv", "parquet", "ffn"]
    path_or_tickers: str
    meta: dict[str, Any] = {}

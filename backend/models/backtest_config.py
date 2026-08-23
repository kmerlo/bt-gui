from __future__ import annotations

import inspect
from typing import Literal

from pydantic import BaseModel, field_validator


class CommissionConfig(BaseModel):
    type: Literal["simple", "bidoffer"] = "simple"
    simple_fn: str | None = None
    use_bidoffer: bool = False

    @field_validator("simple_fn")
    @classmethod
    def validate_simple_fn(cls, v: str | None) -> str | None:
        if v is None:
            return v
        try:
            fn = eval(v, {"__builtins__": {}})
        except Exception as e:
            raise ValueError(f"simple_fn eval failed: {e}") from e
        if not callable(fn):
            raise ValueError("simple_fn must eval to callable")  # noqa: TRY004
        sig = inspect.signature(fn)
        pos_kinds = (inspect.Parameter.POSITIONAL_ONLY, inspect.Parameter.POSITIONAL_OR_KEYWORD)
        params = [p for p in sig.parameters.values() if p.kind in pos_kinds]
        if len(params) < 2:
            raise ValueError("commission fn must accept (quantity, price)")
        return v


class BacktestConfig(BaseModel):
    initial_capital: float = 1_000_000.0
    commission: CommissionConfig = CommissionConfig()
    integer_positions: bool = True
    progress_bar: bool = False

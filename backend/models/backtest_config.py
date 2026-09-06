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
        from backend.services.commission_parser import validate_commission_src

        try:
            validate_commission_src(v)
        except Exception as e:
            raise ValueError(f"simple_fn invalid: {e}") from e
        from backend.services.commission_parser import parse_commission_fn

        fn = parse_commission_fn(v)
        sig = inspect.signature(fn)
        pos_kinds = (inspect.Parameter.POSITIONAL_ONLY, inspect.Parameter.POSITIONAL_OR_KEYWORD)
        params = [p for p in sig.parameters.values() if p.kind in pos_kinds]
        if len(params) < 2:
            raise ValueError("commission fn must accept (quantity, price)")
        return v


class TaxTickerRate(BaseModel):
    gain_rate: float = 26.0
    div_rate: float = 26.0

    @field_validator("gain_rate", "div_rate")
    @classmethod
    def validate_rates(cls, v: float) -> float:
        return _check_rate(v, "tax rate")


def _check_rate(v: float, name: str) -> float:
    if v < 0 or v > 100:
        raise ValueError(f"{name} must be 0..100, got {v}")
    return v


class TaxConfig(BaseModel):
    enabled: bool = True
    default_gain_rate: float = 26.0
    default_div_rate: float = 26.0
    use_loss_carry: bool = True
    carry_expiry_years: int = 4
    # snapshot per-ticker risolto a run creato: {TICKER: {gain_rate, div_rate}}
    ticker_rates: dict[str, TaxTickerRate] = {}

    @field_validator("default_gain_rate", "default_div_rate")
    @classmethod
    def validate_rates(cls, v: float) -> float:
        return _check_rate(v, "tax rate")

    @field_validator("carry_expiry_years")
    @classmethod
    def validate_expiry(cls, v: int) -> int:
        if v < 0 or v > 30:
            raise ValueError(f"carry_expiry_years must be 0..30, got {v}")
        return v


class BacktestConfig(BaseModel):
    initial_capital: float = 1_000_000.0
    commission: CommissionConfig = CommissionConfig()
    integer_positions: bool = True
    progress_bar: bool = False
    start: str | None = None
    end: str | None = None
    price_column: Literal["close", "adj_close"] = "close"
    tax: TaxConfig = TaxConfig()

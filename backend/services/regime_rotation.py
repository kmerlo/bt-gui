from __future__ import annotations

import pandas as pd
from bt.core import Algo


class RegimeRotation(Algo):
    """
    Rotate between SPY and the best sector ETF based on SPY SMA200 regime.

    When SPY price > SMA200: select SPY (stay invested in the market).
    When SPY price < SMA200: select the sector ETF with the highest total return
    over the last ``lookback`` days among those with sufficient history.

    This is a selection algo — must run after SelectAll and before Weigh*.
    Requires daily price data for all tickers in ``sectors`` plus ``spy``.

    Args:
        * spy (str): Ticker name for the benchmark (default "SPY").
        * sectors (list[str]): Sector ETF tickers to rotate through
          (e.g. ["XLY","XLP","XLE","XLF","XLV","XLI","XLB","XLK","XLU","XLRE","XLC"]).
        * sma (int): Lookback window for the SMA (default 200).
        * lookback (DateOffset): Period for momentum ranking (default months=3 ≈ 90 trading days).

    Sets:
        * selected — list containing one ticker: either ``spy`` or the best-performing sector.
    """

    DEFAULT_SECTORS = [
        "XLY", "XLP", "XLE", "XLF", "XLV",
        "XLI", "XLB", "XLK", "XLU", "XLRE", "XLC",
    ]

    def __init__(
        self,
        spy: str = "SPY",
        sectors: list[str] | None = None,
        sma: int = 200,
        lookback: pd.DateOffset | None = pd.DateOffset(months=3),
    ):
        super().__init__()
        self.spy = str(spy).upper()
        self.sectors = [str(t).upper() for t in (sectors or self.DEFAULT_SECTORS)]
        self.sma = int(sma)
        # ponytail: accept either a DateOffset or an int (days) for backwards compat with the GUI text parser
        self.lookback = lookback

    def _resolve_lookback(self, target) -> int:
        """Return an integer number of calendar days to use as the rolling window.

        The GUI passes a pd.DateOffset (e.g. months=3). We approximate trading days
        by counting real days in the offset window and scaling by 252/365.
        """
        import pandas as pd
        now = pd.Timestamp(target.now)
        if isinstance(self.lookback, pd.DateOffset):
            start = now - self.lookback
            total_days = (now - start).days
            # ponytail: months=3 ≈ 63 calendar days ≈ 43 trading days
            trading_days = int(total_days * 252 / 365)
            return max(trading_days, 20)  # sanity floor
        if isinstance(self.lookback, (int, float)):
            return int(self.lookback)
        return 90  # default fallback

    def __call__(self, target):
        import pandas as pd

        try:
            now = target.now
            universe = getattr(target, "universe", None)
            if universe is None or now not in universe.index:
                target.temp["selected"] = []
                return False
        except Exception:
            target.temp["selected"] = []
            return False

        spy_col = self.spy
        if spy_col not in universe.columns:
            target.temp["selected"] = []
            return False

        spy_px = pd.to_numeric(universe[spy_col], errors="coerce")
        sma200 = spy_px.rolling(self.sma, min_periods=self.sma).mean()

        spy_price = spy_px.loc[now]
        sma_val = sma200.loc[now]

        # Guard: need valid (non-NaN) price and SMA for a real decision
        if pd.isna(spy_price) or pd.isna(sma_val):
            target.temp["selected"] = [spy_col]
            return True

        if spy_price > sma_val:
            # Above SMA200 → stay in SPY
            target.temp["selected"] = [spy_col]
            return True

        # Below SMA200 → pick best sector over lookback
        lookback_days = self._resolve_lookback(target)
        start_idx = max(0, universe.index.get_loc(now) - lookback_days)
        window = universe.iloc[start_idx : universe.index.get_loc(now) + 1]
        if len(window) < 20:
            # Not enough history for any meaningful ranking → fallback SPY
            target.temp["selected"] = [spy_col]
            return True

        # Compute momentum only for columns that have enough non-NaN tail values
        candidates = []
        missing = []
        for t in self.sectors:
            col = t.upper()
            if col not in window.columns:
                missing.append(col)
                continue
            s = pd.to_numeric(window[col], errors="coerce")
            if s.notna().sum() < 20:
                continue
            first_valid = s.first_valid_index()
            last_valid = s.last_valid_index()
            if first_valid is None or last_valid is None:
                continue
            if last_valid != now:
                continue
            ret = (s.loc[last_valid] / s.loc[first_valid]) - 1.0
            if pd.isna(ret):
                continue
            candidates.append((t.upper(), float(ret)))

        if missing:
            target.temp.setdefault("_warnings", []).extend(
                [f"RegimeRotation: {t} not in universe (add as Security child to tree)"]
                for t in missing
            )

        if not candidates:
            # No viable sector → fallback to SPY
            target.temp["selected"] = [spy_col]
            return True

        best = max(candidates, key=lambda x: x[1])
        target.temp["selected"] = [best[0]]
        return True

    @staticmethod
    def validate_params(params: dict, available_tickers: list[str]) -> list[str]:
        """Return list of warning strings for invalid sectors parameter.

        Args:
            params: Raw algo params dict (may contain string JSON for sectors).
            available_tickers: Ticker names extracted from the strategy tree.
        """
        import json

        warnings: list[str] = []
        raw = params.get("sectors")
        if raw is None or (isinstance(raw, str) and not raw.strip()):
            return warnings  # will use DEFAULT_SECTORS, no warning
        # Parse JSON string (what GUI sends)
        sectors: list[str] = []
        if isinstance(raw, str):
            try:
                parsed = json.loads(raw)
                if isinstance(parsed, list):
                    sectors = [str(t).upper().strip() for t in parsed if str(t).strip()]
            except Exception:
                warnings.append(f"RegimeRotation: sectors '{raw}' is not valid JSON — ignored")
                return warnings
        elif isinstance(raw, list):
            sectors = [str(t).upper().strip() for t in raw if str(t).strip()]
        else:
            warnings.append(f"RegimeRotation: sectors has unexpected type {type(raw).__name__}")
            return warnings

        if not sectors:
            warnings.append("RegimeRotation: sectors list is empty — will use default sectors")
            return warnings

        avail_set = {t.upper() for t in available_tickers}
        missing = [t for t in sectors if t not in avail_set]
        for t in missing:
            warnings.append(f"RegimeRotation: '{t}' not in tree — add it as a Security child to use it")
        return warnings

from __future__ import annotations

import pandas as pd
from bt.core import Algo


class StopLossTakeProfit(Algo):
    """
    Apply fixed stop-loss / take-profit (and optional trailing stop) to weights.

    Must be placed **after** a Weigh* algo and **before** Rebalance.
    Reads `target.temp['weights']` set by the previous Weigh* and zeroes
    positions whose price has breached SL / TP since entry.

    Trailing is a substitute for fixed stop: when `trailing_long > 0`
    the stop follows `max_price * (1 - trailing_long)` (long) and
    `min_price * (1 + trailing_short)` (short). When trailing is 0,
    fixed `stop_loss_*` is used.

    Args:
        * stop_loss_long (float): Fixed SL distance for longs, e.g. 0.03 = -3% from entry. 0 disables.
        * take_profit_long (float): Fixed TP distance for longs, e.g. 0.5 = +50% from entry. 0 disables.
        * stop_loss_short (float): Fixed SL distance for shorts, e.g. 0.03 = +3% from entry. 0 disables.
        * take_profit_short (float): Fixed TP distance for shorts, e.g. 0.05 = -5% from entry. 0 disables.
        * trailing_long (float): Trailing distance for longs, e.g. 0.03. 0 = fixed SL mode.
        * trailing_short (float): Trailing distance for shorts. 0 = fixed SL mode.

    Requires:
        * weights

    Sets:
        * weights
    """

    def __init__(
        self,
        stop_loss_long: float = 0.03,
        take_profit_long: float = 0.5,
        stop_loss_short: float = 0.03,
        take_profit_short: float = 0.05,
        trailing_long: float = 0.0,
        trailing_short: float = 0.0,
    ):
        super().__init__()
        self.stop_loss_long = float(stop_loss_long) if stop_loss_long is not None else 0.0
        self.take_profit_long = float(take_profit_long) if take_profit_long is not None else 0.0
        self.stop_loss_short = float(stop_loss_short) if stop_loss_short is not None else 0.0
        self.take_profit_short = float(take_profit_short) if take_profit_short is not None else 0.0
        self.trailing_long = float(trailing_long) if trailing_long is not None else 0.0
        self.trailing_short = float(trailing_short) if trailing_short is not None else 0.0
        # ponytail: run_always so SL/TP is checked daily even when a prior RunMonthly blocks entry
        self.run_always = True  # type: ignore[attr-defined]
        # ponytail: per-ticker state, persists across __call__ invocations (bt reuses same Algo instance)
        self._entry: dict[str, float] = {}
        self._trail_high: dict[str, float] = {}
        self._trail_low: dict[str, float] = {}

    def __call__(self, target):
        w = target.temp.get("weights")
        if w is None:
            # ponytail: run_always mode — even when RunMonthly blocked Weigh, check active positions for SL/TP and force exit
            if not self._entry:
                return True
            try:
                now = target.now
                universe = getattr(target, "universe", None)
                if universe is None or now not in universe.index:
                    return True
                row = universe.loc[now]
                if isinstance(row, pd.Series):
                    price_dict = {str(k).upper(): float(v) for k, v in row.items() if pd.notna(v)}
                else:
                    price_dict = {}
            except Exception:
                return True
            # check each active entry for breach even though no new weights
            for ticker in list(self._entry.keys()):
                price = price_dict.get(ticker)
                if price is None or price == 0 or pd.isna(price):
                    continue
                entry = self._entry[ticker]
                is_long = ticker in self._trail_high
                # we don't know long/short from weights, infer from trail dict
                if is_long:
                    if self.trailing_long and self.trailing_long > 0:
                        prev_high = self._trail_high.get(ticker, entry)
                        new_high = max(prev_high, float(price))
                        self._trail_high[ticker] = new_high
                        sl_price = new_high * (1 - self.trailing_long)
                        if float(price) <= sl_price:
                            self._entry.pop(ticker, None)
                            self._trail_high.pop(ticker, None)
                            target.temp["weights"] = {}
                            continue
                        if self.take_profit_long and self.take_profit_long > 0:
                            tp_price = entry * (1 + self.take_profit_long)
                            if float(price) >= tp_price:
                                self._entry.pop(ticker, None)
                                self._trail_high.pop(ticker, None)
                                target.temp["weights"] = {}
                                continue
                    else:
                        if self.stop_loss_long and self.stop_loss_long > 0:
                            sl_price = entry * (1 - self.stop_loss_long)
                            if float(price) <= sl_price:
                                self._entry.pop(ticker, None)
                                self._trail_high.pop(ticker, None)
                                target.temp["weights"] = {}
                                continue
                        if self.take_profit_long and self.take_profit_long > 0:
                            tp_price = entry * (1 + self.take_profit_long)
                            if float(price) >= tp_price:
                                self._entry.pop(ticker, None)
                                self._trail_high.pop(ticker, None)
                                target.temp["weights"] = {}
                                continue
                else:
                    if self.trailing_short and self.trailing_short > 0:
                        prev_low = self._trail_low.get(ticker, entry)
                        new_low = min(prev_low, float(price))
                        self._trail_low[ticker] = new_low
                        sl_price = new_low * (1 + self.trailing_short)
                        if float(price) >= sl_price:
                            self._entry.pop(ticker, None)
                            self._trail_low.pop(ticker, None)
                            target.temp["weights"] = {}
                            continue
                        if self.take_profit_short and self.take_profit_short > 0:
                            tp_price = entry * (1 - self.take_profit_short)
                            if float(price) <= tp_price:
                                self._entry.pop(ticker, None)
                                self._trail_low.pop(ticker, None)
                                target.temp["weights"] = {}
                                continue
                    else:
                        if self.stop_loss_short and self.stop_loss_short > 0:
                            sl_price = entry * (1 + self.stop_loss_short)
                            if float(price) >= sl_price:
                                self._entry.pop(ticker, None)
                                self._trail_low.pop(ticker, None)
                                target.temp["weights"] = {}
                                continue
                        if self.take_profit_short and self.take_profit_short > 0:
                            tp_price = entry * (1 - self.take_profit_short)
                            if float(price) <= tp_price:
                                self._entry.pop(ticker, None)
                                self._trail_low.pop(ticker, None)
                                target.temp["weights"] = {}
                                continue
            # if we forced an exit, ensure weights is set so RebalanceAlways can act
            if "weights" not in target.temp or target.temp["weights"] is None:
                # no forced exit, leave weights missing -> Rebalance won't run, which is correct for non-entry days
                pass
            return True
        # normalise to dict
        if isinstance(w, pd.Series):
            w_dict = {str(k): float(v) for k, v in w.items() if pd.notna(v)}
            is_series = True
        elif isinstance(w, dict):
            w_dict = {str(k): float(v) for k, v in w.items() if v is not None}
            is_series = False
        else:
            return True

        # empty weights -> clear tracking for deselected tickers, keep others? Deselect means close.
        if not w_dict:
            # Weigh* returned empty -> all positions closed intentionally
            self._entry.clear()
            self._trail_high.clear()
            self._trail_low.clear()
            target.temp["weights"] = w
            return True

        # current prices
        try:
            now = target.now
            universe = getattr(target, "universe", None)
            if universe is None or now not in universe.index:
                # no price for this date -> keep weights as-is
                return True
            row = universe.loc[now]
            if isinstance(row, pd.Series):
                price_dict = {str(k).upper(): float(v) for k, v in row.items() if pd.notna(v)}
            else:
                # single value (unlikely)
                price_dict = {}
        except Exception:
            return True

        new_weights: dict[str, float] = {}
        # track tickers that were requested this bar
        requested = {str(k).upper() for k in w_dict.keys()}

        for ticker_raw, weight in list(w_dict.items()):
            ticker = str(ticker_raw).upper()
            price = price_dict.get(ticker)
            # ponytail: if price missing, keep weight (let bt handle) and don't update state
            if price is None or price == 0 or pd.isna(price):
                new_weights[ticker_raw] = weight
                continue

            if weight == 0:
                self._entry.pop(ticker, None)
                self._trail_high.pop(ticker, None)
                self._trail_low.pop(ticker, None)
                continue

            is_long = weight > 0
            # is_short = weight < 0  # not needed separately

            if ticker not in self._entry:
                # new entry
                self._entry[ticker] = float(price)
                if is_long:
                    self._trail_high[ticker] = float(price)
                    self._trail_low.pop(ticker, None)
                else:
                    self._trail_low[ticker] = float(price)
                    self._trail_high.pop(ticker, None)
                new_weights[ticker_raw] = weight
                continue

            entry = self._entry[ticker]
            # decide trailing vs fixed
            if is_long:
                if self.trailing_long and self.trailing_long > 0:
                    prev_high = self._trail_high.get(ticker, entry)
                    new_high = max(prev_high, float(price))
                    self._trail_high[ticker] = new_high
                    sl_price = new_high * (1 - self.trailing_long)
                    if float(price) <= sl_price:
                        self._entry.pop(ticker, None)
                        self._trail_high.pop(ticker, None)
                        continue
                    if self.take_profit_long and self.take_profit_long > 0:
                        tp_price = entry * (1 + self.take_profit_long)
                        if float(price) >= tp_price:
                            self._entry.pop(ticker, None)
                            self._trail_high.pop(ticker, None)
                            continue
                else:
                    if self.stop_loss_long and self.stop_loss_long > 0:
                        sl_price = entry * (1 - self.stop_loss_long)
                        if float(price) <= sl_price:
                            self._entry.pop(ticker, None)
                            self._trail_high.pop(ticker, None)
                            continue
                    if self.take_profit_long and self.take_profit_long > 0:
                        tp_price = entry * (1 + self.take_profit_long)
                        if float(price) >= tp_price:
                            self._entry.pop(ticker, None)
                            self._trail_high.pop(ticker, None)
                            continue
                new_weights[ticker_raw] = weight
            else:  # short
                if self.trailing_short and self.trailing_short > 0:
                    prev_low = self._trail_low.get(ticker, entry)
                    new_low = min(prev_low, float(price))
                    self._trail_low[ticker] = new_low
                    sl_price = new_low * (1 + self.trailing_short)
                    if float(price) >= sl_price:
                        self._entry.pop(ticker, None)
                        self._trail_low.pop(ticker, None)
                        continue
                    if self.take_profit_short and self.take_profit_short > 0:
                        tp_price = entry * (1 - self.take_profit_short)
                        if float(price) <= tp_price:
                            self._entry.pop(ticker, None)
                            self._trail_low.pop(ticker, None)
                            continue
                else:
                    if self.stop_loss_short and self.stop_loss_short > 0:
                        sl_price = entry * (1 + self.stop_loss_short)
                        if float(price) >= sl_price:
                            self._entry.pop(ticker, None)
                            self._trail_low.pop(ticker, None)
                            continue
                    if self.take_profit_short and self.take_profit_short > 0:
                        tp_price = entry * (1 - self.take_profit_short)
                        if float(price) <= tp_price:
                            self._entry.pop(ticker, None)
                            self._trail_low.pop(ticker, None)
                            continue
                new_weights[ticker_raw] = weight

        # clear tracking for tickers that Weigh* deselected (not in requested)
        for t in list(self._entry.keys()):
            if t not in requested:
                self._entry.pop(t, None)
                self._trail_high.pop(t, None)
                self._trail_low.pop(t, None)

        # write back preserving original type
        if is_series:
            if new_weights:
                target.temp["weights"] = pd.Series(new_weights)
            else:
                target.temp["weights"] = pd.Series(dtype=float)
        else:
            target.temp["weights"] = new_weights
        return True


class RebalanceAlways(Algo):
    """
    Rebalance that runs even when a prior Run* algo blocked entry.

    Use after StopLossTakeProfit when entry is RunMonthly/Weekly but exit must be daily.

    Sets:
        * rebalance via bt.algos.Rebalance
    """

    def __init__(self):
        super().__init__()
        self.run_always = True  # type: ignore[attr-defined]
        import bt.algos as _algos

        self._rb = _algos.Rebalance()

    def __call__(self, target):
        # only rebalance if weights was set (either by Weigh* or by StopLossTakeProfit forced exit)
        if "weights" not in target.temp:
            return True
        return self._rb(target)


class EntryGateMemory(Algo):
    """
    Gate entry to a periodic schedule while remembering a daily trigger.

    Detection is daily (cross_signal), execution is periodic (period).
    Example: crossUp SMA20 on day 20 is remembered until the next RunMonthly (1st of next month).

    Place **before** Weigh* and after any SelectWhere that sets selected, or use it standalone
    as the selection algo itself.

    Args:
        * cross_signal (str|DataFrame): Signal that triggers entry (e.g. spy_crossUp_sma20). Daily boolean.
        * filter_signal (str|DataFrame|None): Optional filter (e.g. spy_above_sma200). Checked per filter_mode.
        * period (str): "daily" | "weekly" | "monthly" — when entry is allowed. Default "monthly".
        * filter_mode (str): "at_entry" (default) — filter checked on entry day; "at_trigger" — filter snapshot at cross day remembered; "both" — must be True at both times.

    Requires:
        * universe price data (for period check) and the two signals as DataFrames.

    Sets:
        * selected — list of tickers allowed to be weighed. WeighEqually after this will weigh only those.
    """

    def __init__(
        self,
        cross_signal=None,
        filter_signal=None,
        period: str = "monthly",
        filter_mode: str = "at_entry",
    ):
        super().__init__()
        self.cross_signal = cross_signal
        self.filter_signal = filter_signal
        self.period = str(period).lower() if period else "monthly"
        self.filter_mode = str(filter_mode).lower() if filter_mode else "at_entry"
        if self.filter_mode not in ("at_entry", "at_trigger", "both"):
            raise ValueError("filter_mode must be 'at_entry' | 'at_trigger' | 'both'")
        if self.period not in ("daily", "weekly", "monthly"):
            raise ValueError("period must be 'daily' | 'weekly' | 'monthly'")
        self.run_always = True  # type: ignore[attr-defined]
        # pending[ticker] = {"date": Timestamp, "filter_at_trigger": bool}
        self._pending: dict[str, dict] = {}

    def _is_period_start(self, target, now) -> bool:
        try:
            universe = getattr(target, "universe", None)
            if universe is None:
                return True
            idx = universe.index.get_loc(now)
            if idx == 0:
                return True
            prev = universe.index[idx - 1]
            ts_now = pd.Timestamp(now)
            ts_prev = pd.Timestamp(prev)
            if self.period == "daily":
                return True
            if self.period == "weekly":
                # ponytail: use isocalendar week, robust across year boundary
                return ts_now.isocalendar()[1] != ts_prev.isocalendar()[1] or ts_now.year != ts_prev.year
            if self.period == "monthly":
                return ts_now.month != ts_prev.month or ts_now.year != ts_prev.year
            return True
        except Exception:
            return True

    def _resolve_signal_df(self, target, sig):
        # sig may already be a DataFrame (resolved by tree_serializer) or a string name
        if isinstance(sig, pd.DataFrame):
            return sig
        if isinstance(sig, str) and sig:
            try:
                df = target.get_data(sig)  # type: ignore[attr-defined]
                if isinstance(df, pd.DataFrame):
                    return df
            except Exception:
                pass
        return None

    def _get_signal_bool(self, df, now, ticker: str) -> bool:
        if df is None or df.empty or now not in df.index:
            return False
        try:
            # df may have upper columns
            col = None
            for c in df.columns:
                if str(c).upper() == ticker:
                    col = c
                    break
            if col is None:
                # single-column broadcast case
                if len(df.columns) == 1:
                    col = df.columns[0]
                else:
                    return False
            v = df.loc[now, col]
            # handle Series vs scalar
            if isinstance(v, pd.Series):
                v = v.iloc[0]
            return bool(v) and not pd.isna(v)
        except Exception:
            return False

    def __call__(self, target):
        now = getattr(target, "now", None)
        if now is None:
            return False
        # 1) daily detection: if cross_signal true today, set pending
        cross_df = self._resolve_signal_df(target, self.cross_signal)
        filter_df = self._resolve_signal_df(target, self.filter_signal) if self.filter_signal is not None else None
        # need tickers list — from universe columns
        try:
            universe = getattr(target, "universe", None)
            tickers = [str(c).upper() for c in universe.columns] if universe is not None else []
        except Exception:
            tickers = []
        # if cross_signal unresolved, try to fallback to target.temp['selected'] style? skip.
        for ticker in tickers:
            cross_true = self._get_signal_bool(cross_df, now, ticker) if cross_df is not None else False
            if cross_true:
                # snapshot filter at trigger
                filt_at_trigger = True
                if filter_df is not None:
                    filt_at_trigger = self._get_signal_bool(filter_df, now, ticker)
                self._pending[ticker] = {"date": pd.Timestamp(now), "filter_at_trigger": bool(filt_at_trigger)}
        # 2) only on period start we allow entry
        is_start = self._is_period_start(target, now)
        if not is_start:
            # block Weigh on non-start days — but keep pending for next start
            target.temp["selected"] = []
            return False
        # period start: decide which pending to promote
        selected: list[str] = []
        for ticker in list(self._pending.keys()):
            info = self._pending.get(ticker)
            if not info:
                continue
            # check filter per mode
            filt_now = True
            if filter_df is not None:
                filt_now = self._get_signal_bool(filter_df, now, ticker)
            filt_trigger = bool(info.get("filter_at_trigger", True))
            if self.filter_mode == "at_entry":
                ok = filt_now
            elif self.filter_mode == "at_trigger":
                ok = filt_trigger
            else:  # both
                ok = filt_now and filt_trigger
            if ok:
                selected.append(ticker)
            # consume pending regardless (remembered only until next period)
            self._pending.pop(ticker, None)
        # also handle case where cross happens exactly on period start: pending was just set above, so it will be included
        # if no cross_signal provided, fallback to filter only? then pending logic not needed — just gate filter
        if not selected and filter_df is not None and cross_df is None:
            # no cross signal, just filter as entry condition on period start
            for ticker in tickers:
                if self._get_signal_bool(filter_df, now, ticker):
                    selected.append(ticker)
        target.temp["selected"] = selected
        # return True to allow Weigh to run (even if selected empty, WeighEqually will set weights {} which is fine)
        # but we return False if selected empty to avoid unnecessary Weigh? WeighEqually with empty selected sets weights {} anyway, so True is fine.
        # To keep AlgoStack semantics (block Weigh when no entry), return False when empty
        return True if selected else False

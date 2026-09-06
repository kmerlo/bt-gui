from __future__ import annotations

import io
from typing import Any

import math

import pandas as pd

from backend.api._helpers import _err_msg
from backend.database import BacktestRun as DBRun
from backend.database import SessionLocal
from backend.models.backtest_config import BacktestConfig
from backend.models.strategy_tree import StrategyTree
from backend.services.backtest_progress import (
    _backtest_tasks,
    _set_progress,
    get_progress,
    pending_backtest_count,
    schedule_backtest,
)
from backend.services.price_loading import (
    _load_prices_from_db,
    _load_prices_from_local,
    _pivot_price_rows,
    _sanitize_price_df,
)
from backend.services.tree_serializer import to_bt_strategy

# ponytail: compat re-exports for pre-split importers (benchmark, signals, tutorial3/auth tests);
# new code imports from price_loading / backtest_progress directly
__all__ = [
    "run_backtest_sync",
    "get_progress",
    "pending_backtest_count",
    "schedule_backtest",
    "_backtest_tasks",
    "_load_prices_from_db",
    "_load_prices_from_local",
    "_pivot_price_rows",
    "_sanitize_price_df",
    "_set_progress",
]


def _build_commission(cfg: BacktestConfig):  # type: ignore[no-untyped-def]
    if cfg.commission.simple_fn:
        from backend.services.commission_parser import parse_commission_fn

        return parse_commission_fn(cfg.commission.simple_fn)
    return None


def _norm_columns(df: pd.DataFrame | None) -> pd.DataFrame | None:
    if df is None or df.empty:
        return df
    try:
        df.columns = [str(c).upper() for c in df.columns]  # type: ignore[attr-defined]
    except Exception:
        pass
    return df


def _collect_security_names(node) -> set[str]:
    names: set[str] = set()
    try:
        if getattr(node, "type", None) in ("Security", "HedgeSecurity", "CouponPayingSecurity"):
            names.add(str(getattr(node, "name", "")).upper())
        for ch in getattr(node, "children", []) or []:
            names.update(_collect_security_names(ch))
        # also handle StrategyTree root wrapper
        if hasattr(node, "root"):
            names.update(_collect_security_names(node.root))
    except Exception:
        pass
    return names


def _normalize_tree(tree: StrategyTree) -> StrategyTree:
    # ponytail: upper-case Security names so they match normalized price columns
    try:
        import copy

        t = copy.deepcopy(tree)
        stack = [t.root]
        while stack:
            n = stack.pop()
            if getattr(n, "type", None) in ("Security", "HedgeSecurity", "CouponPayingSecurity"):
                n.name = str(n.name).upper()
            for ch in getattr(n, "children", []) or []:
                stack.append(ch)
        return t
    except Exception:
        return tree


def run_backtest_sync(
    run_id: int,
    tree: StrategyTree,
    cfg: BacktestConfig,
    price_df: pd.DataFrame,
    additional: dict,
    volume,
    volatility,
    indicators: dict[str, pd.DataFrame] | None = None,
):  # type: ignore[no-untyped-def]
    import bt

    _set_progress(run_id, {"progress": 0.1, "done": False})
    try:
        # ponytail: normalize all DataFrame columns to upper case so ffn lower-case does not mismatch Strategy names (AAPL)
        price_df = _norm_columns(price_df)  # type: ignore[assignment]
        price_df = _sanitize_price_df(price_df)  # type: ignore[arg-type]
        if price_df is not None and not price_df.empty and price_df.isna().any().any():
            raise ValueError(f"price_df has NaN after sanitize: {price_df.isna().sum().to_dict()}")
        # fail fast if price contains zeros (bt treats 0 as missing and raises "price is 0")
        if price_df is not None and (price_df == 0).any().any():
            zero_cols = [c for c in price_df.columns if (price_df[c] == 0).any()]
            raise ValueError(f"price_df contains zero values in columns {zero_cols} — bt cannot allocate on zero price")
        if additional:
            for k in list(additional.keys()):
                additional[k] = _norm_columns(additional[k])
        volume = _norm_columns(volume)
        volatility = _norm_columns(volatility)
        # normalize indicator columns and filter to strategy members to avoid KeyError when signal has extra tickers
        member_names = _collect_security_names(tree)
        if indicators:
            normed: dict[str, pd.DataFrame] = {}
            for iid, df in indicators.items():
                df = _norm_columns(df)  # type: ignore[assignment]
                if df is not None and not df.empty and member_names:
                    keep = [c for c in df.columns if str(c).upper() in member_names]
                    if keep and len(keep) != len(df.columns):
                        try:
                            df = df[keep]
                        except Exception:
                            pass
                    elif not keep and len(df.columns) == 1 and member_names:
                        # ponytail: legacy single-col signal like 'ROC_252'/'SMA_5' — broadcast/rename to member ticker(s)
                        # (fixes Trend Example 2 before signal_engine fix)
                        single = str(df.columns[0])
                        if single.upper() not in member_names:
                            base = df.iloc[:, 0]
                            if len(member_names) == 1:
                                df = pd.DataFrame({next(iter(member_names)): base}, index=df.index)
                            else:
                                df = pd.DataFrame({m: base for m in member_names}, index=df.index)
                # align to price_df index to avoid bt reading price 0 on missing dates; ffill holds last weight, leading NaN -> 0
                if df is not None and not df.empty and price_df is not None and not price_df.empty:
                    try:
                        df.index = pd.to_datetime(df.index)
                        price_idx = pd.to_datetime(price_df.index)
                        # reindex to price index, keep original values where available
                        aligned = df.reindex(price_idx)
                        # forward-fill holds last signal, leading NaNs become 0 (no allocation before SMA valid)
                        aligned = aligned.ffill().fillna(0)
                        # ensure columns stay upper and sorted as price_df
                        aligned.columns = [str(c).upper() for c in aligned.columns]
                        df = aligned
                    except Exception:
                        pass
                normed[iid] = df  # type: ignore[assignment]
            indicators = normed
        tree = _normalize_tree(tree)
        # ponytail: fail fast if strategy needs tickers not in price_df (e.g. RunDialog stale selection)
        if member_names and price_df is not None and not price_df.empty:
            price_cols = set(str(c).upper() for c in price_df.columns)
            missing = sorted(member_names - price_cols)
            if missing:
                raise ValueError(
                    f"price_df manca colonne richieste dalla strategia: {missing}. "
                    f"Tree tickers: {sorted(member_names)}, price tickers: {sorted(price_cols)}. "
                    f"Fetch {missing} in Ticker Catalog e premi ↻ in Run Backtest per ricaricare."
                )
        strategy = to_bt_strategy(tree, indicators or {}, price_df)
        commissions = _build_commission(cfg)
        bt_obj = bt.Backtest(
            strategy,
            price_df,
            name=tree.name,
            initial_capital=cfg.initial_capital,
            commissions=commissions,
            integer_positions=cfg.integer_positions,
            additional_data=additional,
            volume=volume,
            volatility=volatility,
        )
        bt_obj.run()
        _set_progress(run_id, {"progress": 1.0, "done": True})
        prices = bt_obj.strategy.prices
        try:
            weights = bt_obj.weights
        except Exception:
            weights = None
        stats: dict[str, Any] = {}
        try:
            s = prices.calc_perf_stats() if hasattr(prices, "calc_perf_stats") else {}
            # ffn PerformanceStats has .stats Series, not to_dict directly
            if hasattr(s, "stats") and isinstance(getattr(s, "stats"), pd.Series):
                stats = getattr(s, "stats").to_dict()
            elif hasattr(s, "to_dict"):
                stats = s.to_dict() if not isinstance(s, dict) else s
            elif isinstance(s, dict):
                stats = s
            else:
                stats = {"stats": str(s)}
            if "cagr" not in stats and "cagr" not in [k.lower() for k in stats.keys()]:
                stats["cagr"] = float(prices.calc_cagr()) if hasattr(prices, "calc_cagr") else 0.0
            if "max_drawdown" not in stats and "max_dd" not in stats:
                try:
                    stats["max_drawdown"] = float(prices.calc_max_drawdown()) if hasattr(prices, "calc_max_drawdown") else 0.0
                except Exception:
                    stats["max_drawdown"] = 0.0
            # sanitize for JSON: nan/inf->None, numpy->float, Timestamp->str
            clean: dict[str, Any] = {}
            for k, v in stats.items():
                try:
                    if pd.isna(v):
                        clean[k] = None
                    elif isinstance(v, (pd.Timestamp,)):
                        clean[k] = str(v)
                    elif hasattr(v, "item"):
                        try:
                            fv = float(v)  # type: ignore[arg-type]
                            if math.isinf(fv) or math.isnan(fv):
                                clean[k] = None
                            else:
                                clean[k] = fv
                        except Exception:
                            clean[k] = str(v)
                    elif isinstance(v, float):
                        if math.isinf(v) or math.isnan(v):
                            clean[k] = None
                        else:
                            clean[k] = v
                    elif isinstance(v, (str, int, bool)) or v is None:
                        clean[k] = v
                    else:
                        clean[k] = str(v)
                except Exception:
                    clean[k] = str(v)
            stats = clean
        except Exception as e:
            stats = {"error": _err_msg(e), "cagr": 0.0, "max_drawdown": 0.0}
        try:
            tx = bt_obj.strategy.get_transactions()
            if isinstance(tx, pd.DataFrame) and not tx.empty:
                tbuf = io.BytesIO()
                tx.to_parquet(tbuf)
                tblob = tbuf.getvalue()
            else:
                tblob = None
        except Exception:
            tblob = None
        pbuf = io.BytesIO()
        pdf = pd.DataFrame({"price": prices})
        if weights is not None and isinstance(weights, pd.DataFrame) and not weights.empty:
            try:
                w = weights.reindex(pdf.index)
                for c in w.columns:
                    pdf[c] = w[c]
            except Exception:
                pass
        pdf.to_parquet(pbuf)
        pblob = pbuf.getvalue()
        db = SessionLocal()
        try:
            row = db.query(DBRun).filter(DBRun.id == run_id).first()
            if row:
                row.stats_json = stats  # type: ignore[assignment]
                row.prices_parquet = pblob  # type: ignore[assignment]
                if tblob:
                    row.transactions_parquet = tblob  # type: ignore[assignment]
                if weights is not None and isinstance(weights, pd.DataFrame) and not weights.empty:
                    wbuf = io.BytesIO()
                    weights.to_parquet(wbuf)
                    row.weights_parquet = wbuf.getvalue()  # type: ignore[assignment]
                db.commit()
        finally:
            db.close()
        return bt_obj
    except Exception as e:
        safe = _err_msg(e)
        _set_progress(run_id, {"progress": 1.0, "done": True, "error": safe})
        db = SessionLocal()
        try:
            row = db.query(DBRun).filter(DBRun.id == run_id).first()
            if row:
                row.stats_json = {"error": safe}  # type: ignore[assignment]
                db.commit()
        finally:
            db.close()
        raise

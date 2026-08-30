from __future__ import annotations

import asyncio
import io
import threading
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import math

import pandas as pd

from backend.database import BacktestRun as DBRun
from backend.database import DataSource as DBSource
from backend.database import SessionLocal
from backend.models.backtest_config import BacktestConfig
from backend.models.strategy_tree import StrategyTree
from backend.services.tree_serializer import to_bt_strategy

executor = ThreadPoolExecutor(max_workers=2)
_progress: dict[int, dict[str, Any]] = {}
_lock = threading.Lock()


def get_progress(run_id: int) -> dict[str, Any]:
    with _lock:
        return dict(_progress.get(run_id, {"progress": 0, "done": False}))


def _set_progress(run_id: int, data: dict[str, Any]) -> None:
    with _lock:
        _progress[run_id] = data


def _load_prices_from_db(
    tickers: list[str],
    start: str | None,
    end: str | None,
    price_column: str = "close",
) -> pd.DataFrame:
    """Load price data from price_data table, pivot to DataFrame for bt framework."""
    from backend.database import PriceData as DBPriceData

    db = SessionLocal()
    try:
        q = db.query(DBPriceData).filter(
            DBPriceData.symbol.in_([t.upper() for t in tickers]),
        )
        if start:
            q = q.filter(DBPriceData.date >= pd.to_datetime(start))
        if end:
            q = q.filter(DBPriceData.date <= pd.to_datetime(end))
        q = q.order_by(DBPriceData.date.asc())
        rows = q.all()

        if not rows:
            raise ValueError(f"No price data found for tickers {tickers}")

        df = pd.DataFrame(
            [
                {
                    "date": r.date,
                    r.symbol.upper(): getattr(r, price_column) if price_column != "close" else r.close,
                }
                for r in rows
            ]
        )
        df = df.set_index("date").sort_index()
        # ensure column names are upper
        df.columns = [str(c).upper() for c in df.columns]
        # resolve duplicate dates (one row per ticker per date) keeping first non-null per column
        df = df.groupby(df.index).first()
        # fill forward missing values (weekends/holidays)
        df = df.ffill()
        return df
    finally:
        db.close()


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
                    # keep only columns that are actual members (intersection); if none match keep original to not hide error
                    keep = [c for c in df.columns if str(c).upper() in member_names]
                    if keep and len(keep) != len(df.columns):
                        try:
                            df = df[keep]
                        except Exception:
                            pass
                normed[iid] = df  # type: ignore[assignment]
            indicators = normed
        tree = _normalize_tree(tree)
        strategy = to_bt_strategy(tree, indicators or {})
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
            stats = {"error": str(e), "cagr": 0.0, "max_drawdown": 0.0}
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
        _set_progress(run_id, {"progress": 1.0, "done": True, "error": str(e)})
        db = SessionLocal()
        try:
            row = db.query(DBRun).filter(DBRun.id == run_id).first()
            if row:
                row.stats_json = {"error": str(e)}  # type: ignore[assignment]
                db.commit()
        finally:
            db.close()
        raise


async def _run_background(
    run_id: int,
    tree: StrategyTree,
    cfg: BacktestConfig,
    price_df: pd.DataFrame,
    additional: dict,
    volume,
    volatility,
    indicators: dict[str, pd.DataFrame] | None = None,
):  # type: ignore[no-untyped-def]
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(executor, run_backtest_sync, run_id, tree, cfg, price_df, additional, volume, volatility, indicators)


def schedule_backtest(
    run_id: int,
    tree: StrategyTree,
    cfg: BacktestConfig,
    price_df: pd.DataFrame,
    additional: dict,
    volume,
    volatility,
    indicators: dict[str, pd.DataFrame] | None = None,
):  # type: ignore[no-untyped-def]
    _set_progress(run_id, {"progress": 0.05, "done": False})
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(_run_background(run_id, tree, cfg, price_df, additional, volume, volatility, indicators))
    except RuntimeError:

        def _bg():
            run_backtest_sync(run_id, tree, cfg, price_df, additional, volume, volatility, indicators)

        executor.submit(_bg)


# fallback for callers that only have ids (legacy path)
def schedule_backtest_by_ids(run_id: int, tree: StrategyTree, cfg: BacktestConfig, price_source_id: int, extra_ids: dict[str, int], indicator_ids: list[int] | None = None):  # type: ignore[no-untyped-def]

    db = SessionLocal()
    try:
        prow = db.query(DBSource).filter(DBSource.id == price_source_id).first()
        if prow is None or prow.parquet_blob is None:
            raise ValueError("price source not found")
        price_df = pd.read_parquet(io.BytesIO(prow.parquet_blob))
        price_df.index = pd.to_datetime(price_df.index)
        additional: dict[str, pd.DataFrame] = {}
        volume = None
        volatility = None
        if extra_ids:
            extra_vals = list(extra_ids.values())
            extra_map = {r.id: r for r in db.query(DBSource).filter(DBSource.id.in_(extra_vals)).all()} if extra_vals else {}
            for k, vid in extra_ids.items():
                row = extra_map.get(vid)
                if row is None or row.parquet_blob is None:
                    continue
                df = pd.read_parquet(io.BytesIO(row.parquet_blob))
                df.index = pd.to_datetime(df.index)
                if k in ("volume", "volatility"):
                    if k == "volume":
                        volume = df
                    else:
                        volatility = df
                else:
                    additional[k] = df
        indicators: dict[str, pd.DataFrame] = {}
        if indicator_ids:
            ind_map = {r.id: r for r in db.query(DBSource).filter(DBSource.id.in_(indicator_ids)).all()} if indicator_ids else {}
            for ind_id in indicator_ids:
                ind_row = ind_map.get(ind_id)
                if ind_row is None or ind_row.parquet_blob is None:
                    continue
                ind_df = pd.read_parquet(io.BytesIO(ind_row.parquet_blob))
                ind_df.index = pd.to_datetime(ind_df.index)
                indicators[str(ind_id)] = ind_df
    finally:
        db.close()
    schedule_backtest(run_id, tree, cfg, price_df, additional, volume, volatility, indicators)

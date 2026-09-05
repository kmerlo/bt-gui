from __future__ import annotations

import asyncio
import atexit
import io
import threading
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import math

import pandas as pd

from backend.database import BacktestRun as DBRun
from backend.database import SessionLocal
from backend.models.backtest_config import BacktestConfig
from backend.models.strategy_tree import StrategyTree
from backend.services.tree_serializer import to_bt_strategy

executor = ThreadPoolExecutor(max_workers=2)
_progress: dict[int, dict[str, Any]] = {}
_lock = threading.Lock()
# ponytail: simple dict registry; use a proper task manager if concurrent backtests exceed 2 or graceful shutdown becomes a production requirement.
_backtest_tasks: dict[int, asyncio.Task] = {}
_tasks_lock = threading.Lock()


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
    """Load price data from the configured price source, pivot to DataFrame for bt framework."""
    from backend.database import get_price_source

    if get_price_source() == "market":
        return _load_prices_from_market(tickers, start, end, price_column)

    return _load_prices_from_local(tickers, start, end, price_column)


def _pivot_price_rows(rows: list, price_column: str) -> pd.DataFrame:
    """Pivot flat rows (symbol/date/close) to wide DataFrame — robust to duplicate dates."""
    if not rows:
        return pd.DataFrame()
    flat = pd.DataFrame(
        [
            {
                "date": r.date,
                "symbol": r.symbol.upper(),
                "close": getattr(r, price_column) if price_column != "close" else r.close,
            }
            for r in rows
        ]
    )
    wide = flat.pivot(index="date", columns="symbol", values="close").sort_index()
    wide.columns = [str(c).upper() for c in wide.columns]
    # ffill for holidays/weekends, bfill for leading NaN (first date may have NaN for one ticker due to insert order)
    wide = wide.ffill().bfill()
    return wide


def _sanitize_price_df(df: pd.DataFrame) -> pd.DataFrame:
    """Ensure price_df has no NaN/zero that bt would treat as price=0."""
    if df.empty:
        return df
    df = df.copy()
    df.index = pd.to_datetime(df.index)
    df = df.sort_index()
    df.columns = [str(c).upper() for c in df.columns]
    # drop fully-empty rows, then fill
    df = df.dropna(how="all").ffill().bfill()
    return df


def _load_prices_from_local(
    tickers: list[str],
    start: str | None,
    end: str | None,
    price_column: str = "close",
) -> pd.DataFrame:
    """Load price data from local price_data table (bt_gui.db)."""
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

        df = _pivot_price_rows(rows, price_column)
        df = _sanitize_price_df(df)
        # ponytail: fail fast if a requested ticker column is completely missing (price is 0 in bt)
        missing = sorted(set(t.upper() for t in tickers) - set(str(c).upper() for c in df.columns))
        if missing:
            raise ValueError(
                f"price data missing columns {missing} for range {start}->{end} "
                f"(price_column={price_column}). Fetch {missing} in Ticker Catalog. Available: {sorted(str(c) for c in df.columns)}"
            )
        if (df == 0).any().any():
            zero_cols = [str(c) for c in df.columns if (df[c] == 0).any()]
            zero_dates = df.index[(df == 0).any(axis=1)].tolist()[:3]
            raise ValueError(
                f"price_df zero in {zero_cols} at {zero_dates} — "
                f"bt price=0 (col={price_column} {start}->{end})"
            )
        if df.isna().any().any():
            raise ValueError(f"price_df still has NaN after sanitize: {df.isna().sum().to_dict()}")
        return df
    finally:
        db.close()


def _load_prices_from_market(
    tickers: list[str],
    start: str | None,
    end: str | None,
    price_column: str = "close",
) -> pd.DataFrame:
    """Load price data from market.db (read-only) via raw SQL."""
    from backend.database import engine_market
    from sqlalchemy import text

    conn = engine_market.connect()
    try:
        placeholders = ",".join(f":t{i}" for i in range(len(tickers)))
        params = {f"t{i}": t.upper() for i, t in enumerate(tickers)}
        sql = f"SELECT symbol, date, open, high, low, close, adj_close, volume FROM price_data WHERE symbol IN ({placeholders})"
        if start:
            sql += " AND date >= :start"
            params["start"] = start
        if end:
            sql += " AND date <= :end"
            params["end"] = end
        sql += " ORDER BY date ASC"
        result = conn.execute(text(sql), params)
        rows = result.fetchall()

        if not rows:
            raise ValueError(f"No price data found for tickers {tickers}")

        # rows are Row tuples: (symbol, date, open, high, low, close, adj_close, volume)
        flat = []
        for r in rows:
            try:
                # support both Row object attribute access and tuple indexing
                sym = getattr(r, "symbol", None) if hasattr(r, "symbol") else r[0]
                d = getattr(r, "date", None) if hasattr(r, "date") else r[1]
                if sym is None:
                    sym = r[0]  # type: ignore[index]
                if d is None:
                    d = r[1]  # type: ignore[index]
                if price_column == "close":
                    val = getattr(r, "close", None) if hasattr(r, "close") else r[5]  # type: ignore[index]
                    if val is None:
                        val = r[5]  # type: ignore[index]
                else:
                    val = getattr(r, price_column, None) if hasattr(r, price_column) else None
                    if val is None:
                        # fallback: map column name to tuple index
                        col_map = {"open": 2, "high": 3, "low": 4, "close": 5, "adj_close": 6, "volume": 7}
                        idx = col_map.get(price_column, 5)
                        val = r[idx]  # type: ignore[index]
                flat.append({"date": d, "symbol": str(sym).upper(), "close": val})
            except Exception:
                continue
        wide = pd.DataFrame(flat).pivot(index="date", columns="symbol", values="close").sort_index()
        wide.columns = [str(c).upper() for c in wide.columns]
        wide = wide.ffill().bfill()
        wide = _sanitize_price_df(wide)
        # ponytail: fail fast if a requested ticker column is missing
        missing = sorted(set(t.upper() for t in tickers) - set(str(c).upper() for c in wide.columns))
        if missing:
            raise ValueError(
                f"price data missing columns {missing} for range {start}->{end} "
                f"(price_column={price_column}). Fetch {missing} in Ticker Catalog. Available: {sorted(str(c) for c in wide.columns)}"
            )
        if (wide == 0).any().any():
            zero_cols = [str(c) for c in wide.columns if (wide[c] == 0).any()]
            zero_dates = wide.index[(wide == 0).any(axis=1)].tolist()[:3]
            raise ValueError(
                f"price_df zero in {zero_cols} at {zero_dates} — "
                f"bt price=0 (col={price_column} {start}->{end})"
            )
        if wide.isna().any().any():
            raise ValueError(f"price_df still has NaN after sanitize: {wide.isna().sum().to_dict()}")
        return wide
    finally:
        conn.close()


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
    loop = asyncio.get_running_loop()
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
        task = loop.create_task(_run_background(run_id, tree, cfg, price_df, additional, volume, volatility, indicators))
        with _tasks_lock:
            _backtest_tasks[run_id] = task
        def _clean_up(t: asyncio.Task) -> None:
            with _tasks_lock:
                _backtest_tasks.pop(run_id, None)
        task.add_done_callback(_clean_up)
    except RuntimeError:

        def _bg():
            run_backtest_sync(run_id, tree, cfg, price_df, additional, volume, volatility, indicators)

        executor.submit(_bg)


def _shutdown_backtests() -> None:
    with _tasks_lock:
        for task in list(_backtest_tasks.values()):
            if not task.done():
                task.cancel()
        _backtest_tasks.clear()


atexit.register(_shutdown_backtests)


def pending_backtest_count() -> int:
    with _tasks_lock:
        return sum(1 for t in _backtest_tasks.values() if not t.done())

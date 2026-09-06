from __future__ import annotations

import base64
import io
import math
import tempfile
from functools import lru_cache
from pathlib import Path
from threading import Lock
from typing import Any

import matplotlib

matplotlib.use("Agg")  # ponytail: headless server — mai GUI backend
import pandas as pd

from backend.api._helpers import _blob_to_df, _err_msg
from backend.database import BacktestRun as DBRun
from backend.database import get_active_db, get_session_local

PLOT_KINDS = ("snapshot", "monthly_heatmap", "drawdown", "distribution")

# ponytail: metriche extra rispetto a stats_json (ffn); ognuna guarded, mai raise
_METRICS = (
    "sharpe",
    "sortino",
    "calmar",
    "value_at_risk",
    "conditional_value_at_risk",
    "kelly_criterion",
    "profit_factor",
    "profit_ratio",
    "payoff_ratio",
    "win_rate",
    "gain_to_pain_ratio",
    "tail_ratio",
    "common_sense_ratio",
    "outlier_win_ratio",
    "outlier_loss_ratio",
    "recovery_factor",
    "risk_of_ruin",
    "ulcer_index",
    "serenity_index",
    "skew",
    "kurtosis",
)

_MPL_LOCK = Lock()  # ponytail: quantstats usa pyplot stateful — un plot alla volta


def _clean(v: Any) -> float | None:
    try:
        f = float(v)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    return None if (math.isnan(f) or math.isinf(f)) else f


def _equity(run_id: int, db_name: str) -> pd.Series | None:
    db = get_session_local(db_name)()
    try:
        row = db.query(DBRun).filter(DBRun.id == run_id).first()
        if row is None or row.prices_parquet is None:
            return None
        df = _blob_to_df(row.prices_parquet)
        if df.empty:
            return None
        df = df.copy()
        df.index = pd.to_datetime(df.index)
        col = "price" if "price" in df.columns else df.columns[0]
        s = pd.to_numeric(df[col], errors="coerce").dropna()
        return s if not s.empty else None
    except Exception:
        return None
    finally:
        db.close()


def _benchmark_equity(run_id: int, db_name: str, idx: pd.DatetimeIndex, scale_to: float) -> pd.Series | None:
    try:
        from backend.services.benchmark import align_benchmark_to_index, load_benchmark_series, normalize_ticker

        db = get_session_local(db_name)()
        try:
            row = db.query(DBRun).filter(DBRun.id == run_id).first()
            if row is None:
                return None
            cfg = row.config_json if isinstance(row.config_json, dict) else {}
            ticker = normalize_ticker(cfg.get("benchmark_ticker"))
            if ticker is None:
                return None
            bench = load_benchmark_series(ticker, str(idx.min())[:10], str(idx.max())[:10], cfg.get("price_column", "close"))
            return align_benchmark_to_index(bench, idx, scale_to)
        finally:
            db.close()
    except Exception:
        return None


def _returns(s: pd.Series) -> pd.Series:
    r = s.pct_change().replace([float("inf"), float("-inf")], float("nan")).dropna()
    return r  # type: ignore[return-value]


def _benchmark_ticker(run_id: int, db_name: str) -> str | None:
    try:
        from backend.services.benchmark import normalize_ticker

        db = get_session_local(db_name)()
        try:
            row = db.query(DBRun).filter(DBRun.id == run_id).first()
            if row is None:
                return None
            cfg = row.config_json if isinstance(row.config_json, dict) else {}
            return normalize_ticker(cfg.get("benchmark_ticker"))
        finally:
            db.close()
    except Exception:
        return None


@lru_cache(maxsize=32)
def get_metrics(run_id: int, db_name: str) -> dict[str, float | None]:
    import quantstats as qs

    eq = _equity(run_id, db_name)
    if eq is None or len(eq) < 3:
        return {}
    rets = _returns(eq)
    if rets.empty:
        return {}
    out: dict[str, float | None] = {}
    for name in _METRICS:
        try:
            out[name] = _clean(getattr(qs.stats, name)(rets))
        except Exception:
            out[name] = None
    return out


@lru_cache(maxsize=32)
def get_plot(run_id: int, kind: str, db_name: str) -> bytes | None:
    import matplotlib.pyplot as plt
    import quantstats as qs

    if kind not in PLOT_KINDS:
        return None
    eq = _equity(run_id, db_name)
    if eq is None or len(eq) < 3:
        return None
    rets = _returns(eq)
    if rets.empty:
        return None
    with _MPL_LOCK:
        plt.close("all")
        try:
            kw: dict[str, Any] = {"show": False}
            if kind == "snapshot":
                bench = _benchmark_equity(run_id, db_name, eq.index, float(eq.iloc[0]))
                if bench is not None and not bench.dropna().empty:
                    kw["benchmark"] = _returns(bench.dropna())
            fig = getattr(qs.plots, kind)(rets, **kw)
            buf = io.BytesIO()
            try:
                fig.savefig(buf, format="png", bbox_inches="tight", dpi=100)
            finally:
                plt.close("all")
            data = buf.getvalue()
            return data or None
        except Exception as e:
            _err_msg(e)
            plt.close("all")
            return None


@lru_cache(maxsize=8)  # ponytail: HTML ~MB — cache stretta
def get_tearsheet(run_id: int, db_name: str) -> str | None:
    import quantstats as qs

    eq = _equity(run_id, db_name)
    if eq is None or len(eq) < 3:
        return None
    rets = _returns(eq)
    if rets.empty:
        return None
    with _MPL_LOCK:
        try:
            bench = _benchmark_equity(run_id, db_name, eq.index, float(eq.iloc[0]))
            bench_rets = _returns(bench.dropna()) if bench is not None and not bench.dropna().empty else None
            with tempfile.TemporaryDirectory() as td:
                out = str(Path(td) / "tearsheet.html")
                qs.reports.html(rets, benchmark=bench_rets, output=out, title=f"Run #{run_id}")
                return Path(out).read_text(encoding="utf-8")
        except Exception as e:
            _err_msg(e)
            return None


def plot_b64(run_id: int, kind: str, db_name: str) -> str | None:
    raw = get_plot(run_id, kind, db_name)
    return base64.b64encode(raw).decode() if raw else None


def quantstats_bundle(run_id: int, db_name: str | None = None) -> dict[str, Any]:
    db_name = db_name or get_active_db()
    return {"metrics": get_metrics(run_id, db_name), "benchmark_ticker": _benchmark_ticker(run_id, db_name)}

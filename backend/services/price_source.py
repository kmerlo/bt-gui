from __future__ import annotations

from typing import Any

import pandas as pd
from sqlalchemy import text

from backend.database import SessionLocal, engine_market, get_price_source


def _row_to_dict(r: Any) -> dict[str, Any]:
    return {
        "date": str(r["date"])[:10],
        "open": float(r["open"]) if r["open"] is not None else None,
        "high": float(r["high"]) if r["high"] is not None else None,
        "low": float(r["low"]) if r["low"] is not None else None,
        "close": float(r["close"]) if r["close"] is not None else None,
        "adj_close": float(r["adj_close"]) if r["adj_close"] is not None else None,
        "volume": int(r["volume"]) if r["volume"] is not None else None,
    }


def load_price_rows(
    symbol: str,
    start: str | None = None,
    end: str | None = None,
    sort_by: str | None = None,
    sort_dir: str = "asc",
    limit: int | None = None,
    offset: int | None = None,
) -> list[dict[str, Any]]:
    """Load price rows from the configured price source (local or market)."""
    source = get_price_source()
    sym = symbol.upper()

    if source == "market":
        return _load_market_rows(sym, start, end, sort_by, sort_dir, limit, offset)

    return _load_local_rows(sym, start, end, sort_by, sort_dir, limit, offset)


def _load_local_rows(
    sym: str,
    start: str | None,
    end: str | None,
    sort_by: str | None,
    sort_dir: str,
    limit: int | None,
    offset: int | None,
) -> list[dict[str, Any]]:
    from backend.database import PriceData as DBPriceData

    db = SessionLocal()
    try:
        q = db.query(DBPriceData).filter(DBPriceData.symbol == sym)
        if start:
            q = q.filter(DBPriceData.date >= pd.to_datetime(start))
        if end:
            q = q.filter(DBPriceData.date <= pd.to_datetime(end))
        col_map = {
            "date": DBPriceData.date,
            "open": DBPriceData.open,
            "high": DBPriceData.high,
            "low": DBPriceData.low,
            "close": DBPriceData.close,
            "adj_close": DBPriceData.adj_close,
            "volume": DBPriceData.volume,
        }
        if sort_by and sort_by in col_map:
            q = q.order_by(col_map[sort_by].asc() if sort_dir == "asc" else col_map[sort_by].desc())
        else:
            q = q.order_by(DBPriceData.date.asc())
        if limit is not None:
            q = q.limit(limit)
        if offset is not None:
            q = q.offset(offset)
        rows = q.all()
        return [_row_to_dict(r) for r in rows]
    finally:
        db.close()


def _load_market_rows(
    sym: str,
    start: str | None,
    end: str | None,
    sort_by: str | None,
    sort_dir: str,
    limit: int | None,
    offset: int | None,
) -> list[dict[str, Any]]:
    # ponytail: market.db is read-only; direct SQL is faster than ORM for bulk reads
    conn = engine_market.connect()
    try:
        sql = "SELECT symbol, interval, date, open, high, low, close, adj_close, volume FROM price_data WHERE symbol = :sym"
        params: dict[str, Any] = {"sym": sym}
        if start:
            sql += " AND date >= :start"
            params["start"] = start
        if end:
            sql += " AND date <= :end"
            params["end"] = end
        sort_col = sort_by if sort_by and sort_by in ("date", "open", "high", "low", "close", "adj_close", "volume") else "date"
        sql += f" ORDER BY {sort_col} {'ASC' if sort_dir == 'asc' else 'DESC'}"
        if limit is not None:
            sql += " LIMIT :limit"
            params["limit"] = limit
        if offset is not None:
            sql += " OFFSET :offset"
            params["offset"] = offset
        result = conn.execute(text(sql), params)
        rows = result.fetchall()
        return [
            {
                "date": str(r.date)[:10],
                "open": float(r.open) if r.open is not None else None,
                "high": float(r.high) if r.high is not None else None,
                "low": float(r.low) if r.low is not None else None,
                "close": float(r.close) if r.close is not None else None,
                "adj_close": float(r.adj_close) if r.adj_close is not None else None,
                "volume": int(r.volume) if r.volume is not None else None,
            }
            for r in rows
        ]
    finally:
        conn.close()


def list_price_tickers() -> list[dict[str, Any]]:
    """Return aggregated ticker list (start/end/count) from the configured source."""
    source = get_price_source()
    if source == "market":
        return _list_market_tickers()
    return _list_local_tickers()


def _list_local_tickers() -> list[dict[str, Any]]:
    from backend.database import PriceData as DBPriceData

    db = SessionLocal()
    try:
        rows = db.query(DBPriceData).order_by(DBPriceData.symbol, DBPriceData.date).all()
        by_symbol: dict[str, dict[str, Any]] = {}
        for r in rows:
            sym = r.symbol.upper()
            if sym not in by_symbol:
                by_symbol[sym] = {"symbol": sym, "interval": r.interval, "start": str(r.date)[:10], "end": str(r.date)[:10], "count": 0}
            entry = by_symbol[sym]
            entry["count"] += 1
            date_str = str(r.date)[:10]
            if date_str < entry["start"]:
                entry["start"] = date_str
            if date_str > entry["end"]:
                entry["end"] = date_str
        return list(by_symbol.values())
    finally:
        db.close()


def _list_market_tickers() -> list[dict[str, Any]]:
    # ponytail: GROUP BY aggregation via SQL instead of Python post-processing
    conn = engine_market.connect()
    try:
        sql = """
            SELECT symbol, interval,
                   MIN(date) AS start_date,
                   MAX(date) AS end_date,
                   COUNT(*) AS cnt
            FROM price_data
            GROUP BY symbol, interval
            ORDER BY symbol
        """
        result = conn.execute(text(sql))
        rows = result.fetchall()
        return [
            {
                "symbol": r.symbol.upper(),
                "interval": r.interval,
                "start": str(r.start_date)[:10],
                "end": str(r.end_date)[:10],
                "count": r.cnt,
            }
            for r in rows
        ]
    finally:
        conn.close()

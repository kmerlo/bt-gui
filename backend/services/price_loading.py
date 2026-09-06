from __future__ import annotations

import pandas as pd

from backend.database import SessionLocal


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

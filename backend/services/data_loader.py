from __future__ import annotations

import io

import pandas as pd
from fastapi import UploadFile


def load_csv(file: UploadFile) -> pd.DataFrame:
    content = file.file.read()
    df = pd.read_csv(io.BytesIO(content), index_col=0, parse_dates=True)
    df.index = pd.to_datetime(df.index)
    return df.sort_index()


def load_parquet(file: UploadFile) -> pd.DataFrame:
    content = file.file.read()
    return pd.read_parquet(io.BytesIO(content))


def fetch_ffn(tickers: list[str], start: str | None = None, end: str | None = None) -> pd.DataFrame:
    import ffn

    kwargs: dict[str, str] = {}
    if start:
        kwargs["start"] = start
    if end:
        kwargs["end"] = end
    df = ffn.get(",".join(tickers), **kwargs)
    if isinstance(df, pd.Series):
        df = df.to_frame(tickers[0])
    if not isinstance(df.index, pd.DatetimeIndex):
        df.index = pd.to_datetime(df.index)
    df = df.sort_index()
    # ponytail: normalize ticker columns to upper case so Strategy Security names (AAPL) match price DataFrame
    try:
        df.columns = [str(c).upper() for c in df.columns]
    except Exception:
        pass
    return df


def validate_data(df: pd.DataFrame, expected_columns: list[str] | None = None) -> None:
    if df.empty:
        raise ValueError("empty DataFrame")
    if not isinstance(df.index, pd.DatetimeIndex):
        raise ValueError("index must be DateTimeIndex")
    if df.isna().all().all():
        raise ValueError("all NaN")
    if expected_columns and set(df.columns) != set(expected_columns):
        pass


def _flatten_yf_df(df: pd.DataFrame) -> pd.DataFrame:
    """Flatten yfinance MultiIndex columns to flat names like 'Open_AAPL'."""
    df = df.reset_index()
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = ["Date" if p == "Date" else f"{p}_{t}" for p, t in df.columns]
    elif "Date" not in df.columns and len(df.columns) > 0:
        df = df.rename(columns={df.columns[0]: "Date"})
    return df


def _row_ohlcv(row: pd.Series, sym: str) -> dict:
    """Extract OHLCV from a flattened yfinance row."""

    def get_f(name: str) -> float | None:
        v = row.get(f"{name}_{sym}")
        return float(v) if pd.notna(v) else None

    v = row.get(f"Volume_{sym}")
    vol = int(v) if pd.notna(v) else None
    return {"open": get_f("Open"), "high": get_f("High"), "low": get_f("Low"), "close": get_f("Close"), "adj_close": get_f("Adj Close"), "volume": vol}


def fetch_and_store_yf(
    db,
    symbol: str,
    start: str | None = None,
    end: str | None = None,
    interval: str = "1d",
) -> int:
    """Fetch price data from yfinance for a single symbol and upsert into price_data.
    Returns the number of rows inserted/updated.
    """
    import yfinance as yf

    kwargs: dict[str, str] = {}
    if start:
        kwargs["start"] = start
    if end:
        kwargs["end"] = end

    df = yf.download(symbol, **kwargs, auto_adjust=False)
    if df.empty:
        return 0

    df = _flatten_yf_df(df)
    df["Date"] = pd.to_datetime(df["Date"], utc=True).dt.tz_localize(None)
    df = df.drop_duplicates(subset=["Date"], keep="last")

    from backend.database import PriceData as DBPriceData

    sym = symbol.upper()
    existing = {
        row.date: row
        for row in db.query(DBPriceData)
        .filter(
            DBPriceData.symbol == sym,
            DBPriceData.interval == interval,
        )
        .all()
    }

    count = 0
    for _, row in df.iterrows():
        date_val = row["Date"]
        if pd.isna(date_val):
            continue
        vals = _row_ohlcv(row, sym)
        if date_val in existing:
            rec = existing[date_val]
            rec.open = vals["open"]
            rec.high = vals["high"]
            rec.low = vals["low"]
            rec.close = vals["close"]
            rec.adj_close = vals["adj_close"]
            rec.volume = vals["volume"]
        else:
            rec = DBPriceData(symbol=sym, interval=interval, date=date_val, **vals)
            existing[date_val] = rec
            db.add(rec)
        count += 1

    db.commit()
    return count


def fetch_yf_df(symbol: str, start: str | None, end: str | None) -> pd.DataFrame:
    """Fetch from yfinance and return a DataFrame suitable for backtest (index=date, columns=[symbol])."""
    import yfinance as yf

    kwargs: dict[str, str] = {}
    if start:
        kwargs["start"] = start
    if end:
        kwargs["end"] = end

    df = yf.download(symbol, **kwargs, auto_adjust=False)
    if df.empty:
        return pd.DataFrame()

    df = _flatten_yf_df(df)
    df["Date"] = pd.to_datetime(df["Date"], utc=True).dt.tz_localize(None)
    sym = symbol.upper()
    df = df.set_index("Date").sort_index()
    close_col = f"Close_{sym}"
    if close_col in df.columns:
        df = df[[close_col]]
        df.columns = [sym]
    return df

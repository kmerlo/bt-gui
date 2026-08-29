from __future__ import annotations

import io

import ffn
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

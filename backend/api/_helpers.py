from __future__ import annotations

import io
import logging
from typing import Any

import pandas as pd


def _df_to_blob(df: pd.DataFrame) -> bytes:
    buf = io.BytesIO()
    df.to_parquet(buf)
    return buf.getvalue()


def _blob_to_df(blob: bytes) -> pd.DataFrame:
    return pd.read_parquet(io.BytesIO(blob))


def _meta(df: pd.DataFrame) -> dict[str, Any]:
    return {"shape": list(df.shape), "columns": list(df.columns), "start": str(df.index[0]), "end": str(df.index[-1])}


def _err_msg(e: Exception) -> str:
    """Return a safe, user-facing error message. Internal details go to the logger."""
    logging.getLogger("bt-gui").warning("API error: %s", e)
    return "internal error"

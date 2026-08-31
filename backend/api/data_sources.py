from __future__ import annotations

from typing import Any

import pandas as pd
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.api._helpers import _blob_to_df, _df_to_blob, _err_msg, _meta
from backend.api._query import apply_search, apply_sort
from backend.database import DataSource as DBSource
from backend.database import get_db
from backend.services.data_loader import fetch_ffn, load_csv, load_parquet

router = APIRouter(tags=["bt-gui"])


@router.post("/data-sources/upload", status_code=201)
def upload_data_source(
    name: str = Query(...),
    type: str = Query(...),
    file: UploadFile = File(...),  # noqa: B008
    db: Session = Depends(get_db),  # noqa: B008
):
    if file.filename and file.filename.endswith(".csv"):
        df = load_csv(file)
        source = "csv"
    elif file.filename and file.filename.endswith(".parquet"):
        df = load_parquet(file)
        source = "parquet"
    else:
        raise HTTPException(status_code=400, detail="only .csv/.parquet")
    if df.empty:
        raise HTTPException(status_code=422, detail="empty DataFrame")
    blob = _df_to_blob(df)
    meta = _meta(df)
    if db.query(DBSource).filter(DBSource.name == name).first():
        raise HTTPException(status_code=409, detail=f"data source {name} exists")
    row = DBSource(name=name, type=type, source=source, path_or_tickers=file.filename, meta_json=meta, parquet_blob=blob)
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"id": row.id, "name": row.name, "meta": meta}


class FetchRequest(BaseModel):
    name: str
    type: str
    tickers: list[str]
    start: str | None = None
    end: str | None = None


@router.post("/data-sources/fetch", status_code=201)
def fetch_data_source(req: FetchRequest, db: Session = Depends(get_db)):  # noqa: B008
    if not req.tickers:
        raise HTTPException(status_code=422, detail="tickers required")
    try:
        df = fetch_ffn(req.tickers, req.start or "", req.end or "")
    except Exception as e:
        raise HTTPException(status_code=502, detail=_err_msg(e))
    if df.empty:
        raise HTTPException(status_code=422, detail="empty result from ffn")
    blob = _df_to_blob(df)
    meta = _meta(df)
    if db.query(DBSource).filter(DBSource.name == req.name).first():
        raise HTTPException(status_code=409, detail=f"data source {req.name} exists")
    row = DBSource(name=req.name, type=req.type, source="ffn", path_or_tickers=",".join(req.tickers), meta_json=meta, parquet_blob=blob)
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"id": row.id, "name": row.name, "meta": meta}


@router.get("/data-sources")
def list_data_sources(  # noqa: B008
    search: str | None = Query(None),
    sort_by: str | None = Query(None),
    sort_dir: str = Query("asc", pattern="^(asc|desc)$"),
    db: Session = Depends(get_db),  # noqa: B008
):
    rows = db.query(DBSource).order_by(DBSource.id).all()
    out = [{"id": r.id, "name": r.name, "type": r.type, "source": r.source, "meta": r.meta_json, "path_or_tickers": r.path_or_tickers} for r in rows]
    if search:
        out = apply_search(out, search, ["name", "type", "source", "path_or_tickers", "id"])
    apply_sort(out, sort_by, sort_dir, {"id", "name", "type", "source"})
    return out


class BulkDeleteDataSourcesRequest(BaseModel):
    ids: list[int]


@router.post("/data-sources/bulk-delete")
def bulk_delete_data_sources(req: BulkDeleteDataSourcesRequest, db: Session = Depends(get_db)):  # noqa: B008
    if not req.ids:
        raise HTTPException(status_code=422, detail="ids required")
    rows = db.query(DBSource).filter(DBSource.id.in_(req.ids)).all()
    found_ids = {r.id for r in rows}
    for r in rows:
        db.delete(r)
    db.commit()
    return {"deleted": len(rows), "not_found": [i for i in req.ids if i not in found_ids]}


@router.delete("/data-sources/{sid}", status_code=204)
def delete_data_source(sid: int, db: Session = Depends(get_db)):  # noqa: B008
    row = db.query(DBSource).filter(DBSource.id == sid).first()
    if row is None:
        raise HTTPException(status_code=404, detail="not found")
    db.delete(row)
    db.commit()


class DeleteRowsRequest(BaseModel):
    dates: list[str]


@router.post("/data-sources/{sid}/rows/delete")
def delete_rows(sid: int, req: DeleteRowsRequest, db: Session = Depends(get_db)):  # noqa: B008
    row = db.query(DBSource).filter(DBSource.id == sid).first()
    if row is None:
        raise HTTPException(status_code=404, detail="not found")
    if row.parquet_blob is None:
        raise HTTPException(status_code=422, detail="no data")
    if not req.dates:
        raise HTTPException(status_code=422, detail="dates required")
    df = _blob_to_df(row.parquet_blob)
    try:
        idx = pd.to_datetime(df.index)
    except Exception:
        idx = df.index
    df.index = idx  # type: ignore[assignment]
    to_drop = pd.to_datetime(req.dates, errors="coerce")
    to_drop = [d for d in to_drop if not pd.isna(d)]  # type: ignore[union-attr]
    if not to_drop:
        raise HTTPException(status_code=422, detail="no valid dates")
    before = len(df)
    df = df.drop(index=to_drop, errors="ignore")
    deleted = before - len(df)
    if df.empty:
        blob = _df_to_blob(df)
        meta: dict[str, Any] = {"shape": list(df.shape), "columns": list(df.columns), "start": None, "end": None}
    else:
        blob = _df_to_blob(df)
        meta = _meta(df)
    row.parquet_blob = blob
    row.meta_json = meta
    db.commit()
    return {"deleted": deleted, "remaining": len(df), "shape": list(df.shape)}


@router.get("/data-sources/{sid}")
def get_data_source(sid: int, db: Session = Depends(get_db)):  # noqa: B008
    row = db.query(DBSource).filter(DBSource.id == sid).first()
    if row is None:
        raise HTTPException(status_code=404, detail="not found")
    return {"id": row.id, "name": row.name, "type": row.type, "source": row.source, "meta": row.meta_json, "path_or_tickers": row.path_or_tickers}


@router.get("/data-sources/{sid}/preview")
def preview_data_source(sid: int, limit: int = 5, db: Session = Depends(get_db)):  # noqa: B008
    row = db.query(DBSource).filter(DBSource.id == sid).first()
    if row is None:
        raise HTTPException(status_code=404, detail="not found")
    if row.parquet_blob is None:
        raise HTTPException(status_code=422, detail="no data")
    df = _blob_to_df(row.parquet_blob)
    head = df.sort_index(ascending=False).head(limit)
    rows = []
    for idx, r in head.iterrows():
        rec: dict[str, Any] = {"date": str(idx)}
        for c in df.columns:
            v = r[c]
            if pd.isna(v):
                rec[str(c)] = None
            else:
                try:
                    rec[str(c)] = float(v)  # type: ignore[arg-type]
                except Exception:
                    rec[str(c)] = str(v)
        rows.append(rec)
    return {"columns": list(df.columns), "rows": rows, "shape": list(df.shape)}


@router.get("/data-sources/{sid}/table")
def table_data_source(
    sid: int,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    sort_by: str | None = Query(None),
    sort_dir: str = Query("asc", pattern="^(asc|desc)$"),
    search: str | None = Query(None),
    db: Session = Depends(get_db),  # noqa: B008
):
    row = db.query(DBSource).filter(DBSource.id == sid).first()
    if row is None:
        raise HTTPException(status_code=404, detail="not found")
    if row.parquet_blob is None:
        raise HTTPException(status_code=422, detail="no data")
    df = _blob_to_df(row.parquet_blob)
    df = df.copy()
    original_shape = list(df.shape)
    if search:
        # ponytail: full scan on blob — paginate in DB if >10k rows
        if len(df) > 10000:
            df = df.head(10000)
        q = search.lower()
        mask = df.index.astype(str).str.lower().str.contains(q, na=False)
        for c in df.columns:
            mask = mask | df[c].astype(str).str.lower().str.contains(q, na=False)
        df = df[mask]
    if sort_by:
        asc = sort_dir == "asc"
        if sort_by == "date":
            df = df.sort_index(ascending=asc)
        elif sort_by in df.columns:
            df = df.sort_values(by=sort_by, ascending=asc, na_position="last")
        else:
            raise HTTPException(status_code=422, detail=f"sort_by {sort_by} not found")
    total = len(df)
    page = df.iloc[offset : offset + limit]
    rows: list[dict[str, Any]] = []
    for idx, r in page.iterrows():
        rec: dict[str, Any] = {"date": str(idx)}
        for c in df.columns:
            v = r[c]
            if pd.isna(v):
                rec[str(c)] = None
            else:
                try:
                    rec[str(c)] = float(v)  # type: ignore[arg-type]
                except Exception:
                    rec[str(c)] = str(v)
        rows.append(rec)
    return {
        "columns": list(df.columns),
        "rows": rows,
        "total": total,
        "shape": original_shape,
        "filtered_shape": [total, len(df.columns)],
        "offset": offset,
        "limit": limit,
    }

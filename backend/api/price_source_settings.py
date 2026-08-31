from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.database import get_price_source, set_price_source

router = APIRouter(tags=["bt-gui"])


class SetPriceSourceRequest(BaseModel):
    source: str


@router.get("/settings/price-source")
def get_price_source_setting():
    return {"source": get_price_source()}


@router.post("/settings/price-source", status_code=200)
def set_price_source_setting(req: SetPriceSourceRequest):
    if req.source not in ("local", "market"):
        raise HTTPException(status_code=422, detail="source must be 'local' or 'market'")
    cur = set_price_source(req.source)
    return {"source": cur}

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session

from backend.database import TaxProfile as DBTaxProfile
from backend.database import get_db

router = APIRouter(tags=["bt-gui"])

DEFAULT_PROFILES: list[dict] = [
    {"name": "Default", "gain_rate": 26.0, "div_rate": 26.0},
    {"name": "Governativi", "gain_rate": 12.5, "div_rate": 12.5},
    {"name": "USA", "gain_rate": 26.0, "div_rate": 37.0},
]


def ensure_default_profiles(db: Session) -> None:
    if db.query(DBTaxProfile).count() == 0:
        for p in DEFAULT_PROFILES:
            db.add(DBTaxProfile(name=p["name"], gain_rate=p["gain_rate"], div_rate=p["div_rate"]))
        db.commit()


def _out(r: DBTaxProfile) -> dict:
    return {"id": r.id, "name": r.name, "gain_rate": r.gain_rate, "div_rate": r.div_rate}


class TaxProfileIn(BaseModel):
    name: str
    gain_rate: float = 26.0
    div_rate: float = 26.0

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("name required")
        return v

    @field_validator("gain_rate", "div_rate")
    @classmethod
    def validate_rates(cls, v: float) -> float:
        if v < 0 or v > 100:
            raise ValueError(f"rate must be 0..100, got {v}")
        return v


@router.get("/tax-profiles")
def list_tax_profiles(db: Session = Depends(get_db)):  # noqa: B008
    ensure_default_profiles(db)
    return [_out(r) for r in db.query(DBTaxProfile).order_by(DBTaxProfile.id).all()]


@router.post("/tax-profiles", status_code=201)
def create_tax_profile(req: TaxProfileIn, db: Session = Depends(get_db)):  # noqa: B008
    ensure_default_profiles(db)
    if db.query(DBTaxProfile).filter(DBTaxProfile.name == req.name).first():
        raise HTTPException(status_code=422, detail=f"profile '{req.name}' exists")
    row = DBTaxProfile(name=req.name, gain_rate=req.gain_rate, div_rate=req.div_rate)
    db.add(row)
    db.commit()
    db.refresh(row)
    return _out(row)


@router.put("/tax-profiles/{pid}")
def update_tax_profile(pid: int, req: TaxProfileIn, db: Session = Depends(get_db)):  # noqa: B008
    row = db.query(DBTaxProfile).filter(DBTaxProfile.id == pid).first()
    if row is None:
        raise HTTPException(status_code=404, detail="not found")
    dup = db.query(DBTaxProfile).filter(DBTaxProfile.name == req.name, DBTaxProfile.id != pid).first()
    if dup:
        raise HTTPException(status_code=422, detail=f"profile '{req.name}' exists")
    row.name = req.name  # type: ignore[assignment]
    row.gain_rate = req.gain_rate  # type: ignore[assignment]
    row.div_rate = req.div_rate  # type: ignore[assignment]
    db.commit()
    return _out(row)


@router.delete("/tax-profiles/{pid}", status_code=204)
def delete_tax_profile(pid: int, db: Session = Depends(get_db)):  # noqa: B008
    row = db.query(DBTaxProfile).filter(DBTaxProfile.id == pid).first()
    if row is None:
        raise HTTPException(status_code=404, detail="not found")
    # ponytail: nessun FK dai run (snapshot in config_json) — delete sempre sicura
    db.delete(row)
    db.commit()

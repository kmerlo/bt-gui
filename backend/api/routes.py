from __future__ import annotations

from fastapi import APIRouter

from .algos import router as algos_router
from .backtest import router as backtest_router
from .data_sources import router as data_sources_router
from .health import router as health_router
from .indicators import router as indicators_router
from .price_data import router as price_data_router
from .runs import router as runs_router
from .strategies import router as strategies_router

router = APIRouter(prefix="/api/bt", tags=["bt-gui"])
router.include_router(health_router)
router.include_router(algos_router)
router.include_router(strategies_router)
router.include_router(data_sources_router)
router.include_router(price_data_router)
router.include_router(indicators_router)
router.include_router(backtest_router)
router.include_router(runs_router)

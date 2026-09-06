from __future__ import annotations

import asyncio
import atexit
import threading
from concurrent.futures import ThreadPoolExecutor
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    import pandas as pd

    from backend.models.backtest_config import BacktestConfig
    from backend.models.strategy_tree import StrategyTree

executor = ThreadPoolExecutor(max_workers=2)
_progress: dict[int, dict[str, Any]] = {}
_lock = threading.Lock()
# ponytail: simple dict registry; use a proper task manager if concurrent backtests exceed 2 or graceful shutdown becomes a production requirement.
_backtest_tasks: dict[int, asyncio.Task] = {}
_tasks_lock = threading.Lock()


def get_progress(run_id: int) -> dict[str, Any]:
    with _lock:
        return dict(_progress.get(run_id, {"progress": 0, "done": False}))


def _set_progress(run_id: int, data: dict[str, Any]) -> None:
    with _lock:
        _progress[run_id] = data


async def _run_background(
    run_id: int,
    tree: StrategyTree,
    cfg: BacktestConfig,
    price_df: pd.DataFrame,
    additional: dict,
    volume,
    volatility,
    indicators: dict[str, pd.DataFrame] | None = None,
):  # type: ignore[no-untyped-def]
    # ponytail: lazy import — backtest_runner imports this module at top level for _set_progress
    from backend.services.backtest_runner import run_backtest_sync

    loop = asyncio.get_running_loop()
    await loop.run_in_executor(executor, run_backtest_sync, run_id, tree, cfg, price_df, additional, volume, volatility, indicators)


def schedule_backtest(
    run_id: int,
    tree: StrategyTree,
    cfg: BacktestConfig,
    price_df: pd.DataFrame,
    additional: dict,
    volume,
    volatility,
    indicators: dict[str, pd.DataFrame] | None = None,
):  # type: ignore[no-untyped-def]
    _set_progress(run_id, {"progress": 0.05, "done": False})
    try:
        loop = asyncio.get_running_loop()
        task = loop.create_task(_run_background(run_id, tree, cfg, price_df, additional, volume, volatility, indicators))
        with _tasks_lock:
            _backtest_tasks[run_id] = task
        def _clean_up(t: asyncio.Task) -> None:
            with _tasks_lock:
                _backtest_tasks.pop(run_id, None)
        task.add_done_callback(_clean_up)
    except RuntimeError:
        # ponytail: lazy import — see _run_background
        from backend.services.backtest_runner import run_backtest_sync

        def _bg():
            run_backtest_sync(run_id, tree, cfg, price_df, additional, volume, volatility, indicators)

        executor.submit(_bg)


def _shutdown_backtests() -> None:
    with _tasks_lock:
        for task in list(_backtest_tasks.values()):
            if not task.done():
                task.cancel()
        _backtest_tasks.clear()


atexit.register(_shutdown_backtests)


def pending_backtest_count() -> int:
    with _tasks_lock:
        return sum(1 for t in _backtest_tasks.values() if not t.done())

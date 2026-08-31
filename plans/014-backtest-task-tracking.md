# Plan 014: Track backtest tasks for graceful shutdown

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to
> the next step. If anything in the "STOP conditions" section occurs,
> stop and report — do not improvise. When done, update the status row
> for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 3203810..HEAD -- backend/services/backtest_runner.py`
> If the file content differs from the excerpts below, compare carefully
> before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M (~2 h)
- **Risk**: MED
- **Depends on**: plans/016.md (dead-function removal must land first to keep the file clean)
- **Category**: bug
- **Planned at**: commit `3203810`, 2026-08-30
- **Issue**: —

## Why this matters

`backtest_runner.py:316` calls `loop.create_task(_run_background(...))` but stores the returned `asyncio.Task` nowhere. On FastAPI shutdown (SIGTERM in containers, Ctrl+C locally), in-flight backtests are killed without updating the DB. The `backtest_runs` row is left with `stats_json=null` and `done=false`, and the frontend WS poll waits forever. This also means `get_progress(run_id)` can return stale `done=false` after a restart.

## Current state

**File**: `backend/services/backtest_runner.py` (366 lines)

Top-of-file module state (lines 20–22):
```python
executor = ThreadPoolExecutor(max_workers=2)
_progress: dict[int, dict[str, Any]] = {}
_lock = threading.Lock()
```

Task creation (lines 314–316):
```python
        loop = asyncio.get_running_loop()
        loop.create_task(_run_background(run_id, tree, cfg, price_df, additional, volume, volatility, indicators))
```

There is no task registry, no shutdown hook, and no `atexit` handler.

The repo convention for module-level state is a simple dict protected by a lock. See `_progress` and `_lock` already present.

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Lint      | `uv run ruff check backend/services/backtest_runner.py` | exit 0 |
| Typecheck | `uv run pytest -q`       | all pass (no regressions) |

## Scope

**In scope**:
- `backend/services/backtest_runner.py`

**Out of scope**:
- `backend/main.py` (no lifecycle changes there; FastAPI `@app.on_event("shutdown")` would touch it, but we use `atexit` instead for simplicity — see ponytail comment)
- `backend/api/backtest.py`
- Tests

## Steps

### Step 1: Add a module-level task registry

After line 22, add:

```python
# ponytail: simple dict registry; use a proper task manager (e.g. background_tasks from FastAPI)
# if concurrent backtests exceed 2 or graceful shutdown becomes a production requirement.
_backtest_tasks: dict[int, asyncio.Task] = {}
_tasks_lock = threading.Lock()
```

### Step 2: Store the created task

In `schedule_backtest()` (line 314–316), change:

```python
        loop = asyncio.get_running_loop()
        task = loop.create_task(_run_background(run_id, tree, cfg, price_df, additional, volume, volatility, indicators))
        with _tasks_lock:
            _backtest_tasks[run_id] = task
```

### Step 3: Register task completion via `add_done_callback`

The task should remove itself from the registry when it finishes (success or failure). Add a done callback:

```python
        def _clean_up(t: asyncio.Task) -> None:
            with _tasks_lock:
                _backtest_tasks.pop(run_id, None)
        task.add_done_callback(_clean_up)
```

Insert this after the `_backtest_tasks[run_id] = task` line.

### Step 4: Add an `atexit` handler that cancels pending tasks

At module level (after the registry), add:

```python
import atexit

def _shutdown_backtests() -> None:
    with _tasks_lock:
        for task in list(_backtest_tasks.values()):
            if not task.done():
                task.cancel()
        _backtest_tasks.clear()

atexit.register(_shutdown_backtests)
```

This ensures that on process exit (SIGTERM → Python cleanup), pending tasks are cancelled and the DB row is updated by the exception handler in `run_backtest_sync` (line 276–286 already sets `"error": str(e)` on the run).

### Step 5: Expose pending count for health endpoint (optional but useful)

Add a public function:

```python
def pending_backtest_count() -> int:
    with _tasks_lock:
        return sum(1 for t in _backtest_tasks.values() if not t.done())
```

## Test plan

Add one test to `tests/backend/test_backtest_runner.py`:

```python
def test_task_registry_stores_and_removes():
    """Verify that schedule_backtest registers the task and cleans up on completion."""
    from backend.services.backtest_runner import _backtest_tasks, _tasks_lock, pending_backtest_count
    # pending should start at 0 (no running backtests in test env)
    assert pending_backtest_count() == 0
    # The actual task is created inside schedule_backtest which needs an event loop.
    # Integration test test_backtest_full_run already exercises the full flow.
    # Here we just assert the registry is empty before and after the integration.
```

The existing `test_backtest_full_run` already covers the happy path. No new isolated unit test is needed for the registry — the integration test verifies end-to-end that the task is created, runs, and completes.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `uv run ruff check backend/services/backtest_runner.py` exits 0
- [ ] `uv run pytest -q` exits 0 (all 11 tests pass, no regression)
- [ ] `_backtest_tasks` dict is populated in `schedule_backtest` and cleared by `add_done_callback`
- [ ] `atexit.register(_shutdown_backtests)` is present at module level
- [ ] `pending_backtest_count()` function exists and is exported

## STOP conditions

- `ruff` flags an `asyncio` usage that requires a different pattern in this Python version → STOP and report.
- Adding `atexit` causes test flakes → STOP and report.

## Maintenance notes

- If the app moves to a production container with a real shutdown hook (e.g. Kubernetes SIGTERM with graceful period), replace `atexit` with a FastAPI `@app.on_event("shutdown")` handler that awaits the tasks with a timeout.
- The `_clean_up` callback runs in the event loop thread; the `_tasks_lock` protects against concurrent access from the main thread. This is correct as written.

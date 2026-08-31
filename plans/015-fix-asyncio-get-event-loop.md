# Plan 015: Fix deprecated asyncio.get_event_loop()

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
- **Effort**: S (5 min)
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `3203810`, 2026-08-30
- **Issue**: —

## Why this matters

`backtest_runner.py:299` calls `asyncio.get_event_loop()`. In Python 3.10+, this is deprecated and can return a stale loop if one exists from a prior async context, causing `run_in_executor` to schedule on the wrong loop. Line 315 already uses the correct `asyncio.get_running_loop()`. The fix is one character change.

## Current state

**File**: `backend/services/backtest_runner.py`, lines 297–300:

```python
):  # type: ignore[no-untyped-def]
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(executor, run_backtest_sync, run_id, tree, cfg, price_df, additional, volume, volatility, indicators)
```

Line 315 already has the correct pattern:
```python
        loop = asyncio.get_running_loop()
```

## Commands you will need

| Purpose   | Command                              | Expected on success |
|-----------|--------------------------------------|---------------------|
| Lint      | `uv run ruff check backend/services/backtest_runner.py` | exit 0 |
| Tests     | `uv run pytest -q`                   | all pass            |

## Scope

**In scope**:
- `backend/services/backtest_runner.py` only (line 299)

**Out of scope**:
- Any other file
- No test changes needed (existing tests cover the path)

## Steps

### Step 1: Replace `get_event_loop` with `get_running_loop`

Change line 299 from:
```python
    loop = asyncio.get_event_loop()
```
to:
```python
    loop = asyncio.get_running_loop()
```

## Test plan

No new tests. Run existing suite:
```bash
uv run pytest -q
```
All 11 tests must pass.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -n "get_event_loop" backend/services/backtest_runner.py` returns no matches
- [ ] `grep -n "get_running_loop" backend/services/backtest_runner.py` returns 2 matches (lines 299 and 315)
- [ ] `uv run ruff check backend/services/backtest_runner.py` exits 0
- [ ] `uv run pytest -q` exits 0

## STOP conditions

- `ruff` flags a new issue introduced by this change → STOP and report (unlikely).

## Maintenance notes

- `get_running_loop()` raises `RuntimeError` if called outside an async context. `_run_background` is always called from within an async function (`schedule_backtest` → `loop.create_task`), so this is safe.
- If `_run_background` is ever called directly (not via `schedule_backtest`), the call site must be in an async context.

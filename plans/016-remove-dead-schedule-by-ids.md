# Plan 016: Remove dead schedule_backtest_by_ids function

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

- **Priority**: P2
- **Effort**: S (10 min)
- **Risk**: LOW
- **Depends on**: none
- **Category**: tech-debt
- **Planned at**: commit `3203810`, 2026-08-30
- **Issue**: —

## Why this matters

`schedule_backtest_by_ids` (lines 326–366) is a 41-line function that duplicates the data-loading logic already present in `backend/api/backtest.py:82–106`. It is never called from anywhere in the codebase. Keeping it increases the size of `backtest_runner.py` (already 366 lines, exceeding the 300-line practical threshold from GUIDE-CODING_PRACTICES.md) and gives a false sense of coverage for the ID-based loading path.

## Current state

**File**: `backend/services/backtest_runner.py`, lines 325–366:

```python
# fallback for callers that only have ids (legacy path)
def schedule_backtest_by_ids(run_id: int, tree: StrategyTree, cfg: BacktestConfig, price_source_id: int, extra_ids: dict[str, int], indicator_ids: list[int] | None = None):  # type: ignore[no-untyped-def]

    db = SessionLocal()
    try:
        prow = db.query(DBSource).filter(DBSource.id == price_source_id).first()
        if prow is None or prow.parquet_blob is None:
            raise ValueError("price source not found")
        price_df = pd.read_parquet(io.BytesIO(prow.parquet_blob))
        price_df.index = pd.to_datetime(price_df.index)
        additional: dict[str, pd.DataFrame] = {}
        volume = None
        volatility = None
        if extra_ids:
            extra_vals = list(extra_ids.values())
            extra_map = {r.id: r for r in db.query(DBSource).filter(DBSource.id.in_(extra_vals)).all()} if extra_vals else {}
            for k, vid in extra_ids.items():
                row = extra_map.get(vid)
                if row is None or row.parquet_blob is None:
                    continue
                df = pd.read_parquet(io.BytesIO(row.parquet_blob))
                df.index = pd.to_datetime(df.index)
                if k in ("volume", "volatility"):
                    if k == "volume":
                        volume = df
                    else:
                        volatility = df
                else:
                    additional[k] = df
        indicators: dict[str, pd.DataFrame] = {}
        if indicator_ids:
            ind_map = {r.id: r for r in db.query(DBSource).filter(DBSource.id.in_(indicator_ids)).all()} if indicator_ids else {}
            for ind_id in indicator_ids:
                ind_row = ind_map.get(ind_id)
                if ind_row is None or ind_row.parquet_blob is None:
                    continue
                ind_df = pd.read_parquet(io.BytesIO(ind_row.parquet_blob))
                ind_df.index = pd.to_datetime(ind_df.index)
                indicators[str(ind_id)] = ind_df
    finally:
        db.close()
    schedule_backtest(run_id, tree, cfg, price_df, additional, volume, volatility, indicators)
```

Grep confirms zero callers:
```
grep -rn "schedule_backtest_by_ids" backend/ frontend/
# only returns: backend/services/backtest_runner.py:326:def schedule_backtest_by_ids(...)
```

## Commands you will need

| Purpose   | Command                              | Expected on success |
|-----------|--------------------------------------|---------------------|
| Grep      | `grep -rn "schedule_backtest_by_ids" backend/ frontend/` | 0 matches (definition only) |
| Lint      | `uv run ruff check backend/services/backtest_runner.py` | exit 0 |
| Tests     | `uv run pytest -q`                   | all pass            |

## Scope

**In scope**:
- `backend/services/backtest_runner.py` — delete lines 325–366 (the function and its comment)

**Out of scope**:
- Any other file
- No test changes

## Steps

### Step 1: Delete the dead function

Remove lines 325–366 from `backend/services/backtest_runner.py` (the comment `# fallback for callers...` through the closing of `schedule_backtest_by_ids`). The file should end at line 324 with the closing of `schedule_backtest`.

### Step 2: Verify no import breakage

Run ruff to confirm no unused-import or undefined-name errors.

## Test plan

Run the existing test suite — no new tests needed.

```bash
uv run pytest -q
```

Expected: all 11 tests pass.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -rn "schedule_backtest_by_ids" backend/ frontend/` returns no matches
- [ ] `wc -l backend/services/backtest_runner.py` reports ≤ 325 lines (was 366)
- [ ] `uv run ruff check backend/services/backtest_runner.py` exits 0
- [ ] `uv run pytest -q` exits 0

## STOP conditions

- grep returns a caller other than the definition line → STOP and report. Do not delete.

## Maintenance notes

- If ID-based scheduling is needed in the future, add it back via a shared private helper `_load_sources_as_dfs(db, ...)` called from both `backtest.py` and the new function, rather than duplicating the loading logic.

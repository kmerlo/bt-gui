# Plan 019: Add pagination to list_runs

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to
> the next step. If anything in the "STOP conditions" section occurs,
> stop and report — do not improvise. When done, update the status row
> for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 3203810..HEAD -- backend/api/runs.py frontend/src/api/runs.ts frontend/src/hooks/useRunsTable.ts`
> If the file content differs from the excerpts below, compare carefully
> before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S (~45 min)
- **Risk**: LOW
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `3203810`, 2026-08-30
- **Issue**: —

## Why this matters

`list_runs` in `runs.py:35-38` calls `.all()` with no LIMIT, loading every backtest run into memory. As runs accumulate, the response grows unbounded. The FE `useRunsTable` hook already supports pagination parameters (`limit`, `offset`) — they just aren't wired through to the backend. The existing `price_data.py` endpoint already has a pagination pattern to follow.

## Current state

**`backend/api/runs.py:17-38`**:
```python
@router.get("/runs")
def list_runs(
    search: str | None = Query(None),
    sort_by: str | None = Query(None),
    sort_dir: str = Query("asc", pattern="^(asc|desc)$"),
    ...
    db: Session = Depends(get_db),
):
    rows = db.query(DBRun).order_by(DBRun.id.desc()).all()
    from backend.database import Strategy as DBStrategy
    strat_rows = db.query(DBStrategy).all()
```

**`frontend/src/api/runs.ts:7-24`** — the `listRuns` function already accepts filter params but has no `limit`/`offset`:
```ts
  listRuns: (opts?: { search?: string; sort_by?: string; ... }) => {
```

**`frontend/src/hooks/useRunsTable.ts`** — already has `limit`/`offset` state (check before writing; if not, add it).

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Lint      | `uv run ruff check backend/api/runs.py` | exit 0 |
| Tests     | `uv run pytest -q`       | all pass            |
| Build     | `cd frontend && npm run build` | exit 0 |

## Scope

**In scope**:
- `backend/api/runs.py`
- `frontend/src/api/runs.ts`
- `frontend/src/hooks/useRunsTable.ts` (if it exists and needs limit/offset wiring)

**Out of scope**:
- `frontend/src/bt/components/RunsTable.tsx` (UI already renders the list; pagination controls are a future enhancement — out of scope for this plan)
- Any other API endpoint

## Steps

### Step 1: Add limit/offset query params to the BE endpoint

In `backend/api/runs.py`, add two new query parameters to `list_runs`:

```python
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
```

Change the query from `.all()` to paginated:
```python
    rows = (
        db.query(DBRun)
        .order_by(DBRun.id.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    total = db.query(DBRun).count()
```

Return a dict instead of a flat list:
```python
    return {"data": out, "total": total, "limit": limit, "offset": offset}
```

Where `out` is the existing list-building logic (lines 55–96). Keep `out` as-is; just wrap it.

### Step 2: Update the FE API client

In `frontend/src/api/runs.ts`, update `listRuns` to accept and pass `limit` and `offset`:

```ts
  listRuns: (opts?: {
    search?: string
    sort_by?: string
    sort_dir?: string
    filter_id?: string
    filter_strategy_id?: string
    filter_strategy_name?: string
    filter_created_at?: string
    filter_start?: string
    filter_end?: string
    filter_total_return?: string
    filter_max_drawdown?: string
    filter_sharpe?: string
    filter_sortino?: string
    filter_stats?: string
    limit?: number
    offset?: number
  }) => {
```

Add `limit` and `offset` to the query string construction (after the existing filters).

Update the return type:
```ts
  export type RunsListResponse = {
    data: RunRow[]
    total: number
    limit: number
    offset: number
  }
```

And change the return of `listRuns`:
```ts
    return request<RunsListResponse>(`/api/bt/runs${qs}`)
```

### Step 3: Update the consumer hook

Read `frontend/src/hooks/useRunsTable.ts`. If it already destructures the response as a list (e.g. `const { data } = await ...`), update it to handle the new shape. If it doesn't exist or already handles the dict shape, verify it works.

The key change: wherever the hook assigns the response to state, change from:
```ts
setRuns(resp)
```
to:
```ts
setRuns(resp.data ?? [])
```

### Step 4: Keep backward compatibility in the FE

The `RunsTable` component and any other consumers expect an array. The hook is the single place that unpacks `data`. Ensure no other component calls `backtestApi.listRuns` directly.

## Test plan

Add to `tests/backend/test_backtest_runner.py` (or create a small addition in `test_routes_smoke.py`):

```python
def test_list_runs_pagination():
    r = client.get("/api/bt/runs?limit=2&offset=0")
    assert r.status_code == 200
    j = r.json()
    assert "data" in j
    assert "total" in j
    assert "limit" in j
    assert isinstance(j["data"], list)
    assert len(j["data"]) <= 2
```

Run existing suite to confirm no regression.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `uv run ruff check backend/api/runs.py` exits 0
- [ ] `uv run pytest -q` exits 0
- [ ] `cd frontend && npm run build` exits 0
- [ ] `grep -n "limit.*Query\|offset.*Query" backend/api/runs.py` returns ≥ 2 matches
- [ ] `grep -n "RunsListResponse\|listRuns.*limit\|listRuns.*offset" frontend/src/api/runs.ts` returns matches
- [ ] No component directly accesses `resp` as a list from `listRuns` (grep for `listRuns` callers)

## STOP conditions

- `useRunsTable.ts` does not exist → STOP and report. Verify the hook exists before starting.
- The `RunsTable` component calls `listRuns` directly (not through the hook) → STOP and report. Check all callers before changing the API shape.

## Maintenance notes

- The `total` count query is a separate SQL query. For very large tables this could be optimized with a window function, but for now the two-query pattern is acceptable (SQLite handles it fine).
- The max `limit=200` cap prevents accidental large payloads.

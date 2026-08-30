# Plan 008: Split frontend api barrel + deduplicate search/sort helpers

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `advisor-plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat c83f4bf..HEAD -- frontend/src/api/bt.ts backend/api/strategies.py backend/api/data_sources.py backend/api/runs.py backend/api/price_data.py frontend/package.json`
> If files changed, compare "Current state" excerpts before proceeding.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: 002, 007
- **Category**: tech-debt
- **Planned at**: commit `c83f4bf`, 2026-08-30

## Why this matters

`frontend/src/api/bt.ts` is a 232-line junk drawer with 7 responsibilities (`btApi`, `strategiesApi`, `algosApi`, `dataApi`, `priceDataApi`, `backtestApi`, `dbApi` + `BtSettings` + `formatCreatedAt`). GUIDE-CODING_PRACTICES.md §1 says 300 soft / 500 hard lines and one-file-one-responsibility; every view imports the monolith so fan-in is maximal. Backend repeats the same `q in str(v).lower()` search + `sort_by` allowlist in 4 endpoints (`strategies.py:42`, `data_sources.py:86`, `runs.py:112`, `price_data.py:83`) and frontend mirrors it in `DataManager.tsx:124` — a fix in one drifts from the others (runs.py already diverged to single-pass in 006).

## Current state

- `frontend/src/api/bt.ts:1-232`:
  ```ts
  export const strategiesApi = { list, get, create, update, delete, bulkDelete }
  export const algosApi = { list, schema }
  export const dataApi = { list, upload, fetchFfn, preview, table, ... }
  export const priceDataApi = { list, fetch, getRows, delete }
  export const backtestApi = { create, listRuns, getRun, ... }
  export const dbApi = { info, switch }
  export function formatCreatedAt(iso: string) { ... } // line 217
  export type BtSettings = { ... } // line 28
  ```
  Size 232 lines, 7 domains, imported by 10+ components. Fan-in high.

- Backend lists do identical inline search/sort:
  `backend/api/strategies.py:42-54`, `backend/api/data_sources.py:86-101`, `backend/api/runs.py:96-145` (now single-pass after 006), `backend/api/price_data.py:83`
  ```python
  if search:
      q = search.lower()
      out = [r for r in out if q in str(r["name"]).lower() or ...]
  if sort_by:
      allowed = {"id", "name", ...}
      out.sort(key=lambda r: str(r[sort_by]).lower(), reverse=rev)
  ```
  Frontend `frontend/src/bt/components/DataManager.tsx:124` and `DataDetailView.tsx:71` duplicate same.

- `frontend/package.json:20` declares both `chart.js ^4.5.1` (unused, `grep -r "chart.js" frontend/src` 0) and `lightweight-charts ^5` (used). SPEC notes heatmap optional.

- Conventions: `GUIDE §1` 300-line soft limit; `frontend/src/api/bt.ts` barrel pattern to be preserved for compat; `hooks/` vs `components/` split (plan 004).

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Lint | `uv run ruff check .` | exit 0 |
| FE build | `npm run build --prefix frontend` | exit 0 |
| Tests | `uv run pytest -q` | all pass |

## Scope

**In scope**:
- `frontend/src/api/bt.ts` → split into `frontend/src/api/{strategies,algos,data,price,runs,settings,format}.ts` + keep barrel re-export
- `frontend/src/utils/listQuery.ts` (create) — `applySearch`, `applySort` for client lists
- `backend/api/_query.py` (create) — `apply_search(out,q,fields)`, `apply_sort(out,sort_by,sort_dir,allowed)`
- `backend/api/strategies.py`, `data_sources.py`, `runs.py`, `price_data.py` — replace inline blocks with helper calls
- `frontend/src/bt/components/DataManager.tsx`, `DataDetailView.tsx` — use new util
- `frontend/package.json` — remove `chart.js`

**Out of scope**:
- `frontend/src/types/bt.ts` (generated)
- Any API shape change (response envelope stays identical)
- Heatmap feature (deferred)

## Git workflow

- Branch: `advisor/008-api-split-query-helpers`
- Commit: `refactor(api): split bt.ts barrel and deduplicate search/sort helpers`
- Do NOT push unless instructed.

## Steps

### Step 1: Create backend query helpers

Create `backend/api/_query.py`:

```python
from __future__ import annotations
from fastapi import HTTPException


def apply_search(out: list[dict], q: str, fields: list[str]) -> list[dict]:
    ql = q.lower()
    return [r for r in out if any(ql in str(r.get(f) or "").lower() for f in fields)]


def apply_sort(out: list[dict], sort_by: str | None, sort_dir: str, allowed: set[str]) -> None:
    if not sort_by:
        return
    if sort_by not in allowed:
        raise HTTPException(status_code=422, detail=f"sort_by {sort_by} not allowed (use {sorted(allowed)})")
    rev = sort_dir == "desc"
    # numeric keys handled by caller via _ key if needed
    out.sort(key=lambda r: (r[sort_by] is None, str(r[sort_by]).lower() if r[sort_by] is not None else ""), reverse=rev)
```

**Verify**: `uv run ruff check .` → 0

### Step 2: Replace inline search/sort in 4 endpoints

In each of `strategies.py:42-54`, `data_sources.py:86-101`, `price_data.py:83`, `runs.py:146-155`:

- `from backend.api._query import apply_search, apply_sort`
- Replace:
  ```python
  if search:
      out = apply_search(out, search, ["name", "type", "source", ...])
  apply_sort(out, sort_by, sort_dir, allowed)
  ```
  For `runs.py` keep single-pass search optimization from 006 but delegate field list to helper (or keep helper inside single pass). Keep numeric sort special-case for `runs.py` (`_NUMERIC_SORT_KEYS`).

**Verify**: `uv run pytest -q` → pass

### Step 3: Split frontend barrel

Extract per-domain modules (each <80 lines):

- `frontend/src/api/strategies.ts`, `algos.ts`, `data.ts`, `price.ts`, `runs.ts`, `settings.ts`
- Move `formatCreatedAt` to `frontend/src/utils/format.ts`
- Move `BtSettings` + `loadSettings/saveSettings` to `frontend/src/api/settings.ts`
- Update `frontend/src/api/bt.ts` to:
  ```ts
  export * from './strategies'
  export * from './algos'
  // ... keep request<T> here
  ```
  So existing `import { strategiesApi } from '@/api/bt'` keeps working (barrel).

Update call sites: `frontend/src/bt/components/DataManager.tsx`, `StrategiesView.tsx`, etc. to keep importing from `bt.ts` (no churn) OR switch to domain import — either is fine but prefer barrel for now.

**Verify**: `npm run build --prefix frontend` → 0

### Step 4: Create frontend listQuery util and deduplicate

Create `frontend/src/utils/listQuery.ts`:

```ts
export function applySearch<T>(rows: T[], q: string, fields: (keyof T)[]): T[] { ... }
export function applySort<T>(rows: T[], sortBy: string, sortDir: 'asc'|'desc'): T[] { ... }
```

Replace `DataManager.tsx:124` and `DataDetailView.tsx:71` inline `q_low in str(v).lower()` loops with `applySearch`.

**Verify**: `npm run build --prefix frontend` → 0

### Step 5: Remove dead chart.js

`frontend/package.json:20` — `npm uninstall chart.js` (or edit file + `npm install`). Verify no `import from 'chart.js'` remains via `grep -r "chart.js" frontend/src` → 0.

**Verify**: `npm run build --prefix frontend` → 0; bundle size down ~70KB gzip

## Test plan

- No new BE behavior to test beyond existing list endpoints: `uv run pytest -q` covers `strategies.py` and `data_sources.py` list with `search` param.
- Add one unit test `tests/backend/test_query_helpers.py` for `apply_search/apply_sort` happy path + 422 on bad sort.
- FE: no harness yet (see plan 009), manual `npm run build` gate suffices; helpers are trivial and covered by visual regression in DataManager.

## Done criteria

- [ ] `wc -l frontend/src/api/bt.ts` < 60 (barrel only); each `frontend/src/api/*.ts` < 100 lines
- [ ] `wc -l backend/api/_query.py` exists and is used by 4 endpoints (`grep -rn "apply_search\|apply_sort" backend/api` ≥4)
- [ ] `grep -rn "chart.js" frontend/package.json` → 0
- [ ] `grep -rn "q in str(r\[" backend/api` → 0 (replaced by helper)
- [ ] `uv run ruff check .` → 0
- [ ] `npm run build --prefix frontend` → 0
- [ ] `uv run pytest -q` → pass
- [ ] `advisor-plans/README.md` row 008 → DONE

## STOP conditions

- Splitting `bt.ts` breaks `openapi-typescript` generated import path or `wsProgress` helper coupling — STOP, keep barrel and extract only one domain as proof.
- Helper `apply_sort` cannot handle numeric `_` keys in `runs.py` without diverging signature — STOP, keep runs.py special-case, note in comment.
- Removing `chart.js` breaks `plans/SPEC.md:360` optional heatmap reference — STOP, leave dep but add `// ponytail: chart.js only for future heatmap` comment instead.

## Maintenance notes

- Future list endpoints must use `_query.py` helpers; add to `GUIDE-CODING_PRACTICES.md` checklist item 4.
- When frontend test harness lands (plan 009), add `utils/listQuery.test.ts` coverage.
- If heatmap is ever built, re-add `chart.js` behind `React.lazy` import, not eager barrel.

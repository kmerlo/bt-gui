# Plan 006: Table perf + health fix + tooling hygiene

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `advisor-plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 8f78919..HEAD -- backend/api/routes.py .gitignore tests/backend/test_data_loader.py frontend/src/types/bt.ts`
> If files changed, compare "Current state" excerpts before proceeding.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: 002 (health fix lives in the new `health.py`; if 002 not done, patch `routes.py` directly)
- **Category**: perf + dx
- **Planned at**: commit `8f78919`, 2026-08-30

## Why this matters

Three small but concrete costs: (1) data-source table does full `astype(str).contains` scan per column on the entire `parquet_blob` DataFrame (`routes.py:455-458`) without DB pagination — slow on 10k rows. (2) `__import__("sqlalchemy")` hides the import. (3) Missing `.env` in `.gitignore` risks secret leak, and `tests/backend/test_data_loader.py:92` has an unused import that breaks `ruff`. The `frontend/src/types/bt.ts` drift is unchecked.

## Current state

- `backend/api/routes.py:455-458` (or after 002: `backend/api/data_sources.py` table endpoint):
  ```python
  if search:
      q = search.lower()
      mask = df.index.astype(str).str.lower().str.contains(q, na=False)
      for c in df.columns:
          mask = mask | df[c].astype(str).str.lower().str.contains(q, na=False)
      df = df[mask]
  ```
  plus `runs` global search `str(r["stats"]).lower()` per run (line 841-887).
- `backend/api/routes.py:85`: `db.execute(__import__("sqlalchemy").text("SELECT 1"))`
- `.gitignore` (read — no `.env` entry seen)
- `tests/backend/test_data_loader.py:92`: `import backend.services.data_loader as dl` unused → `ruff F401`
- `frontend/src/types/bt.ts:1` comment `AUTO-GENERATO — non editare a mano` but no CI gate.
- `frontend/src/bt/components/DataManager.tsx:253` and `StrategiesView.tsx:262` duplicate filter pattern (handled in plan 004's `useRunsTable`; this plan just fixes the BE perf variant).

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Lint | `uv run ruff check .` | exit 0 |
| Tests | `uv run pytest -q` | all pass |
| FE build | `npm run build --prefix frontend` | exit 0 |
| Types gate | `npm run gen:types --prefix frontend` (requires BE `:8001`) | generates `src/types/bt.ts` |

## Scope

**In scope**:

- `backend/api/_helpers.py` or `backend/api/data_sources.py` / `runs.py` (perf fix)
- `backend/api/health.py` (or `routes.py` if 002 not done) — fix `__import__`
- `.gitignore`
- `tests/backend/test_data_loader.py`
- `frontend/package.json` (add `typecheck` script if needed) or CI doc

**Out of scope**:

- `frontend/src/bt/components/*` heavy splits (plans 003-005).
- `backend/services/*` (no).

## Git workflow

- Branch: `advisor/006-table-perf-tooling`
- Commit: `fix(perf,dx): table search, health import, gitignore and ruff`
- Do NOT push unless instructed.

## Steps

### Step 1: Fix `__import__` and ruff error

- In `backend/api/health.py` (or `routes.py:85`): replace `__import__("sqlalchemy").text` with `from sqlalchemy import text` at top and `db.execute(text("SELECT 1"))`.
- In `tests/backend/test_data_loader.py:92`: delete `import backend.services.data_loader as dl` (or use it: `assert dl.load_csv is not None` if you prefer to keep import).

**Verify**: `uv run ruff check .` → 0

### Step 2: Perf — limit table search work

In `backend/api/data_sources.py` (table endpoint) and `backend/api/runs.py` (list_runs):

- DataSources: compute `q = search.lower()` once, build mask with vectorized `df.index.astype(str)` only once, and for columns do `df[c].astype(str, errors="ignore")` but short-circuit: if `len(df) > 500` and no pagination, add `limit/offset` before search or warn. Minimal fix: keep logic but move `str.lower()` outside loop (already) and add `df = df.head(10000)` cap before search to avoid OOM. Document `# ponytail: full scan on blob — paginate in DB if >10k rows`.
- Runs: replace `q in str(r["stats"]).lower()` with `q in (r["stats"].__repr__().lower() if r["stats"] else "")` is same cost — instead, compute `stats_str = str(r["stats"]).lower()` once per run outside filter loop (already per filter). Consolidate multiple `if search`/`if filter_*` passes into a single loop over `out` to avoid 8 passes over the list.

No schema change; just fewer passes.

**Verify**: `uv run pytest -q` → pass; manual `curl /api/bt/data-sources/1/table?search=aapl` still works.

### Step 3: Tooling hygiene

- Append to `.gitignore`:
  ```
  .env
  .env.*
  *.db-journal
  ```
- In `frontend/package.json`: ensure `gen:types` exists (it does: `openapi-typescript http://localhost:8001/openapi.json -o src/types/bt.ts`) and add to `my-docs/GUIDE_documentazione_tecnica.md` a one-liner that CI should run `npm run gen:types && git diff --exit-code src/types/bt.ts`.

**Verify**: `git check-ignore -v .env` → shows `.gitignore` line; `uv run ruff check .` → 0

## Test plan

- `uv run pytest -q` — existing tests cover data_loader and runs; no new tests needed for this perf cut.
- `uv run ruff check .` — must be 0 after step 1.
- `npm run build --prefix frontend` — 0.

## Done criteria

- [ ] `grep -rn '__import__' backend` → 0
- [ ] `uv run ruff check .` → 0 (was 1 error, now 0)
- [ ] `.gitignore` contains `.env`
- [ ] `advisor-plans/README.md` row 006 → DONE

## STOP conditions

- 002 not done and `health.py` doesn't exist — apply health fix in `routes.py` instead, don't create `health.py` alone.
- Perf fix would change API shape (e.g. adding pagination params) — STOP, keep shape identical, just optimize loop.
- `npm run gen:types` fails (BE not running) — skip that verification, note in README.

## Maintenance notes

- If DataSource tables grow >10k rows, move storage to DB columns instead of `parquet_blob` scan — this perf fix is a ceiling.
- Keep `ruff` green on every commit; the `F401` in tests was a drift indicator.

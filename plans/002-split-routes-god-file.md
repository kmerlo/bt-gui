# Plan 002: Split backend/api/routes.py god-file (1025 lines) into modules

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 8f78919..HEAD -- backend/api/routes.py backend/main.py`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: 001 (so the new modules don't copy the old `eval` path; if 001 is not done, copy the hardened parser anyway)
- **Category**: tech-debt
- **Planned at**: commit `8f78919`, 2026-08-30

## Why this matters

`backend/api/routes.py` is 1025 lines, >2× the hard limit 500 (`my-docs/GUIDE-CODING_PRACTICES.md:1`). Every feature touches the same file, causing merge conflicts and hiding the integration contract `APIRouter(prefix="/api/bt")` (`AGENTS.md:2`, `GUIDE 10`). Splitting by domain restores one-file-one-responsibility and makes the `Stocks_App` mount (`plans/005`) safe to review.

## Current state

Facts the executor needs:

- `backend/api/routes.py:24` defines `router = APIRouter(prefix="/api/bt", tags=["bt-gui"])` and then 20+ endpoints in one file:
  - DB switch/health/stats (`/db`, `/db/switch`, `/health`, `/stats`) lines 30-113
  - Algos (`/algos`, `/algos/{name}/schema`) 115-128
  - Strategies CRUD+bubulk (`/strategies*`) 131-227
  - DataSources (`/data-sources/*`) 229-493
  - PriceData (`/price-data*`) 495-578
  - Indicators (`/indicators*`) 580-657
  - Backtest/runs (`/backtest`, `/runs*`, `/runs/{id}/prices`, `/backtest/{id}/progress` WS) 659-1025
  - Helpers `_df_to_blob`, `_blob_to_df`, `_meta` at 232-243, and re-used across sections.
- `backend/main.py:25` does `app.include_router(bt_router)` — the only place the prefix matters. Must stay `from backend.api.routes import router` (or re-export).
- `frontend/src/api/bt.ts` calls these endpoints by literal path — renaming paths would break FE.
- Soglia: `GUIDE 1` 300 soft / 500 hard. Target: no file >300 after split.

Repo conventions to match:

- `backend/services/` one file per service (`AGENTS.md:3`), same idea for `backend/api/` after this plan.
- Keep `APIRouter(prefix="/api/bt")` in exactly one place — the aggregator, not duplicated. Exemplar: current `routes.py:24`.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Lint | `uv run ruff check .` | exit 0 |
| Tests | `uv run pytest -q` | all pass |
| FE build | `npm run build --prefix frontend` | exit 0 |
| OpenAPI sanity | `uv run python -c "from backend.main import app; print([r.path for r in app.routes][:5])"` | shows `/api/bt/...` routes |

## Scope

**In scope**:

- `backend/api/routes.py` (rewrite as aggregator)
- `backend/api/strategies.py` (create)
- `backend/api/data_sources.py` (create)
- `backend/api/price_data.py` (create)
- `backend/api/indicators.py` (create)
- `backend/api/runs.py` (create)
- `backend/api/backtest.py` (create)
- `backend/api/health.py` (create — `/health`, `/stats`, `/db*`)
- `backend/api/__init__.py` (if needed for re-export)
- `backend/api/_helpers.py` (create — `_df_to_blob`, `_blob_to_df`, `_meta`)

**Out of scope**:

- `backend/services/backtest_runner.py` internals (plan 001 owns commission).
- `frontend/*` — no path changes.
- `backend/database.py` — don't change models.

## Git workflow

- Branch: `advisor/002-split-routes`
- Commit per module: `refactor(api): split routes into domain modules` etc.
- Do NOT push unless operator instructs.

## Steps

### Step 1: Create helpers module

Create `backend/api/_helpers.py` extracting the three helpers verbatim from `routes.py:232-243`:

```python
def _df_to_blob(df: pd.DataFrame) -> bytes: ...
def _blob_to_df(blob: bytes) -> pd.DataFrame: ...
def _meta(df: pd.DataFrame) -> dict[str, Any]: ...
```

Keep `io`, `pandas` imports there. No logic change.

**Verify**: `uv run ruff check backend/api/_helpers.py` → 0; `uv run pytest -q` still passes (helpers not yet wired).

### Step 2: Create domain modules — copy-paste, keep `router` local then rename

For each domain file, create a file with `router = APIRouter(prefix="/api/bt", tags=["bt-gui"])` temporarily, paste the relevant endpoints **verbatim** (no refactor yet), and import helpers from `._helpers`. This keeps git diff blame traceable. Domains:

- `health.py` — `/db`, `/db/switch`, `/health`, `/stats` (lines 30-113)
- `strategies.py` — `/strategies*` + bulk-delete models (131-227)
- `data_sources.py` — `/data-sources/*` (229-405, including `DeleteRowsRequest`)
- `price_data.py` — `/price-data*` (495-578)
- `indicators.py` — `/indicators*` (580-657)
- `backtest.py` — `RunRequest` + `POST /backtest` (659-757)
- `runs.py` — `GET /runs`, `POST /runs/bulk-delete`, `DELETE /runs/{id}`, `GET /runs/{id}`, `GET /runs/{id}/prices`, `WS /backtest/{id}/progress` (759-1025)

Each file imports only what it needs (`pandas`, `sqlalchemy`, `fastapi`, `backend.database`, `backend.services.*`). Fix the illegal `__import__("sqlalchemy")` at `routes.py:85` while moving: replace with `from sqlalchemy import text` at top and `db.execute(text("SELECT 1"))`.

**Verify** per file: `uv run ruff check backend/api/<file>.py` → 0

### Step 3: Convert domain `router`s to prefix-less and aggregate

In each domain file, change `router = APIRouter(prefix="/api/bt", ...)` to `router = APIRouter(tags=["bt-gui"])` (drop prefix). Then rewrite `backend/api/routes.py` to be the **only** place with prefix:

```python
from fastapi import APIRouter
from .health import router as health_router
from .strategies import router as strategies_router

# ... etc
router = APIRouter(prefix="/api/bt", tags=["bt-gui"])
router.include_router(health_router)
router.include_router(strategies_router)
# ...
```

Re-export `router` so `backend/main.py:5` (`from backend.api.routes import router as bt_router`) keeps working with zero change.

**Verify**: `uv run python -c "from backend.main import app; assert any('/api/bt/health' in r.path for r in app.routes)"` → no assert.

### Step 4: Lint, tests, build

Run `uv run ruff check .` → 0, `uv run pytest -q` → all pass, `npm run build --prefix frontend` → 0. If any test hits an endpoint that moved, the error will be `404` — check that aggregator included all routers.

**Verify**: `uv run pytest -q` + `npm run build --prefix frontend`

## Test plan

- No new tests required for the move itself — existing `tests/backend/*.py` and manual `TestClient(app).get("/api/bt/health")` must still pass. The move is behavior-preserving.
- Add a smoke test `tests/backend/test_routes_smoke.py` with 3 `TestClient` calls: `GET /api/bt/health` 200, `GET /api/bt/algos` 200, `GET /api/bt/strategies` 200 — model after `tests/test_health.py:9`.

## Done criteria

- [ ] No file under `backend/api/` exceeds 300 lines (`wc -l backend/api/*.py` — each <300, `routes.py` aggregator <80)
- [ ] `backend/api/routes.py` is the only file with `prefix="/api/bt"` (`grep -rn 'prefix="/api/bt"' backend` → 1 match)
- [ ] `__import__("sqlalchemy")` gone (`grep -rn '__import__' backend` → 0)
- [ ] `uv run ruff check .` exits 0
- [ ] `uv run pytest -q` exits 0 (including new smoke test)
- [ ] `npm run build --prefix frontend` exits 0
- [ ] `plans/README.md` row 002 → DONE

## STOP conditions

- Drift: `routes.py` changed since `8f78919` and excerpt mismatches.
- A step would require touching `frontend/src/api/bt.ts` paths — STOP (paths must stay identical).
- Any endpoint returns 404 after aggregation — STOP and check missing `include_router`.

## Maintenance notes

- New endpoints go in the domain file that owns the resource, never in `routes.py`. Reviewer should reject direct additions to `routes.py`.
- If a new domain grows >300, split it again (e.g. `runs/prices.py`).

# Plan 030: Split backtest_runner.py (516 lines, over the 500 hard limit)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 71f31b5..HEAD -- backend/services/backtest_runner.py backend/api/backtest.py tests/backend/test_backtest_runner.py`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/026-fix-sltp-blocked-day-and-flip.md (land behavior
  fixes before restructuring the money path; if 026 is DONE, proceed)
- **Category**: tech-debt
- **Planned at**: commit `71f31b5`, 2026-09-05

## Why this matters

`backend/services/backtest_runner.py` (516 lines) is over the 500-line hard
gate in `my-docs/GUIDE-CODING_PRACTICES.md` §1 and mixes four responsibilities:
price loading (local + market SQL, pivoting, sanitizing), progress registry +
async scheduling, the `run_backtest_sync` money path, and result persistence.
Every price-loading or persistence change risks the scheduling logic and vice
versa. Prior splits (routes, btStore, ResultsDashboard, BuilderView) show the
repo's established extraction pattern.

## Current state

Function inventory of `backend/services/backtest_runner.py` (verified live,
516 lines total):

- Price loading: `_load_prices_from_db` (:38), `_pivot_price_rows` (:53),
  `_sanitize_price_df` (:74), `_load_prices_from_local` (:87),
  `_load_prices_from_market` (:134)
- Shared helpers: `_build_commission` (:212), `_norm_columns` (:220),
  `_collect_security_names` (:230), `_normalize_tree` (:245)
- Money path + persistence: `run_backtest_sync` (:263-458, includes stats
  cleaning, `weights_parquet` write at :440-443, `except` persist at :448-458)
- Scheduling: module `executor = ThreadPoolExecutor(max_workers=2)` (:20),
  `_progress` dict (:21), `_backtest_tasks` (:24), `get_progress` (:28),
  `_set_progress` (:33), `_run_background` (:461), `schedule_backtest` (:475),
  `_shutdown_backtests` (:503), `pending_backtest_count` (:514),
  `atexit.register(_shutdown_backtests)` (:511)
- Importers (keep working — public names must stay importable):
  `backend/api/backtest.py` imports `_load_prices_from_db`,
  `_collect_security_names`, `schedule_backtest` (verify exact import lines
  before moving); `backend/api/runs.py` imports `get_progress`;
  tests import `run_backtest_sync`, `_pivot_price_rows`, `_sanitize_price_df`
  (see `test_tutorial3_sma_parent.py:17,60`).
- Naming precedent from plan 002: `backend/services/` one-service-per-file;
  routers import from services (never the reverse — check for cycles).

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| BE tests | `uv run pytest -q` | all pass |
| BE lint | `uv run ruff check .` | exit 0 |
| Import check | `grep -rn "from backend.services.backtest_runner import\|from backend.services import backtest_runner" backend/ tests/ \| wc -l` | baseline count recorded in step 1, same after |

## Scope

**In scope** (the only files you should modify/create):

- `backend/services/backtest_runner.py` (shrink to orchestration only)
- `backend/services/price_loading.py` (create: price-loading group)
- `backend/services/backtest_progress.py` (create: executor + registry +
  scheduling group)
- `backend/api/backtest.py`, `backend/api/runs.py` (import updates ONLY —
  no logic changes)
- `tests/backend/test_backtest_runner.py` (import updates ONLY)

**Out of scope** (do NOT touch, even though they look related):

- Any behavior change: sanitize/fail-fast semantics, progress payload shape,
  scheduling semantics, error persistence (plan 028 owns the `str(e)` part —
  if 028 already landed, preserve its sanitized form exactly).
- `backend/services/custom_algos.py`, `signal_engine.py`, `benchmark.py`.
- Progress-registry eviction/TTL (CORR-13/PERF-08) and `_backtest_tasks`
  redesign — separate follow-up, not this split.
- `weights_parquet` keep-vs-delete decision (TEST-04) — untouched.

## Git workflow

- Trunk-based per `AGENTS.md` §6: work on `master`, commit per step locally,
  then `git push origin master`. No feature branches.
- Message style: `refactor: <what>` e.g.
  `refactor: extract price_loading and backtest_progress from runner`.

## Steps

### Step 1: Record the import baseline

Run the import-check grep; record the count and the exact importing lines.
Run `uv run pytest -q` → green baseline.

**Verify**: baseline count noted (write it in the commit message of step 4).

### Step 2: Extract price loading → `backend/services/price_loading.py`

Move verbatim (no logic edits): `_load_prices_from_db`, `_pivot_price_rows`,
`_sanitize_price_df`, `_load_prices_from_local`, `_load_prices_from_market`
plus only the imports they need. In `backtest_runner.py`, re-import them
(`from backend.services.price_loading import ...`) so existing importers keep
working during the transition; update `backend/api/backtest.py` and tests to
import from the new module directly.

**Verify**: `uv run pytest -q` → all pass; import-check count unchanged in
meaning (paths updated, no new importers).

### Step 3: Extract scheduling → `backend/services/backtest_progress.py`

Move verbatim: `executor`, `_progress`, `_lock`, `_backtest_tasks`,
`_tasks_lock`, `get_progress`, `_set_progress`, `_run_background`,
`schedule_backtest`, `_shutdown_backtests`, `pending_backtest_count`, the
`atexit.register` line, plus needed imports (`asyncio`, `atexit`,
`threading`, `concurrent.futures`). `backtest_runner.py` imports
`get_progress/_set_progress/schedule_backtest` from the new module; update
`backend/api/runs.py` (`get_progress`) and `backend/api/backtest.py`
(`schedule_backtest`) imports. `_run_background` calls `run_backtest_sync`
— to avoid a service→service cycle, keep `_run_background` + `schedule_backtest`
in `backtest_progress.py` importing `run_backtest_sync` lazily inside the
function (match existing lazy-import style if present) OR keep them in
`backtest_runner.py` — decide by cycle check; document the choice in one line.

**Verify**: `uv run pytest -q` → all pass; `uv run ruff check .` → exit 0.

### Step 4: Verify size gates and finalize

**Verify**: `wc -l backend/services/backtest_runner.py backend/services/price_loading.py backend/services/backtest_progress.py` → EACH file <300 lines
(soft gate); `uv run pytest -q` → all pass; `uv run ruff check .` → exit 0;
live smoke: `uv run uvicorn backend.main:app --port 8001` starts and
`curl http://127.0.0.1:8001/api/bt/health` → `{"status":"ok"}` (then stop it).

## Test plan

- No new tests (pure move). Existing suite is the net — especially
  `test_backtest_runner.py` (sync run, error path, weights parquet),
  `test_tutorial3_sma_parent.py` (imports `_pivot_price_rows`,
  `_sanitize_price_df`), `test_benchmark.py`, `test_data_loader.py`.
- Structural pattern for new modules: neighboring
  `backend/services/price_source.py` (single price-access layer).

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `uv run pytest -q` exits 0
- [ ] `uv run ruff check .` exits 0
- [ ] `wc -l` each of the three files <300 lines
- [ ] `curl /api/bt/health` → `{"status":"ok"}` on a started server
- [ ] No behavior diff: `git diff 71f31b5..HEAD -- backend/services/backtest_runner.py`
  shows only removals + re-imports (spot-check; moved code byte-identical
  modulo imports)
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Plan 026 is not DONE and `run_backtest_sync`/custom_algos interaction code
  changed under you (drift) — reconcile first.
- Moving `_run_background`/`schedule_backtest` creates an import cycle that
  lazy import cannot cleanly solve — report the cycle, keep scheduling in the
  runner, still extract price loading.
- Any test fails after a verbatim move (assumption "pure move is safe" false)
  — report the failing test before attempting behavior fixes.
- The split requires touching routers beyond import lines.

## Maintenance notes

- Future home for progress eviction/TTL: `backtest_progress.py`.
- Future home for SQL-side price aggregation (PERF-04): `price_loading.py`.
- If `price_source.py` vs `price_loading.py` overlap (DEBT-05), consolidate in
  a follow-up — do not merge here.
- Reviewer: diff the moved functions byte-for-byte ignoring imports.

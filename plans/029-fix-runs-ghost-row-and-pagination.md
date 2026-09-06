# Plan 029: Fix runs ghost rows and filter-after-paginate in list_runs

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 71f31b5..HEAD -- backend/api/backtest.py backend/api/runs.py tests/backend/test_backtest_runner.py`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `71f31b5`, 2026-09-05

## Why this matters

Two runs-API bugs corrupt what the user sees: (1) every REJECTED backtest
(unknown tickers, missing prices) leaves an orphan run row with
`stats_json=None` because the row is committed before validation; (2)
`list_runs` applies SQL `offset/limit` first, then filters/sorts in Python on
the fetched page, and returns the UNFILTERED count as `total` — so filtered
views silently skip matches and show a wrong count. The FE `useRunsTable`
consumes `data/total/limit/offset` directly.

## Current state

- `backend/api/backtest.py:58-98` (verified live):
  ```python
  row = DBRun(strategy_id=strategy_id, config_json=cfg_dict, stats_json=None)
  db.add(row)
  db.commit()
  db.refresh(row)
  run_id = row.id
  tickers = [t.upper() for t in req.tickers] if req.tickers else []
  if tickers:
      ... _load_prices_from_db(...)   # may raise -> ghost row stays
  elif req.price_source_id is not None:
      ... 404/422 paths ...           # ghost row stays
  else:
      raise HTTPException(status_code=422, detail="tickers or price_source_id required")
  # then tree-ticker coverage check -> 422 paths, ghost row stays
  ```
  Note line ~53: `cfg_dict["benchmark_ticker"] = normalize_ticker(...)` with
  comment "mai 422 se mancano i dati (fallback a null in lettura)" — keep that
  behavior.
- `backend/api/runs.py:19-47` (verified live): `total = db.query(DBRun).count()`,
  then `.order_by(DBRun.id.desc()).offset(offset).limit(limit).all()`.
- `backend/api/runs.py:115-180` (verified live): builds `out` dicts per row
  (with `_run_start_end` parquet fallback), then applies ALL filters in Python
  (`q_search`, `q_id`, `q_sid`, `q_sname`, `q_created`, `q_start/end`,
  `q_tr/dd/sharpe/sortino/stats`), then sorts (numeric keys via hidden
  `_cagr` etc., else `apply_sort` from `backend/api/_query.py`), then pops the
  hidden keys and returns `{"data": out, "total": total, ...}` with the
  UNFILTERED total.
- FE consumer: `useRunsTable` hook + `RunsTable.tsx` — re-verify expectations
  after the change (same response shape, corrected semantics).
- Conventions: `uv run pytest -q`, `uv run ruff check .` exit 0. NEVER delete
  user rows in `bt_gui.db` (AGENTS.md §9) — tests must use `test_*`-style
  artifacts or the conftest test DB only.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| BE tests | `uv run pytest -q` | all pass |
| BE lint | `uv run ruff check .` | exit 0 |

## Scope

**In scope** (the only files you should modify):

- `backend/api/backtest.py` (validate-before-insert)
- `backend/api/runs.py` (SQL-side filtering/sorting/pagination + filtered total)
- `tests/backend/test_runs_pagination.py` (create) — or extend an existing runs
  test file if one exists; check first.

**Out of scope** (do NOT touch, even though they look related):

- `PERF-05` (parquet decode per row in `_run_start_end`, slim list projection)
  — separate perf plan, deferred.
- FE `useRunsTable` — read-only verification; fix BE to the existing contract.
- Any DELETE/backfill of existing ghost rows — no data migration here.

## Git workflow

- Trunk-based per `AGENTS.md` §6: work on `master`, commit locally, then
  `git push origin master`. No feature branches.
- Message style: `fix: <what>` e.g. `fix: no ghost runs + SQL-side runs filtering`.

## Steps

### Step 1: Validate before insert in create_backtest

Reorder `backend/api/backtest.py:58-98` so ALL validation that can raise
4xx happens BEFORE `db.add/commit`:

1. Resolve tickers → load `price_df` (both `tickers` and `price_source_id`
   branches, including the "tickers or price_source_id required" 422).
2. Run the tree-ticker coverage check (the `need`/`miss` 422).
3. ONLY then `db.add(row); db.commit(); db.refresh(row)` and `schedule_backtest`.

Keep `benchmark_ticker` normalization where it is (no 422 by design).
Success-path behavior (response shape, `run_id`, scheduling) must be identical.

**Verify**: `uv run pytest -q` → pass. Manual: POST a backtest with an unknown
ticker → 422 AND `GET /runs?search=<name>` shows no new orphan row
(use the test DB via pytest client, never hand-edit `bt_gui.db`).

### Step 2: Push search/filter/sort into SQL in list_runs

Constraints: several filters (`filter_total_return`, `filter_sharpe`, etc.)
operate on values computed in Python from `stats_json`/parquet. Two acceptable
designs — pick the smaller diff that stays correct:

- (a) Filter/sort on DB-mappable columns in SQL (id, strategy_id via join or
  denormalized name, created_at, config start/end) + Python-side only for the
  stats-derived filters, with pagination applied AFTER all filtering and
  `total` = filtered count.
- (b) If (a) still leaves the page-then-filter hole for stats filters, do:
  fetch candidate IDs (or full rows when table is small — check current scale),
  filter/sort in Python, THEN slice `[offset:offset+limit]`, `total = len(filtered)`.

Whichever you pick, these invariants must hold: `total` equals the number of
rows matching ALL filters; `data` is the correct `offset/limit` window of the
fully filtered+sorted set; default (no filters) keeps current ordering
(`id desc`) and shape. The hidden `_cagr`-style helper keys must still be
popped before return.

**Verify**: `uv run pytest -q` → pass.

### Step 3: Tests

Create `tests/backend/test_runs_pagination.py` (test DB via conftest; seed
runs with `test_`-style strategy names — never touch user rows):

1. Seed ≥5 runs; `search=` matching 2 → `total == 2`, `data` has exactly those.
2. `limit=2&offset=0` + `limit=2&offset=2` with a filter → disjoint windows,
   union equals unfiltered-filtered set (no skips).
3. Sort by a numeric key (`total_return`) desc → ordered, `total` correct.
4. Ghost-row regression: create attempt with unknown ticker → 422 and run
   count unchanged.

**Verify**: new tests pass; `uv run pytest -q` → all pass;
`uv run ruff check .` → exit 0. Also open the FE Runs table once (dev server)
and confirm search/pagination behave — or state in NOTES it was BE-verified only.

## Test plan

- New `tests/backend/test_runs_pagination.py`: 4 cases above.
- Existing `test_backtest_runner.py` + smoke tests as regression net for the
  reorder in step 1.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `uv run pytest -q` exits 0 (including new pagination tests)
- [ ] `uv run ruff check .` exits 0
- [ ] `grep -n '"total": total' backend/api/runs.py` — `total` is assigned from
  the FILTERED set (rename to `total_filtered` or equivalent; bare unfiltered
  `total = db.query(DBRun).count()` must no longer feed the response when
  filters are active — default no-filter path may keep `count()`)
- [ ] `db.commit()` in `backend/api/backtest.py` appears AFTER the
  `price_df manca` 422 check in file order
  (`grep -n "db.commit()\|price_df manca\|tickers or price_source" backend/api/backtest.py`)
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `schedule_backtest` or the response shape depends on `run_id` existing
  BEFORE price loading (assumption false) — report the dependency.
- Stats-derived filters cannot be expressed without loading every row's parquet
  at acceptable cost — report measured cost and propose the slim-projection
  (PERF-05) as prerequisite instead.
- The FE `useRunsTable` depends on the buggy semantics (e.g. client-side
  re-filtering that double-applies) — report the exact lines.

## Maintenance notes

- If a metadata column (start/end/stats numerics) is ever persisted on the run
  row (PERF-05), revisit this endpoint to push ALL filters into SQL.
- Pre-existing ghost rows from before this fix are left as-is (no migration);
  they age out via normal bulk-delete.
- Reviewer: verify no test touches non-`test_*` rows; check `git status` for DB
  file modifications (must be none).

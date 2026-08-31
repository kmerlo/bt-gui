# Plan 007: Batch per-ID fetches + price list pagination

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat c83f4bf..HEAD -- backend/api/backtest.py backend/services/backtest_runner.py backend/api/price_data.py frontend/src/bt/components/DataDetailView.tsx frontend/src/bt/components/DataManager.tsx`
> If files changed, compare "Current state" excerpts before proceeding.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: 002 (uses split api files), 006 (table perf pattern)
- **Category**: perf
- **Planned at**: commit `c83f4bf`, 2026-08-30

## Why this matters

Every `POST /api/bt/backtest` does N+1 DB round-trips: one `SELECT ... WHERE id==vid` per extra source and per indicator (`backtest.py:81,96` and `backtest_runner.py:333,348`). With 5 indicators this is 6 queries instead of 3. Price detail `GET /api/bt/price-data/{symbol}/rows` loads the entire symbol history then filters/sorts in Python and ships it all to the browser (`DataDetailView.tsx:68` fetches all rows, client sorts+slices). Both grow linearly and block the request thread. Fixing them is one helper each and keeps the API shape identical for single-item fetches.

## Current state

- `backend/api/backtest.py:81-96` (hot path) and `backend/services/backtest_runner.py:333-354` (legacy `schedule_backtest_by_ids`):
  ```python
  for k, vid in req.extra_source_ids.items():
      erow = db.query(DBSource).filter(DBSource.id == vid).first()
  for ind_id in all_ind_ids:
      ind_row = db.query(DBSource).filter(DBSource.id == ind_id).first()
  ```
  Pattern repeats in `backtest_runner.py:333` for `extra_ids`.

- `backend/api/price_data.py:26,48`:
  ```python
  rows = db.query(DBPriceData).order_by(...).all()  # list endpoint, no limit
  # get_price_rows loads all rows for symbol then Python filters
  ```
  Frontend `frontend/src/bt/components/DataDetailView.tsx:68`:
  ```ts
  priceDataApi.getRows(selectedSymbol) // no limit/offset/search/sort delegation
  // then filtered.filter + filtered.sort + slice(pageSize)
  ```
  vs indicator path correctly uses `dataApi.table(id, {limit,offset,search,sort_by})`.

- Conventions: BE uses `APIRouter(prefix="/api/bt")` per `backend/api/routes.py:14`; services are one-file-one-responsibility; pagination pattern already established in `backend/api/data_sources.py:200` (`limit/offset/sort_by/sort_dir/search` + `df.iloc[offset:offset+limit]`). Match it.

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Lint | `uv run ruff check .` | exit 0 |
| Tests | `uv run pytest -q` | all pass (61) |
| FE build | `npm run build --prefix frontend` | exit 0 |

## Scope

**In scope**:
- `backend/api/backtest.py`
- `backend/services/backtest_runner.py`
- `backend/api/price_data.py`
- `frontend/src/api/bt.ts` (add limit/offset params to `priceDataApi.getRows` if needed)
- `frontend/src/bt/components/DataDetailView.tsx` and `DataManager.tsx` (switch to server-paginated call)

**Out of scope**:
- `backend/api/runs.py` / `data_sources.py` list pagination (separate effort, larger)
- `frontend/src/types/bt.ts` (auto-generated)
- Any schema change to `PriceData` table

## Git workflow

- Branch: `advisor/007-batch-fetches-price-pagination`
- Commit: `perf(api): batch extra/indicator fetches and paginate price rows`
- Do NOT push unless instructed.

## Steps

### Step 1: Batch extra_source_ids and indicator fetches

In `backend/api/backtest.py:81-102` and `backend/services/backtest_runner.py:332-354`:

- Collect ids first:
  ```python
  extra_ids = list(req.extra_source_ids.values())
  extra_rows = {r.id: r for r in db.query(DBSource).filter(DBSource.id.in_(extra_ids)).all()} if extra_ids else {}
  ind_rows_map = {r.id: r for r in db.query(DBSource).filter(DBSource.id.in_(all_ind_ids)).all()} if all_ind_ids else {}
  ```
- Then iterate in-memory:
  ```python
  for k, vid in req.extra_source_ids.items():
      erow = extra_rows.get(vid)
      if erow is None or erow.parquet_blob is None:
          continue
  for ind_id in all_ind_ids:
      ind_row = ind_rows_map.get(ind_id)
  ```
Apply same pattern in `schedule_backtest_by_ids` for both loops. Keep single-item fallback (`if not extra_ids: additional={}`).

**Verify**: `uv run ruff check .` → 0; `uv run pytest -q` → pass

### Step 2: Paginate price_data list + getRows server-side

In `backend/api/price_data.py`:

- `list_price_data` (`GET /api/bt/price-data`): add `limit: int = Query(100, ge=1, le=500), offset: int = Query(0, ge=0)` and DB `limit(offset+limit)` with aggregation via `GROUP BY` or Python but capped. Minimal: `q = q.limit(limit).offset(offset)` and return `{items,total}` or keep list but capped; preserve backward compat by defaulting to 100. Document `# ponytail: capped list — full GROUP BY aggregation when >10k symbols`.
- `get_price_rows` (`GET /api/bt/price-data/{symbol}/rows`): add `limit/offset` params, push `search/sort_by/sort_dir` to SQL if possible, otherwise Python but after `q.all()` slice with `limit/offset`. Return same shape plus `total` for client pagination. Keep existing `start/end/search/sort` behavior.

**Verify**: `curl /api/bt/price-data?limit=10` returns ≤10; `uv run pytest -q` → pass

### Step 3: Switch DataDetailView/DataManager to server pagination

In `frontend/src/bt/components/DataDetailView.tsx:68-84` and `DataManager.tsx:100`:

- Change `priceDataApi.getRows(symbol, {start,end})` to `priceDataApi.getRows(symbol, {start,end, limit: pageSize, offset: startIdx, sort_by, sort_dir, search})`
- Update `priceDataApi.getRows` signature in `frontend/src/api/bt.ts:169` to accept `limit/offset`
- Keep client-side filtered path as fallback when server `total` absent. Page size 50 matches `dataApi.table`.

**Verify**: `npm run build --prefix frontend` → 0; manual open DataDetailView → paginated fetch in Network tab

## Test plan

- Existing `tests/backend/test_backtest_runner.py` covers backtest create; add mock test that asserts 1 `IN` query instead of N: use `db.query(DBSource).filter(DBSource.id.in_(ids)).all()` called once (monkeypatch or count via SQLAlchemy event).
- Add `tests/backend/test_price_data_pagination.py`: create 5 price rows for one symbol, call `GET /api/bt/price-data/{sym}/rows?limit=2&offset=1` → 2 rows, `GET /api/bt/price-data?limit=1` → 1 row.
- Model after `tests/backend/test_data_loader.py:54` pattern (`TestClient(app)` + `f"test_{uuid}"` names).

## Done criteria

- [ ] `grep -rn "\.filter(DBSource.id ==" backend/api/backtest.py backend/services/backtest_runner.py` → 0 (replaced by `.in_(`)
- [ ] `grep -rn "for k, vid in.*extra_source" backend/api/backtest.py` still exists but without DB query inside loop
- [ ] `curl /api/bt/price-data/{symbol}/rows?limit=2` returns ≤2 rows; `DataDetailView` fetches with `limit/offset`
- [ ] `uv run ruff check .` → 0
- [ ] `uv run pytest -q` → pass (incl. 1-2 new tests)
- [ ] `npm run build --prefix frontend` → 0
- [ ] `plans/README.md` row 007 → DONE

## STOP conditions

- Batch `IN` query would require changing `indicator_source_ids` from `list[int]` to another shape — STOP, keep shape identical, just optimize loop.
- Price pagination would change `GET /rows` response from `PriceRow[]` to envelope and FE cannot handle it without larger refactor — STOP, keep array shape and add optional `total` header/query param instead.
- `backtest_runner.py` legacy `schedule_backtest_by_ids` no longer called by any route — don't delete it, just batch it; removing changes blast radius.

## Maintenance notes

- If `PriceData` grows >10k rows per symbol, move filtering/sorting to SQL (`WHERE symbol=:s AND date BETWEEN ... ORDER BY date LIMIT`) instead of Python scan.
- The `IN` batch pattern should be reused for any future multi-id fetch (e.g., bulk strategy load); add helper `fetch_sources_by_ids(db, ids) -> dict` if a third site appears.

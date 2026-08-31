# Plan 009: Establish verification baseline, fix deps/DX hygiene

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat c83f4bf..HEAD -- pyproject.toml frontend/package.json .gitignore`
> If files changed, compare "Current state" excerpts before proceeding.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none (enables 007/008)
- **Category**: tests + dx + migration
- **Planned at**: commit `c83f4bf`, 2026-08-30

## Why this matters

Verification is the prerequisite for every risky plan: `ffn` → `yfinance` migration landed in `backend/services/data_loader.py:78` (`fetch_and_store_yf` via `yfinance`) but `yfinance` is not in `pyproject.toml` dependencies, so a fresh `uv sync` fails on `GET /api/bt/price-data/fetch`. `.gitignore:3` ignores `uv.lock` while `uv.lock` exists, so reproducible installs are impossible. DX gates are incomplete: `tool.ruff.lint.select=["E","F"]` only, `tool.mypy` disables 9 error codes, `frontend/package.json` has `gen:types` but no `typecheck` script, no `format`, no pre-commit, no `.env.example`. Money path (`commission simple_fn` eval + `price_data` persistence) has zero targeted coverage. Without fixing this, every later perf/refactor plan is blind.

## Current state

- `pyproject.toml:7-22` deps list `bt, fastapi, uvicorn, pydantic, sqlalchemy, pandas, numpy, cython, ffn, python-multipart, aiofiles, websockets, httpx, pyarrow` — no `yfinance`, but `backend/services/data_loader.py:88` `import yfinance as yf` and `backend/api/price_data.py:12` uses it. `uv run pip show yfinance` succeeds locally because installed transitively, but fresh clone fails.
- `pyproject.toml:46` `bt = {path="../bt", editable=true}` breaks CI without sibling. `.gitignore:3` has `uv.lock`.
- `pyproject.toml:36-41` `tool.ruff` line-length 180, `select=["E","F"]` only; no `format`. `tool.mypy:49-57` `disallow_untyped_defs=false`, `disable_error_code` 9 entries. `frontend/package.json:6-11` scripts `dev/build/lint/gen:types` but no `typecheck: tsc -b --noEmit`, no `format/test`. No `.pre-commit-config.yaml`, no `.editorconfig`, no `.env.example`, no `.github/workflows`.
- Tests: `tests/backend/test_price_data.py` missing; `tests/backend/test_backtest_runner.py:72` uses `time.sleep(0.2)` polling; `tests/conftest.py:5` global `ACTIVE_DB` switch; `frontend/src/**/*.test.*` → 0 files; `pyproject.toml:32-34` no `coverage`.

- Conventions: `AGENTS.md §6` trunk-based master; verification gates `uv run ruff check .`, `uv run pytest -q`, `npm run build --prefix frontend`; GUIDE-CODING_PRACTICES.md §4 lint from commit zero.

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Install | `uv sync` | exit 0 |
| Lock | `uv lock` | updates `uv.lock` |
| Tests | `uv run pytest -q` | all pass |
| Lint | `uv run ruff check .` | exit 0 |
| Format | `uv run ruff format --check .` | exit 0 |
| FE typecheck | `npm run typecheck --prefix frontend` | exit 0 |
| FE build | `npm run build --prefix frontend` | exit 0 |

## Scope

**In scope**:
- `pyproject.toml` — add `yfinance`, un-ignore `uv.lock`, tighten deps, add `ruff format`, mypy, coverage
- `.gitignore` — remove `uv.lock` line
- `frontend/package.json` — add `typecheck`, `format` scripts
- Root — add `.editorconfig`, `.env.example`, `.pre-commit-config.yaml` (optional), `.github/workflows/ci.yml` minimal
- `tests/backend/test_price_data.py` (create) — minimal coverage for yfinance branch
- `tests/backend/test_query_helpers.py` if helpers exist

**Out of scope**:
- Frontend vitest harness full suite (deferred to follow-up; just gate `typecheck`)
- Changing `bt` sibling path pin (document, don't migrate)

## Git workflow

- Branch: `advisor/009-verification-baseline-deps`
- Commit: `chore(dx): declare yfinance, commit lockfile, add verification gates`
- Do NOT push unless instructed.

## Steps

### Step 1: Fix Python deps and lockfile tracking

In `pyproject.toml`:

- Add `yfinance>=1.0` to `dependencies` (bounded, e.g. `yfinance>=1.0,<2`).
- Deduplicate `httpx` (present in `dependencies` and `dependency-groups.dev` — keep one in `dependencies`).
- Remove or document `cython` note (keep if `bt` needs it at runtime, else comment).
- In `.gitignore`, delete the `uv.lock` line (keep `__pycache__/` etc). `uv.lock` must be committed for reproducibility per `uv` docs.

Run `uv lock && uv sync` to regenerate lockfile; commit `uv.lock`.

**Verify**: `grep yfinance pyproject.toml` → 1 line; `git check-ignore -v uv.lock` → no output (not ignored); `uv run pytest -q` → pass

### Step 2: Add tooling hygiene (ruff format, mypy tightening, editorconfig, env example)

- `pyproject.toml`:
  - Extend `tool.ruff.lint.select` to `["E","F","I"]` (add isort) or keep `E,F` but add `[tool.ruff.format]` defaults. Add `tool.ruff.lint` `line-length` unchanged 180.
  - Tighten `tool.mypy`: set `disallow_untyped_defs=true` with narrow per-file ignores if needed; keep current disables but document via comment.
- `frontend/package.json`: add
  ```json
  "typecheck": "tsc -b --noEmit",
  "format": "prettier --check src"
  ```
  (or `eslint` if prettier absent — minimal gate is `typecheck`).
- Add `.editorconfig` (2 spaces ts, 4 spaces py).
- Add `.env.example` with `DATABASE_URL`, `BT_GUI_PORT` placeholders (no secrets).
- Optional but recommended: add `.pre-commit-config.yaml` with `ruff`, `mypy`, `tsc`.

**Verify**: `uv run ruff check .` → 0; `uv run ruff format --check .` → 0; `npm run typecheck --prefix frontend` → 0

### Step 3: Add CI minimal gate and coverage

- Add `.github/workflows/ci.yml`:
  ```yaml
  on: [push, pull_request]
  jobs:
    ci:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-python@v5
        - run: uv sync && uv run ruff check . && uv run ruff format --check . && uv run pytest -q
        - uses: actions/setup-node@v4
        - run: npm ci --prefix frontend && npm run typecheck --prefix frontend && npm run build --prefix frontend
  ```
- Add `pytest-cov` to `pyproject.toml:dev` and `tool.coverage` minimal; gate is `uv run pytest --cov=backend` optional — document but don't enforce % yet.

**Verify**: `uv run pytest -q` → pass; `npm run build --prefix frontend` → 0

### Step 4: Add missing price_data test branch

Create `tests/backend/test_price_data.py`:

- Use `TestClient(app)` pattern from `tests/backend/test_data_loader.py:14`.
- Mock `yfinance.download` to return a tiny DataFrame (3 rows) and assert `POST /api/bt/price-data/fetch` 201 and `GET /api/bt/price-data` lists symbol, `GET /api/bt/price-data/{sym}/rows` returns rows.
- Prefix names `test_price_*` and cleanup via `db.query(PriceData).filter(PriceData.symbol.like('TEST%')).delete()` (respect AGENTS.md §9 `test_%` rule).

**Verify**: `uv run pytest -q tests/backend/test_price_data.py` → pass

## Test plan

- New file `tests/backend/test_price_data.py` with 3 cases: yfinance mock fetch success, list after fetch, rows after fetch.
- Existing 61 tests remain green; new tests follow `test_data_loader.py` fixture pattern (no `drop_all`, `StaticPool` optional for isolation).

## Done criteria

- [ ] `grep yfinance pyproject.toml` → 1 line; `uv sync` in fresh `tmp` clone (or `uv lock --check`) → 0
- [ ] `git check-ignore -v uv.lock` → exit 1 (not ignored) and `uv.lock` tracked
- [ ] `uv run ruff check .` → 0; `uv run ruff format --check .` → 0
- [ ] `npm run typecheck --prefix frontend` → 0 (script exists and passes)
- [ ] `.env.example` and `.editorconfig` exist
- [ ] `uv run pytest -q` → all pass incl. `test_price_data.py`
- [ ] `npm run build --prefix frontend` → 0
- [ ] `plans/README.md` row 009 → DONE

## STOP conditions

- Adding `yfinance` bound conflicts with `bt` sibling `cython`/`pandas` pins causing resolver failure — STOP, report resolution error, keep `yfinance` unpinned and note in plan.
- Tightening `mypy` to `disallow_untyped_defs=true` surfaces >20 errors across `backend/services/backtest_runner.py` (which has `type: ignore` heavy) — STOP, keep `disallow_untyped_defs=false` and record as follow-up instead of blocking DX.
- `uv.lock` commit would be >10k lines and churns unrelated deps — STOP, keep `.gitignore` removal but don't commit lockfile in same PR; document in README.

## Maintenance notes

- When `bt` sibling path `../bt` is replaced by published wheel, remove path source and add version pin.
- Coverage gate (`--cov`) should be tightened after 009 lands; add threshold once price_data tests stabilize.
- Frontend `gen:types` drift check from plan 006 (`npm run gen:types && git diff --exit-code frontend/src/types/bt.ts`) belongs in CI alongside `typecheck`.

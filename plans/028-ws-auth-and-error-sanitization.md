# Plan 028: Authenticate WS progress and sanitize persisted/streamed errors

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 71f31b5..HEAD -- backend/api/runs.py backend/services/backtest_runner.py backend/middleware.py backend/api/_helpers.py frontend/src/api/runs.ts frontend/src/bt/components/RunDialog.tsx tests/backend/test_routes_smoke.py`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `71f31b5`, 2026-09-05

## Why this matters

With `BT_API_KEY` set, the app is supposed to be private — but the WebSocket
progress endpoint accepts any client (Starlette never invokes `@app.middleware("http")`
for WebSockets), leaking run progress, raw exception text, and run-ID
existence. Separately, `run_backtest_sync`'s failure path persists and streams
RAW `str(e)` (SQL fragments, library internals), re-opening the
info-disclosure hole plan 017 closed everywhere else with `_err_msg`.

## Current state

- `backend/main.py:31-40` (verified live): `api_key_auth` is
  `@app.middleware("http")` — WS-exempt by Starlette design. Key source:
  `backend/middleware.py:9-10` `_get_api_key()` reads `BT_API_KEY` or
  `BT_GUI_API_KEY`; skip paths `/ docs openapi.json redoc`.
- `backend/api/runs.py:357-377` (verified live):
  ```python
  @router.websocket("/backtest/{run_id}/progress")
  async def ws_progress(websocket: WebSocket, run_id: int):
      await websocket.accept()
      ...
  ```
  No credential check of any kind.
- `backend/services/backtest_runner.py:448-458` (verified live):
  ```python
  except Exception as e:
      _set_progress(run_id, {"progress": 1.0, "done": True, "error": str(e)})
      ...
      row.stats_json = {"error": str(e)}
  ```
  while `backend/api/_helpers.py:24-27` provides `_err_msg(e)` → logs full,
  returns `"internal error"`.
- `backend/api/runs.py:280-294` returns the stored `stats_json` verbatim;
  `frontend/src/bt/components/RunDialog.tsx:82-84` renders `d.error` raw;
  `frontend/src/api/runs.ts:56` opens
  `new WebSocket(\`${WS_BASE}/api/bt/backtest/${id}/progress\`)` with no key.
- `tests/backend/test_routes_smoke.py:38-62` unit-tests `_get_api_key()` only.
- Conventions: `uv run pytest -q`, `uv run ruff check .` exit 0;
  `cd frontend && npm run build` + `npm run typecheck` exit 0 for FE changes.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| BE tests | `uv run pytest -q` | all pass |
| BE lint | `uv run ruff check .` | exit 0 |
| FE build | `cd frontend && npm run build` | exit 0 |
| FE typecheck | `cd frontend && npm run typecheck` | exit 0 |

## Scope

**In scope** (the only files you should modify):

- `backend/api/runs.py` (WS key check)
- `backend/services/backtest_runner.py` (sanitized persist/stream)
- `backend/middleware.py` (only if a shared `check_key(candidate)` helper is
  needed — keep `_get_api_key()` signature stable)
- `frontend/src/api/runs.ts` (append key to WS URL when configured)
- `frontend/src/bt/components/RunDialog.tsx` (render stable message)
- `tests/backend/test_auth_middleware.py` (create: HTTP + WS coverage)

**Out of scope** (do NOT touch, even though they look related):

- `backend/main.py` HTTP middleware logic — unchanged.
- Broader logging/request-ID work (DX-03 finding) — deferred.
- Any change to the success-path progress payload shape.

## Git workflow

- Trunk-based per `AGENTS.md` §6: work on `master`, commit locally, then
  `git push origin master`. No feature branches.
- Message style: `fix: <what>` e.g. `fix: WS progress auth + sanitized run errors`.

## Steps

### Step 1: Key check inside the WS handler

In `ws_progress` (`backend/api/runs.py:357-377`): BEFORE `await websocket.accept()`
(or immediately after accept-then-close — read Starlette's pattern in the
installed version; prefer check-before-accept via query param), read candidate
key from `websocket.query_params.get("api_key")` plus `X-API-Key`-style header
(`websocket.headers`), compare with `_get_api_key()`; if a key is configured
and the candidate mismatches, close with code `4401` (do NOT leak whether the
run_id exists — close before any `get_progress` call). If NO key is configured
(dev mode), behavior unchanged. Extract comparison into `backend/middleware.py`
only if both HTTP and WS can share it without changing `main.py`.

**Verify**: `uv run pytest -q` → pass (no test yet covers WS; manual check in
step 4).

### Step 2: Sanitize persisted and streamed errors

In `backtest_runner.py:448-458`: route through `_err_msg` — log full exception
server-side (already done inside `_err_msg`), persist/stream only the generic
message:
```python
from backend.api._helpers import _err_msg
...
except Exception as e:
    safe = _err_msg(e)
    _set_progress(run_id, {"progress": 1.0, "done": True, "error": safe})
    ... row.stats_json = {"error": safe}
```
Check for a service→api import cycle first (`_helpers` imports only stdlib +
pandas — safe). If a cycle exists, move `_err_msg` usage to the runs.py
read-path + WS send-path instead and report the deviation in NOTES.

**Verify**: `uv run pytest -q` → pass.

### Step 3: FE — send key, render stable message

- `frontend/src/api/runs.ts:56`: append `?api_key=${key}` when the app has a
  configured key (read how the HTTP client attaches `X-API-Key` today — mirror
  that source; if HTTP auth has no FE-side key store yet, add the query param
  only when a `BT_API_KEY`-equivalent value is available in settings/store,
  otherwise leave URL unchanged and document).
- `RunDialog.tsx:82-84`: render a stable user message for `d.error` (the
  server now sends generic text; do not parse internals).

**Verify**: `cd frontend && npm run typecheck` → exit 0; `npm run build` → exit 0.

### Step 4: Tests (HTTP + WS auth, sanitized errors)

Create `tests/backend/test_auth_middleware.py` (pattern: existing smoke tests +
`monkeypatch.setenv("BT_API_KEY", ...)` + TestClient; MUST restore env after):

1. No key configured → `/api/bt/health` 200 without credentials.
2. Key configured → 200 with `X-API-Key`, 200 with `Bearer`, 401 without,
   200 on `/docs` without.
3. WS: key configured → connect without key gets closed/rejected; connect with
   `?api_key=<key>` receives progress frames (use Starlette TestClient
   `websocket_connect`; if the test client cannot do WS in this version, assert
   at minimum the close path and document).
4. Sanitization: force `run_backtest_sync` failure (bad tree/empty prices) →
   stored `stats_json["error"]` equals `"internal error"`, not the raw text.

**Verify**: `uv run pytest tests/backend/test_auth_middleware.py -q` → all pass;
`uv run pytest -q` → all pass; `uv run ruff check .` → exit 0.

## Test plan

- New `tests/backend/test_auth_middleware.py`: HTTP matrix (4 cases), WS
  accept/reject (2 cases), error sanitization (1 case).
- Existing suite as regression net (esp. `test_backtest_runner.py` error-path
  test, `test_routes_smoke.py`).

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `uv run pytest -q` exits 0 (including new `test_auth_middleware.py`)
- [ ] `uv run ruff check .` exits 0
- [ ] `cd frontend && npm run build` exits 0 and `npm run typecheck` exits 0
- [ ] `grep -n "str(e)" backend/services/backtest_runner.py` returns no matches
- [ ] `grep -n "4401\|api_key" backend/api/runs.py` returns ≥1 match
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `_helpers` import into `backtest_runner.py` creates a cycle — use the
  read-path alternative and report.
- The FE has no key store to append `?api_key=` (assumption false) — report how
  HTTP auth credentials reach the server from the FE today.
- TestClient WS support is unavailable — report version, keep HTTP + unit
  coverage, mark WS test TODO in the file.

## Maintenance notes

- Dev mode (no key) stays open — document in README setup (DX-02 covers docs).
- If auth graduates to JWT (see `middleware.py:5` ponytail note), the WS check
  must move to the same verifier.
- Reviewer: confirm close happens BEFORE any run-ID existence signal.

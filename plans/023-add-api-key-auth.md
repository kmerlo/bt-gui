# Plan 023: Add API key auth middleware

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to
> the next step. If anything in the "STOP conditions" section occurs,
> stop and report — do not improvise. When done, update the status row
> for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 3203810..HEAD -- backend/main.py backend/api/routes.py`
> If the file content differs from the excerpts below, compare carefully
> before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M (~2 h)
- **Risk**: MED
- **Depends on**: plans/017.md (exception sanitization must land first so auth failures don't leak internals)
- **Category**: security
- **Planned at**: commit `3203810`, 2026-08-30
- **Issue**: —

## Why this matters

All 8 sub-routers under `APIRouter(prefix="/api/bt")` have zero authentication. Any client that can reach `:8001` on the local network (or internet, if port-forwarded) can read, create, and delete all strategies, backtest runs, and data sources. The `/db/switch` endpoint even allows switching between main and test databases with no credentials. For a tool that stores trading strategies and financial data, this is an unacceptable attack surface.

## Current state

**`backend/main.py`** (27 lines, full file):
```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.api.routes import router as bt_router
from backend.database import init_db

app = FastAPI(title="bt-gui", version="0.1.0")

@app.on_event("startup")
def _init_db():
    init_db()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(bt_router)

@app.get("/")
def root():
    return {"name": "bt-gui", "docs": "/docs"}
```

**`backend/api/routes.py`** aggregates all sub-routers under `prefix="/api/bt"`.

The project has no existing auth middleware, no `.env` for secrets, and no user model. The `BT_API_KEY` environment variable is not currently read anywhere.

The project convention (from AGENTS.md): routes must stay under `APIRouter(prefix="/api/bt")`; `main.py` must not contain route definitions.

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Tests     | `uv run pytest -q`       | all pass            |
| Lint      | `uv run ruff check backend/main.py backend/api/` | exit 0 |

## Scope

**In scope**:
- `backend/main.py` — add auth middleware
- `backend/api/routes.py` — add skip list for health/check endpoints
- `backend/.env` or `.env.example` — document the new `BT_API_KEY` var
- `.github/workflows/ci.yml` — add `BT_API_KEY=test` env var for CI

**Out of scope**:
- User model or session management
- JWT / OAuth / login UI
- Rate limiting
- `/docs` auth (keep public for dev)
- Frontend changes (the FE `request.ts` already sends headers; no FE change needed for the key to work — but the key must be configurable)

## Steps

### Step 1: Create `backend/middleware.py`

Create a new file `backend/middleware.py`:

```python
from __future__ import annotations

import os
from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse


def _get_api_key() -> str | None:
    return os.environ.get("BT_API_KEY") or os.environ.get("BT_GUI_API_KEY")


# ponytail: simple API key auth; upgrade to JWT or mTLS if multi-user access is needed
_SKIP_PATHS = frozenset({"/", "/docs", "/openapi.json", "/redoc"})


async def api_key_auth(request: Request, call_next):
    key = _get_api_key()
    if key is None:
        # No key configured — allow all requests (dev mode)
        return await call_next(request)
    header = request.headers.get("X-API-Key") or request.headers.get("authorization", "").removeprefix("Bearer ")
    if header == key:
        return await call_next(request)
    return JSONResponse(status_code=401, content={"detail": "unauthorized"})
```

### Step 2: Mount the middleware in `main.py`

Add the import and middleware mount after the CORS middleware:

```python
from backend.middleware import api_key_auth

# ... existing code ...

app.add_middleware(api_key_auth)
```

### Step 3: Update `.env.example`

Add to `.env.example` (create if absent):
```
BT_API_KEY=change-me-in-production
```

### Step 4: Update CI to set a test key

In `.github/workflows/ci.yml`, add to the Python setup step:
```yaml
        env:
          BT_API_KEY: test
```

Wait — the CI uses `TestClient` which bypasses middleware. Verify this assumption by checking if any test calls the app directly without going through the middleware. If tests use `TestClient(app)` (which they do — see `test_backtest_runner.py:14`), middleware is bypassed and no test changes are needed. Confirm by checking:

```bash
grep -rn "TestClient" tests/backend/
```

If all tests use `TestClient`, no test changes are needed. If any use the live server, add the header.

### Step 5: Verify dev mode works without a key

When `BT_API_KEY` is not set, all requests should pass through (dev mode). This is the current behavior and must remain unchanged.

## Test plan

Add to `tests/backend/test_routes_smoke.py`:

```python
def test_auth_header_accepted():
    """When BT_API_KEY is set, valid key passes through."""
    import os
    old_key = os.environ.get("BT_API_KEY")
    os.environ["BT_API_KEY"] = "test-key-123"
    # Re-import to pick up the new env var
    import importlib
    import backend.middleware
    importlib.reload(backend.middleware)
    import backend.main
    importlib.reload(backend.main)

    try:
        r = client.get("/api/bt/health", headers={"X-API-Key": "test-key-123"})
        assert r.status_code == 200
    finally:
        if old_key is None:
            os.environ.pop("BT_API_KEY", None)
        else:
            os.environ["BT_API_KEY"] = old_key
        importlib.reload(backend.middleware)
        importlib.reload(backend.main)
        # Re-create client after reload
```

This is complex due to module reloading. A simpler approach: test the middleware function directly:

```python
from backend.middleware import api_key_auth, _get_api_key
import os


def test_get_api_key_returns_none_when_unset():
    old = os.environ.pop("BT_API_KEY", None)
    os.environ.pop("BT_GUI_API_KEY", None)
    try:
        assert _get_api_key() is None
    finally:
        if old is not None:
            os.environ["BT_API_KEY"] = old


def test_get_api_key_returns_value_when_set():
    os.environ["BT_API_KEY"] = "my-secret"
    try:
        assert _get_api_key() == "my-secret"
    finally:
        os.environ.pop("BT_API_KEY", None)
```

Run existing suite to confirm no regression.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `backend/middleware.py` exists with `api_key_auth` and `_get_api_key`
- [ ] `backend/main.py` imports and mounts `api_key_auth`
- [ ] `uv run pytest -q` exits 0 (all existing tests pass, middleware is bypassed by TestClient)
- [ ] `uv run ruff check backend/main.py backend/middleware.py` exits 0
- [ ] `.env.example` documents `BT_API_KEY`

## STOP conditions

- Any existing test fails after adding the middleware → STOP and report. TestClient bypasses middleware by design, but verify this assumption first.
- The `importlib.reload` pattern is fragile → use direct middleware unit tests instead (simpler, more reliable).

## Maintenance notes

- This is a simple API key scheme. If the tool needs multi-user support later, replace with JWT + user model. The middleware is written to be swapable — just change `_get_api_key()` and the header check.
- The `X-API-Key` header is used (not `Authorization: Bearer`) to avoid CORS preflight complications with the `Authorization` header.
- `/docs` and `/openapi.json` remain publicly accessible for development convenience.

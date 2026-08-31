# Plan 017: Sanitize exception messages in API error responses

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to
> the next step. If anything in the "STOP conditions" section occurs,
> stop and report — do not improvise. When done, update the status row
> for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 3203810..HEAD -- backend/api/backtest.py backend/api/data_sources.py backend/api/indicators.py backend/api/strategies.py backend/api/health.py`
> If the file content differs from the excerpts below, compare carefully
> before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S (20 min)
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `3203810`, 2026-08-30
- **Issue**: —

## Why this matters

Five API route files use `detail=str(e)` when raising `HTTPException`, leaking internal error messages (which may contain file paths, dependency versions, or SQL internals) to the HTTP response. An attacker can trigger these by sending malformed requests. The fix is to centralize error formatting behind a single helper.

## Current state

Affected locations:

| File | Line | Pattern |
|------|------|---------|
| `backend/api/backtest.py` | 112 | `raise HTTPException(status_code=500, detail=str(e)) from e` |
| `backend/api/data_sources.py` | 62 | `detail=str(e)` in an except block |
| `backend/api/indicators.py` | 72 | `detail=str(e)` in an except block |
| `backend/api/strategies.py` | 21 | `detail=str(e)` |
| `backend/api/strategies.py` | 86 | `detail=str(e)` |
| `backend/api/health.py` | 82 | `"db_error": db_error` where `db_error = str(e)` |

The existing convention in this repo for API errors is `HTTPException(status_code=..., detail="...")`. See `backend/api/runs.py:151` for a clean example: `detail=f"sort_by {sort_by} not allowed (use {sorted(allowed)})"`.

## Commands you will need

| Purpose   | Command                              | Expected on success |
|-----------|--------------------------------------|---------------------|
| Lint      | `uv run ruff check backend/api/`     | exit 0              |
| Tests     | `uv run pytest -q`                   | all pass            |

## Scope

**In scope**:
- `backend/api/backtest.py`
- `backend/api/data_sources.py`
- `backend/api/indicators.py`
- `backend/api/strategies.py`
- `backend/api/health.py`
- `backend/api/_helpers.py` (add the shared helper)

**Out of scope**:
- `backend/api/runs.py` (already uses safe messages)
- `backend/api/algos.py` (check before touching — verify no `str(e)` there)
- Any frontend changes

## Steps

### Step 1: Add a shared `_err_msg` helper to `_helpers.py`

Append to `backend/api/_helpers.py`:

```python
def _err_msg(e: Exception) -> str:
    """Return a safe, user-facing error message. Internal details go to the logger."""
    import logging
    logging.getLogger("bt-gui").warning("API error: %s", e)
    return "internal error"
```

### Step 2: Replace `detail=str(e)` in each affected file

In each file, find every `detail=str(e)` (or `detail=f"... {e}"`) and replace with `detail=_err_msg(e)`.

Specific changes:

**`backend/api/backtest.py:112`**:
```python
# Before:
        raise HTTPException(status_code=500, detail=str(e)) from e
# After:
        raise HTTPException(status_code=500, detail=_err_msg(e))
```

**`backend/api/strategies.py:21` and `:86`** — replace both occurrences.

**`backend/api/data_sources.py:62`** — replace the occurrence.

**`backend/api/indicators.py:72`** — replace the occurrence.

**`backend/api/health.py:76`** — the `db_error` variable is used in the response. Change to not include the raw message:
```python
    # Before (line 74-76):
    except Exception as e:  # noqa: BLE001
        db_ok = False
        db_error = str(e)
    # After:
    except Exception:  # noqa: BLE001
        db_ok = False
        db_error = None
```
And update line 82 to conditionally include it:
```python
    return {"status": "ok" if db_ok else "error", "version": version, "db": "ok" if db_ok else "error", "db_error": db_error, "counts": counts}
```

### Step 3: Add the import where needed

Each file that uses `_err_msg` must import it:
```python
from backend.api._helpers import _err_msg
```

## Test plan

Add one test to `tests/backend/test_routes_smoke.py`:

```python
def test_error_response_does_not_leak_path():
    """Trigger an exception in a route and verify the detail message is sanitized."""
    # Call a route with intentionally invalid data to trigger an exception path.
    # The response detail should be "internal error", not a traceback or path.
    r = client.post("/api/bt/backtest", json={"tree": None, "strategy_id": 99999})
    assert r.status_code in (404, 422, 500)
    detail = r.json().get("detail", "")
    assert "/" not in detail or detail == "internal error"
```

Also run the existing suite to confirm no regressions.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -rn "detail=str(e)" backend/api/` returns no matches
- [ ] `grep -rn "_err_msg" backend/api/_helpers.py` returns 1 match (definition)
- [ ] `grep -rn "from backend.api._helpers import _err_msg" backend/api/` returns ≥ 4 matches (one per affected file)
- [ ] `uv run ruff check backend/api/` exits 0
- [ ] `uv run pytest -q` exits 0

## STOP conditions

- Any affected file uses `detail=str(e)` in a pattern not covered above → STOP and report. Verify each file individually before editing.

## Maintenance notes

- If a route needs to return a *validational* error (e.g. "invalid ticker format"), that should use a static string, not `_err_msg`. The helper is only for unexpected exceptions.
- The health endpoint still returns `"db_error": null` on failure now, which is correct — the DB error is logged server-side.

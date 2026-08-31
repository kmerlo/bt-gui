# Plan 018: Add unit tests for run_backtest_sync

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to
> the next step. If anything in the "STOP conditions" section occurs,
> stop and report — do not improvise. When done, update the status row
> for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 3203810..HEAD -- backend/services/backtest_runner.py tests/backend/test_backtest_runner.py`
> If the file content differs from the excerpts below, compare carefully
> before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M (~2 h)
- **Risk**: LOW
- **Depends on**: plans/016.md (dead function removed first so the file is cleaner), plans/015.md (asyncio fix applied first)
- **Category**: tests
- **Planned at**: commit `3203810`, 2026-08-30
- **Issue**: —

## Why this matters

`run_backtest_sync` (lines 131–286 of `backtest_runner.py`) is the critical path that executes the `bt` backtest, sanitizes stats (nan→None, inf→None), saves parquet blobs, and handles the error branch. It is only exercised indirectly through `test_backtest_full_run` (an integration test that requires a real DB, real price data, and a running FastAPI app). A regression in stats sanitization or the error path would go undetected until someone notices bad numbers in the UI.

## Current state

**File**: `backend/services/backtest_runner.py`, lines 131–286.

Key sections to test:
- Lines 220–238: `calc_perf_stats()` call + try/except that falls back to `{"error": str(e), "cagr": 0.0, "max_drawdown": 0.0}`
- Lines 240–248: transaction parquet serialization
- Lines 249–274: price and weight parquet save to DB
- Lines 276–286: outer except that sets `{"error": ...}` progress and writes to DB

**Existing test file**: `tests/backend/test_backtest_runner.py` (160 lines). Tests currently cover:
- `test_backtest_full_run` — happy path via HTTP
- `test_backtest_strategy_id` — strategy-ID path
- `test_backtest_invalid_price_source` — 404 path
- `test_list_runs` — list endpoint
- `test_ws_progress` — WS endpoint

None of these directly test `run_backtest_sync`.

The project test convention (see `tests/backend/test_persistence.py`) uses `sqlite:///:memory:` with `StaticPool` for isolated tests. Follow that pattern.

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Tests     | `uv run pytest -q`       | all pass (new + old) |
| Lint      | `uv run ruff check tests/backend/test_backtest_runner.py` | exit 0 |

## Scope

**In scope**:
- `tests/backend/test_backtest_runner.py` — add new test functions only

**Out of scope**:
- `backend/services/backtest_runner.py` (no production code changes)
- Any other test file
- Frontend changes

## Steps

### Step 1: Add a helper to create an in-memory DB session

At the top of `test_backtest_runner.py`, after the existing imports, add a helper that creates an in-memory SQLite session with the required tables:

```python
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

def _mem_db():
    eng = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    from backend.database import Base
    Base.metadata.create_all(bind=eng)
    return sessionmaker(bind=eng)
```

### Step 2: Test happy path — stats sanitization

```python
def test_run_backtest_sync_sanitizes_stats():
    """Verify that nan/inf values in perf stats are cleaned to None."""
    from backend.services.backtest_runner import run_backtest_sync
    from backend.database import BacktestRun as DBRun
    from backend.models.strategy_tree import StrategyTree
    from backend.models.backtest_config import BacktestConfig
    import pandas as pd

    session_factory = _mem_db()
    # We can't easily mock bt.Backtest, so we test the function with a minimal
    # DataFrame that will cause bt to raise — the error path should write a
    # clean error dict to the DB.
    # This test mainly verifies the DB write path is correct.
    eng = session_factory.kw.get("bind")
    assert eng is not None
```

Actually, mocking `bt.Backtest` is tricky. A better approach: test the function by patching the internal `bt` module. Let's use `unittest.mock.patch`:

```python
from unittest.mock import patch, MagicMock
import math


def _make_tree(name: str = "test_tree"):
    return StrategyTree(
        name=name,
        root={"name": name, "type": "Strategy", "algos": [{"class_name": "RunMonthly"}], "children": []},
        version=1,
    )


def _make_cfg():
    return BacktestConfig()


def test_run_backtest_sync_writes_error_on_bt_failure():
    """When bt.Backtest raises, the run is marked done=true with an error dict."""
    from backend.services.backtest_runner import run_backtest_sync
    from backend.database import Base, engine as test_engine, SessionLocal

    # Use in-memory DB
    mem_eng = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=mem_eng)
    MemSession = sessionmaker(bind=mem_eng)
    db = MemSession()

    try:
        row = DBRun(strategy_id=None, config_json={"strategy_name": "test"}, stats_json=None)
        db.add(row)
        db.commit()
        db.refresh(row)
        run_id = row.id

        price_df = pd.DataFrame({"AAPL": [100.0, 101.0, 102.0]}, index=pd.date_range("2020-01-01", periods=3))

        with patch("backend.services.backtest_runner.bt") as mock_bt:
            mock_bt.Backtest.side_effect = RuntimeError("simulated bt failure")
            run_backtest_sync(run_id, _make_tree(), _make_cfg(), price_df, {}, None, None)

        # Verify DB row has error
        updated = db.query(DBRun).filter(DBRun.id == run_id).first()
        assert updated is not None
        assert updated.stats_json is not None
        assert "error" in updated.stats_json
        assert updated.stats_json["error"] == "simulated bt failure"
    finally:
        db.close()
```

### Step 3: Test that nan/inf in stats are sanitized to None

```python
def test_run_backtest_sync_sanitizes_nan_inf():
    """NaN and Inf values in perf stats are replaced with None."""
    from backend.services.backtest_runner import run_backtest_sync
    from backend.database import Base, BacktestRun as DBRun
    from unittest.mock import patch
    import pandas as pd
    import math

    mem_eng = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=mem_eng)
    MemSession = sessionmaker(bind=mem_eng)
    db = MemSession()

    try:
        row = DBRun(strategy_id=None, config_json={"strategy_name": "test"}, stats_json=None)
        db.add(row)
        db.commit()
        db.refresh(row)
        run_id = row.id

        price_df = pd.DataFrame({"AAPL": [100.0, 101.0, 102.0]}, index=pd.date_range("2020-01-01", periods=3))

        mock_bt_obj = MagicMock()
        mock_perf = {
            "cagr": float("nan"),
            "max_drawdown": float("inf"),
            "total_return": 0.5,
            "daily_sharpe": float("-inf"),
            "good_field": "keep_me",
        }
        mock_bt_obj.get_performance_analytics.return_value = mock_perf
        mock_bt_obj.weights = None
        mock_bt_obj.strategy.get_transactions.return_value = pd.DataFrame()

        with patch("backend.services.backtest_runner.bt") as mock_bt:
            mock_bt.Backtest.return_value = mock_bt_obj
            run_backtest_sync(run_id, _make_tree(), _make_cfg(), price_df, {}, None, None)

        updated = db.query(DBRun).filter(DBRun.id == run_id).first()
        assert updated.stats_json is not None
        assert math.isnan(updated.stats_json.get("cagr", 0) or 0) is False  # was nan, now None
        assert updated.stats_json.get("cagr") is None
        assert updated.stats_json.get("max_drawdown") is None
        assert updated.stats_json.get("total_return") == 0.5
        assert updated.stats_json.get("daily_sharpe") is None
        assert updated.stats_json.get("good_field") == "keep_me"
    finally:
        db.close()
```

### Step 4: Test weights parquet is saved when available

```python
def test_run_backtest_sync_saves_weights_parquet():
    """When bt_obj.weights is a DataFrame, it is saved as weights_parquet."""
    from backend.services.backtest_runner import run_backtest_sync
    from backend.database import Base, BacktestRun as DBRun
    from unittest.mock import patch, MagicMock
    import pandas as pd

    mem_eng = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=mem_eng)
    MemSession = sessionmaker(bind=mem_eng)
    db = MemSession()

    try:
        row = DBRun(strategy_id=None, config_json={"strategy_name": "test"}, stats_json=None)
        db.add(row)
        db.commit()
        db.refresh(row)
        run_id = row.id

        price_df = pd.DataFrame({"AAPL": [100.0, 101.0]}, index=pd.date_range("2020-01-01", periods=2))
        weights_df = pd.DataFrame({"AAPL": [0.5, 0.6]}, index=pd.date_range("2020-01-01", periods=2))

        mock_bt_obj = MagicMock()
        mock_bt_obj.get_performance_analytics.return_value = {"cagr": 0.1, "max_drawdown": 0.02}
        mock_bt_obj.weights = weights_df
        mock_bt_obj.strategy.get_transactions.return_value = pd.DataFrame()

        with patch("backend.services.backtest_runner.bt") as mock_bt:
            mock_bt.Backtest.return_value = mock_bt_obj
            run_backtest_sync(run_id, _make_tree(), _make_cfg(), price_df, {}, None, None)

        updated = db.query(DBRun).filter(DBRun.id == run_id).first()
        assert updated is not None
        assert updated.weights_parquet is not None
        assert isinstance(updated.weights_parquet, bytes)
    finally:
        db.close()
```

## Test plan

Run all tests:
```bash
uv run pytest -q tests/backend/test_backtest_runner.py
```
Expected: 11 existing tests + 3 new tests = 14 total, all passing.

Also run the full suite:
```bash
uv run pytest -q
```

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `uv run pytest -q tests/backend/test_backtest_runner.py` exits 0 with 14 tests
- [ ] `uv run pytest -q` exits 0 (full suite, no regression)
- [ ] `uv run ruff check tests/backend/test_backtest_runner.py` exits 0
- [ ] New tests cover: (a) error path writes error dict, (b) nan/inf sanitization, (c) weights parquet save

## STOP conditions

- `bt` module cannot be patched (e.g. it's imported differently at runtime) → STOP and report. Verify by reading `backend/services/backtest_runner.py` import section first.
- `StaticPool` causes issues with the in-memory DB → try removing `poolclass=StaticPool` and using a regular in-memory engine instead.

## Maintenance notes

- These tests mock `bt.Backtest`. If the `bt` library API changes (new constructor args, different method names), the mocks will need updating. Add a comment at the top of the test file noting the mocked interface.
- The error-branch DB write (lines 278–286 of `backtest_runner.py`) opens a second `SessionLocal()` inside the outer `except`. The tests verify this path works correctly with the in-memory DB.

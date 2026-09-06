# Plan 025: Add characterization tests for custom_algos SL/TP and EntryGateMemory

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 71f31b5..HEAD -- backend/services/custom_algos.py tests/backend/`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `71f31b5`, 2026-09-05

## Why this matters

`backend/services/custom_algos.py` (490 lines) owns money-path logic — position
exits (`StopLossTakeProfit` with fixed/trailing long/short state in `_entry`,
`_trail_high/low`) and entry gating (`EntryGateMemory` with period gating,
pending-trigger memory, 3 filter modes) — with zero dedicated tests
(`grep custom_algos tests/` returns nothing). Plan 026 will change this exact
behavior; without characterization tests first, the fix cannot prove it did not
regress something else. Tests-first also unblocks the DEBT-02 deduplication
(four repeated SL/TP blocks) later.

## Current state

Relevant files and roles:

- `backend/services/custom_algos.py` — `StopLossTakeProfit`, `RebalanceAlways`,
  `EntryGateMemory` bt Algo classes (~490 lines). Key excerpts (verified live):
  - Blocked-day branch (`w is None`), `custom_algos.py:77-154`: on breach sets
    `target.temp["weights"] = {}`.
  - Normal branch, `custom_algos.py:194-221`:
    ```python
    for ticker_raw, weight in list(w_dict.items()):
        ticker = str(ticker_raw).upper()
        ...
        if weight == 0:
            self._entry.pop(ticker, None)
            ...
            continue
        is_long = weight > 0
        if ticker not in self._entry:
            # new entry
            self._entry[ticker] = float(price)
    ```
  - Tail write-back, `custom_algos.py:293-299`: preserves Series vs dict type.
- `tests/conftest.py:5-17` — session-autouse fixture switches to the `test` DB
  and restores afterwards. These new tests are pure unit tests (no DB): do NOT
  touch the DB at all.
- `tests/backend/test_signal_engine.py` — exemplar for plain unit-test style
  (imports service module directly, synthetic pandas frames, no fixtures).
- Repo conventions: `uv run pytest -q` must pass; `uv run ruff check .` exit 0;
  line-length 180; tests use plain `assert`, no test class framework required.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Tests (new file) | `uv run pytest tests/backend/test_custom_algos.py -q` | all pass |
| Full suite | `uv run pytest -q` | all pass |
| Lint | `uv run ruff check .` | exit 0 |

## Scope

**In scope** (the only files you should modify):

- `tests/backend/test_custom_algos.py` (create)

**Out of scope** (do NOT touch, even though they look related):

- `backend/services/custom_algos.py` — behavior changes belong to plan 026;
  this plan is tests-only.
- `backend/services/backtest_runner.py`, `bt_gui.db` — no DB, no runner.
- Real `bt` backtest runs — use a stub `target`, never `bt.run()`.

## Git workflow

- Trunk-based per `AGENTS.md` §6: work on `master`, commit locally, then
  `git push origin master`. No feature branches.
- Commit message style (from `git log`): `test: <what>` e.g.
  `test: characterization tests for custom_algos SL/TP and EntryGate`.

## Steps

### Step 1: Build the stub-target harness

Create `tests/backend/test_custom_algos.py` with a minimal stub:

```python
class StubTarget:
    def __init__(self, price_dict, now=None):
        self.temp = {}
        self._prices = price_dict  # {TICKER: price}
        self.now = now
    # expose universe/prices the way the algos read them
```

Check how the algos read prices/universe: `StopLossTakeProfit.__call__` builds
`price_dict` from `target.universe` at `target.now` (read the top of
`custom_algos.py:1-76` first and match the harness to the real attribute names
— `target.temp`, `target.universe`, `target.now`). If the attribute names differ
from this sketch, adapt the harness (do not change the service).

Cover the constructor signatures actually present (read them; do not guess
param names — e.g. `stop_loss_long`, `take_profit_long`, `trailing_long`, ...).

**Verify**: `uv run pytest tests/backend/test_custom_algos.py -q --collect-only` →
lists the harness import with 0 errors (tests may fail, collection must work).

### Step 2: SL/TP characterization tests (normal branch)

Add tests driving `StopLossTakeProfit.__call__(stub)` bar-by-bar with synthetic
prices, asserting `stub.temp["weights"]` contents and `_entry`/`_trail_*` state:

1. Fixed long SL triggers at `entry * (1 - stop_loss_long)`; survivor tickers
   keep their weights (multi-ticker: breach on A crashes only A, B untouched).
2. Fixed long TP triggers at `entry * (1 + take_profit_long)`.
3. Trailing long ratchets `_trail_high` up on new highs, exits on
   `price <= high * (1 - trailing_long)`.
4. Short side mirror: fixed short SL at `entry * (1 + stop_loss_short)`.
5. `weight == 0` clears `_entry`/`_trail_*` for that ticker.
6. Tickers deselected from `w_dict` get state cleared (lines ~286-291).

**Verify**: `uv run pytest tests/backend/test_custom_algos.py -q` → new tests pass.

### Step 3: Blocked-day branch + EntryGateMemory tests

1. `w is None` (RunMonthly-blocked day) with a breached ticker: record ACTUAL
   current behavior in the assertion (expected per live code: whole-portfolio
   exit). Mark the test with a comment `# plan-026 will change this to
   per-ticker exit` so plan 026 knows exactly which assertion to flip.
2. `EntryGateMemory`: period-start promotion of pending triggers, consumption
   on trigger, and each filter mode present in the class (read the class for
   exact mode names — do not guess).
3. `RebalanceAlways`: sets weights from `target.temp` on entry days (smoke).

**Verify**: `uv run pytest tests/backend/test_custom_algos.py -q` → all pass
(minimum 10 tests total across steps 2-3).

### Step 4: Full gates

**Verify**: `uv run pytest -q` → all pass. `uv run ruff check .` → exit 0.

## Test plan

- New file `tests/backend/test_custom_algos.py`, ≥10 tests: fixed SL/TP long,
  trailing long, short mirror, weight-0 clear, deselect clear, multi-ticker
  isolation, blocked-day current behavior (marked for 026), EntryGate modes,
  RebalanceAlways smoke.
- Structural pattern: `tests/backend/test_signal_engine.py` (direct import,
  synthetic frames, plain asserts).
- Verification: `uv run pytest tests/backend/test_custom_algos.py -q` → all pass.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `uv run pytest -q` exits 0 (including ≥10 new tests in
  `test_custom_algos.py`)
- [ ] `uv run ruff check .` exits 0
- [ ] `grep -rn "custom_algos" tests/ | wc -l` returns ≥10
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `custom_algos.py` top-of-file (lines 1-76) does not match the excerpts
  (codebase drifted since this plan was written).
- The Algo classes cannot be instantiated without a real `bt` universe object
  (assumption "stub target suffices" is false) — report what constructor/`__call__`
  actually requires.
- Full-suite `pytest` failures appear in files other than the new one.

## Maintenance notes

- Plan 026 flips the blocked-day test to per-ticker exit semantics.
- If SL/TP params are renamed later, these tests are the contract — update both.
- Reviewer: check no test hits the real DB or network (all synthetic).

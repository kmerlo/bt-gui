# Plan 026: Fix SL/TP blocked-day full liquidation and stale entry on flip

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 71f31b5..HEAD -- backend/services/custom_algos.py tests/backend/test_custom_algos.py`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/025-test-custom-algos-characterization.md
- **Category**: bug
- **Planned at**: commit `71f31b5`, 2026-09-05

## Why this matters

Two money-path bugs in `StopLossTakeProfit` produce wrong backtest exits:
(1) on RunMonthly-blocked days (`w is None`) a single ticker breaching SL/TP
zeroes the WHOLE portfolio instead of just that ticker; (2) when a position
flips direction (long→short), the old entry price and trail state are reused
for the new direction. Saved multi-asset strategies using SL/TP get wrong
equity curves. Results will shift toward correct — that is intended.

## Current state

- `backend/services/custom_algos.py`, blocked-day branch `w is None`
  (lines ~77-154, verified live). Every breach path does:
  ```python
  self._entry.pop(ticker, None)
  self._trail_high.pop(ticker, None)
  target.temp["weights"] = {}
  continue
  ```
  (6+ sites: lines ~93, 100, 108, 115, 126, 133, 141, 148). The normal branch
  instead builds per-ticker `new_weights` (lines ~190-299). After the loop:
  ```python
  if "weights" not in target.temp or target.temp["weights"] is None:
      # no forced exit, leave weights missing -> Rebalance won't run, which is correct for non-entry days
      pass
  return True
  ```
- Flip bug, `custom_algos.py:211-221` (verified live):
  ```python
  if ticker not in self._entry:
      # new entry
      self._entry[ticker] = float(price)
  ```
  No side tracking: a long→short flip keeps old `entry`/`_trail_high`.
- `RebalanceAlways` consumes `target.temp["weights"]` — on blocked days it
  must act only when a forced exit happened (existing tail logic above).
- Tests from plan 025 exist in `tests/backend/test_custom_algos.py`, including
  one blocked-day test marked `# plan-026 will change this to per-ticker exit`.
- Convention: `uv run pytest -q`, `uv run ruff check .` exit 0. Never modify
  user rows in `bt_gui.db` (AGENTS.md §9); these tests use stub targets only.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Targeted tests | `uv run pytest tests/backend/test_custom_algos.py -q` | all pass |
| Full suite | `uv run pytest -q` | all pass |
| Lint | `uv run ruff check .` | exit 0 |

## Scope

**In scope** (the only files you should modify):

- `backend/services/custom_algos.py`
- `tests/backend/test_custom_algos.py` (flip the marked blocked-day assertion,
  add flip tests)

**Out of scope** (do NOT touch, even though they look related):

- `backend/services/backtest_runner.py` — split belongs to plan 030.
- DEBT-02 deduplication of the 4× SL/TP blocks — explicitly deferred; fix
  semantics in place, do not refactor structure here.
- Saved strategies / `bt_gui.db` rows — results shifting is expected, no data
  migration.

## Git workflow

- Trunk-based per `AGENTS.md` §6: work on `master`, commit locally, then
  `git push origin master`. No feature branches.
- Message style: `fix: <what>` e.g. `fix: SL/TP blocked-day per-ticker exit + entry reset on flip`.

## Steps

### Step 1: Per-ticker exit in the blocked-day branch

In the `w is None` branch, replace whole-portfolio liquidation with per-ticker
exit: when ticker T breaches, remove T from tracking AND emit weights that keep
all other currently-tracked positions alive. Concretely: maintain the set of
live tickers as `set(self._entry.keys())` (entries imply open positions in this
branch, since entries are only added on entry days); after processing all
tickers, if any forced exit happened, set
`target.temp["weights"] = {t: <carry weight> for live survivors}` — read how
`RebalanceAlways` interprets blocked-day weights first and match it: the
minimal correct shape is to write weights only for survivors so Rebalance
closes exactly the breached tickers. If `RebalanceAlways` requires explicit
zero weights for closed tickers, write `{survivor: 1.0..., breached: 0.0}`
instead — verify against its code, do not guess.

Keep the tail "no forced exit → leave weights missing" logic intact.

**Verify**: `uv run pytest tests/backend/test_custom_algos.py -q` → the old
marked blocked-day test now FAILS (proving behavior changed), everything else
passes.

### Step 2: Flip the marked test, add isolation test

Update the `# plan-026` marked test to assert per-ticker exit (breached ticker
closed, survivor kept). Add: two tickers breach on the same blocked day → both
closed, third survivor kept.

**Verify**: `uv run pytest tests/backend/test_custom_algos.py -q` → all pass.

### Step 3: Reset entry/trail state on direction flip

In the normal branch at `custom_algos.py:211-221`: track entry side. Minimal
change: when `ticker in self._entry` but the incoming weight sign differs from
the tracked side (long = `ticker in self._trail_high`, short = in
`_trail_low`), re-initialize `_entry[ticker] = float(price)` and reset
`_trail_high`/`_trail_low` for the new side — i.e. treat as a new entry at the
current price. Add tests: long→short and short→long flips assert TP/SL levels
computed from the flip price, not the original entry.

**Verify**: `uv run pytest tests/backend/test_custom_algos.py -q` → all pass.

### Step 4: Full gates + tutorial regression

**Verify**: `uv run pytest -q` → all pass (note: tutorial tests asserting exact
equity numbers may shift — if `test_tutorial3_sma_parent.py` or benchmark
tests fail ONLY on numeric expectations while structure assertions pass, update
the numeric expectations ONLY if the new numbers are explainable by this fix;
otherwise STOP). `uv run ruff check .` → exit 0.

## Test plan

- Flip the plan-025 marked blocked-day test to per-ticker semantics + same-day
  double-breach test.
- New flip tests (both directions) asserting entry reset at flip price.
- Existing suite as regression net; tutorial numeric shifts need explanation.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `uv run pytest -q` exits 0
- [ ] `uv run ruff check .` exits 0
- [ ] `grep -n 'temp\["weights"\] = {}' backend/services/custom_algos.py`
  returns no matches (no whole-portfolio liquidation left)
- [ ] `grep -n "plan-026 will change" tests/backend/test_custom_algos.py`
  returns no matches (marker resolved)
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Plan 025 is not DONE (tests missing) — do this plan after 025.
- `RebalanceAlways` cannot express "close T, keep others" on blocked days
  (assumption false) — report its exact consumption logic.
- A tutorial/benchmark numeric test fails and the delta is NOT explainable by
  per-ticker exits — report expected vs actual.
- The fix requires touching `backtest_runner.py` or any out-of-scope file.

## Maintenance notes

- Backtest results for saved SL/TP strategies change (toward correct) — tell
  users to re-run affected runs; no DB migration needed.
- DEBT-02 (4× block dedup) is still open and now safer thanks to these tests.
- Reviewer: scrutinize the survivor-weights shape vs `RebalanceAlways`.

# Plan 027: Fix cross_over/down two-operand semantics and bool fast-path

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 71f31b5..HEAD -- backend/services/signal_engine.py backend/services/tree_serializer.py tests/backend/test_signal_engine.py tests/backend/test_signals_api.py`
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

Two signal-path bugs produce silently wrong boolean signals: (1)
`cross_over`/`cross_down` resolve only the LEFT operand and compare a series
against its own shift (momentum), so any two-operand cross (fast-above-slow,
price-cross-SMA) is wrong with no error; (2) the "signals are already boolean
— skip condition" fast path in `tree_serializer.py` uses `t is bool`, which is
always False for pandas dtypes, so boolean frames get re-thresholded. Saved
signals/strategies using cross ops will change output (toward correct).

## Current state

- `backend/services/signal_engine.py:130-137` (verified live):
  ```python
  if op in ("cross_over", "cross_down"):
      ind = resolve_value(expr["left"], indicators, price_df)
      if isinstance(ind, pd.DataFrame):
          ind = _normalize_indicator_cols(ind, price_df)
      # ponytail: ind may be DataFrame after normalization
      if isinstance(ind, pd.DataFrame):
          return ind > ind.shift(1) if op == "cross_over" else ind < ind.shift(1)  # type: ignore[operator]
      return ind > ind.shift(1) if op == "cross_over" else ind < ind.shift(1)  # type: ignore[attr-defined]
  ```
  `expr["right"]` is never read. `SUPPORTED_OPS` (`signal_engine.py:6-10`):
  `gt lt gte lte eq neq above below cross_over cross_down and or not`.
- `backend/services/tree_serializer.py:46-49` — same single-DataFrame shift
  pattern for `signal_condition`.
- `backend/services/tree_serializer.py:65-76` (verified live):
  ```python
  if algo_cfg.class_name != "WeighTarget":
      if not df.dtypes.apply(lambda t: t is bool).all():
          condition = getattr(algo_cfg, "signal_condition", None)
          df = _apply_signal_condition(df, condition, price_df)
  ```
- Expression shape: leaves are `{"type": "indicator"|"signal"|"value", ...}`
  via `resolve_value` (`signal_engine.py:13-24`); cross callers pass
  `{"op": "cross_over", "left": {...}, "right": {...}}` — confirm by reading
  `SignalPanel.tsx` payload construction and `tests/backend/test_signal_engine.py`
  before changing semantics.
- Conventions: `uv run pytest -q`, `uv run ruff check .` exit 0. FE types are
  generated (`frontend/src/types/bt.ts`) — if the API contract changes, note it
  but do NOT regenerate types here (needs BE on :8001; out of scope).

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Targeted tests | `uv run pytest tests/backend/test_signal_engine.py tests/backend/test_signals_api.py -q` | all pass |
| Full suite | `uv run pytest -q` | all pass |
| Lint | `uv run ruff check .` | exit 0 |

## Scope

**In scope** (the only files you should modify):

- `backend/services/signal_engine.py`
- `backend/services/tree_serializer.py`
- `tests/backend/test_signal_engine.py` (new cross/bool tests; update stale
  expectations only where the old behavior was the bug)

**Out of scope** (do NOT touch, even though they look related):

- `backend/api/signals.py` compute-weights positional compare — real but
  separate finding; do not expand scope.
- `backend/services/indicator_calculator.py` multi-output columns — separate.
- FE `SignalPanel.tsx` — unless the request shape must change (prefer keeping
  the shape, fixing server semantics).

## Git workflow

- Trunk-based per `AGENTS.md` §6: work on `master`, commit locally, then
  `git push origin master`. No feature branches.
- Message style: `fix: <what>` e.g. `fix: true two-operand cross semantics + bool fast-path`.

## Steps

### Step 1: Define and implement two-operand cross

1. Read `SignalPanel.tsx` + existing cross tests to fix the exact
   `left`/`right` expression shapes in use.
2. In `signal_engine.py`, resolve BOTH operands, align them (reindex to common
   index/columns via the existing `_normalize_indicator_cols` for DataFrames),
   and compute edge transitions:
   - `cross_over`: `(left > right) & (left.shift(1) <= right.shift(1))`
   - `cross_down`: `(left < right) & (left.shift(1) >= right.shift(1))`
3. Keep the rising/falling single-operand form ONLY when `right` is absent
   (back-compat for callers that relied on momentum form) — document with a
   one-line comment.
4. Mirror the same fix in `tree_serializer.py:46-49` `signal_condition` path.

**Verify**: `uv run pytest tests/backend/test_signal_engine.py -q` → pass
(existing cross tests may fail here — expected; fixed in step 3).

### Step 2: Fix the bool fast-path predicate

Replace `df.dtypes.apply(lambda t: t is bool)` with
`df.dtypes.apply(pd.api.types.is_bool_dtype)`. Boolean frames must now bypass
`_apply_signal_condition`; non-boolean frames keep current behavior (verify
`gt 0` flows produce identical output before/after — add an assertion).

**Verify**: `uv run pytest tests/backend/test_signal_engine.py -q` → pass.

### Step 3: Tests

Add to `tests/backend/test_signal_engine.py`:

1. Two-operand cross_over on synthetic fast/slow frames: True exactly on the
   crossing bar, False elsewhere (same for cross_down).
2. Misaligned columns/index between operands → aligned comparison, no crash.
3. Single-operand (no `right`) → legacy rising/falling preserved.
4. All-boolean DataFrame through the `tree_serializer` param path → returned
   untouched (condition NOT applied); `gt 0` on ints → unchanged output.
5. Update any existing test that asserted the old momentum-as-cross behavior.

**Verify**: targeted tests pass; then `uv run pytest -q` → all pass;
`uv run ruff check .` → exit 0.

## Test plan

- 5+ new tests listed above in `tests/backend/test_signal_engine.py`.
- Pattern: existing file (synthetic frames, direct function calls).
- Full suite as regression net for signal consumers (`test_signals_api.py`,
  tutorial tests).

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `uv run pytest -q` exits 0
- [ ] `uv run ruff check .` exits 0
- [ ] `grep -n 'expr\["right"\]' backend/services/signal_engine.py` returns
  ≥1 match (right operand is read)
- [ ] `grep -n "t is bool" backend/services/tree_serializer.py` returns no matches
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The FE sends cross expressions WITHOUT a `right` key (assumption false) —
  report the actual payload shape from `SignalPanel.tsx`.
- Fixing `tree_serializer.py:46-49` requires changing the public request shape
  (FE + regenerated types) — stop; that is a bigger migration.
- Tutorial/signal API tests fail on numeric expectations not explainable by
  correct cross semantics — report expected vs actual.

## Maintenance notes

- Saved cross-based signals/strategies change output — users should re-validate
  affected runs; no DB migration.
- If a new cross variant is added, extend the edge-transition helper, not
  call sites.
- Reviewer: check alignment logic (columns AND index) in the two-operand path.

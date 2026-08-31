# Plan 001: Harden commission simple_fn eval (RCE)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 8f78919..HEAD -- backend/models/backtest_config.py backend/services/backtest_runner.py frontend/src/bt/components/SettingsView.tsx frontend/src/bt/components/RunDialog.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `8f78919`, 2026-08-30
- **Issue**: —

## Why this matters

`simple_fn` is user-controlled (saved in `StrategyTree`/`BacktestConfig` and via
FE inputs). It is `eval`ed in two BE places and twice in FE with direct `eval`.
An attacker who can create a strategy (any authenticated user, or anyone with
write access to `bt_gui.db`) achieves arbitrary code execution on the BE at
backtest time. The fix is a whitelist AST parser that only allows `lambda
quantity, price: <arithmetic>` — the only legitimate use. FE `eval` is removed
entirely (validation there is UI-only; BE stays the gate).

## Current state

Relevant files and roles:

- `backend/models/backtest_config.py:19-29` — Pydantic validator that `eval`s the string and checks callable+arity:
  ```python
  @field_validator("simple_fn")
  def validate_simple_fn(cls, v: str | None) -> str | None:
      if v is None:
          return v
      fn = eval(v, {"__builtins__": {}})  # noqa: S307
      if not callable(fn):
          raise ValueError("simple_fn must eval to callable")
      sig = inspect.signature(fn)
      ...
      if len(params) < 2:
          raise ValueError("commission fn must accept (quantity, price)")
      return v
  ```
- `backend/services/backtest_runner.py:75-79` — runtime `eval` of the same string:
  ```python
  def _build_commission(cfg: BacktestConfig):
      if cfg.commission.simple_fn:
          fn = eval(cfg.commission.simple_fn, {"__builtins__": {}})  # noqa: S307
          return fn
      return None
  ```
- `frontend/src/bt/components/SettingsView.tsx:144` and `frontend/src/bt/components/RunDialog.tsx:102` — FE preview `eval(settings.simple_fn)` / `eval(v)` to test the function before save. Triggers Vite `EVAL` warning (`npm run build` output shows it).

Repo conventions (from `my-docs/GUIDE-CODING_PRACTICES.md`):
- Validation at trust boundaries, error handling that prevents data loss is never skipped (ponytail "When NOT to be lazy").
- `uv run ruff check .` and `npm run build` must pass.

Exemplar for safe parsing: none yet — this plan introduces `backend/services/commission_parser.py` following single-responsibility (`services/` one file per domain, `AGENTS.md:3`).

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Install | `uv sync` | exit 0 |
| Typecheck FE | `npm run build --prefix frontend` | exit 0, no `EVAL` warning |
| Lint | `uv run ruff check .` | exit 0 |
| Tests | `uv run pytest -q` | all pass |
| Manual check | `uv run python -c "from backend.models.backtest_config import CommissionConfig; CommissionConfig(simple_fn='lambda q,p: q*p*0.001')"` | exit 0 |

## Suggested executor toolkit

- `ast` stdlib for parsing — no new dependency.

## Scope

**In scope** (only files you should modify):

- `backend/services/commission_parser.py` (create)
- `backend/models/backtest_config.py`
- `backend/services/backtest_runner.py`
- `frontend/src/bt/components/SettingsView.tsx`
- `frontend/src/bt/components/RunDialog.tsx`
- `tests/backend/test_backtest_runner.py` (or new `tests/backend/test_commission_parser.py`)

**Out of scope** (do NOT touch):

- `backend/api/routes.py` — god-file split is plan 002.
- `frontend/src/bt/store/btStore.ts` — plan 003.
- Any change to `bt` library itself.

## Git workflow

- Branch: `advisor/001-harden-commission-eval` (or work directly on `master` per trunk-based repo — match `git log --oneline` which shows direct `master` pushes).
- Commit per step; message style: `fix(security): harden commission simple_fn` (conventional, as in `git log`).
- Do NOT push unless operator instructs.

## Steps

### Step 1: Create AST whitelist parser

Create `backend/services/commission_parser.py`:

- Export `parse_commission_fn(src: str) -> Callable[[float,float], float]` and `validate_commission_src(src: str) -> str` (returns src if valid, else raises `ValueError`).
- Allowed AST: `Module` with single `Expr` → `Lambda` with exactly 2 args (`quantity`/`price` names not enforced, but arity 2). Body may only contain: `BinOp` (`Add/Sub/Mult/Div/Pow/Mod`), `UnaryOp` (`USub/UAdd`), `Constant`/`Num`, `Name` (only the two arg names), and `Call` is **forbidden**, `Attribute` forbidden, `Subscript` forbidden, `IfExp` allowed optionally. No `Import`, no `Name` beyond args, no `__class__` etc. Walking must reject anything else with `ValueError("commission: disallowed syntax <node>")`.
- Provide `build_fn` that compiles via `compile(ast.parse(src, mode="eval"))` and `eval` with `{"__builtins__": {}}` but only after whitelist check — or better, compile+eval the lambda node directly.
- Include docstring with one line: `# ponytail: whitelist AST, expand if bounded use-case needs it`.

**Verify**: `uv run ruff check backend/services/commission_parser.py` → exit 0

### Step 2: Wire BE validator and runner through parser

- In `backend/models/backtest_config.py`: replace `eval(v, {"__builtins__": {}})` in `validate_simple_fn` with `from backend.services.commission_parser import validate_commission_src; validate_commission_src(v)` and keep the callable/arity checks via `parse_commission_fn` inspection. Keep `inspect.signature(parse_commission_fn(v))` check.
- In `backend/services/backtest_runner.py:75-79`: replace `eval(cfg.commission.simple_fn, {"__builtins__": {}})` with `from backend.services.commission_parser import parse_commission_fn; return parse_commission_fn(cfg.commission.simple_fn)`.

**Verify**: `uv run ruff check .` → exit 0

### Step 3: Remove FE `eval` — switch to try/validate UI only

- In `frontend/src/bt/components/SettingsView.tsx:144` and `frontend/src/bt/components/RunDialog.tsx:102`: remove `eval(...)`. Instead, do a lightweight syntactic check: `const ok = /^\\s*lambda\\s+\\w+\\s*,\\s*\\w+\\s*:/.test(v)` and try `new Function` is **also** forbidden — just regex + message "Validazione completa al salvataggio (BE)". If the user insists on preview, compute example `0.001*100*50` via arithmetic, not eval.
- Ensure no `eval` remains: `grep -rn "eval(" frontend/src` → 0 matches.

**Verify**: `npm run build --prefix frontend` → exit 0 and no `[EVAL]` warnings. Previously it warned at both files.

### Step 4: Add tests

Add `tests/backend/test_commission_parser.py` (or extend `test_backtest_runner.py`):

- `test_valid_lambda` — `lambda q,p: q*p*0.001` parses and `fn(100,50)==5.0`
- `test_valid_expression_variants` — `lambda quantity, price: quantity*price*0.002 + 1`
- `test_rejects_builtin_access` — `lambda q,p: __import__('os').system('x')` raises `ValueError`
- `test_rejects_attribute` — `lambda q,p: q.__class__` raises
- `test_rejects_wrong_arity` — `lambda q: q` raises
- Keep existing `test_backtest_runner.py` passing.

**Verify**: `uv run pytest -q -k commission` → 5 passed; `uv run pytest -q` → all pass.

## Test plan

- New file `tests/backend/test_commission_parser.py` covering cases above; model after `tests/backend/test_backtest_runner.py`.
- Existing tests must still pass: `uv run pytest -q`.

## Done criteria

Machine-checkable — ALL must hold:

- [ ] `grep -rn "eval(" backend --include="*.py"` returns only `commission_parser.py` line with `compile` (no bare `eval(..., {"__builtins__"`) outside it) — i.e. `grep -rn 'eval(' backend/models backend/services/backtest_runner.py` → 0
- [ ] `grep -rn "eval(" frontend/src` → 0
- [ ] `uv run ruff check .` exits 0
- [ ] `npm run build --prefix frontend` exits 0 without `EVAL` warning
- [ ] `uv run pytest -q` exits 0, including new commission tests
- [ ] `plans/README.md` row for 001 updated to DONE

## STOP conditions

Stop and report if:

- The excerpts in "Current state" don't match live code (drift).
- `commission_parser` would need to allow a construct you found in real saved strategies (e.g. `max`, `min`, `abs` used in production `simple_fn` values). If so, STOP — propose expanded whitelist instead of silently widening.
- `npm run build` or `uv run pytest` fails twice after reasonable fix.

## Maintenance notes

- If commission logic ever needs `max/min/abs`, expand the whitelist in `commission_parser.py` explicitly (add `Call` allowlist). Reviewer must check that no `Attribute` bypass is introduced.
- Future `simple_fn` UI should reuse the same regex hint; don't reintroduce FE `eval`.

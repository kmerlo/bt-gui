# Plan 011: Fix stale BE/FE structure in GUIDE-CODING_PRACTICES.md

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 198124c..HEAD -- my-docs/GUIDE-CODING_PRACTICES.md backend/api backend/services frontend/src/api frontend/src/bt/store frontend/src/hooks frontend/src/bt/components`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S (2-3h)
- **Risk**: LOW
- **Depends on**: none
- **Category**: docs
- **Planned at**: commit `198124c`, 2026-08-30

## Why this matters

`my-docs/GUIDE-CODING_PRACTICES.md:250-302` describes a monolithic `backend/api/routes.py` unico ingresso and `frontend/src/api/bt.ts` barrel + `frontend/src/types/bt.ts`. The live codebase at `198124c` has split `backend/api/` into 8 routers (`algos.py`, `backtest.py`, `data_sources.py`, `health.py`, `indicators.py`, `price_data.py`, `runs.py`, `strategies.py`, `routes.py` as facade), `frontend/src/api/` into 7 files (`request.ts`, `price.ts`, `data.ts`, `strategies.ts`, `algos.ts`, `runs.ts`, `settings.ts`, `bt.ts` barrel), and `backend/services/` now has 7 services (`algo_registry.py`, `backtest_runner.py`, `commission_parser.py`, `data_loader.py`, `indicator_calculator.py`, `persistence.py`, `tree_serializer.py`). New contributors following the guide create files in the wrong place and violate rule 10 (APIRouter prefix) because they don't know the split.

## Current state

Relevant files, each with one line on its role:
- `my-docs/GUIDE-CODING_PRACTICES.md:250-272` — Backend file tree, currently shows `backend/api/routes.py # APIRouter(prefix="/api/bt") — UNICO punto` and `backend/services/` with 5 services.
- `my-docs/GUIDE-CODING_PRACTICES.md:278-302` — Frontend file tree, shows `frontend/src/api/bt.ts # request<T>, WS_BASE` single file and `bt/components/` with 5 entries.
- `backend/api/` — actual split (8 routers). `backend/api/routes.py:1` is aggregator that includes sub-routers, not the sole route file.
- `frontend/src/api/` — actual split (7 files + barrel).
- `backend/services/data_loader.py:78` — `fetch_and_store_yf` canonical (yfinance), `fetch_ffn` legacy — guide says `ffn loading` (line 267).
- `frontend/src/bt/store/` — has `btStore.ts`, `preset.ts`, `treeOps.ts` (3 files, guide shows 1).
- `frontend/src/hooks/` — has `useTreeDrag.ts`, `useRunsTable.ts`, `useEquityCharts.ts`, `useRunDetail.ts`, `useStrategySave.ts` (5 files, guide shows 3).
- `frontend/src/bt/components/` — has 15 files including `DateInputIT.tsx`, `MetricsPanel.tsx`, `RunsTable.tsx`, `TransactionsTable.tsx` (guide shows 6).

Excerpts (as at 198124c):

`my-docs/GUIDE-CODING_PRACTICES.md:254-272`:
```
backend/
├── main.py              # FastAPI app, CORS, include_router — NUNCA route qui
├── database.py          # Engine, SessionLocal, Base, get_db
├── models/
│   ├── strategy_tree.py # Pydantic: NodeConfig, AlgoConfig, StrategyTree
│   ├── backtest_config.py
│   └── data_source.py
├── services/
│   ├── tree_serializer.py   # StrategyTree → bt.Strategy
│   ├── algo_registry.py     # discover_algos(), algo_json_schema()
│   ├── data_loader.py       # CSV/Parquet/ffn loading
│   ├── backtest_runner.py   # async run in threadpool + WS progress
│   └── persistence.py       # CRUD SQLite
└── api/
    ├── __init__.py
    └── routes.py        # APIRouter(prefix="/api/bt") — UNICO punto di integrazione
```

`my-docs/GUIDE-CODING_PRACTICES.md:278-302`:
```
frontend/src/
├── api/
│   └── bt.ts                # request<T>, WS_BASE, btApi namespace
├── types/
│   └── bt.ts                # AUTO-GENERATO da openapi-typescript — NON editare a mano
├── bt/
│   ├── components/
│   │   ├── TreeEditor.tsx   # orchestrazione drag+render
│   │   ├── NodeCard.tsx     # singolo nodo (piccolo, <80 righe)
│   │   ├── AlgoStack.tsx    # composer algo
│   │   ├── DataManager.tsx
│   │   ├── RunDialog.tsx
│   │   └── ResultsDashboard.tsx
│   └── store/
│       └── btStore.ts       # Zustand store
└── hooks/                   # hook separati dalla logica UI
    ├── useTreeDrag.ts
    ├── useTreeInspector.ts
    └── useBacktestRunner.ts
```

`backend/api/` listing at 198124c:
```
backend/api/algos.py
backend/api/backtest.py
backend/api/data_sources.py
backend/api/health.py
backend/api/_helpers.py
backend/api/_query.py
backend/api/indicators.py
backend/api/price_data.py
backend/api/routes.py
backend/api/runs.py
backend/api/strategies.py
```

`frontend/src/api/` listing:
```
frontend/src/api/algos.ts
frontend/src/api/bt.ts          # barrel re-export
frontend/src/api/data.ts
frontend/src/api/price.ts
frontend/src/api/request.ts
frontend/src/api/runs.ts
frontend/src/api/settings.ts
frontend/src/api/strategies.ts
```

Repo conventions that apply:
- File tree diagrams must match live `ls` output; use same indentation and comments as `AGENTS.md:44-59` (which is already closer to reality).
- `APIRouter(prefix="/api/bt")` is distributed across `backend/api/*.py` but aggregated in `backend/api/routes.py` — keep that nuance.
- One service = one file; list `commission_parser.py` and `indicator_calculator.py` that were added after guide.
- Verification: `npm run build --prefix frontend` → exit 0, `uv run ruff check .` → exit 0.

Design constraints to honor:
- Keep guide as normative source per `AGENTS.md:3` — edits here are the single source of truth, `AGENTS.md:44-59` is excerpt.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Frontend build | `npm run build --prefix frontend` | exit 0, `tsc -b && vite build` |
| Backend lint | `uv run ruff check .` | exit 0 |
| Tests | `uv run pytest -q` | all pass (64 tests at 198124c) |
| Verify no stale string | `grep -rn "routes.py.*UNICO" my-docs/GUIDE-CODING_PRACTICES.md` | 0 matches after fix |

## Scope

**In scope** (only files you should modify):
- `my-docs/GUIDE-CODING_PRACTICES.md`

**Out of scope** (do NOT touch):
- `AGENTS.md` — updated in plan 013, not here; avoid double-edit conflict.
- `backend/api/*`, `frontend/src/api/*`, `backend/services/*` — code is correct; only docs change here.
- `plans/SPEC.md` — stale there is plan 010 territory, not this.
- Any `my-docs/GUIDE_documentazione_tecnica.md` or `GUIDE_manuale_bt_gui.md`.

## Git workflow

- Repo is trunk-based per `AGENTS.md:80-94`: work on `master`, no `feat/*` branches. Commit directly on `master` (`git add my-docs/GUIDE-CODING_PRACTICES.md && git commit -m "docs: ..."`).
- Do NOT push unless operator says so; commit only.
- Message style: `docs: ...` matching `git log --oneline -5` (`docs: update appunti_sviluppi.md`, `fix(ui): ...`).

## Steps

### Step 1: Update Backend file tree (lines 254-272)

Edit `my-docs/GUIDE-CODING_PRACTICES.md` backend section.

Replace:
```
├── services/
│   ├── tree_serializer.py   # StrategyTree → bt.Strategy
│   ├── algo_registry.py     # discover_algos(), algo_json_schema()
│   ├── data_loader.py       # CSV/Parquet/ffn loading
│   ├── backtest_runner.py   # async run in threadpool + WS progress
│   └── persistence.py       # CRUD SQLite
└── api/
    ├── __init__.py
    └── routes.py        # APIRouter(prefix="/api/bt") — UNICO punto di integrazione
```
With (match live):
```
├── services/
│   ├── tree_serializer.py       # StrategyTree → bt.Strategy
│   ├── algo_registry.py         # discover_algos(), algo_json_schema()
│   ├── data_loader.py           # yfinance (fetch_and_store_yf) + ffn legacy
│   ├── backtest_runner.py       # async run in threadpool + WS progress
│   ├── commission_parser.py     # whitelist simple_fn (plan 001)
│   ├── indicator_calculator.py  # SMA/EMA/RSI/MACD/BB (plan 006)
│   └── persistence.py           # CRUD SQLite
└── api/
    ├── _helpers.py, _query.py   # shared pagination/search helpers (plan 008)
    ├── algos.py, backtest.py, data_sources.py, health.py
    ├── indicators.py, price_data.py, runs.py, strategies.py
    └── routes.py                # aggregator — include_router di tutti i sub-router (prefix="/api/bt")
```

Add a one-line note below the tree: `> Ogni router espone APIRouter(prefix="/api/bt") e viene aggregato in routes.py — vedi AGENTS.md:52.`

**Verify**: `grep -n "commission_parser" my-docs/GUIDE-CODING_PRACTICES.md` → 1 match; `grep -n "UNICO punto" my-docs/GUIDE-CODING_PRACTICES.md` → 0 matches.

### Step 2: Update Frontend file tree (lines 278-302)

Replace:
```
├── api/
│   └── bt.ts                # request<T>, WS_BASE, btApi namespace
...
├── bt/
│   ├── components/
│   │   ├── TreeEditor.tsx   # orchestrazione drag+render
│   │   ├── NodeCard.tsx     # singolo nodo (piccolo, <80 righe)
│   │   ├── AlgoStack.tsx    # composer algo
│   │   ├── DataManager.tsx
│   │   ├── RunDialog.tsx
│   │   └── ResultsDashboard.tsx
│   └── store/
│       └── btStore.ts       # Zustand store
└── hooks/                   # hook separati dalla logica UI
    ├── useTreeDrag.ts
    ├── useTreeInspector.ts
    └── useBacktestRunner.ts
```
With (match live 198124c, keep guide concise, list all 15 components + 3 store files + 5 hooks):
```
├── api/
│   ├── request.ts           # request<T>, WS_BASE (plan 008)
│   ├── price.ts, data.ts, strategies.ts, algos.ts, runs.ts, settings.ts
│   └── bt.ts                # barrel re-export (ponytail: <60 lines)
├── types/
│   └── bt.ts                # AUTO-GENERATO — NON editare a mano
├── bt/
│   ├── components/
│   │   ├── TreeEditor.tsx, BuilderView.tsx, AlgoStack.tsx, NodeInspector.tsx
│   │   ├── DataManager.tsx, DataDetailView.tsx, DateInputIT.tsx
│   │   ├── RunDialog.tsx, ResultsDashboard.tsx, RunsTable.tsx, MetricsPanel.tsx
│   │   ├── TransactionsTable.tsx, StrategiesView.tsx, SettingsView.tsx, IndicatorPanel.tsx
│   │   └── (ogni componente <300 righe, solo JSX)
│   └── store/
│       ├── btStore.ts       # Zustand store
│       ├── preset.ts        # persist tickerStart/End, priceColumn, backtestConfig
│       └── treeOps.ts       # findNode/updateNode/addChild/remove/insertAt
└── hooks/
    ├── useTreeDrag.ts, useRunsTable.ts, useRunDetail.ts
    └── useEquityCharts.ts, useStrategySave.ts
```
Add rule line: `components/ solo JSX; logica in hooks/ o store — vedi AGENTS.md:61.`

**Verify**: `grep -n "DateInputIT" my-docs/GUIDE-CODING_PRACTICES.md` → 1; `grep -n "preset.ts" my-docs/GUIDE-CODING_PRACTICES.md` → 1.

### Step 3: Alignment check

Run full verification.

**Verify**: `npm run build --prefix frontend` → exit 0; `uv run ruff check .` → exit 0; `uv run pytest -q` → all pass.

## Test plan

No new tests needed (docs only). Verify:
- Guide file tree matches `ls backend/api | sort` and `ls frontend/src/api | sort` and `ls frontend/src/bt/components | sort` at HEAD.
- No stale `UNICO` string remains.
- Build/lint still pass.

Existing test pattern not needed.

## Done criteria

Machine-checkable. ALL must hold:
- [ ] `grep -rn "routes.py.*UNICO" my-docs/GUIDE-CODING_PRACTICES.md` returns 0
- [ ] `grep -rn "ffn loading" my-docs/GUIDE-CODING_PRACTICES.md` returns 0 (replaced by yfinance note)
- [ ] `grep -c "commission_parser" my-docs/GUIDE-CODING_PRACTICES.md` ≥1 and `grep -c "DateInputIT" my-docs/GUIDE-CODING_PRACTICES.md` ≥1
- [ ] `npm run build --prefix frontend` exits 0
- [ ] `uv run ruff check .` exits 0
- [ ] Only `my-docs/GUIDE-CODING_PRACTICES.md` modified (`git status --porcelain` shows 1 file)

## STOP conditions

Stop and report back (do not improvise) if:
- `backend/api/` no longer has the 8 files listed (split changed) — guide excerpt would be wrong again; report layout.
- `frontend/src/api/bt.ts` is no longer a barrel (content >60 lines or not re-export) — scope assumption broken.
- A step's verification fails twice after a reasonable fix attempt.
- The fix appears to require touching an out-of-scope file.

## Maintenance notes

- When a new router or service is added, update this section the same commit (keep GUIDE and AGENTS in sync; plan 013 adds cross-check note).
- Reviewers should verify `ls` listings match the guide tree; stale tree is worse than no tree.
- Follow-up deferred: `plans/SPEC.md:233` file tree — covered by plans/010, not here.

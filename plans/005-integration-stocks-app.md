# Plan 005: Integrazione bt-gui dentro Stocks_App (router + view)

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 8fd6270..HEAD -- plans/` + `ls ../bt-gui/backend/api/routes.py ../bt-gui/frontend/src/bt/components/BuilderView.tsx` — plans 001–004 must be DONE (bt-gui standalone funzionante su `:8001/:3001`, `BuilderView` + `ResultsDashboard` + `POST /api/bt/backtest` + WS). `ls ../Stocks_App/backend/main.py ../Stocks_App/frontend/src/App.tsx` — Stocks_App deve esistere. If `bt-gui` is still NiceGUI, STOP.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/004-data-runner-results.md
- **Category**: tech-debt / direction
- **Planned at**: commit `8fd6270`, 2026-08-23
- **Issue**: —

## Why this matters

Questo è il payoff di tutta la variante A: `bt-gui` sviluppato in parallelo diventa una view di `Stocks_App` senza riscrittura. Se l'integrazione è 2 righe BE + 5 file FE, il lavoro parallelo ha ripagato; se richiede refactor profondo di `Stocks_App/backend/main.py` (monolite 4000 righe) o duplicazione di tipi, il debito di Stocks_App va affrontato qui.

## Current state

- `bt-gui` standalone: BE `FastAPI` con `APIRouter(prefix="/api/bt")` in `backend/api/routes.py`, FE `React19` con `BuilderView`/`DataManager`/`ResultsDashboard`, `api/bt.ts` con `request<T>`/`WS_BASE`, `types/bt.ts` da OpenAPI, porte `:8001/:3001`, `uv` BE + `npm` FE.
- `Stocks_App`:
  - BE: `Stocks_App/backend/main.py` — monolite `app = FastAPI()` con 62+ route inline, nessun `APIRouter` ( `AGENTS.md:59` ). `database.py` con doppio engine SQLite (`config.db` + `market.db`), `check_same_thread=False`, `SessionLocal`. `pyproject.toml` `uv.lock` committato, `requires-python >=3.11`.
  - FE: `Stocks_App/frontend/src/App.tsx:24-44` `ViewId` union + hash routing `readHash()` + `navigate()` + `renderView()` switch (15 viste). `navItems.ts:5` array `NAV_ITEMS`. `api.ts:29-43` `API_BASE='http://localhost:8000'`, `WS_BASE`, `request<T>`. `types.ts:882` righe, manuale da `schemas.py`. `vite.config.ts:6-11` proxy `/* → http://localhost:8000`. TS strict `verbatimModuleSyntax`, `noUnusedLocals`.
  - Componenti rilevanti: `StrategyBacktestView.tsx` (PineTS backtest, 1200+ righe, `lightweight-charts` pipeline), `PortfolioBacktestView.tsx`, `RRGView.tsx`.
- Integrazione target: `bt-gui` diventa `ViewId = 'bt-builder'` in Stocks_App, riusando stesso `request<T>` e `lightweight-charts` pipeline. BE `bt_router` importato o proxato.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Stocks_App BE test | `uv run pytest -q` (in `Stocks_App/backend`) | all pass (o solo nuovi) |
| Stocks_App FE build | `npm run build` (in `Stocks_App/frontend`) | exit 0 |
| bt-gui BE test | `uv run pytest -q` (in `../bt-gui`) | all pass |
| bt-gui FE build | `npm run build` (in `../bt-gui/frontend`) | exit 0 |
| Manual E2E | Open `http://localhost:3000/#bt-builder`, create tree, Run, see results | works |

## Scope

**In scope** (modify in `Stocks_App` + `bt-gui`):
- `Stocks_App/backend/main.py` (add `include_router` or proxy) — 2-5 righe
- `Stocks_App/backend/database.py` (if sharing DB — optional, see decision below)
- `Stocks_App/frontend/src/navItems.ts` (add bt-builder entry)
- `Stocks_App/frontend/src/App.tsx` (add `ViewId` + `renderView` case + hash handling)
- `Stocks_App/frontend/src/api/bt.ts` (copy from `bt-gui/frontend/src/api/bt.ts`) — or extend `api.ts` with `btApi`
- `Stocks_App/frontend/src/types/bt.ts` (copy from `bt-gui` generated)
- `Stocks_App/frontend/src/components/bt/BuilderView.tsx` + `TreeEditor.tsx` + `AlgoStack.tsx` + `NodeInspector.tsx` + `DataManager.tsx` + `ResultsDashboard.tsx` + `bt/store/btStore.ts` (copy from `bt-gui/frontend/src/bt/`)
- `Stocks_App/frontend/package.json` (add `@dnd-kit/*`, `zustand` if not present — `lightweight-charts` already there)
- `bt-gui/README.md` (document integration)
- `Stocks_App/docs/ANALISI-bt-gui-integration.md` (optional short note)

**Out of scope** (do NOT touch):
- `bt/` — no edits. `bt-gui` still depends on `bt` via path/git.
- `Stocks_App` monolith refactor into `routes/` — not required for this plan. Keep `main.py` monolith + single `include_router` line. Full split is separate plan.
- `bt-gui` standalone — do NOT delete or move; it stays as dev standalone. Integration is copy, not move.
- NiceGUI — archived.

## Git workflow

- Branch: in `Stocks_App` repo, `feat/bt-gui-integration` (from `master`). In `bt-gui` repo, `docs/integration` (or just update README).
- Commits: `feat(backend): mount bt-gui APIRouter`, `feat(frontend): add bt-builder view + btApi`, `feat(frontend): copy bt-gui components`. Message style as `Stocks_App` (`feat:`, `fix:` — check `git log --oneline -5` in Stocks_App).
- Do NOT push unless operator says. This plan touches two repos — commit each separately.

## Steps

### Step 1: Decidi BE integration — `include_router` vs proxy (1 decisione, 1 riga)

**Opzione A — `include_router` (preferita, 2 righe, zero processi extra):**

In `Stocks_App/backend/main.py`, trova `app = FastAPI()` e dopo tutte le route esistenti, aggiungi:

```python
# bt-gui integration — APIRouter isolato, non tocca route esistenti
try:
    from bt_gui.api.routes import router as bt_router  # or from backend.api.routes if bt-gui installed as package

    app.include_router(bt_router)
except ImportError:
    pass  # bt-gui not installed — optional feature
```

Per farlo funzionare, `bt-gui` deve essere installabile da Stocks_App:

```bash
# in Stocks_App/backend
uv add --editable ../bt-gui  # or uv add "bt-gui @ git+https://github.com/kmerlo/bt-gui"
# or if bt-gui not yet a package, just add its backend to PYTHONPATH via symlink/copy
```

Se `bt_gui` non è ancora un package pip (solo `backend/`), alternativa senza package: copia `bt-gui/backend/` → `Stocks_App/backend/bt_gui/` (1 `cp -r`) e adatta import `from bt_gui.api.routes import router`.

**Opzione B — proxy (zero modifiche BE Stocks_App, 1 riga FE):**

Lascia `bt-gui` su `:8001`, in `Stocks_App/frontend/vite.config.ts` aggiungi:

```ts
proxy: {
  '/api': 'http://localhost:8000',        // existing
  '/api/bt': 'http://localhost:8001',     // new — bt-gui BE
}
```

E in `frontend/src/api/bt.ts` usa `API_BASE = 'http://localhost:8000'` ma `'/api/bt/…'` verrà proxato a `:8001` in dev. In produzione, nginx/Caddy fa lo stesso.

**Scegli A se vuoi singolo processo Stocks_App; B se vuoi zero rischio su `main.py` monolite.** Il piano supporta entrambe — A è preferita ma B è fallback se `main.py` include fallisce.

**Verify**: Con A, `uv run uvicorn main:app --port 8000 &` poi `curl -s http://127.0.0.1:8000/api/bt/health | grep -q ok && echo ok` → `ok`. Con B, `curl -s http://127.0.0.1:8001/api/bt/health | grep -q ok && echo ok` → `ok` (bt-gui BE up).

### Step 2: FE — `api/bt.ts` + `types/bt.ts` + deps

Copia (non symlink) da `bt-gui`:

```bash
cp ../bt-gui/frontend/src/api/bt.ts Stocks_App/frontend/src/api/bt.ts
cp ../bt-gui/frontend/src/types/bt.ts Stocks_App/frontend/src/types/bt.ts
```

Se `Stocks_App/frontend/src/api/bt.ts` già esiste (unlikely), merge `request<T>` helpers — mantieni `API_BASE='http://localhost:8000'` (non `:8001`) per integrazione via include_router.

Aggiungi deps mancanti a `Stocks_App/frontend/package.json` (verifica quali già presenti: `lightweight-charts`, `@monaco-editor/react` già ci sono — `package.json:12-21`):

```bash
cd Stocks_App/frontend
npm install zustand @dnd-kit/core @dnd-kit/sortable  # lightweight-charts già presente, non reinstallare
```

Se `zustand` già presente, skip.

**Verify**: `npm run build` (in `Stocks_App/frontend`) → exit 0 (may show `verbatimModuleSyntax` errors — fix with `import type`).

### Step 3: FE — copia `bt/` components + store

```bash
mkdir -p Stocks_App/frontend/src/components/bt Stocks_App/frontend/src/bt/store
cp -r ../bt-gui/frontend/src/bt/components/* Stocks_App/frontend/src/components/bt/
cp -r ../bt-gui/frontend/src/bt/store/* Stocks_App/frontend/src/bt/store/  # or src/components/bt/store — keep same path as bt-gui
# Ensure import paths in copied files point to ../../api/bt and ../../types/bt — adjust if needed
```

Verifica import paths:

* In `TreeEditor.tsx` etc., `import { useBtStore } from '../store/btStore'` deve risolvere. Se `bt-gui` aveva `src/bt/store/btStore.ts` e Stocks_App ha `src/components/bt/store/btStore.ts`, aggiorna import relativi.
* `import { strategiesApi } from '../../api/bt'` — deve puntare a `Stocks_App/frontend/src/api/bt.ts`.

Se `verbatimModuleSyntax` richiede `import type`, fix:

```ts
import type { StrategyTree } from '../../types/bt'
```

**Verify**: `npm run build` → exit 0.

### Step 4: FE — `navItems.ts` + `App.tsx` wiring

`Stocks_App/frontend/src/navItems.ts:5` — aggiungi:

```ts
{ id: 'bt-builder', label: 'BT Builder' },
```

`Stocks_App/frontend/src/App.tsx`:

* Estendi `ViewId` union (`App.tsx:24`):
```ts
export type ViewId = ... | 'bt-builder'
```

* In `renderView()` switch (`App.tsx:119`):
```ts
case 'bt-builder':
  return <BTBuilderView />
```

* Import in cima:
```ts
import BTBuilderView from './components/bt/BuilderView'
```

* Hash routing già gestisce `readHash()` generico — `bt-builder` funziona senza modifiche (`App.tsx:42-53` parses `view` from hash). Verifica che `navigate('bt-builder')` aggiorni hash `#bt-builder`.

Se `BuilderView` in `bt-gui` aveva `RunDialog` che navigava a `results` view interna, adatta per Stocks_App: `BuilderView` può tenere `results` come tab interna o navigare a `#bt-builder&run=123` con `activeSymbol`-like param.

**Verify**: `npm run build` → exit 0. Manuale: `npm run dev` → open `http://localhost:3000/#bt-builder` → palette/tree/inspector render.

### Step 5: E2E smoke + docs

Manuale E2E (con BE up su `:8000` se include_router, o `:8001` se proxy):

1. Open `#bt-builder`
2. Drag `Security` AAPL/MSFT su root Strategy, aggiungi `RunMonthly`+`WeighEqually`+`Rebalance` nello stack
3. Data: upload `prices.csv` o fetch `ffn` (se BE ha ffn route)
4. Run: seleziona `price` source, Run → WS progress → ResultsDashboard 3 chart

Se BE è `include_router`, verifica `openapi.json` contiene `/api/bt/*` paths:

```bash
curl -s http://127.0.0.1:8000/openapi.json | python -c "import json,sys; d=json.load(sys.stdin); assert '/api/bt/health' in str(d['paths'])"
```

Commit:

```bash
# in Stocks_App
git add backend/main.py frontend/src/navItems.ts frontend/src/App.tsx frontend/src/api/bt.ts frontend/src/types/bt.ts frontend/src/components/bt/ frontend/package.json
git commit -m "feat: integrate bt-gui as bt-builder view (APIRouter + React components)"
# in bt-gui
git add README.md
git commit -m "docs: document Stocks_App integration (include_router)"
```

**Verify**: `uv run pytest -q` (in `Stocks_App/backend`) → still pass (new bt routes tested via `TestClient` if added). `npm run build` (in `Stocks_App/frontend`) → exit 0.

## Test plan

- BE: `TestClient` in `Stocks_App/backend/test/test_bt_integration.py` (opzionale, S) — `GET /api/bt/health` 200, `GET /api/bt/algos` contains `Rebalance`, `POST /api/bt/strategies` 201.
- FE: no automated tests required — `npm run build` + manuale E2E `#bt-builder` → run → results.
- Pattern: `Stocks_App/backend/test/` esistente usa `pytest` + `httpx`.

## Done criteria

- [ ] `curl -s http://127.0.0.1:8000/api/bt/health` (o `:8001` se proxy) → `{"status":"ok"}` (con BE up)
- [ ] `grep -q "bt-builder" Stocks_App/frontend/src/navItems.ts` → exit 0
- [ ] `grep -q "BTBuilderView" Stocks_App/frontend/src/App.tsx` → exit 0
- [ ] `ls Stocks_App/frontend/src/api/bt.ts && ls Stocks_App/frontend/src/types/bt.ts && ls Stocks_App/frontend/src/components/bt/BuilderView.tsx` → all exist
- [ ] `npm run build` (in `Stocks_App/frontend`) → exit 0
- [ ] Manual E2E `#bt-builder` → drag-drop → Save → Run → WS progress → ResultsDashboard 3 chart (manuale)
- [ ] `git -C Stocks_App log --oneline -1 | grep -q "bt-gui\|bt-builder"` → exit 0

## STOP conditions

- `Stocks_App/backend/main.py` monolite cannot `include_router` due to `app` not at module level or circular import with `bt_gui` (report `main.py:app` location, consider proxy fallback B).
- `uv add --editable ../bt-gui` fails due to `bt-gui` not being a valid package (no `pyproject.toml` [project] table) — report `uv add` error, fallback to copy `backend/` dir.
- `verbatimModuleSyntax` / `noUnusedLocals` breaks copied `bt/` components (report `tsc` file:line, fix with `import type` and `_` prefix).
- `ViewId` union in `App.tsx` is used in exhaustive switch without `default` — adding `bt-builder` without `default` causes TS error (add case + `default: return null`).
- Port `:8000` vs `:8001` confusion — if BE is `include_router`, FE must use `:8000`, not `:8001` (report `API_BASE` value, fix `vite.config.ts` proxy).

## Maintenance notes

- `bt-gui` rimane repo standalone — la copia in `Stocks_App` è one-way snapshot. Se `bt-gui` evolve, re-copy `frontend/src/bt/` + `api/bt.ts` + `types/bt.ts` (add `scripts/sync-from-bt-gui.sh` per automatizzare).
- `Stocks_App/backend/main.py` `include_router` è fragile finché monolite — se Stocks_App migra a `routes/` (ADR futuro), sposta `bt_router` include in `backend/routes/__init__.py`.
- `frontend/src/types/bt.ts` è generato da `openapi-typescript` — dopo ogni modifica BE `bt-gui`, rigenera e re-copy.
- Non committare `bt_gui.db` — è gitignored in `bt-gui`, in Stocks_App userà `config.db` o `bt_gui.db` separato (decidi in base a `DATABASE_URL`).
- Se `bt` upstream aggiunge nuovi Security types, aggiorna `bt-gui/backend/services/tree_serializer.py:TYPE_MAP` e re-copy FE palette.

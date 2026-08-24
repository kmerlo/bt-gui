# Plan 001: Bootstrap repo bt-gui — backend FastAPI + frontend Vite (uv)

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 8fd6270..HEAD -- plans/` — this plan lives in `bt/plans/` (repo `bt`), not in `bt-gui`. In-scope for drift = `plans/SPEC.md` and `plans/001-bootstrap-bt-gui.md` itself. The new repo `bt-gui` does not exist yet — create it at `../bt-gui` (sibling of `bt`).

## Status

- **Priority**: P0
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: tech-debt / dx
- **Planned at**: commit `8fd6270`, 2026-08-23
- **Issue**: —

## Why this matters

Senza repo bootstrap non esiste dove scrivere codice. Questo piano crea lo scheletro `bt-gui` con backend FastAPI isolato (`APIRouter(prefix="/api/bt")`) e frontend Vite React19, entrambi gestiti da `uv`/`npm`, con proxy e health check verificabili. Ogni piano successivo assume che `uv run uvicorn backend.main:app --port 8001` e `npm run dev -- --port 3001` partano e che `GET /api/bt/health` risponda 200.

## Current state

- `bt` è fork `pmorissette/bt` su branch `master` (`8fd6270`), Python 3.12 (`.python-version`), `pyproject.toml:113` ha `[tool.uv] package=false`, `make develop` usa `uv`. `bt` non contiene GUI.
- `Stocks_App` è il riferimento per convenzioni FE/BE:
  - FE: `Stocks_App/frontend/package.json:12-21` → `react 19.2.6`, `vite 8.0.12`, `@vitejs/plugin-react 6.0.1`, `typescript ~6.0.2`, `lightweight-charts 5.0.0`, `@monaco-editor/react 4.7.0`; `tsconfig.app.json` ha `verbatimModuleSyntax:true`, `noUnusedLocals:true`, `noUnusedParameters:true`, `erasableSyntaxOnly:true`.
  - Vite proxy: `Stocks_App/frontend/vite.config.ts:6-11` → `server.port 3000, proxy '/*' → http://localhost:8000`.
  - BE: `Stocks_App/backend/pyproject.toml` → `fastapi>=0.129.2`, `uvicorn>=0.41`, `sqlalchemy>=2.0.46`, `requires-python >=3.11`, `uv.lock` committato.
  - API helper: `Stocks_App/frontend/src/api.ts:29-43` → `API_BASE = 'http://localhost:8000'`, `WS_BASE = API_BASE.replace(/^http/,'ws')`, `request<T>(url,opts)` con `fetch(API_BASE+url)` e throw su `!res.ok`.
- `plans/SPEC.md` (variante A) definisce architettura, porte `:8001/:3001`, `APIRouter(prefix="/api/bt")` isolato, struttura `bt-gui/backend` + `bt-gui/frontend`.
- Il nuovo repo `bt-gui` deve stare in `../bt-gui` (sibling di `bt`, così `bt @ file://../bt` funziona in dev).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Create repo dir | `mkdir -p ../bt-gui && ls ../bt-gui` | empty dir |
| Backend deps | `uv sync` (in `../bt-gui`) | exit 0, `uv.lock` created |
| Backend run | `uv run uvicorn backend.main:app --host 127.0.0.1 --port 8001 &` | log `Uvicorn running on http://127.0.0.1:8001` |
| Health check | `curl -s http://127.0.0.1:8001/api/bt/health \| jq .` | `{"status":"ok"}` |
| OpenAPI | `curl -s http://127.0.0.1:8001/openapi.json \| jq .info.title` | `"bt-gui"` |
| Frontend install | `npm install` (in `../bt-gui/frontend`) | exit 0 |
| Frontend typecheck | `npm run build` (runs `tsc -b && vite build`) | exit 0 |
| Frontend dev | `npm run dev -- --port 3001 &` | `Local: http://localhost:3001/` |
| Lint backend | `uv run ruff check .` | exit 0 |
| Tests backend | `uv run pytest -q` | 1 passed (health test) |

## Scope

**In scope** (create these — repo `bt-gui` is new, so all files are in-scope):
- `../bt-gui/pyproject.toml`, `../bt-gui/.python-version`, `../bt-gui/README.md`, `../bt-gui/.gitignore`
- `../bt-gui/backend/__init__.py`, `../bt-gui/backend/main.py`, `../bt-gui/backend/database.py` (stub), `../bt-gui/backend/api/__init__.py`, `../bt-gui/backend/api/routes.py`
- `../bt-gui/frontend/*` (Vite scaffold: `package.json`, `vite.config.ts`, `tsconfig*.json`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/api/bt.ts`, `src/types/bt.ts`)
- `../bt-gui/tests/test_health.py`
- `../bt-gui/scripts/dev.sh`

**Out of scope** (do NOT touch):
- `bt/` itself — no edits to `bt/pyproject.toml`, `bt/bt/*.py`. `bt` is a dependency, not modified.
- `Stocks_App/` — no edits. This plan only copies patterns, not code.
- Pydantic models / DB / serializer / algo registry — moved to plans 002–003. Here only stub them so imports don't break.
- Any NiceGUI code — `SPEC.nicegui.md` is archived, not implemented.

## Git workflow

- New repo `bt-gui` gets its own git: `git init` in `../bt-gui`, remote `origin` to be created by operator (e.g. `kmerlo/bt-gui`). Do NOT push unless operator says so.
- Commit style: conventional-ish as in `bt` (`git log --oneline -5` → `ci: …`, `docs: …`, `fix: …`). Example: `feat: bootstrap bt-gui repo (FastAPI + Vite, uv)`.
- In `bt` repo, this plan's deliverable is only the plan files themselves (already present) + optional `bt-gui` sibling. Do NOT commit `bt-gui` inside `bt`.

## Steps

### Step 1: Crea repo `bt-gui` e `pyproject.toml` con uv

Crea `../bt-gui/` come sibling di `bt`:

```bash
mkdir -p ../bt-gui/backend/api ../bt-gui/backend/models ../bt-gui/backend/services ../bt-gui/frontend/src/api ../bt-gui/frontend/src/types ../bt-gui/frontend/src/bt/components ../bt-gui/frontend/src/bt/store ../bt-gui/tests/backend ../bt-gui/scripts
```

Scrivi `../bt-gui/.python-version`:
```
3.12
```

Scrivi `../bt-gui/pyproject.toml`:
```toml
[project]
name = "bt-gui"
version = "0.1.0"
description = "Visual GUI for bt backtesting framework (React + FastAPI, integrable in Stocks_App)"
readme = "README.md"
requires-python = ">=3.12"
dependencies = [
    "bt>=1.2.0",
    "fastapi>=0.110",
    "uvicorn[standard]>=0.30",
    "pydantic>=2.0",
    "sqlalchemy>=2.0",
    "pandas>=2.0",
    "numpy>=1.26,<3.0",
    "ffn>=1.1.2",
    "python-multipart>=0.0.9",
    "aiofiles>=23.0",
    "websockets>=12.0",
]

[dependency-groups]
dev = [
    "pytest>=8.0",
    "httpx>=0.28.1",
    "ruff>=0.8",
    "mypy>=1.10",
]

[tool.pytest.ini_options]
pythonpath = ["."]
testpaths = ["tests"]

[tool.ruff]
line-length = 180

[tool.ruff.lint.per-file-ignores]
"__init__.py" = ["F401", "F403"]

[tool.mypy]
python_version = "3.12"
warn_return_any = true
warn_unused_configs = true
disallow_untyped_defs = false
disallow_incomplete_defs = false
check_untyped_defs = true
ignore_missing_imports = true
strict_optional = true
disable_error_code = ["attr-defined", "operator", "index", "var-annotated", "override", "union-attr", "call-arg", "has-type", "no-any-return"]

[tool.uv.sources]
bt = { path = "../bt", editable = true }

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"
```

> Nota: `[tool.uv.sources] bt = { path = "../bt" }` è la sintassi uv per dipendenza path. Se la versione uv non la supporta, usa `bt @ file://../bt` in `dependencies` e documenta.

`../bt-gui/.gitignore`:
```
__pycache__/
.venv/
uv.lock
*.db
*.parquet
node_modules/
dist/
.env
```

`../bt-gui/README.md`: breve descrizione + comandi `uv sync`, `uv run uvicorn backend.main:app --port 8001 --reload`, `npm run dev -- --port 3001`.

Inizializza git e sync:
```bash
cd ../bt-gui && git init && uv sync
```

**Verify**: `ls ../bt-gui/uv.lock && cat ../bt-gui/pyproject.toml | grep -q 'name = "bt-gui"' && echo ok` → `ok`. `uv run python -c "import bt; print(bt.__version__)"` → `1.2.0` (o simile).

### Step 2: Backend FastAPI minimo con APIRouter isolato

`../bt-gui/backend/__init__.py`: vuoto.

`../bt-gui/backend/database.py` (stub, verrà completato in plan 002):
```python
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

DATABASE_URL = "sqlite:///./bt_gui.db"
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=engine)

class Base(DeclarativeBase):
    pass

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
```

`../bt-gui/backend/api/routes.py`:
```python
from fastapi import APIRouter

router = APIRouter(prefix="/api/bt", tags=["bt-gui"])

@router.get("/health")
def health():
    return {"status": "ok"}

@router.get("/algos")
def list_algos():
    # stub — plan 003 popola con discover_algos()
    return []

@router.get("/algos/{name}/schema")
def algo_schema(name: str):
    return {"class_name": name, "params": {}}
```

`../bt-gui/backend/main.py`:
```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from backend.api.routes import router as bt_router

app = FastAPI(title="bt-gui", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:3001", "http://localhost:5173"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
app.include_router(bt_router)

@app.get("/")
def root():
    return {"name": "bt-gui", "docs": "/docs"}
```

`../bt-gui/backend/api/__init__.py`: vuoto.

**Verify**: `uv run uvicorn backend.main:app --host 127.0.0.1 --port 8001 &` poi `sleep 2 && curl -s http://127.0.0.1:8001/api/bt/health | grep -q '"status": "ok"' && echo ok` → `ok`. `curl -s http://127.0.0.1:8001/docs | grep -q swagger && echo ok` → `ok`. Kill uvicorn dopo.

### Step 3: Frontend Vite React19 con proxy e api helper

In `../bt-gui/frontend/`, crea scaffold Vite:

```bash
cd ../bt-gui/frontend
npm create vite@latest . -- --template react-ts  # se chiede overwrite, conferma (dir vuota tranne src creata prima)
# oppure se già esiste package.json, salta e scrivi i file sotto manualmente
```

Sovrascrivi con questi contenuti (allineati a `Stocks_App/frontend`):

`frontend/package.json`:
```json
{
  "name": "bt-gui-frontend",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "lint": "eslint .",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^19.2.6",
    "react-dom": "^19.2.6",
    "lightweight-charts": "^5.0.0",
    "@dnd-kit/core": "^6.1.0",
    "@dnd-kit/sortable": "^8.0.0",
    "@monaco-editor/react": "^4.7.0",
    "chart.js": "^4.5.1",
    "zustand": "^5.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.2.14",
    "@types/react-dom": "^19.2.3",
    "@vitejs/plugin-react": "^6.0.1",
    "typescript": "~6.0.2",
    "vite": "^8.0.12",
    "eslint": "^10.3.0",
    "openapi-typescript": "^7.0.0"
  }
}
```

`frontend/vite.config.ts`:
```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3001,
    proxy: {
      '/api': 'http://localhost:8001',
      '/openapi.json': 'http://localhost:8001',
      '/docs': 'http://localhost:8001',
    },
  },
})
```

`frontend/tsconfig.json` + `tsconfig.app.json` — copia da `Stocks_App/frontend/tsconfig*.json` (verbatimModuleSyntax, noUnusedLocals, noUnusedParameters, erasableSyntaxOnly). Se `npm create vite` li ha già generati, verifica che contengano quei flag, altrimenti sovrascrivi.

`frontend/src/api/bt.ts` — pattern identico a `Stocks_App/frontend/src/api.ts:29-43` ma con base `:8001`:
```ts
export const API_BASE = 'http://localhost:8001'
export const WS_BASE = API_BASE.replace(/^http/, 'ws')

export async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`${res.status} ${res.statusText}: ${text}`)
  }
  if (res.status === 204) return undefined as T
  return res.json()
}

export const btApi = {
  health: () => request<{ status: string }>('/api/bt/health'),
  algos: () => request<unknown[]>('/api/bt/algos'),
}
```

`frontend/src/types/bt.ts` — stub, verrà generato da OpenAPI in plan 002:
```ts
// Generated from OpenAPI — run `npx openapi-typescript http://localhost:8001/openapi.json -o src/types/bt.ts` after backend is up
export type Health = { status: string }
```

`frontend/src/App.tsx` — placeholder 5 route hash (come `Stocks_App/frontend/src/App.tsx:42`):
```tsx
import { useState } from 'react'
import { btApi } from './api/bt'

type View = 'builder' | 'results' | 'strategies' | 'data' | 'settings'

export default function App() {
  const [view, setView] = useState<View>('builder')
  const [health, setHealth] = useState('')
  return (
    <div style={{ padding: 16, fontFamily: 'system-ui' }}>
      <nav style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {(['builder','results','strategies','data','settings'] as View[]).map(v =>
          <button key={v} onClick={() => setView(v)} style={{ fontWeight: view===v?'700':'400' }}>{v}</button>
        )}
        <button onClick={() => btApi.health().then(r => setHealth(r.status)).catch(e => setHealth(String(e)))}>health</button>
        {health && <span>→ {health}</span>}
      </nav>
      <div>view: {view} — scaffold OK</div>
    </div>
  )
}
```

`frontend/src/main.tsx` + `index.html`: standard Vite (copia da `npm create vite`).

**Verify**: `cd ../bt-gui/frontend && npm install && npm run build` → exit 0, `dist/` creato. `npm run dev -- --port 3001 &` poi `curl -s http://localhost:3001/ | grep -q vite && echo ok` → `ok` (o check via `lsof -i :3001`).

### Step 4: Test health + script dev

`../bt-gui/tests/test_health.py`:
```python
from fastapi.testclient import TestClient
from backend.main import app

client = TestClient(app)

def test_health():
    r = client.get("/api/bt/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}
```

`../bt-gui/tests/__init__.py`: vuoto.
`../bt-gui/backend/tests` non serve — i test stanno in `../bt-gui/tests/`.

`../bt-gui/scripts/dev.sh`:
```bash
#!/usr/bin/env bash
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
uv run uvicorn backend.main:app --host 127.0.0.1 --port 8001 --reload &
BE_PID=$!
cd "$ROOT/frontend" && npm run dev -- --port 3001 &
FE_PID=$!
echo "BE $BE_PID on :8001, FE $FE_PID on :3001 — Ctrl+C to stop"
wait
```
`chmod +x ../bt-gui/scripts/dev.sh`

**Verify**: `uv run pytest -q` (in `../bt-gui`) → `1 passed`. `uv run ruff check .` → exit 0 (o fix con `uv run ruff check --fix .`).

### Step 5: Commit

```bash
cd ../bt-gui
git add -A
git commit -m "feat: bootstrap bt-gui repo (FastAPI + Vite, uv, health check)"
```

**Verify**: `git log --oneline -1 | grep -q bootstrap && echo ok` → `ok`.

## Test plan

- `tests/test_health.py` già creato — copre `GET /api/bt/health` via `TestClient` (pattern come `Stocks_App/backend/test/` che usa `httpx`/`TestClient`).
- Future plans aggiungeranno test per `tree_serializer`, `algo_registry`, `data_loader`, `backtest_runner` (vedi piani 002–004).
- **Verify**: `uv run pytest -q` → `1 passed`. `uv run ruff check .` → 0 errori. `npm run build` in `frontend/` → exit 0.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `ls ../bt-gui/pyproject.toml && ls ../bt-gui/uv.lock` → both exist
- [ ] `uv run python -c "import bt; print(bt.__version__)"` (in `../bt-gui`) → prints `1.2.0` (o >=1.2.0)
- [ ] `uv run pytest -q` (in `../bt-gui`) → `1 passed`
- [ ] `curl -s http://127.0.0.1:8001/api/bt/health` (con BE up) → `{"status":"ok"}`
- [ ] `curl -s http://127.0.0.1:8001/openapi.json | python -c "import json,sys; d=json.load(sys.stdin); assert d['info']['title']=='bt-gui'"` → exit 0
- [ ] `npm run build` (in `../bt-gui/frontend`) → exit 0, `dist/` exists
- [ ] `git -C ../bt-gui log --oneline -1 | grep -q bootstrap` → exit 0
- [ ] No files in `bt/` modified: `git -C ../bt status --porcelain | grep -v "^?? plans/"` → empty (only `plans/` untracked is ok)

## STOP conditions

Stop and report back (do not improvise) if:

- `../bt` sibling does not exist or `bt` cannot be imported after `uv sync` (path dependency broken — report uv version and `uv sync` log).
- `uv sync` fails due to `[tool.uv.sources]` syntax not supported by installed `uv` (report `uv --version`, fallback to `dependencies = ["bt @ file://../bt"]`).
- Port `:8001` or `:3001` already in use by Stocks_App or other service (report `lsof -i :8001`).
- `npm run build` fails due to `verbatimModuleSyntax` / `noUnusedLocals` errors in scaffold (report `tsc` output).
- `bt` version imported is not `>=1.2.0` (mismatch with `bt/backtest.py` CostModel API expected by later plans).

## Maintenance notes

- After this lands, every later plan runs `uv sync` in `../bt-gui` before `uv run …`.
- The `APIRouter(prefix="/api/bt")` in `backend/api/routes.py` is the **only** integration surface for Stocks_App (plan 005). Keep all bt-gui routes under that prefix; never add routes at `/` except `/` and `/docs`.
- `frontend/src/api/bt.ts` mirrors `Stocks_App/frontend/src/api.ts:29-43` intentionally — keep `request<T>` and `WS_BASE` signatures identical so copy-paste into Stocks_App is trivial. If Stocks_App changes `request<T>`, mirror here.
- `openapi-typescript` generation (`npx openapi-typescript http://localhost:8001/openapi.json -o src/types/bt.ts`) will be added in plan 002; for now `types/bt.ts` is stub.
- If `Stocks_App` migrates backend to `APIRouter` structure, `bt-gui` router can be included directly without change.

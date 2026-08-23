# bt-gui

Visual GUI per `bt` backtesting framework — React 19 + Vite + FastAPI, integrabile in `Stocks_App`.

Repo separato da `bt` (sibling `../bt`), dipendenza `bt @ file://../bt` in dev.

## Stack

- Backend: FastAPI + Pydantic v2 + SQLAlchemy 2 + pandas, `uv` su Python 3.12, `APIRouter(prefix="/api/bt")` isolato
- Frontend: React 19 + Vite 8 + TypeScript strict (`verbatimModuleSyntax`, `noUnusedLocals`), `@dnd-kit`, `lightweight-charts` 5, `@monaco-editor/react`
- Porte dev: BE `:8001`, FE `:3001` (proxy `/api` → `:8001`)

## Comandi

```bash
# Backend
uv sync
uv run uvicorn backend.main:app --host 127.0.0.1 --port 8001 --reload
uv run pytest -q
uv run ruff check .

# Frontend
cd frontend && npm install
npm run dev -- --port 3001
npm run build   # tsc -b && vite build

# Entrambi
./scripts/dev.sh
```

## Integrazione Stocks_App

Vedi `../bt/plans/005-integration-stocks-app.md` — `APIRouter(prefix="/api/bt")` importabile con `app.include_router(bt_router)`.

## Spec

`../bt/plans/SPEC.md` (variante A), NiceGUI archiviata in `SPEC.nicegui.md`.

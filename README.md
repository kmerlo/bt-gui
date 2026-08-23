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

`bt-gui` è integrato in `Stocks_App` come view `bt-builder` (`#bt-builder`):

- **BE (opzione A, singolo processo)**: `Stocks_App/backend/main.py` prova `from bt_gui.api.routes import router as bt_router; app.include_router(bt_router)` — richiede `bt_gui` installato; se manca, fallback su opzione B.
- **BE (opzione B, proxy, 1 riga)**: `Stocks_App/frontend/vite.config.ts` proxya `/api/bt → http://localhost:8001` (bt-gui BE). Nessuna modifica BE Stocks_App.
- **FE**: copiati `frontend/src/api/bt.ts`, `frontend/src/types/bt.ts`, `frontend/src/bt/` (store + componenti `BuilderView`, `TreeEditor`, `AlgoStack`, `NodeInspector`, `DataManager`, `ResultsDashboard`, `RunDialog`), deps `zustand` + `@dnd-kit/*` (`lightweight-charts` già presente). `navItems.ts` + `App.tsx` (`ViewId='bt-builder'` + `renderView` case).
- **CORS**: `bt-gui/backend/main.py` permette `http://localhost:3000` (Stocks_App FE) oltre a `:3001`.

Verifica: `curl http://127.0.0.1:8001/api/bt/health` → `{"status":"ok"}`; `npm run build` in `Stocks_App/frontend` → exit 0; apri `http://localhost:3000/#bt-builder` → palette/tree/inspector + Run → Results.

Piani: `plans/005-integration-stocks-app.md`. `bt-gui` resta repo standalone — copia one-way in Stocks_App.

Vedi `../bt/plans/005-integration-stocks-app.md` — `APIRouter(prefix="/api/bt")` importabile con `app.include_router(bt_router)`.

## Spec

`../bt/plans/SPEC.md` (variante A), NiceGUI archiviata in `SPEC.nicegui.md`.

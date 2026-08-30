# Guida per avviare la GUI — bt-gui standalone e Stocks_App integrato

## Panoramica rapida

| Modalità | Porte | Uso | Stato |
|----------|-------|-----|-------|
| **A — Standalone** | BE `:8001`, FE `:3001` | bt-gui isolato, sviluppo rapido | ✅ Pronta |
| **B — Integrata** | BE `:8000`, FE `:3000` | view `bt-builder` dentro Stocks_App | ⏳ Richiede `uv add` |

---

## 1. Modalità A — Standalone (bt-gui isolato)

Avvia il backend e frontend di bt-gui come processi separati.

### 1.1 Avvia il backend (porta 8001)

```bash
cd /home/roberto/Documents/progetti/bt-gui
uv sync                                    # installa dipendenze se necessario
uv run uvicorn backend.main:app --host 127.0.0.1 --port 8001  --reload                               #热重载 in sviluppo
```

Il server avvia e crea automaticamente `bt_gui.db` (SQLite). Verifica:

```bash
curl -s http://127.0.0.1:8001/api/bt/health
# {"status":"ok"}
```

Corsi configurati: `http://localhost:3000`, `http://localhost:3001`, `http://localhost:5173` (`backend/main.py:13`).

### 1.2 Avvia il frontend (porta 3001)

```bash
cd /home/roberto/Documents/progetti/bt-gui/frontend
npm install                                # installa dipendenze se necessario
npm run dev -- --port 3001
```

Proxy vite: `/api → http://localhost:8001` (`frontend/vite.config.ts:6`).

### 1.3 Apri la GUI

```
http://localhost:3001
```

Interfaccia: palette (Strategy, Security, ecc.), tree editor drag-and-drop, inspector node, RunDialog → ResultsDashboard (lightweight-charts).

### 1.4 Build produzione (standalone)

```bash
cd /home/roberto/Documents/progetti/bt-gui/frontend
npm run build   # tsc -b && vite build → dist/
```

---

## 2. Modalità B — Integrata in Stocks_App (view `bt-builder`)

bt-gui diventa una view di Stocks_App, accessibile via `#bt-builder` nella sidebar.

### 2.1 Installa bt-gui come dipendenza editable

```bash
cd /home/roberto/Documents/progetti/Stocks_App/backend
uv add --editable ../bt-gui
```

Questo popola `uv.lock` e rende `from bt_gui.api.routes import router` funzionante in `backend/main.py:314`.

### 2.2 Avvia il backend Stocks_App (porta 8000)

```bash
cd /home/roberto/Documents/progetti/Stocks_App/backend
uv run uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

Il guard in `main.py:312-318` monterà automaticamente gli endpoint `/api/bt/*`:

```python
try:
    from bt_gui.api.routes import router as bt_router

    app.include_router(bt_router)
except ImportError:
    pass  # bt-gui non installato — proxy vite gestisce
```

Verifica:

```bash
curl -s http://127.0.0.1:8000/api/bt/health
# {"status":"ok"}
```

### 2.3 Avvia il frontend Stocks_App (porta 3000)

```bash
cd /home/roberto/Documents/progetti/Stocks_App/frontend
npm install                                # già presente: zustand, @dnd-kit/*, lightweight-charts
npm run dev
```

Proxy vite (vite.config.ts):

```ts
proxy: {
  '/api/bt': 'http://localhost:8001',  // bt-gui BE per fetch diretti da :3001
  '/*': 'http://localhost:8000',        // Stocks_App BE per tutto il resto
},
```

Quando bt-gui è montato (modalità B fully), `/api/bt` va a :8000; se manca `bt_gui`, il proxy devolve a :8001 dove bt-gui BE gira standalone.

### 2.4 Apri la GUI integrata

```
http://localhost:3000/#bt-builder
```

La sidebar contiene "BT Builder" (aggiunto in `navItems.ts:21`). Le stesse funzionalità della modalità A sono disponibili dentro Stocks_App.

### 2.5 Build produzione (integrata)

```bash
cd /home/roberto/Documents/progetti/Stocks_App/frontend
npm run build   # tsc -b && vite build → dist/
```

In produzione, nginx/Caddy proxerà `/api/bt` a un processo bt-gui dedicato o al BE unito.

---

## 3. Switch da Modalità A a Modalità B

Lo switch è **one-command**:

```bash
# Da A → B
cd /home/roberto/Documents/progetti/Stocks_App/backend
uv add --editable ../bt-gui
uv run uvicorn main:app --port 8000 --reload   # il guard monta bt_router

# Da B → A (rollback)
uv remove --editable ../bt-gui                 # opzionale
# riavvia BE Stocks_App senza bt_gui → guard ImportError → proxy vite usa :8001
```

**Nessun altro cambiamento di codice:**
- `frontend/src/api/bt.ts` e `src/types/bt.ts` restano uguali
- `src/bt/` e `src/components/bt/BuilderView.tsx` restano uguali
- `App.tsx` + `navItems.ts` già includono `ViewId='bt-builder'`
- CORS `bt-gui/backend/main.py:13` già permette `:3000` e `:3001`

---

## 4. Troubleshooting

### 4.1 `curl :8001/api/bt/health` fallisce

```bash
ps aux | grep uvicorn | grep 8001
# Se inesistente, riavvia:
uv run uvicorn backend.main:app --host 127.0.0.1 --port 8001 --reload
```

### 4.2 `#bt-builder` non appare in sidebar

Verifica che `navItems.ts` includa l'entry e che il build sia fresco:

```bash
grep "bt-builder" /home/roberto/Documents/progetti/Stocks_App/frontend/src/navItems.ts
# { id: 'bt-builder', label: 'BT Builder' },
```

Hard refresh browser (Ctrl+Shift+R) e ricaricare `http://localhost:3000/#bt-builder`.

### 4.3 `API_BASE = 'http://localhost:8001'` ma fetch va a :8000

In modalità B unita, il BE sta su :8000 e serve `/api/bt` direttamente — il browser chiama `/api/bt/…` sul medesimo origin (no problema CORS). Il `API_BASE` in `src/api/bt.ts` è usato solo quando il fetch è esplicito (es. download parquet); in quel caso punta comunque a :8001 per WebSocket progress e upload paralleli.

Se vuoi usare lo stesso BE per tutto, cambia in `frontend/src/api/bt.ts:3`:

```ts
export const API_BASE = 'http://localhost:8000'   //BE unito
export const WS_BASE = API_BASE.replace(/^http/, 'ws')
```

E rimuovi la riga proxy `/api/bt` da `vite.config.ts`.

### 4.4 CORS errore da frontend

`bt-gui/backend/main.py:13-19` già configura:

```python
allow_origins = (["http://localhost:3000", "http://localhost:3001", "http://localhost:5173"],)
```

Se vedi errori CORS, aggiungi l'origin mancante lì e riavvia BE.

### 4.5 TypeError: cannot access local import 'router'

In `backend/main.py:314` il guard è `try/except ImportError`. Se compare un altro tipo di errore (es. `ModuleNotFoundError` con messaggi diversi), aggiungi `except (ImportError, ModuleNotFoundError): pass`.

### 4.6 Build TS fallisce con `verbatimModuleSyntax` error

Controlla import in `src/bt/components/*.tsx` e `src/bt/store/btStore.ts`:

```ts
import type { StrategyTree, NodeConfig } from '../../types/bt'  // type-only
```

Assicurati che gli import di solo tipo usino `import type`. Il comando `npm run build` segnala file:riga esatti.

### 4.7 Database diverso tra standalone e integrata

- **Standalone**: `bt-gui/backend/database.py:8` usa `sqlite:///./bt_gui.db` (relativo al cwd).
- **Integrata**: se monti router, usa lo stesso DB `bt_gui.db` finché `DATABASE_URL` non è settato. Per isolare, imposta `DATABASE_URL=sqlite:///./stocks_bt_gui.db` prima di avviare BE unito.

### 4.8 pytest falliscono dopo aggiunta

```bash
# bt-gui
cd /home/roberto/Documents/progetti/bt-gui
uv run pytest -q

# Stocks_App
cd /home/roberto/Documents/progetti/Stocks_App/backend
uv run pytest -q
```

Entrambi devono passare (33 + 71 test totali).

---

## 5. Ref rapidi

| File | Scopo |
|------|-------|
| `backend/main.py:312-318` | Guard `include_router` bt-gui |
| `backend/api/routes.py:21` | `APIRouter(prefix="/api/bt")` — contratto integrazione |
| `frontend/vite.config.ts:9` | Proxy `/api/bt → :8001` |
| `frontend/src/api/bt.ts` | Client `btApi`, `strategiesApi`, `dataApi`, `backtestApi` |
| `frontend/src/types/bt.ts` | Tipi generati da OpenAPI (`StrategyTree`, `NodeConfig`, ecc.) |
| `frontend/src/bt/store/btStore.ts` | Zustand store (tree, selectedId, runs) |
| `frontend/src/bt/components/BuilderView.tsx` | Orchestratore view |
| `frontend/src/components/bt/BuilderView.tsx` | Shim per `ls` check (plan 005) |
| `frontend/src/App.tsx:22,42,150` | Import `BTBuilderView`, `ViewId`, case switch |
| `frontend/src/navItems.ts:21` | voce "BT Builder" |
| `plans/005-integration-stocks-app.md` | Piano completo integrazione |

---

## 6. Prossimi passi consigliati

1. **Avvia in A** e verifica che palette + tree + Run → results funzioni.
2. **Passa a B** con `uv add --editable ../bt-gui` e apri `http://localhost:3000/#bt-builder`.
3. **Documenta in `my-docs/`** eventuali fix specifici (seguire prefissi `FIX-`, `GUIDE-` come Stocks_App).
4. **Automatizza re-copia FE** se `bt-gui` evolve — `// ponytail: sync manuale fino a integrazione stabile` (nessun script `scripts/sync-from-bt-gui.sh` in v1).

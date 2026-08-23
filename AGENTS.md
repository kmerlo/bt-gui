# AGENTS — bt-gui

> **Prima di qualsiasi task di codice: leggi `my-docs/GUIDE-CODING_PRACTICES.md` e applica tutte le regole.**
> Questo file è una sintesi operativa; la fonte normativa è la guida. In caso di conflitto, vince la guida.

## 0. Lettura obbligatoria

1. `my-docs/GUIDE-CODING_PRACTICES.md` — best practice, stack, soglie, checklist (11 regole + separazione stato/logica/UI)
2. `./plans/SPEC.md` + piano corrente in `./plans/00*` — cosa costruire e done criteria
3. `frontend/tsconfig.app.json` + `pyproject.toml` — vincoli strict verificabili da build/lint

Non iniziare a scrivere codice se non hai letto (1). Ogni PR/task che viola la guida verrà rifiutata.

## 1. Stack & porte

| Lato | Stack | Note |
|------|-------|------|
| BE | FastAPI + Pydantic v2 + SQLAlchemy 2, `uv` | `APIRouter(prefix="/api/bt")` unico punto integrazione |
| FE | React 19 + Vite 8 + TS `~6.0.2` strict | `verbatimModuleSyntax`, `noUnusedLocals`, `noUnusedParameters`, `erasableSyntaxOnly` |
| FE state | Zustand `^5` | stato condiviso; `useState` solo locale |
| FE drag | `@dnd-kit/core ^6.1` + `sortable ^8.0` | tree editor |
| Charts | `lightweight-charts ^5` | factory maiuscole `CandlestickSeries` |
| Editor | `@monaco-editor/react ^4.7` | `simple_fn` |
| Types | `openapi-typescript ^7` | genera `frontend/src/types/bt.ts` da `/openapi.json` |

Porte: BE `:8001`, FE `:3001` (proxy `/api` → `:8001`). Piani: `./plans/`.

## 2. Regole d'oro (estratto — vedi guida per dettagli)

1. **Un file, una responsabilità** — soglia pratica 300 righe, dura 500. Oltre → estrai hook/component/service.
2. **Estrai presto** — alla seconda funzione correlata nello stesso file, estrai `hooks/useXxx.ts`.
3. **Mai `any`** — usa `frontend/src/types/bt.ts` generato da OpenAPI; se manca, aggiungi modello Pydantic e `npm run gen:types`.
4. **Lint dal commit zero** — `npm run build` e `uv run ruff check .` devono passare; fissa il codice, non disabilitare i check.
5. **Separa stato/logica/UI** — hook `hooks/` (logica+stato, zero JSX) / store `src/bt/store/btStore.ts` (Zustand) / componenti `src/bt/components/` (solo JSX) / orchestratore `BuilderView`/`App.tsx`.
6. **Zustand per stato condiviso** — 2+ componenti leggono lo stesso dato → store, altrimenti `useState` locale.
7. **Mai `catch {}` vuoto** — almeno `catch { /* perché vuoto */ }` o `console.warn`.
8. **`const` di default** — `let` solo se riassegnato (TS strict lo impone).
9. **Ref last resort** — passa dati come parametri o leggi dallo store, non `useRef` globale.
10. **Route sempre sotto `/api/bt`** — `backend/api/routes.py: APIRouter(prefix="/api/bt")`; mai route in `main.py`.
11. **Piani prima del codice** — verifica `./plans/` esista; se manca, crealo prima di codificare.

Checklist completa per nuove feature nella guida cap. "Checklist per nuove feature" — spunta tutti i 10 punti prima di aprire PR.

## 3. Dove mettere i file

```
backend/
  main.py              # include_router, CORS — NIENTE route
  database.py          # Base, SessionLocal, get_db
  models/strategy_tree.py  # NodeConfig/AlgoConfig/StrategyTree (Pydantic)
  services/tree_serializer.py, algo_registry.py, data_loader.py, backtest_runner.py, persistence.py
  api/routes.py        # APIRouter(prefix="/api/bt") — UNICO ingresso
frontend/src/
  api/bt.ts            # request<T>, WS_BASE, btApi/strategiesApi/algosApi
  types/bt.ts          # AUTO-GENERATO — non editare a mano
  bt/store/btStore.ts  # Zustand
  bt/components/TreeEditor.tsx, AlgoStack.tsx, NodeInspector.tsx, BuilderView.tsx, ...
  hooks/useTreeDrag.ts, useBacktestRunner.ts ...
```

`components/` solo JSX; logica in `hooks/` o `store`. Un service = un file.

## 4. Comandi

```bash
uv sync
uv run uvicorn backend.main:app --host 127.0.0.1 --port 8001 --reload
uv run pytest -q
uv run ruff check .
cd frontend && npm install && npm run dev -- --port 3001
npm run build   # tsc -b && vite build — deve uscire 0
npm run gen:types  # rigenera src/types/bt.ts (BE su :8001)
```

## 5. Piani & integrazione

- Piani in `./plans/`: `001-bootstrap` → `005-integration-stocks-app`. Segui l'ordine, rispetta STOP conditions e Done criteria.
- `APIRouter(prefix="/api/bt")` è il contratto con `Stocks_App` (plan 005 lo monta senza modifiche).

## 6. Git & release

**Trunk-based** (come `Stocks_App`): lavoro sempre su `master`, nessun branch `feat/*`.

```bash
# Prima di ogni task
git checkout master && git pull origin master

# Dopo commit locale, integro subito
git push origin master
```

- Mai fare `git checkout -b feat/…` né `git push origin feat/…`.
- Le PR sono facoltative se l'utente le richiede; di default push diretto su `master`.
- Rimuovi branch vecchi rimasti solo per retro-compatibilità: `git branch -d feat/003-tree-algo feat/004-data-runner-results; git push origin --delete feat/…`.

## 7. Stile agente

- Risposte brevi, fattuali; cita `file:line` per funzioni-simbolo.
- Verifica con esecuzione (`pytest`, `npm run build`) prima di dichiarare done.
- Ponytail attivo di default: soluzione più corta che funziona; marca scorciatoie con `// ponytail:`.

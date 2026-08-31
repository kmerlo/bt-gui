# AGENTS — bt-gui

> **Prima di qualsiasi task di codice: leggi `my-docs/GUIDE-CODING_PRACTICES.md` e applica tutte le regole.**
> Questo file è una sintesi operativa; la fonte normativa è la guida. In caso di conflitto, vince la guida.
> Sync: questo estratto è generato da GUIDE-CODING_PRACTICES.md:50-280 — mantieni allineati (ponytail + DB §11).

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

Checklist completa per nuove feature nella guida cap. "Checklist per nuove feature" — spunta tutti i 11 punti prima di aprire PR.

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

- Piani in `./plans/`: `001-bootstrap` → `005-integration-stocks-app`. Segui l'ordine, rispetta STOP conditions e Done criteria. Advisor plans (db-quality): `advisor-plans/001-harden-commission-eval` → `014-refresh-stale-example`.
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
- **Al termine di ogni piano (DONE)**: oltre al commit locale esegui subito `git push origin master` — non lasciare commit locali non pushati. Regola valida per `bt-gui` ed anche per `Stocks_App` quando il piano tocca entrambi i repo (commit + push separati).
- Rimuovi branch vecchi rimasti solo per retro-compatibilità: `git branch -d feat/003-tree-algo feat/004-data-runner-results; git push origin --delete feat/…`.

## 7. Stile agente

- Risposte brevi, fattuali; cita `file:line` per funzioni-simbolo.
- Verifica con esecuzione (`pytest`, `npm run build`) prima di dichiarare done.
- Ponytail attivo di default: soluzione più corta che funziona; marca scorciatoie con `// ponytail:`.
- **Qualità sopra velocità:** quando si presenta una scelta tra due approcci (es. integrazione minimalista vs pulizia architetturale), preferire la soluzione di qualità superiore anche se richiede più tempo, salvo diversa indicazione esplicita dell'utente. Un'architettura pulita oggi costa meno di un refactoring domani.

## 8. Documentazione e appunti sviluppo

Dopo ogni task di sviluppo (commit), aggiornare i file nella cartella `my-docs/`:

### 8.1 `appunti_sviluppi.md` — registro modifiche

Inserire una riga con data/ora e descrizione della modifica:

```
- [YYYY-MM-DD HH:MM] — Descrizione sintetica. [file/modulo interessato]
```

### 8.2 Routing informazioni

- **Informazioni utente** (come usare il software, tutorial, guide operative) → aggiornare `my-docs/GUIDE_manuale_bt_gui.md`.
- **Informazioni tecniche** (scelte architetturali, struttura DB, formati dati, decision log) → aggiornare `my-docs/GUIDE_documentazione_tecnica.md`.

### 8.3 File esistenti in my-docs/

| File | Scopo |
|------|-------|
| `GUIDE-CODING_PRACTICES.md` | Regole di sviluppo (fonti normative) |
| `GUIDE-TUTORIAL_STRATEGIE.md` | Tutorial passo-passo strategie |
| `GUIDE-AVVIARE-GUI.md` | Avvio rapido del software |
| `GUIDE_documentazione_tecnica.md` | Scelte architetturali e tecniche |
| `GUIDE_manuale_bt_gui.md` | Manuale utente finale |
| `appunti_sviluppi.md` | Registro cronologico modifiche |

## 9. Dati & DB — MAI cancellare contenuti utente (REGOLA INVIOLABILE)

> ⚠️ **VIETATO ASSOLUTO — pena blocco PR:** cancellare o modificare righe utente in `bt_gui.db` (`strategies`, `data_sources`, `backtest_runs`, `tutorial1` / indicatori `sma50` etc.). Ogni violazione è un bug critico, anche se fatta da `pytest` o da un test.

**Divieti espliciti (MAI fare, nemmeno nei test):**

- `rm *.db`, `DROP TABLE`, `DELETE FROM <tabella>` senza `WHERE` su dati utente.
- `DELETE FROM data_sources WHERE type='indicator'` o qualsiasi `WHERE type=...` che colpisce righe utente (es. `sma50`).
- `db.query(DBSource).filter(DBSource.type == "indicator").delete()` — CANCELLATO: cancella anche indicatori utente. **MAI.**
- `SessionLocal().query(...).delete()` senza filtro `name LIKE 'test_%' / 'tmp_%' / 'mock_%'`.
- Sovrascrivere `bt_gui.db` con un DB di test o fare `Base.metadata.drop_all()` sul file reale.

**Cosa fare invece (obbligatorio):**

- Per test/verifiche crea **solo** righe con prefisso `test_` / `tmp_` / `mock_` / `ind_sma_` / `smatest_` etc. (es. `test_csv_abc123`, `tmp_preset_test_123`).
- Cancella **solo ed esclusivamente** quelle righe, con filtro esplicito sul nome:
  ```python
  # ✅ ESEMPIO CORRETTO
  db.query(DBSource).filter(DBSource.name.like("test\\_%") | DBSource.name.like("tmp\\_%") | DBSource.name.like("mock\\_%")).delete(synchronize_session=False)
  # ❌ VIETATO
  db.query(DBSource).filter(DBSource.type == "indicator").delete()
  ```
- `pytest` su `bt_gui.db` reale: usa `Base.metadata.create_all` + `SessionLocal` isolata, MAI `drop_all`; lascia il DB pulito **solo** dagli artefatti `test_%`/`tmp_%`/`mock_%` a fine run. Preferisci `sqlite:///:memory:` con `StaticPool` (vedi `tests/backend/test_persistence.py:11`) per test isolati.
- Prima di qualsiasi operazione distruttiva (anche in un test) chiedi conferma esplicita all'utente e mostra il `WHERE` che userai.
- Se un test deve verificare "lista vuota", NON svuotare la tabella utente: crea un DB in-memory isolato o filtra per `name LIKE 'test_%'` e asserisci su quello, mai su `SELECT * FROM data_sources` globale.

**Se hai già cancellato per errore:** fermati, avvisa l'utente, verifica con `SELECT id, name, type FROM data_sources` cosa è stato perso e proponi ripristino. Non nascondere l'errore.


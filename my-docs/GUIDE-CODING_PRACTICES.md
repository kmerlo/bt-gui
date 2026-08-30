# Guida alle best practice di sviluppo — bt-gui

> **Scopo**: Questo documento contiene le regole pratiche da seguire nello sviluppo di `bt-gui`
> (FastAPI + React 19 + Vite + TypeScript strict). Nasce dall'esperienza del progetto
> `Stocks_App`, in particolare dal refactor di `ChartView.tsx` da ~8.000 righe a una composizione
> di hook separati, e dalle lezioni apprese costruendo questo repo da zero.
> Scritto per essere usato sia dal team che **come istruzioni iniziali per un LLM**.

---

## Perché serve questo documento

`bt-gui` è un progetto full-stack con dipendenze incrociate:
- Il **backend** FastAPI espone `APIRouter(prefix="/api/bt")` che deve restare isolato per essere
  importabile in `Stocks_App` senza modifiche.
- Il **frontend** React 19 usa TypeScript strict (`verbatimModuleSyntax`, `noUnusedLocals`,
  `noUnusedParameters`, `erasableSyntaxOnly`) e tipi generati automaticamente da OpenAPI.
- I **piani di sviluppo** stanno in `./plans/` — ogni feature nuova va prima discussa lì.

Senza regole esplicite, è facile:
1. Far crescere un componente oltre le 300 righe (es. `TreeEditor.tsx` che accumula drag, render,
   inspector e logica stato in un unico file).
2. Usare `any` sui dati che arrivano dal backend invece di allinearsi ai tipi generati da
   `openapi-typescript`.
3. Aggiungere route fuori da `/api/bt` rompendo l'integrazione con `Stocks_App`.
4. Mescolare logica di business e UI nello stesso file.

---

## Stack del progetto

| Lato | Tecnologia | Versione | Note |
|------|-----------|----------|------|
| Backend | FastAPI + Pydantic v2 | `>=0.110` | `APIRouter(prefix="/api/bt")` obbligatorio |
| Backend | SQLAlchemy 2 | `>=2.0` | `DeclarativeBase` in `database.py` |
| Backend | uv | — | `uv sync`, `uv run pytest`, `uv run ruff` |
| Frontend | React 19 + Vite 8 | `react ^19.2.6`, `vite ^8.0.12` | |
| Frontend | TypeScript strict | `~6.0.2` | `verbatimModuleSyntax`, `noUnusedLocals`, `noUnusedParameters`, `erasableSyntaxOnly` |
| Frontend | Zustand | `^5.0.0` | Store globale, non `useState` sparsi |
| Frontend | lightweight-charts | `^5.0.0` | Equity curve, drawdown |
| Frontend | @dnd-kit | `core ^6.1.0`, `sortable ^8.0.0` | Drag-and-drop tree |
| Frontend | @monaco-editor/react | `^4.7.0` | Editor `simple_fn` |
| Frontend | openapi-typescript | `^7.0.0` | Genera `src/types/bt.ts` da `/openapi.json` |

**Porte**: BE `:8001`, FE `:3001` (proxy `/*` → `:8001`).
**Piani**: `./plans/` — leggere prima di sviluppare.

---

## Regole d'oro (da applicare dal giorno 1)

### 1. Un file, una responsabilità

```
❌ ResultsDashboard.tsx (548 righe prima di 2026-08-30)
   └── filtri, fetch, polling, charts, metrics, transactions in un unico file

✅ hooks/useRunsTable.ts     (~110 righe) — filtri/sort/refresh/polling
✅ hooks/useEquityCharts.ts   (~107 righe) — sanitize/drawdown + sync crosshair/pan
✅ components/RunsTable.tsx   (~121 righe) — tabella sticky + filtri
✅ components/MetricsPanel.tsx (~69 righe) — grouping Daily/Monthly/Yearly
✅ Orchestratore ResultsDashboard.tsx (~69 righe) — solo composizione

> Esempio vivo: vedi appunti_sviluppi.md:32 e advisor-plans/004-split-results-dashboard.md
```

**Soglia pratica**: se un file supera le **300 righe**, chiediti: "Quali di queste responsabilità
posso estrarre?"
**Soglia dura**: **mai superare le 500 righe**. Se ci arrivi, estrai ORA.
> **Eccezione**: `frontend/src/types/bt.ts` (439 righe, AUTO-GENERATO da openapi-typescript) è escluso — non splittarlo.

### 2. Estrai presto, non dopo

Il momento giusto per estrarre è **quando hai 2+ funzioni correlate** nello stesso componente.

```tsx
// ❌ Tardi — startLive / stopLive / updateCandle in App.tsx
function startLive() { ... }     // riga 4356
function stopLive() { ... }      // riga 4420
function updateCandle() { ... }  // riga 4490

// ✅ Presto — appena la seconda, estrai
function useBacktestRunner() {
  const [running, setRunning] = useState(false)
  const start = useCallback(() => { ... }, [])
  const stop = useCallback(() => { ... }, [])
  return { running, start, stop }
}
```

Costa **5 minuti** farlo subito. Costa **5 ore** farlo dopo che 50 altre funzioni si sono
accumulate intorno.

### 3. Usa i tipi generati da OpenAPI — mai `any`

I tipi ufficiali del progetto vivono in `src/types/bt.ts`, generati automaticamente da
`openapi-typescript`. Usali sempre:

```ts
// ❌
const tree = response as any
tree.root.algos.find((a: any) => a.class_name === 'WeighEqually')

// ✅
import type { StrategyTree, AlgoConfig } from '@/types/bt'
const tree = response as StrategyTree
tree.root.algos.find((a: AlgoConfig) => a.class_name === 'WeighEqually')
```

`any` è un buco nero: lo usi una volta, il typechecker smette di aiutarti in tutto il resto.
Se un dato da API non ha ancora un tipo generato, aggiungi l'interfaccia a `bt.ts` e rigenera
con `npm run gen:types` (richiede BE in ascolto su `:8001`).

### 4. Lint attivo dal commit zero

Il progetto ha già `tsconfig.app.json` con `noUnusedLocals`, `noUnusedParameters`,
`verbatimModuleSyntax` e `erasableSyntaxOnly`. `npm run build` fallisce se li violi.

**Regola**: se il build fallisce per un errore di lint, **fissa il file, non disabilitare
il check**. Un file troppo grosso per il typechecker è un file da estrarre, non da ignorare.

### 5. Separa stato, logica e UI

In `bt-gui` questa separazione ha tre livelli ben definiti:

| Livello | Dove sta | Cosa fa | Esempio |
|---------|----------|---------|---------|
| **Hook** (logica + stato) | `hooks/useXxx.ts` | `useState`, `useEffect`, `useCallback` — zero JSX | `useBacktestRunner` |
| **Store** (stato condiviso) | `src/bt/store/btStore.ts` | Zustand store per stato che attraversa più view | `btStore` con tree, selectedNode, runs |
| **Componente** (UI) | `src/bt/components/Xxx.tsx` | Solo JSX + props. Al massimo `useState` locale per toggle UI | `NodeCard` |
| **Orchestratore** | `App.tsx` o view container | Importa hook/store, destruttura, passa props | `BuilderView` |

```tsx
// ✅ Pattern corretto
// hooks/useBacktestRunner.ts
export function useBacktestRunner() {
  const [running, setRunning] = useState(false)
  const run = useCallback(async (tree: StrategyTree) => { ... }, [])
  return { running, run }
}

// components/RunButton.tsx
export function RunButton({ onRun }: Props) {
  return <button onClick={() => onRun(tree)} disabled={running}>Run</button>
}

// BuilderView.tsx (orchestratore)
export default function BuilderView() {
  const { running, run } = useBacktestRunner()
  return <RunButton onRun={run} />
}
```

### 6. Zustand per lo stato condiviso — no `useState` sparsi

Quando lo stato deve essere letto da più componenti (albero strategie, node selezionato,
lista run), usa Zustand invece di alzare il state a `App.tsx`.

```tsx
// ✅ Store Zustand
import { create } from 'zustand'

interface BtState {
  tree: StrategyTree | null
  selectedNodeId: string | null
  setTree: (t: StrategyTree) => void
  selectNode: (id: string) => void
}

export const useBtStore = create<BtState>((set) => ({
  tree: null,
  selectedNodeId: null,
  setTree: (tree) => set({ tree }),
  selectNode: (selectedNodeId) => set({ selectedNodeId }),
}))
```

```tsx
// ❌ Alzare lo stato a App.tsx con 82 useState (come faceva ChartView)
const [tree, setTree] = useState(...)
const [selectedNode, setSelectedNode] = useState(...)
const [algoStack, setAlgoStack] = useState(...)
// ... 80 righe dopo ...
```

**Regola**: se 2+ componenti leggono/modificano lo stesso dato → Zustand store.
Se è locale a un solo componente → `useState`.

### 7. Mai `catch {}` vuoto

```tsx
// ❌ Il problema sparisce nel vuoto
try { chart.removeSeries(series) } catch {}

// ✅ Almeno un commento che spiega perché ignori
try { chart.removeSeries(series) } catch { /* series might not exist yet */ }

// ✅ Se non è atteso, logga
try { chart.removeSeries(series) } catch (e) { console.warn('removeSeries failed:', e) }
```

### 8. Variabili non riassegnate → `const`

Il TS strict lo impone già (`noUnusedLocals` + `verbatimModuleSyntax`). Rispetta la convenzione
anche in runtime:

```ts
// ❌
let treeData = await btApi.strategies.get(id)

// ✅ (se treeData non viene mai riassegnato)
const treeData = await btApi.strategies.get(id)
```

### 9. Ref come last resort

```tsx
// ❌ useRef per passare dati tra callback
const treeRef = useRef<StrategyTree | null>(null)
// ... 400 righe dopo ...
useEffect(() => {
  const data = treeRef.current  // chi l'ha scritto? quando? perché?
}, [])

// ✅ Passa i dati come parametri o leggi dallo store
const { tree } = useBtStore()
```

Se un hook ha bisogno di dati, **passaglieli come parametri** o leggili dallo store Zustand.
Non usare `useRef` come variabile globale nascosta.

### 11. Dati & DB — MAI cancellare contenuti utente (REGOLA INVIOLABILE)

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

> Questa è la regola più critica del repo — violazione = bug critico. Vedi AGENTS.md:131 per il dettaglio normativo.

---

### 10. Route sempre sotto `/api/bt`

Tutte le route devono andare dentro `router = APIRouter(prefix="/api/bt")` in
`backend/api/routes.py`. Mai aggiungere route dirette in `main.py` (tranne `/` e `/docs`).

Questo è il **contratto di integrazione** con `Stocks_App`. Se rompi il prefix, l'integrazione
si rompe.

```python
# ✅ Corretto
router = APIRouter(prefix="/api/bt", tags=["bt-gui"])

@router.get("/backtest")
def run_backtest(...): ...

# ❌ Vietato — route flotta in main.py
@app.get("/backtest")
def run_backtest(...): ...
```

---

## Struttura dei file — cosa mettere dove

### Backend

```
backend/
├── main.py              # FastAPI app, CORS, include_router — NUNCA route qui
├── database.py          # Engine, SessionLocal, Base, get_db
├── models/
│   ├── __init__.py
│   ├── strategy_tree.py # Pydantic: NodeConfig, AlgoConfig, StrategyTree
│   ├── backtest_config.py
│   └── data_source.py
├── services/
│   ├── __init__.py
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

**Regola**: un service = un file. Non mettere 3 service in uno solo. Se `backtest_runner.py`
supera le 300 righe, estrai `backtest_progress.py` o `backtest_cancel.py`.

### Frontend

```
frontend/src/
├── main.tsx
├── App.tsx                  # Router + layout, mai più di 80 righe
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

**Regola**: `components/` contiene solo JSX. La logica va in `hooks/` o nello `store/`. Vedi AGENTS.md:61.

---

## Checklist per nuove feature

Quando inizi una nuova feature (riferisciti sempre a `./plans/` per il piano corrispondente),
rispondi a queste 11 domande **prima** di scrivere codice:

1. ☐ Il piano esiste in `./plans/`? → Se no, crealo prima.
2. ☐ Questa logica appartiene a un dominio esistente? → Va nel suo hook/service esistente.
3. ☐ Questa logica è un dominio nuovo? → Nuovo hook (`hooks/useXxx.ts`) + nuovo service se BE.
4. ☐ La nuova UI è autonoma? → Nuovo componente in `components/`.
5. ☐ Ho usato `any` da qualche parte? → Sostituisci con tipo da `types/bt.ts` o interfaccia locale.
6. ☐ Il file che sto modificando supererà le 300 righe? → Estrai PRIMA.
7. ☐ Posso testare questa logica in isolamento? → Se no, disaccoppia.
8. ☐ La nuova route BE è sotto `/api/bt`? → Se è fuori, fermati e correggi.
9. ☐ I tipi necessari esistono in `types/bt.ts`? → Se no, aggiungili al model Pydantic e
   rigenera con `npm run gen:types`.
10. ☐ Lo stato è locale (useState) o condiviso (Zustand)? → Se 2+ componenti ci accedono, Zustand.
11. ☐ Ho toccato il DB? → Mai DELETE senza WHERE su name LIKE 'test_%' / 'tmp_%' / 'mock_%'; mai DROP/rm *.db; usa sqlite:///:memory: per liste vuote.

---

## Istruzioni per un LLM in questo progetto

Copia questa sezione e consegnala al tuo LLM all'inizio di una sessione di sviluppo.

```
## Regole di architettura per bt-gui

1. **File sotto le 300 righe**. Se un file supera le 300 righe, estrai un modulo/hook
   separato PRIMA di aggiungere nuove funzionalità. Soglia dura: 500 righe.

2. **Un hook = un dominio**. `useBacktestRunner` gestisce solo il runner.
   `useTreeDrag` gestisce solo il drag. Mai hook "jolly".

3. **Separa stato, logica e UI**:
   - Logica + stato locale → custom hook in `hooks/`
   - Stato condiviso (attraversa view) → Zustand store in `src/bt/store/`
   - UI pura → componenti in `src/bt/components/`
   - Composizione → orchestratore in view container, non in App.tsx

4. **Niente `any`**. Mai. Usa i tipi da `src/types/bt.ts` (generati da OpenAPI).
   Se manca un tipo, aggiungilo al model Pydantic e rigenera con `npm run gen:types`.

5. **Lint attivo dal giorno 1**. TypeScript strict: `verbatimModuleSyntax`,
   `noUnusedLocals`, `noUnusedParameters`, `erasableSyntaxOnly`. `npm run build` fallisce
   se li violi — fissa il codice, non disabilitare i check.

6. **`const` sempre, `let` solo se riassegnato**. Il TS strict lo impone.

7. **`catch {}` mai vuoto**. Almeno `catch { /* vuoto perché ... */ }`.

8. **Route sempre sotto `/api/bt`**. `APIRouter(prefix="/api/bt")` è il contratto
   di integrazione con Stocks_App. Mai route dirette in `main.py`.

9. **Ref solo se indispensabile**. Se una funzione ha bisogno di dati, passaglieli
   come parametri. Non usare `useRef` come surrogato di variabile globale.

10. **Zustand per stato condiviso**. Se 2+ componenti leggono lo stesso dato,
    usa `create<BtState>()` in `src/bt/store/btStore.ts`, non useState alzati a App.tsx.

11. **Piani in `./plans/`**. Prima di sviluppare, leggi il piano corrispondente.
     Se non esiste, crealo prima di scrivere codice.

12. **MAI cancellare righe utente in bt_gui.db** — vedi §11. Per test usa solo prefissi test_/tmp_/mock_ e sqlite:///:memory:.

13. **Ponytail di default: soluzione più corta che funziona** — marca scorciatoie con `// ponytail:` e verifica con `npm run build` / `pytest` prima di dichiarare done (AGENTS.md:99-101).
```

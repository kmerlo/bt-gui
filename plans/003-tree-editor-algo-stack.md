# Plan 003: Tree Editor + Algo Stack Composer (React)

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 8fd6270..HEAD -- plans/` + `ls ../bt-gui/backend/models/strategy_tree.py ../bt-gui/backend/services/tree_serializer.py ../bt-gui/frontend/src/api/bt.ts` — plan 002 must be DONE (Pydantic models, DB, serializer, `GET /api/bt/algos`). If `../bt-gui/frontend/src/types/bt.ts` does not contain `StrategyTree`, STOP.

## Status

- **Priority**: P0
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/002-models-db-serializer.md
- **Category**: tech-debt / direction
- **Planned at**: commit `8fd6270`, 2026-08-23
- **Issue**: —

## Why this matters

Il valore di `bt-gui` è costruire alberi `Strategy → Security` annidati + stack algo senza scrivere Python. Se tree editor e algo composer non sono usabili (drag-drop rotto, form non tipizzati, validazione assente), l'utente torna a scrivere `bt.Strategy` a mano e la GUI non serve. Questo piano consegna l'editing visuale completo con validazione `Requires/Sets` e persistenza via `POST /api/bt/strategies`.

## Current state

- BE: `StrategyTree`/`NodeConfig`/`AlgoConfig` Pydantic, `tree_serializer.to_bt_strategy(tree)`, `algo_registry.REGISTRY` con categorie e `GET /api/bt/algos` + `GET /api/bt/algos/{name}/schema`, CRUD `POST/GET /api/bt/strategies`. `frontend/src/types/bt.ts` generato da OpenAPI.
- FE scaffold: `frontend/src/api/bt.ts` con `request<T>`/`WS_BASE` (pattern `Stocks_App/frontend/src/api.ts:29-43`), `App.tsx` placeholder 5 view, `vite.config.ts` proxy `:8001`, `tsconfig` strict (`verbatimModuleSyntax`, `noUnusedLocals`).
- `Stocks_App` ha già drag-drop e chart patterns riusabili:
  - State-based view switching `App.tsx:56-69` (`useState<ViewId>`, `navigate`, hash).
  - `lightweight-charts` 5 con `CandlestickSeries`/`LineSeries` factory (maiuscolo) — `StrategyBacktestView.tsx:3-13`.
  - Nessun tree editor esistente — nuovo componente, ma `TreeEditor` può riusare `SortableContext` di `@dnd-kit/sortable`.
- `bt/algos.py` docstrings contengono `Requires: ...` / `Sets: ...` per validazione stack — `algo_registry` deve estrarle (già fatto in plan 002 stub, qui completato).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Frontend install | `npm install` (in `../bt-gui/frontend`) | exit 0 |
| Frontend typecheck | `npm run build` | exit 0, `dist/` exists |
| Frontend lint | `npm run lint` (if configured) | exit 0 or only known warns |
| Backend tests | `uv run pytest -q` (in `../bt-gui`) | all pass |
| Backend lint | `uv run ruff check .` | exit 0 |
| Manual FE | `npm run dev -- --port 3001` then open `http://localhost:3001` | builder view renders |

## Scope

**In scope** (in `../bt-gui`):
- `frontend/src/bt/store/btStore.ts` (Zustand store per tree + selection)
- `frontend/src/bt/components/TreeEditor.tsx`, `frontend/src/bt/components/AlgoStack.tsx`, `frontend/src/bt/components/NodeInspector.tsx`
- `frontend/src/bt/components/BuilderView.tsx` (composition: palette + canvas + inspector + algo stack)
- `frontend/src/App.tsx` (integrate BuilderView at `/`)
- `frontend/src/api/bt.ts` (extend with `strategiesApi`, `algosApi`)
- `backend/services/algo_registry.py` (extend Requires/Sets parsing)
- `frontend/src/types/bt.ts` (if schema changed, regenerate)

**Out of scope** (do NOT touch):
- `bt/` — no edits.
- `backend/services/data_loader.py`, `backtest_runner.py`, Data Manager, Results Dashboard — plan 004.
- `Stocks_App/` — no edits. Copy-paste integration is plan 005.
- Results / backtest execution UI — plan 004.

## Git workflow

- Branch in `bt-gui`: `feat/003-tree-algo` (from `feat/002-…`).
- Commits: `feat(tree): add TreeEditor with dnd-kit`, `feat(algo): AlgoStack auto-form + validation`, `feat(store): Zustand btStore`, `feat(builder): compose BuilderView`. Message style as `bt` (`feat:`, `fix:`).
- Do NOT push unless operator says.

## Steps

### Step 1: Estendi `api/bt.ts` e Zustand store

`frontend/src/api/bt.ts` — aggiungi (mantenendo `request<T>`/`WS_BASE` identici a `Stocks_App`):

```ts
import type { StrategyTree, AlgoConfig } from '../types/bt'

export const strategiesApi = {
  list: () => request<StrategyTree[]>('/api/bt/strategies'),
  get: (id: number) => request<StrategyTree>(`/api/bt/strategies/${id}`),
  create: (tree: StrategyTree) => request<StrategyTree>('/api/bt/strategies', { method: 'POST', body: JSON.stringify(tree) }),
  update: (id: number, tree: StrategyTree) => request<StrategyTree>(`/api/bt/strategies/${id}`, { method: 'PUT', body: JSON.stringify(tree) }),
  delete: (id: number) => request<void>(`/api/bt/strategies/${id}`, { method: 'DELETE' }),
}

export const algosApi = {
  list: () => request<{ name: string; category: string; doc: string }[]>('/api/bt/algos'),
  schema: (name: string) => request<{ title: string; type: string; properties: Record<string, unknown>; required: string[] }>(`/api/bt/algos/${name}/schema`),
}
```

`frontend/src/bt/store/btStore.ts` — Zustand (già in `frontend/package.json`):

```ts
import { create } from 'zustand'
import type { StrategyTree, NodeConfig } from '../../types/bt'

type BtStore = {
  tree: StrategyTree | null
  selectedId: string | null
  setTree: (t: StrategyTree) => void
  setSelected: (id: string | null) => void
  updateNode: (id: string, patch: Partial<NodeConfig>) => void
  addChild: (parentId: string, node: NodeConfig) => void
  removeNode: (id: string) => void
  moveNode: (id: string, newParentId: string, index: number) => void
}

export const useBtStore = create<BtStore>((set, get) => ({
  tree: null, selectedId: null,
  setTree: (tree) => set({ tree }),
  setSelected: (selectedId) => set({ selectedId }),
  updateNode: (id, patch) => { /* DFS find + shallow merge */ },
  addChild: (parentId, node) => { /* DFS find parent, push */ },
  removeNode: (id) => { /* DFS remove */ },
  moveNode: (id, newParentId, index) => { /* remove + insert at index */ },
}))
```

Helper DFS ricorsivi: `findNode(root, id)`, `findParent(root, id)`. Mantieni immutabilità (spread) per trigger React.

Albero iniziale di default (come `StrategyBacktestView.tsx:117 DEFAULT_CODE` ma per tree): root `Strategy` "MyStrategy" con 1 child `Security` "AAPL".

**Verify**: `npm run build` → exit 0. `grep -q "useBtStore" frontend/src/bt/store/btStore.ts && echo ok` → `ok`.

### Step 2: Tree Editor — palette + canvas + inspector

`frontend/src/bt/components/TreeEditor.tsx`:

* **Palette** (sinistra, 180px): 5 card draggable (non `dnd-kit` sortable, ma `useDraggable`): `Strategy`, `Security`, `FixedIncomeStrategy`, `HedgeSecurity`, `CouponPayingSecurity`. Ogni card al dragStart setta `data: { type, isPalette: true }`. Icone testuali (es. `◈ Strategy`). Al drop su canvas, `addChild(dragOverParentId, new NodeConfig({name: type, type}))`.
* **Canvas** (centro, flex 1): render ricorsivo `NodeItem` con `useSortable({id: node.id, data: {node}})`. `SortableContext` per children di ogni Strategy. Mostra `name` + badge `type` + `algos.length` se Strategy. Click → `setSelected(node.id)`. Drag handle `⋮⋮`. Evidenzia `selectedId`.
* **DnD logic**: `DndContext` su BuilderView che gestisce sia palette→canvas sia reorder intra-parent. Su `onDragEnd`, se `active.data.isPalette` → `addChild(overId, newNode)`, altrimenti `moveNode(active.id, overParentId, newIndex)`. Usa `arrayMove` da `@dnd-kit/sortable`.

`frontend/src/bt/components/NodeInspector.tsx` (dx, 260px):

* Se `selectedId == null` → "Seleziona un nodo".
* Altrimenti `node = findNode(tree.root, selectedId)`.
* Campi: `name` (input), `type` badge readonly (cambio tipo non consentito v1 — serve ricreazione), `params` JSON editor (textarea con `JSON.stringify(node.params, null, 2)` + parse on blur, valida JSON). Per `Security` mostra hint "ticker = name".
* Se `node.type` è Strategy → renderizza `AlgoStack` inline (vedi step 3) + lista children count.

Stile: CSS inline come `StrategyBacktestView.tsx:978-1010` (dark `#0d1117`, border `#30363d`) per coerenza con futuro port in Stocks_App (che usa `var(--bg-secondary)`). Non introdurre CSS framework.

**Verify**: `npm run build` → exit 0. Manuale: avvia `npm run dev -- --port 3001`, trascina `Security` da palette su root → appare in canvas, click → inspector mostra name.

### Step 3: Algo Stack Composer — registry + auto-form + validazione

`backend/services/algo_registry.py` — estendi parsing `Requires`/`Sets`:

Già in plan 002 estrae `category`/`params`/`doc`. Aggiungi estrazione `requires`/`sets` da docstring via regex `r"Requires:\s*(.+)"` e `r"Sets:\s*(.+)"` (pattern usato in `bt/algos.py` — verifica su `WeighEqually`, `Rebalance`, `SelectAll`).

Esponi in `GET /api/bt/algos` anche `requires`/`sets`.

`frontend/src/bt/components/AlgoStack.tsx`:

* Props: `nodeId: string` (Strategy node).
* Fetch `algosApi.list()` una volta (cache in `useMemo`), raggruppa per `category` (7 gruppi come SPEC). Mostra `select` per aggiungere algo + `Add` button. `select` default `RunMonthly`.
* Lista stack verticale (`SortableContext` per `node.algos` con `id = index` o `algoId` generato). Ogni item: `class_name` + `×` remove + drag handle + form inline.
* **Auto-Form**: al mount di ogni item, `algosApi.schema(class_name)` → `properties`/`required`. Genera input: `string` → text, `int`/`float` → number, `bool` → checkbox, `enum` → select. Valore in `algo.params[key]`, onChange → `updateNode(nodeId, {algos: newAlgos})` via store.
* Validazione: se `algo.requires` contiene `weights` ma nessun algo precedente `sets: weights`, mostra warning giallo "Requires 'weights' — aggiungi Weigh* prima". Non bloccare save, solo warning.
* Drag-reorder: `onDragEnd` → `arrayMove(algos, oldIndex, newIndex)` + `updateNode`.

Riutilizza `@monaco-editor/react` per params di tipo `code` se un algo ha param `fn` (raro in v1 — opzionale).

**Verify**: `npm run build` → exit 0. `uv run pytest -q` → still pass (BE registry test esteso). Manuale: aggiungi `RunMonthly` + `WeighEqually` + `Rebalance` a root Strategy → warning scompare, reorder funziona, `updateNode` persiste in store.

### Step 4: BuilderView composition + persistenza

`frontend/src/bt/components/BuilderView.tsx`:

```tsx
import { DndContext, closestCenter } from '@dnd-kit/core'
import { useBtStore } from '../store/btStore'
import TreeEditor from './TreeEditor'
import NodeInspector from './NodeInspector'
import { strategiesApi } from '../../api/bt'

export default function BuilderView() {
  const { tree, setTree } = useBtStore()
  // DndContext wrappers, palette+canvas+inspector layout (flex row, gap 12)
  // Top bar: tree name input + Save / Load / New buttons
  // Save → strategiesApi.create(tree) or update, Load → select from list
}
```

Layout: `display:flex, gap:12, height: calc(100vh - 80px)` — palette 180px | canvas flex1 | inspector 260px. Top bar con `input` per `tree.name` + `Save` (POST) + `Load` (select da `strategiesApi.list()`) + `New` (reset a default tree).

`frontend/src/App.tsx` — monta BuilderView:

```tsx
import BuilderView from './bt/components/BuilderView'
export default function App() {
  const [view, setView] = useState('builder')
  return (
    <div style={{ padding: 12 }}>
      <nav>… buttons setView …</nav>
      {view === 'builder' && <BuilderView />}
      {/* other views placeholder */}
    </div>
  )
}
```

Testa persistenza: `Save` → `POST /api/bt/strategies` (verifica 201), `Load` → `GET /api/bt/strategies` → seleziona → `setTree`.

**Verify**: `npm run build` → exit 0. Manuale E2E: crea tree `Root(Strategy: RunMonthly+WeighEqually+Rebalance) → [AAPL(Security), MSFT(Security)]`, Save "test-tree", reload pagina, Load "test-tree" → tree identico. `curl -s http://127.0.0.1:8001/api/bt/strategies | python -m json.tool` → lista contiene "test-tree".

## Test plan

- FE: nessuno test automatico richiesto in questo piano (FE test via `npm run build` + manuale). Se si vuole, `vitest` può testare `btStore` DFS helpers (add/remove/move) — opzionale, non bloccante.
- BE: estendi `tests/backend/test_algo_registry.py` per `requires`/`sets` extraction (es. `Rebalance` requires `weights`).
- **Verify**: `uv run pytest -q` → pass, `npm run build` → exit 0, manuale drag-drop + save/load funziona.

## Done criteria

- [ ] `npm run build` (in `../bt-gui/frontend`) → exit 0
- [ ] `uv run ruff check .` (in `../bt-gui`) → exit 0
- [ ] Drag palette `Security` su root Strategy → nuovo child appare in canvas (manuale)
- [ ] Click nodo → inspector mostra `name` editabile, modifica persiste in store
- [ ] Aggiungi `RunMonthly`, `WeighEqually`, `Rebalance` a Strategy → stack mostra 3 item con form auto-generati, reorder via drag funziona
- [ ] `Save` tree → `curl -s http://127.0.0.1:8001/api/bt/strategies | grep -q "test-tree"` → exit 0 (con BE up e tree salvato)
- [ ] `Load` tree dopo reload → tree identico (manuale)
- [ ] `git -C ../bt-gui log --oneline -1 | grep -q "003\|tree\|algo"` → exit 0

## STOP conditions

- `@dnd-kit` drag-drop non funziona con `verbatimModuleSyntax` (import type vs value) — report `tsc` error, fix con `import type { … }`.
- `GET /api/bt/algos` ritorna lista vuota (registry non popolato — report `REGISTRY` keys, verifica `bt/algos.py` import).
- `AlgoConfig` `params` non serializzabili (es. `pd.DataFrame` default) — report quale algo/param, fallback a `string` input.
- `findNode`/`findParent` DFS causa stack overflow su tree profondo (max depth ~10 atteso — report depth, passa a iterativo).
- `noUnusedLocals`/`noUnusedParameters` blocca `npm run build` (report file:line, prefixa con `_` o rimuovi).

## Maintenance notes

- `btStore` DFS helpers sono l'unico posto con logica tree — se si aggiunge undo/redo, wrappare `setTree` con history stack lì, non nei componenti.
- `AlgoStack` `requires`/`sets` warning è soft — non blocca `Save`. Se in futuro si vuole validazione hard, aggiungere check in `POST /api/bt/strategies` lato BE (chiama `tree_serializer` + `algo_registry.validate_stack(tree)`).
- `@dnd-kit` `SortableContext` `id` deve essere stabile — usa `node.id` (uuid) non `index`, altrimenti reorder rompe animazione.
- `NodeInspector` `params` JSON editor è textarea v1 — sostituibile con `Monaco` o form tipizzato quando `algo_registry` espone JSON Schema per Node params (es. `multiplier` per `FixedIncomeStrategy`).
- `TreeEditor` canvas ricorsivo — se si aggiunge virtualizzazione per alberi >100 nodi, estrarre `NodeItem` memoizzato (`React.memo`).

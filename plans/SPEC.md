# bt-gui Specification — Variante A (repo separato, React19+Vite, uv)

**Project**: Visual GUI per `bt` — repo separato `bt-gui`, integrabile in `Stocks_App`  
**Decisione**: Opzione A — standalone con Vite, portabile in Stocks_App come view+router  
**Deciso il**: 2026-08-23 · commit base `8fd6270` · package manager `uv` per entrambi i lati  
**Precedente**: NiceGUI spec archiviata in `plans/SPEC.nicegui.md` (questa la sostituisce)

---

## 0. Obiettivi e vincoli decisi

1. **Parallelo ora, integrabile domani** — `bt-gui` si sviluppa fuori da `Stocks_App` senza bloccarlo; l'integrazione futura è copia di 1 view + 1 router, non riscrittura.
2. **Repo separato `bt-gui`** — `bt` (fork `pmorissette/bt`) resta pulito per `git pull upstream`. `bt-gui` dipende da `bt` via `bt @ file://../bt` in dev e `bt>=1.2.0` in release. Evita conflitti su `pyproject.toml`/`Makefile`/CI.
3. **uv ovunque** — sia `bt` (`pyproject.toml` già con `[tool.uv] package=false`) sia `bt-gui` usano `uv sync`/`uv run`. Allineato a `Stocks_App/backend/pyproject.toml` (`requires-python >=3.11`, `uv.lock` committato).
4. **Contratto unico** — FE e BE parlano solo via JSON `StrategyTree` + OpenAPI. FE non importa `bt` direttamente.

---

## 1. Architettura

```
┌──────────────────────────────────────────────────────────────────────┐
│  bt-gui/frontend  (React 19 + Vite + TypeScript strict)               │
│  ┌──────────────┐ ┌──────────────────┐ ┌──────────────────┐          │
│  │ Tree Editor  │ │  Algo Stack      │ │ Results Dashboard│          │
│  │ (dnd-kit)    │ │  Composer        │ │ (lightweight-    │          │
│  └──────┬───────┘ └────────┬─────────┘ │  charts)         │          │
│         │                  │           └────────┬─────────┘          │
│         └──────────────────┼────────────────────┘                    │
│                            ▼                                         │
│                   React state (Zustand o Context)                     │
│                   api/bt.ts  ←→  types/bt.ts (da OpenAPI)           │
└────────────────────────────┼─────────────────────────────────────────┘
                             │  HTTP + WS  (vite proxy /* → :8001)
                             ▼
┌──────────────────────────────────────────────────────────────────────┐
│  bt-gui/backend  (FastAPI, uvicorn :8001)                             │
│  APIRouter(prefix="/api/bt")  ← isolato, importabile in Stocks_App   │
│  - POST /api/bt/backtest          (run + persist)                     │
│  - WS   /api/bt/backtest/{id}/progress                                │
│  - GET  /api/bt/algos   GET /api/bt/algos/{name}/schema              │
│  - CRUD /api/bt/strategies   /api/bt/data-sources   /api/bt/runs     │
│  services: tree_serializer │ algo_registry │ data_loader │ runner │ persistence │
│  models:  StrategyTree │ BacktestConfig │ DataSourceConfig │ database (SQLAlchemy) │
└────────────────────────────┼─────────────────────────────────────────┘
                             ▼
                     bt library (bt.Strategy / bt.algos / bt.Backtest)
```

**Porte in dev** (evitano collisione con Stocks_App `:8000/:3000`):
* `bt-gui` BE `:8001`, FE `:3001` (`vite.config.ts` proxy `/* → http://localhost:8001` — stesso pattern di `Stocks_App/frontend/vite.config.ts:8`).

**Integrazione Stocks_App** (quando pronta, senza riscrittura):
* BE: `from bt_gui.api.routes import router as bt_router; app.include_router(bt_router)` — 2 righe in `Stocks_App/backend/main.py`.
* FE: copia `bt-gui/frontend/src/bt/` → `Stocks_App/frontend/src/components/bt/`, aggiungi `NAV_ITEMS` (`Stocks_App/frontend/src/navItems.ts:5`) + case in `App.tsx:119`, riusa `api.ts:33 request<T>` + `WS_BASE`.

---

## 2. Routes (SPA)

| Route (bt-gui standalone) | View | Equivalente Stocks_App dopo integrazione |
|---|---|---|
| `/` | Builder (tree + algo + data + run) | `BTBuilderView` montata su `#bt-builder` |
| `/results/:runId` | Results (equity, weights, metrics, tx, drawdown) | stessa view, hash `#bt-results&run=…` |
| `/strategies` | Library (CRUD strategie salvate) | sottoview o tab dentro Builder |
| `/data` | Data Manager (sorgenti + ffn fetch) | riusa `HistoricalDataView`/`TickerListsView` se già presenti |
| `/settings` | Settings (prefs) | `ConfigurationView` |

FE standalone usa `react-router` o lo stesso hash-routing di `Stocks_App/frontend/src/App.tsx:42-68` — a scelta; l'integrazione adatterà comunque a `ViewId`.

---

## 3. Data Models (Pydantic — invariati rispetto a SPEC NiceGUI)

### StrategyTree
```python
class NodeConfig(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    name: str
    type: Literal["Strategy", "Security", "FixedIncomeStrategy",
                  "HedgeSecurity", "CouponPayingSecurity"]
    params: Dict[str, Any] = {}  # e.g. {"multiplier": 1.0}
    algos: List[AlgoConfig] = []  # only for Strategy types
    children: List["NodeConfig"] = []

class AlgoConfig(BaseModel):
    class_name: str  # "RunMonthly", "WeighEqually", ...
    params: Dict[str, Any] = {}

class StrategyTree(BaseModel):
    name: str
    root: NodeConfig
    version: int = 1
```

### BacktestConfig
```python
class CommissionConfig(BaseModel):
    type: Literal["simple", "bidoffer"] = "simple"
    simple_fn: Optional[str] = None  # "lambda q, p: max(1, abs(q)*0.01)" — validato, non eval libero
    use_bidoffer: bool = False

class BacktestConfig(BaseModel):
    initial_capital: float = 1_000_000.0
    commission: CommissionConfig = CommissionConfig()
    integer_positions: bool = True
    progress_bar: bool = False  # BE ignora in API, utile per CLI
```

### DataSourceConfig
```python
class DataSourceConfig(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    name: str
    type: Literal["price", "volume", "volatility", "bidoffer", "coupons", "cost_long", "cost_short"]
    source: Literal["csv", "parquet", "ffn"]
    path_or_tickers: str
    meta: Dict[str, Any] = {}
```

---

## 4. Database Schema (SQLAlchemy — identico a SPEC precedente)

```python
class Strategy(Base):
    __tablename__ = "strategies"
    id = Column(Integer, primary_key=True)
    name = Column(String, unique=True)
    tree_json = Column(JSON)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, onupdate=datetime.utcnow)

class DataSource(Base):
    __tablename__ = "data_sources"
    id = Column(Integer, primary_key=True)
    name = Column(String, unique=True)
    type = Column(String)
    source = Column(String)
    path_or_tickers = Column(String)
    meta_json = Column(JSON)
    parquet_blob = Column(LargeBinary)

class BacktestRun(Base):
    __tablename__ = "backtest_runs"
    id = Column(Integer, primary_key=True)
    strategy_id = Column(Integer, ForeignKey("strategies.id"))
    config_json = Column(JSON)
    stats_json = Column(JSON)
    prices_parquet = Column(LargeBinary)
    weights_parquet = Column(LargeBinary)
    transactions_parquet = Column(LargeBinary)
    created_at = Column(DateTime, default=datetime.utcnow)
```

Nota: due DB come Stocks_App (`config.db` versionato vs `market.db` gitignored) **non** necessari qui — singolo `bt_gui.db` basta. Se si integra in Stocks_App, le 3 tabelle convivono con quelle esistenti.

---

## 5. UI Components (React — sostituisce `bt_gui/ui/` NiceGUI)

### 1. Tree Editor (`frontend/src/bt/components/TreeEditor.tsx`)
* Palette: card draggable per 5 tipi nodo (icone).
* Canvas: albero con `@dnd-kit/sortable` o `react-arborist`, drag da palette + reorder.
* Inspector: pannello dx — name, type badge, params, algo stack se `type is Strategy`.

### 2. Algo Stack Composer (`frontend/src/bt/components/AlgoStack.tsx`)
* Registry: `GET /api/bt/algos` → lista categorizzata (stesse 7 categorie di SPEC: Scheduling/Selection/Weighting/Risk/Execution/Flows/Simulation/Debug).
* Auto-Form: `GET /api/bt/algos/{name}/schema` (JSON Schema da `inspect.signature`) → input tipizzati.
* Stack: lista verticale drag-reorder, form inline, validazione Requires/Sets.

### 3. Data Manager (`frontend/src/bt/components/DataManager.tsx`)
* Tabella sorgenti + preview.
* Dialog ffn: tickers, start/end → `POST /api/bt/data-sources/fetch` (`ffn.get` lato BE).
* Upload CSV/Parquet → `POST /api/bt/data-sources/upload` (multipart).
* Validazione allineamento indici/colonne come `bt/backtest.py:_process_data`.

### 4. Run Dialog (`frontend/src/bt/components/RunDialog.tsx`)
* Form `BacktestConfig`, editor `simple_fn` con `@monaco-editor/react` (già in `Stocks_App/frontend/package.json:13`).
* Pulsante Run → `POST /api/bt/backtest` + WS progress `ws://…/api/bt/backtest/{id}/progress`.

### 5. Results Dashboard (`frontend/src/bt/components/ResultsDashboard.tsx`)
* Equity curve: `lightweight-charts` LineSeries (pattern `Stocks_App/.../StrategyBacktestView.tsx:520-588`).
* Weights heatmap: `lightweight-charts` o `chart.js` heatmap (a scelta; `Stocks_App` usa entrambi).
* Metrics: tabella da `Result.stats` (`bt/backtest.py:470`).
* Transactions: tabella paginata.
* Drawdown: AreaSeries underwater.
* Compare: overlay curve, metrics side-by-side — riusa `sanitizeLine`/`sanitizeCandles` di `StrategyBacktestView.tsx:492-496`.

---

## 6. Services (backend — invariati, solo spostati sotto `backend/`)

| Modulo | Responsabilità |
|---|---|
| `services/tree_serializer.py` | `StrategyTree.to_bt_strategy()` → build ricorsivo `bt.Strategy`/`bt.Security` |
| `services/algo_registry.py` | `discover_algos()`, `algo_schema(name)`, validazione |
| `services/data_loader.py` | Load CSV/Parquet, fetch `ffn`, validate, return DataFrame |
| `services/backtest_runner.py` | `async run_backtest()` in threadpool, WS progress, cancel |
| `services/persistence.py` | CRUD Strategy/DataSource/BacktestRun su SQLite |

Tutti esposti via `api/routes.py` come `APIRouter(prefix="/api/bt")` isolato.

---

## 7. Project Structure (repo separato `bt-gui`)

```
bt-gui/                          # repo separato, uv
├── pyproject.toml               # [project] name="bt-gui", deps bt>=1.2.0, fastapi, pydantic>=2, sqlalchemy>=2
├── uv.lock
├── .python-version              # 3.12 (allineato a bt)
├── README.md
├── backend/
│   ├── main.py                  # FastAPI app + include_router(bt_router) + CORS
│   ├── database.py              # SQLAlchemy engine (check_same_thread=False come Stocks_App)
│   ├── models/
│   │   ├── strategy_tree.py
│   │   ├── backtest_config.py
│   │   ├── data_source.py
│   │   └── db_models.py
│   ├── services/
│   │   ├── tree_serializer.py
│   │   ├── algo_registry.py
│   │   ├── data_loader.py
│   │   ├── backtest_runner.py
│   │   └── persistence.py
│   └── api/
│       ├── __init__.py
│       └── routes.py            # APIRouter(prefix="/api/bt") — UNICO punto di integrazione Stocks_App
├── frontend/
│   ├── package.json             # react 19, vite 8, @dnd-kit/*, lightweight-charts 5, @monaco-editor/react
│   ├── vite.config.ts           # proxy /* → http://localhost:8001
│   ├── tsconfig.app.json        # verbatimModuleSyntax, noUnusedLocals (come Stocks_App)
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       ├── App.tsx              # router (hash o react-router) + 5 views
│       ├── api/
│       │   └── bt.ts            # request<T>/WS_BASE pattern da Stocks_App/frontend/src/api.ts:29-43
│       ├── types/
│       │   └── bt.ts            # generati da OpenAPI (openapi-typescript), non scritti a mano
│       ├── bt/
│       │   ├── components/
│       │   │   ├── TreeEditor.tsx
│       │   │   ├── AlgoStack.tsx
│       │   │   ├── DataManager.tsx
│       │   │   ├── RunDialog.tsx
│       │   │   └── ResultsDashboard.tsx
│       │   └── store/
│       │       └── btStore.ts   # Zustand o Context — equivalente AppState di SPEC
│       └── components/          # layout condiviso (Sidebar se serve)
├── tests/
│   ├── backend/                 # pytest (httpx AsyncClient)
│   └── frontend/                # vitest se serve
└── scripts/
    └── dev.sh                   # uv run uvicorn backend.main:app --port 8001 --reload  +  npm run dev -- --port 3001
```

---

## 8. Phased Implementation (6 fasi, 6 settimane — FE ora React)

### Fase 1: Foundation (Settimana 1) — Piano 001
- [ ] `pyproject.toml` + `uv.lock` + `backend/main.py` (FastAPI + CORS + `APIRouter`)
- [ ] Pydantic models + SQLAlchemy schema + `openapi.json` generato
- [ ] `frontend` Vite bootstrap (ts strict, proxy, `api/bt.ts` + `types/bt.ts`)
- [ ] Data loader BE: CSV/Parquet + `ffn.get` (validazione indici)
- [ ] **Deliverable**: `uv run uvicorn …:8001` + `npm run dev -- --port 3001` si aprono, `GET /api/bt/health` ok, upload CSV funziona

### Fase 2: Tree Editor (Settimana 2) — Piano 002/003
- [ ] Palette 5 tipi nodo + canvas `@dnd-kit` + inspector
- [ ] Serializzazione `StrategyTree` ↔ `bt.Strategy` (ricorsiva, test con alberi nested)
- [ ] Persistenza strategie (CRUD SQLite)
- [ ] **Deliverable**: costruire/salvare/ricaricare alberi anche annidati (Strategy dentro Strategy)

### Fase 3: Algo Stack (Settimana 3) — Piano 003
- [ ] `GET /api/bt/algos` con categorie + `GET /api/bt/algos/{name}/schema`
- [ ] Auto-form da JSON Schema, drag-reorder, validazione Requires/Sets
- [ ] **Deliverable**: comporre logica completa, validata, serializzata nel tree

### Fase 4: Data & Config (Settimana 4) — Piano 004
- [ ] Data sources manager (tabella + preview + ffn dialog + allineamento)
- [ ] `BacktestConfig` form + Monaco editor per `simple_fn` con validazione `inspect.signature(q,p)` (come `bt/backtest.py:204-213`)
- [ ] **Deliverable**: setup pre-run completo senza errori di allineamento

### Fase 5: Backtest Execution (Settimana 5) — Piano 004
- [ ] `POST /api/bt/backtest` async in threadpool + WS progress + cancel
- [ ] Persistenza `BacktestRun` (parquet blob) + `CostModel` wiring se `bidoffer`/`volume`/`volatility` forniti
- [ ] **Deliverable**: run con progress live, annullabile, risultati persistiti

### Fase 6: Results Dashboard (Settimana 6) — Piano 004
- [ ] Equity/weights/drawdown con `lightweight-charts` + metrics/transactions table + compare
- [ ] Export strategia → `.py` standalone (opzionale v1)
- [ ] **Deliverable**: analisi professionale, confronto multi-run

### Fase 7: Integrazione Stocks_App (dopo v1) — Piano 005
- [ ] BE: `include_router` in `Stocks_App/backend/main.py` (o proxy microservizio)
- [ ] FE: copia `bt/` + `NAV_ITEMS` + `ViewId` + tipi
- [ ] **Deliverable**: `bt-gui` usabile dentro Stocks_App senza fork del FE

---

## 9. Open Decisions (aggiornate)

1. **Router FE standalone**: `react-router` vs hash-routing `App.tsx:42` di Stocks_App — hash è più facile da portare, react-router più standard. Default: hash per v1.
2. **ffn vs yfinance**: SPEC usa `ffn`, Stocks_App usa `yfinance`. `data_loader.py` astrae con adapter — v1 `ffn`, adapter `yfinance` in Fase 7 se serve.
3. **Template built-in**: momentum / mean-reversion / risk-parity / pairs — sì, 3 template in v1 (coprono 80% test).
4. **Export `.py`**: sì, `StrategyTree → .py` via `tree_serializer` (utile per utenti `bt` puri).
5. **Heatmap weights**: `lightweight-charts` non ha heatmap nativa — usare `chart.js` (già in Stocks_App) o `echarts` solo per quel pannello.

---

## 10. Dependencies

### Backend (`bt-gui/pyproject.toml`)
```toml
[project]
name = "bt-gui"
requires-python = ">=3.12"
dependencies = [
    "bt>=1.2.0",          # file://../bt in dev, git tag in CI
    "fastapi>=0.110",
    "uvicorn[standard]>=0.30",
    "pydantic>=2.0",
    "sqlalchemy>=2.0",
    "pandas>=2.0",
    "numpy>=1.26,<3.0",
    "ffn>=1.1.2",
    "python-multipart>=0.0.9",  # upload CSV/Parquet
    "aiofiles>=23.0",
    "websockets>=12.0",
]

[dependency-groups]
dev = ["pytest>=8", "httpx>=0.28", "ruff>=0.8", "mypy>=1.10"]
```

### Frontend (`bt-gui/frontend/package.json`)
```json
{
  "dependencies": {
    "react": "^19.2.6",
    "react-dom": "^19.2.6",
    "@dnd-kit/core": "^6.1.0",
    "@dnd-kit/sortable": "^8.0.0",
    "@monaco-editor/react": "^4.7.0",
    "lightweight-charts": "^5.0.0",
    "chart.js": "^4.5.1",
    "zustand": "^5.0.0"
  },
  "devDependencies": {
    "typescript": "~6.0.2",
    "@vitejs/plugin-react": "^6.0.1",
    "vite": "^8.0.12",
    "openapi-typescript": "^7.0.0"
  }
}
```
`chart.js` riusato da Stocks_App solo per heatmap; se non serve, rimuovibile.

---

## 11. Acceptance Criteria (v1)

- [ ] Creare albero strategie visualmente (drag-drop, anche annidato)
- [ ] Comporre algo stack con form auto-generati + validazione
- [ ] Caricare dati via CSV/Parquet o `ffn` (con validazione allineamento)
- [ ] Configurare backtest (capitale, `simple_fn` validata, `integer_positions`)
- [ ] Lanciare backtest con progress WS live + cancel
- [ ] Vedere risultati: equity, weights, metriche `Result.stats`, transactions, drawdown
- [ ] Salvare/caricare strategie da SQLite
- [ ] Confrontare multi-run (overlay + tabella)
- [ ] `uv run uvicorn backend.main:app --port 8001` + `npm run dev -- --port 3001` funzionanti
- [ ] `APIRouter(prefix="/api/bt")` importabile in Stocks_App senza modifiche al FE `bt-gui`

---

## 12. File archiviato

La spec NiceGUI precedente è conservata in `plans/SPEC.nicegui.md` per riferimento. Non cancellarla — serve se si vuole valutare desktop `native=True` in futuro.

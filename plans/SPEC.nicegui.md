# bt-gui Specification — NiceGUI (archiviata)

> **Archiviata il 2026-08-23** — sostituita da `SPEC.md` variante A (React19+Vite, repo separato `bt-gui`, uv).
> Conservata per riferimento se si valuta desktop `native=True` in futuro.

**Project**: Visual GUI for `bt` backtesting framework  
**Framework**: NiceGUI (FastAPI + Vue/Quasar)  
**Target**: Single-user desktop app (`ui.run(native=True)`)  
**Data**: ffn for fetching, CSV/Parquet upload  
**Storage**: SQLite (SQLAlchemy)  
**Transaction Costs**: Simple function `fn(quantity, price) -> float`

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        NiceGUI Frontend                          │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌──────────────────┐  ┌──────────────────┐   │
│  │  Tree Editor │  │  Algo Stack      │  │  Results         │   │
│  │  (drag-drop) │  │  Composer        │  │  Dashboard       │   │
│  └──────┬──────┘  └────────┬─────────┘  └────────┬─────────┘   │
│         │                  │                     │              │
│         └──────────────────┼─────────────────────┘              │
│                            ▼                                    │
│                   ┌──────────────────┐                          │
│                   │  AppState        │  (reactive singleton)    │
│                   └────────┬─────────┘                          │
└────────────────────────────┼────────────────────────────────────┘
                             │
              ┌──────────────┴──────────────┐
              ▼                             ▼
    ┌─────────────────────┐     ┌─────────────────────┐
    │   FastAPI Backend   │     │   bt Library        │
    │  (async, non-block) │────▶│  (core/algos/       │
    │  - /api/backtest    │     │   backtest)         │
    │  - /api/data        │     │                     │
    │  - /api/strategies  │     │                     │
    └─────────────────────┘     └─────────────────────┘
```

---

## Routes (Single Page App)

| Route | Page | Description |
|-------|------|-------------|
| `/` | Builder | Tree editor + algo stack + data + run |
| `/results/{run_id}` | Results | Equity curve, weights, metrics, transactions |
| `/strategies` | Library | Saved strategies CRUD |
| `/data` | Data Manager | Sources table + ffn fetch |
| `/settings` | Settings | App preferences |

---

## Data Models (Pydantic)

### StrategyTree
```python
class NodeConfig(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    name: str
    type: Literal["Strategy", "Security", "FixedIncomeStrategy", 
                  "HedgeSecurity", "CouponPayingSecurity"]
    params: Dict[str, Any] = {}  # e.g., {"multiplier": 1.0}
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
    # Simple: fn(q, p) -> float, e.g. "lambda q, p: max(1, abs(q) * 0.01)"
    simple_fn: Optional[str] = None
    # Bid/offer: requires bidoffer data source
    use_bidoffer: bool = False

class BacktestConfig(BaseModel):
    initial_capital: float = 1_000_000.0
    commission: CommissionConfig = CommissionConfig()
    integer_positions: bool = True
    progress_bar: bool = True
```

### DataSourceConfig
```python
class DataSourceConfig(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    name: str
    type: Literal["price", "volume", "volatility", "bidoffer", 
                  "coupons", "cost_long", "cost_short"]
    source: Literal["csv", "parquet", "ffn"]
    path_or_tickers: str  # file path or JSON list of tickers
    meta: Dict[str, Any] = {}  # shape, date_range, columns
```

---

## Database Schema (SQLAlchemy)

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

---

## UI Components

### 1. Tree Editor (`/ui/components/tree_editor.py`)
- **Palette**: Draggable cards for 5 node types with icons
- **Canvas**: `ui.tree` with custom slots, drag-drop from palette, reorder
- **Inspector**: Right panel — name, type badge, params, algo stack (for Strategy)

### 2. Algo Stack Composer (`/ui/components/algo_stack.py`)
- **Registry**: Auto-discover `bt.algos` classes, categorize by prefix
- **Auto-Form**: `inspect.signature(AlgoClass.__init__)` → NiceGUI inputs
- **Stack**: Vertical list with drag-reorder, inline param forms, validation

**Algo Categories**:
- Scheduling: `RunOnce`, `RunDaily`, `RunWeekly`, `RunMonthly`, `RunQuarterly`, `RunYearly`, `RunOnDate`, `RunAfterDate`, `RunAfterDays`, `RunEveryNPeriods`, `RunIfOutOfBounds`
- Selection: `SelectAll`, `SelectThese`, `SelectHasData`, `SelectN`, `SelectMomentum`, `SelectWhere`, `SelectRandomly`, `SelectRegex`, `SelectActive`, `SelectTypes`, `ResolveOnTheRun`
- Weighting: `WeighEqually`, `WeighSpecified`, `WeighTarget`, `WeighInvVol`, `WeighERC`, `WeighMeanVar`, `WeighRandomly`, `ScaleWeights`
- Risk/Constraints: `LimitWeights`, `LimitDeltas`, `TargetVol`, `PTE_Rebalance`
- Execution: `Rebalance`, `RebalanceOverTime`
- Flows/Risk: `CapitalFlow`, `CorporateActions`, `HedgeRisks`, `UpdateRisk`, `SetNotional`
- Simulation: `ReplayTransactions`, `SimulateRFQTransactions`
- Debug: `PrintDate`, `PrintInfo`, `PrintTempData`, `PrintRisk`, `Debug`

### 3. Data Manager (`/ui/components/data_manager.py`)
- Table of loaded sources with preview
- ffn fetch dialog: tickers, start/end date → `ffn.get()`
- Validate index/columns match price data

### 4. Run Dialog (`/ui/components/run_dialog.py`)
- BacktestConfig form
- Commission: simple function editor (code input with syntax highlight)
- Run button with progress WebSocket stream

### 5. Results Dashboard (`/ui/components/results_dashboard.py`)
- Equity curve: `ui.echart` interactive line
- Weights heatmap: `ui.echart` heatmap
- Metrics table: `ui.table` from `Result.stats`
- Transactions: `ui.table` with pagination
- Drawdown: `ui.echart` underwater plot
- Compare: overlay curves, side-by-side metrics

---

## Services

| Module | Responsibility |
|--------|----------------|
| `tree_serializer.py` | `StrategyTree.to_bt_strategy()` → recursive `bt.Strategy` build |
| `algo_registry.py` | `discover_algos()`, `build_form(algo_class)`, validation |
| `data_loader.py` | Load CSV/Parquet, fetch ffn, validate, return DataFrame |
| `backtest_runner.py` | `async run_backtest()` in thread pool, WebSocket progress |
| `persistence.py` | Save/load Strategy, DataSource, BacktestRun to SQLite |

---

## Project Structure

```
bt-gui/
├── pyproject.toml
├── main.py
├── bt_gui/
│   ├── __init__.py
│   ├── models/
│   │   ├── __init__.py
│   │   ├── strategy_tree.py
│   │   ├── backtest_config.py
│   │   ├── data_source.py
│   │   └── database.py
│   ├── services/
│   │   ├── __init__.py
│   │   ├── tree_serializer.py
│   │   ├── algo_registry.py
│   │   ├── data_loader.py
│   │   ├── backtest_runner.py
│   │   └── persistence.py
│   ├── ui/
│   │   ├── __init__.py
│   │   ├── state.py
│   │   ├── components/
│   │   │   ├── __init__.py
│   │   │   ├── tree_editor.py
│   │   │   ├── algo_stack.py
│   │   │   ├── data_manager.py
│   │   │   ├── run_dialog.py
│   │   │   └── results_dashboard.py
│   │   └── pages/
│   │       ├── __init__.py
│   │       ├── builder.py
│   │       ├── results.py
│   │       ├── strategies.py
│   │       └── data.py
│   └── api/
│       ├── __init__.py
│       └── routes.py
└── tests/
```

---

## Phased Implementation

### Phase 1: Foundation (Week 1)
- [ ] `pyproject.toml`, `main.py` (FastAPI + NiceGUI mount)
- [ ] Pydantic models + SQLAlchemy schema
- [ ] `AppState` reactive singleton
- [ ] Data loader: CSV/Parquet + ffn fetch
- [ ] **Deliverable**: App opens, "Load Data" works

### Phase 2: Tree Editor (Week 2)
- [ ] Palette with 5 node types
- [ ] Tree canvas with drag-drop
- [ ] Node inspector
- [ ] Serialization to `bt.Strategy`
- [ ] **Deliverable**: Build and save strategy trees

### Phase 3: Algo Stack (Week 3)
- [ ] Algo registry with categories
- [ ] Auto-form generation from signatures
- [ ] Stack builder with drag-reorder
- [ ] Validation (Requires/Sets)
- [ ] **Deliverable**: Full strategy logic composition

### Phase 4: Data & Config (Week 4)
- [ ] Data sources manager
- [ ] ffn fetch dialog
- [ ] Backtest config (simple commission fn)
- [ ] **Deliverable**: Complete pre-run setup

### Phase 5: Backtest Execution (Week 5)
- [ ] Async runner with progress WebSocket
- [ ] Cancel support
- [ ] Persist results to SQLite
- [ ] **Deliverable**: Run backtests, see live progress

### Phase 6: Results Dashboard (Week 6)
- [ ] Equity curve, weights heatmap
- [ ] Metrics table, transactions table
- [ ] Drawdown chart
- [ ] Multi-backtest compare
- [ ] **Deliverable**: Professional analysis views

---

## Open Decisions

1. **Theme**: NiceGUI default (Material) or custom?
2. **ffn providers**: Yahoo only, or configurable API keys?
3. **Built-in templates**: Ship momentum, mean-reversion, risk-parity, pairs in v1?
4. **Export**: Strategy export to standalone `.py` script?

---

## Dependencies

```toml
[project]
dependencies = [
    "nicegui>=2.0.0",
    "bt>=1.2.0",
    "ffn>=1.1.2",
    "pandas>=2.0",
    "numpy>=1.24",
    "pydantic>=2.0",
    "sqlalchemy>=2.0",
    "aiofiles>=23.0",
    "python-dateutil>=2.8",
    "echarts-python>=0.2.0",  # for ui.echart
]
```

---

## Acceptance Criteria (v1)

- [ ] Create strategy tree visually (drag-drop)
- [ ] Compose algo stack with auto-generated forms
- [ ] Load price data via CSV/Parquet or ffn
- [ ] Configure backtest (capital, simple commission fn)
- [ ] Run backtest with live progress
- [ ] View results: equity, weights, metrics, transactions, drawdown
- [ ] Save/load strategies from SQLite
- [ ] Compare multiple backtest runs
- [ ] Run as native desktop app (`python main.py`)

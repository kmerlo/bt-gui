# Plan 002: Modelli Pydantic + DB + serializzazione StrategyTree

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 8fd6270..HEAD -- plans/` + `ls ../bt-gui/backend/main.py` — this plan assumes plan 001 is DONE (repo `../bt-gui` exists with FastAPI health check, `APIRouter(prefix="/api/bt")`, Vite scaffold). If `../bt-gui/backend/api/routes.py` does not contain `router = APIRouter(prefix="/api/bt")`, treat as drift/STOP.

## Status

- **Priority**: P0
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/001-bootstrap-bt-gui.md
- **Category**: tech-debt / correctness
- **Planned at**: commit `8fd6270`, 2026-08-23
- **Issue**: —

## Why this matters

I modelli `StrategyTree`/`BacktestConfig`/`DataSourceConfig` sono il contratto FE↔BE e la base di tutto: tree editor, algo stack, runner e persistenza dipendono da essi. Se la serializzazione `StrategyTree → bt.Strategy` è sbagliata, i backtest producono risultati diversi dalla stessa tree visuale — bug silenzioso e costoso. Questo piano rende il contratto verificato da test e l'OpenAPI genera `frontend/src/types/bt.ts` senza drift.

## Current state

- Plan 001 ha creato `../bt-gui/backend/main.py` con `APIRouter(prefix="/api/bt")` e stub `GET /api/bt/health`, `/algos`, `/algos/{name}/schema`. DB è stub `backend/database.py` (engine `sqlite:///./bt_gui.db`, `check_same_thread=False`, `Base(DeclarativeBase)`). Nessun modello Pydantic, nessuna tabella, nessun serializer.
- `bt` core da integrare:
  - `bt/core/strategy.py` → `StrategyBase`, `Strategy(name, children)`, `FixedIncomeStrategy`; `bt/core/security.py` → `Security`, `FixedIncomeSecurity`, `HedgeSecurity`, `CouponPayingSecurity`; `bt/core/node.py` → `Node`, `PAR`, `TOL`.
  - `bt/algos.py` (~1600 righe): tutti gli algo con `__call__(target) -> bool`. Esempio `WeighEqually`, `RunMonthly`, `Rebalance`, `SelectAll`, ecc. Ogni algo ha docstring con `Requires`/`Sets` usati da `algo_registry` per validazione.
  - `bt/backtest.py` → `Backtest(strategy, data, initial_capital, commissions, integer_positions)` e `Result`. `commissions` validata in `backtest.py:197-213` (`callable` con 2 params posizionali, o `CostModel`).
- `plans/SPEC.md` §3-4 definisce i 3 Pydantic + 3 tabelle SQLAlchemy + servizi `tree_serializer`/`algo_registry`/`persistence`. `Stocks_App/backend/database.py` è il riferimento per pattern engine/session (doppio engine, ma qui ne basta uno).
- `bt/algos.py` va scoperto via `inspect` e `import bt.algos` + `dir`/`getattr` + `issubclass(Algo)`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Backend deps | `uv sync` (in `../bt-gui`) | exit 0 |
| Typecheck | `uv run mypy backend --ignore-missing-imports` | exit 0 (or only known ignores) |
| Lint | `uv run ruff check .` | exit 0 |
| Tests | `uv run pytest -q` | all pass (health + new serializer tests) |
| OpenAPI gen | `npx --prefix frontend openapi-typescript http://localhost:8001/openapi.json -o src/types/bt.ts` | exit 0, `src/types/bt.ts` updated |
| Manual check | `uv run python -c "from backend.models.strategy_tree import StrategyTree; print('ok')"` | `ok` |

## Scope

**In scope** (modify/create in `../bt-gui`):
- `backend/models/strategy_tree.py`, `backend/models/backtest_config.py`, `backend/models/data_source.py`, `backend/models/db_models.py` (o `database.py` — consolidate)
- `backend/services/tree_serializer.py`, `backend/services/algo_registry.py`, `backend/services/persistence.py`
- `backend/api/routes.py` (estendi con CRUD strategies, algos endpoints, OpenAPI tags)
- `frontend/src/types/bt.ts` (rigenera da OpenAPI)
- `tests/backend/test_serializer.py`, `tests/backend/test_algo_registry.py`, `tests/backend/test_persistence.py`
- `backend/database.py` (evolve stub into full DB with `Base.metadata.create_all`)

**Out of scope** (do NOT touch):
- `bt/` — no edits. Test serializer con `bt` importato, non modificato.
- `frontend/src/bt/components/*` — tree editor UI vera è plan 003. Qui solo tipi generati.
- `backend/services/data_loader.py` e `backtest_runner.py` — plan 004.
- `Stocks_App/` — no edits.
- NiceGUI — archived.

## Git workflow

- Branch in `bt-gui`: `feat/002-models-serializer` (convenzione `feat/` come in `bt` — vedi `git log --oneline -5` in `bt`).
- Commit per step (models → db → serializer → registry → routes+OpenAPI). Message: `feat(models): add StrategyTree Pydantic`, `feat(db): add SQLAlchemy tables`, `feat(serializer): StrategyTree → bt.Strategy`.
- Do NOT push unless operator says.

## Steps

### Step 1: Modelli Pydantic `StrategyTree` / `BacktestConfig` / `DataSourceConfig`

Crea `backend/models/strategy_tree.py`:
```python
from __future__ import annotations
from typing import Any, Literal
from uuid import uuid4
from pydantic import BaseModel, Field


class AlgoConfig(BaseModel):
    class_name: str
    params: dict[str, Any] = {}


class NodeConfig(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    name: str
    type: Literal["Strategy", "Security", "FixedIncomeStrategy", "HedgeSecurity", "CouponPayingSecurity"]
    params: dict[str, Any] = {}
    algos: list[AlgoConfig] = []
    children: list[NodeConfig] = []


class StrategyTree(BaseModel):
    name: str
    root: NodeConfig
    version: int = 1
```

`backend/models/backtest_config.py`:
```python
from typing import Literal, Optional
from pydantic import BaseModel, field_validator


class CommissionConfig(BaseModel):
    type: Literal["simple", "bidoffer"] = "simple"
    simple_fn: Optional[str] = None
    use_bidoffer: bool = False

    @field_validator("simple_fn")
    @classmethod
    def validate_simple_fn(cls, v, info):
        if v is None:
            return v
        # Reuse bt/backtest.py:204-213 logic: must be callable source with 2 positional params
        import ast, inspect

        try:
            fn = eval(v, {"__builtins__": {}})
        except Exception as e:
            raise ValueError(f"simple_fn eval failed: {e}")
        if not callable(fn):
            raise ValueError("simple_fn must eval to callable")
        sig = inspect.signature(fn)
        params = [p for p in sig.parameters.values() if p.kind in (inspect.Parameter.POSITIONAL_ONLY, inspect.Parameter.POSITIONAL_OR_KEYWORD)]
        if len(params) < 2:
            raise ValueError("commission fn must accept (quantity, price)")
        return v


class BacktestConfig(BaseModel):
    initial_capital: float = 1_000_000.0
    commission: CommissionConfig = CommissionConfig()
    integer_positions: bool = True
    progress_bar: bool = False
```

`backend/models/data_source.py`:
```python
from typing import Any, Literal, Optional
from uuid import uuid4
from pydantic import BaseModel, Field


class DataSourceConfig(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    name: str
    type: Literal["price", "volume", "volatility", "bidoffer", "coupons", "cost_long", "cost_short"]
    source: Literal["csv", "parquet", "ffn"]
    path_or_tickers: str
    meta: dict[str, Any] = {}
```

`backend/models/__init__.py`: re-export.

**Verify**: `uv run python -c "from backend.models.strategy_tree import StrategyTree; t=StrategyTree(name='x', root={'name':'root','type':'Strategy'}); print(t.model_dump_json()[:80])"` → no error. `uv run ruff check backend/models` → exit 0.

### Step 2: DB SQLAlchemy + `persistence.py` stub

Evolvi `backend/database.py` per creare tabelle (se `backend/models/db_models.py` preferito, sposta lì e importa in `database.py`):

```python
# backend/database.py — full
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, JSON, LargeBinary
from sqlalchemy.orm import DeclarativeBase, sessionmaker, relationship
from sqlalchemy import create_engine
from datetime import datetime

DATABASE_URL = "sqlite:///./bt_gui.db"
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=engine)


class Base(DeclarativeBase):
    pass


class Strategy(Base):
    __tablename__ = "strategies"
    id = Column(Integer, primary_key=True)
    name = Column(String, unique=True, index=True)
    tree_json = Column(JSON)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


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


def init_db():
    Base.metadata.create_all(bind=engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
```

Chiama `init_db()` in `backend/main.py` all'avvio (o usa lifespan).

`backend/services/persistence.py`: CRUD thin wrappers (`save_strategy(db, tree)`, `get_strategy(db, id)`, `list_strategies(db)`, `delete_strategy`) — usati dalle route. Mantieni <80 righe, delega a SQLAlchemy.

**Verify**: `uv run python -c "from backend.database import init_db; init_db(); print('tables ok')"` → `tables ok`. `uv run pytest tests/test_health.py -q` → still pass.

### Step 3: `tree_serializer.py` — `StrategyTree → bt.Strategy`

Crea `backend/services/tree_serializer.py`:

```python
import bt

TYPE_MAP = {
    "Strategy": bt.Strategy,
    "Security": bt.Security,
    "FixedIncomeStrategy": bt.FixedIncomeStrategy,
    "HedgeSecurity": bt.HedgeSecurity,
    "CouponPayingSecurity": bt.CouponPayingSecurity,
}


def _build_node(cfg, is_root=False):
    cls = TYPE_MAP[cfg.type]
    # Node(name, children) + algos via AlgoStack
    # cfg.type in Strategy variants → pass algos as AlgoStack
    # Security variants → leaf, ignore algos
    children = [_build_node(c) for c in cfg.children]
    # params → kwargs del costruttore Node (es. multiplier)
    kwargs = dict(cfg.params or {})
    if children:
        kwargs["children"] = children
    node = cls(cfg.name, **kwargs) if not is_root or cfg.type != "Strategy" else cls(cfg.name, **kwargs)
    # Wire algos if Strategy type
    if cfg.type in ("Strategy", "FixedIncomeStrategy") and cfg.algos:
        from backend.services.algo_registry import build_algo

        stack = [build_algo(a.class_name, a.params) for a in cfg.algos]
        # bt.Strategy expects AlgoStack; use bt.AlgoStack or assign directly
        import bt.core as btc

        node.algo_stack = btc.AlgoStack(*stack) if hasattr(btc, "AlgoStack") else stack
    # Recursively attach children for Strategy nodes (bt expects children via Node)
    # If _build_node already passed children, skip
    return node


def to_bt_strategy(tree) -> bt.Strategy:
    return _build_node(tree.root, is_root=True)


def from_bt_strategy(strategy) -> StrategyTree:
    # Optional reverse — not needed for v1, stub that raises NotImplemented
    raise NotImplementedError
```

Dettagli critici da verificare leggendo `bt/core/strategy.py` e `bt/core/node.py`:
* `Strategy.__init__(self, name, children=None, ...)` — children può essere lista di `Node`/`Security` o dict. Adatta `_build_node` alla firma reale (leggi `bt/core/strategy.py:__init__` prima di scrivere).
* `AlgoStack` è `bt.core.AlgoStack` (`bt/core/algo.py`) — verifica import `from bt.core import AlgoStack` o `bt.AlgoStack`.
* `FixedIncomeStrategy` ha `multiplier`/`cash` handling — passa via `params`.

Scrivi test `tests/backend/test_serializer.py`: round-trip con albero nested (Strategy root con 2 Security + 1 sub-Strategy con 1 Security), verifica `len(strategy.members)`, `strategy.name`, e che `Backtest(strategy, data).run()` non sollevi con `data` dummy (2 colonne, 10 righe).

**Verify**: `uv run pytest tests/backend/test_serializer.py -v` → pass. Manuale: `uv run python -c "from backend.models.strategy_tree import StrategyTree; from backend.services.tree_serializer import to_bt_strategy; t=StrategyTree(...); s=to_bt_strategy(t); print(s)"` → no error.

### Step 4: `algo_registry.py` — discover + schema + validation

`backend/services/algo_registry.py`:
```python
import inspect, importlib
import bt.algos as algos_mod
from bt.core import Algo


def discover_algos():
    out = {}
    for name in dir(algos_mod):
        obj = getattr(algos_mod, name)
        if inspect.isclass(obj) and issubclass(obj, Algo) and obj is not Algo:
            # categorise by prefix (Run*, Select*, Weigh*, etc.) — same 7 buckets as SPEC
            cat = "Other"
            for prefix, label in [
                ("Run", "Scheduling"),
                ("Select", "Selection"),
                ("Weigh", "Weighting"),
                ("Limit", "Risk"),
                ("Target", "Risk"),
                ("PTE", "Risk"),
                ("Rebalance", "Execution"),
                ("Capital", "Flows"),
                ("Corporate", "Flows"),
                ("Hedge", "Flows"),
                ("Update", "Flows"),
                ("Set", "Flows"),
                ("Replay", "Simulation"),
                ("Simulate", "Simulation"),
                ("Print", "Debug"),
                ("Debug", "Debug"),
            ]:
                if name.startswith(prefix):
                    cat = label
                    break
            sig = inspect.signature(obj.__init__)
            params = {
                k: {
                    "annotation": str(v.annotation) if v.annotation != inspect._empty else "Any",
                    "default": v.default if v.default != inspect._empty else None,
                    "required": v.default == inspect._empty,
                }
                for k, v in sig.parameters.items()
                if k != "self"
            }
            doc = (obj.__doc__ or "").strip()
            out[name] = {"category": cat, "params": params, "doc": doc[:500]}
    return out


REGISTRY = discover_algos()


def build_algo(class_name: str, params: dict):
    cls = getattr(algos_mod, class_name, None)
    if cls is None:
        raise ValueError(f"Unknown algo {class_name}")
    return cls(**(params or {}))


def algo_json_schema(class_name: str):
    # JSON Schema minimal for FE auto-form: {type:"object", properties:{...}, required:[...]}
    info = REGISTRY.get(class_name)
    if not info:
        raise KeyError(class_name)
    props = {}
    req = []
    for k, v in info["params"].items():
        props[k] = {"type": "string", "default": v["default"]}  # FE coerces; keep simple for v1
        if v["required"]:
            req.append(k)
    return {"title": class_name, "type": "object", "properties": props, "required": req}
```

Estendi `backend/api/routes.py`:
```python
from backend.services.algo_registry import REGISTRY, algo_json_schema, build_algo
@router.get("/algos") -> restituisce list di {name, category, doc}
@router.get("/algos/{name}/schema") -> algo_json_schema(name)
```

Test `tests/backend/test_algo_registry.py`: verifica che `REGISTRY` contenga `RunMonthly`, `WeighEqually`, `Rebalance`, `SelectAll`, che `algo_json_schema("WeighEqually")` abbia `properties`, che `build_algo("WeighEqually", {})` non sollevi.

**Verify**: `uv run pytest tests/backend/test_algo_registry.py -v` → pass. `curl -s http://127.0.0.1:8001/api/bt/algos | python -c "import json,sys; d=json.load(sys.stdin); assert any(x['name']=='Rebalance' for x in d)"` (con BE up).

### Step 5: CRUD Strategies + OpenAPI types generation

Estendi `backend/api/routes.py` con:
```python
from backend.models.strategy_tree import StrategyTree
from backend.database import get_db, Strategy as DBStrategy
from backend.services.tree_serializer import to_bt_strategy


@router.post("/strategies", status_code=201)
def create_strategy(tree: StrategyTree, db=Depends(get_db)): ...


@router.get("/strategies")
def list_strategies(db=Depends(get_db)): ...


@router.get("/strategies/{sid}")
def get_strategy(sid: int, db=Depends(get_db)): ...


@router.put("/strategies/{sid}")
def update_strategy(sid: int, tree: StrategyTree, db=Depends(get_db)): ...


@router.delete("/strategies/{sid}", status_code=204)
def delete_strategy(sid: int, db=Depends(get_db)): ...
```

Validazione: `to_bt_strategy(tree)` chiamata in `POST`/`PUT` per fail-fast se tree non costruibile (422).

Dopo, rigenera tipi FE:
```bash
uv run uvicorn backend.main:app --port 8001 &
sleep 2
npx --prefix frontend openapi-typescript http://localhost:8001/openapi.json -o src/types/bt.ts
# verifica che src/types/bt.ts contenga StrategyTree, AlgoConfig
```

Test `tests/backend/test_persistence.py`: CRUD via `TestClient` (create → get → list → update → delete), verifica `tree_json` persistito.

**Verify**: `uv run pytest -q` → all pass (health + serializer + registry + persistence). `uv run ruff check .` → 0. `grep -q "StrategyTree" ../bt-gui/frontend/src/types/bt.ts && echo ok` → `ok`.

## Test plan

- `tests/backend/test_serializer.py` — nested tree, 5 node types, invalid type error, commission fn passthrough.
- `tests/backend/test_algo_registry.py` — discover count >= 30, categories non-empty, build unknown algo raises ValueError.
- `tests/backend/test_persistence.py` — CRUD strategies via TestClient, duplicate name 409/422, tree validation fails 422.
- Pattern: `TestClient(app)` come `Stocks_App/backend/test/` + `test_health.py` già in plan 001.
- Edge: `simple_fn` malformata → 422 (validatore Pydantic), `StrategyTree` con cycle → recursion limit (test expects 422).

## Done criteria

- [ ] `uv run pytest -q` → ≥4 tests pass (health + 3 nuovi file)
- [ ] `uv run ruff check .` → exit 0
- [ ] `curl -s http://127.0.0.1:8001/openapi.json | python -c "import json,sys; d=json.load(sys.stdin); assert '/api/bt/strategies' in str(d['paths'])"` → exit 0
- [ ] `grep -q "StrategyTree" ../bt-gui/frontend/src/types/bt.ts` → exit 0
- [ ] `uv run python -c "from backend.services.tree_serializer import to_bt_strategy; from backend.models.strategy_tree import StrategyTree; t=StrategyTree(name='t', root={'name':'root','type':'Strategy','children':[{'name':'AAPL','type':'Security'}]}); s=to_bt_strategy(t); assert s.name=='root'"` → exit 0
- [ ] `git -C ../bt-gui status --porcelain` shows only expected files; `git -C ../bt status --porcelain | grep -v "^?? plans/"` → empty (bt untouched)

## STOP conditions

- `bt.Strategy` / `bt.Security` signatures differ from assumed (`children` kwarg, `AlgoStack` location) — leggi `bt/core/strategy.py:__init__` e `bt/core/node.py` live prima di scrivere serializer; se mismatch, STOP e reporta firma reale.
- `bt.algos` contains non-Algo classes that break `issubclass` (report which name).
- `simple_fn` validator cannot `eval` due to restricted `__builtins__` — report eval error, fallback to `ast.literal_eval` check.
- `npx openapi-typescript` not available (report `npm ls openapi-typescript`, fallback to manual `types/bt.ts` stub).
- SQLite `JSON` column not supported on target sqlite version (report `sqlite3 --version`).

## Maintenance notes

- `tree_serializer` is the only place that knows `TYPE_MAP` — if `bt` adds new Security types, update there and add test.
- `algo_registry.REGISTRY` is built at import — if `bt/algos.py` adds new algo, it appears automatically; no FE change except category bucket.
- `frontend/src/types/bt.ts` must be regenerated after ogni modifica a Pydantic models — add `npm run gen:types` script in `frontend/package.json` (`openapi-typescript http://localhost:8001/openapi.json -o src/types/bt.ts`).
- Commission `simple_fn` validation mirrors `bt/backtest.py:204-213` — keep them in sync; if `bt` changes signature check, update `backtest_config.py:field_validator`.
- DB `bt_gui.db` is gitignored — tests use in-memory sqlite via dependency override (`get_db` override in TestClient).

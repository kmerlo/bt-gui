# Plan 004: Data Manager + Backtest Runner (WS) + Results Dashboard

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 8fd6270..HEAD -- plans/` + `ls ../bt-gui/backend/services/tree_serializer.py ../bt-gui/frontend/src/bt/components/BuilderView.tsx` — plans 002–003 must be DONE (serializer + tree editor). If `../bt-gui/frontend/src/bt/store/btStore.ts` missing, STOP.

## Status

- **Priority**: P0
- **Effort**: L
- **Risk**: MED
- **Depends on**: plans/003-tree-editor-algo-stack.md
- **Category**: tech-debt / correctness
- **Planned at**: commit `8fd6270`, 2026-08-23
- **Issue**: —

## Why this matters

Senza dati e runner, il builder di plan 003 è un mock. Questo piano chiude il loop: carica dati (CSV/Parquet/ffn), lancia `bt.Backtest` con `StrategyTree` costruito, streamma progress via WebSocket, persiste `BacktestRun` e mostra equity/weights/drawdown/transactions. È il "run" che giustifica la GUI — senza, l'utente non vede se la strategia funziona.

## Current state

- BE: `StrategyTree` Pydantic, `tree_serializer.to_bt_strategy`, `algo_registry`, CRUD `strategies`, `GET /algos`. DB `bt_gui.db` con tabelle `strategies/data_sources/backtest_runs`. Nessun `data_loader`, nessun `backtest_runner`, nessuna route `POST /backtest` / WS.
- FE: `BuilderView` con tree+algo editabili, `btStore`, `api/bt.ts` con `strategiesApi`/`algosApi`, proxy `:8001`, `types/bt.ts` da OpenAPI. Nessun Data Manager, Run Dialog, Results Dashboard.
- `bt/backtest.py` API da riusare:
  - `Backtest(strategy, data, name, initial_capital, commissions, integer_positions, additional_data, volume, volatility)` — `data` è `DataFrame` con index `DateTime` e colonne = security names (`data.columns` deve matchare `strategy.members` names).
  - `Backtest.run()` → `strategy.prices`, `strategy.values`, `strategy.weights`, `get_transactions()`, `Result(*backtests).stats`.
  - `data` viene preprocessato in `_process_data` aggiungendo riga `t0-1` NaN — il FE non deve preoccuparsi, ma il BE deve validare che `data.index` sia `DateTimeIndex` e `columns` matchino security names.
  - `CostModel` (`bt.core.SqrtCostModel`, `AlmgrenChrissCostModel`) richiede `volume`/`volatility` DataFrame allineati — se `BacktestConfig.commission.type == "bidoffer"` si usa `bidoffer` DataFrame in `additional_data`.
- `Stocks_App` patterns per risultati:
  - `StrategyBacktestView.tsx:371-876` — `buildEquityCurve`, `buildBuyHoldCurve`, `buildDrawdownCurve`, `buildOverlayPlots`, `buildTradeMarkers`, `lightweight-charts` pipeline con `sanitizeLine`/`sanitizeCandles`, `ResizeObserver`.
  - `api.ts:446-450` — `rrgApi.optimize` con `fetch(...).then(r => r.body?.getReader())` per streaming NDJSON — pattern riusabile per WS fallback.
  - `api.ts:29-31` — `WS_BASE` già definito in `bt-gui/frontend/src/api/bt.ts` (plan 001).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Backend | `uv run pytest -q` | all pass |
| Backend lint | `uv run ruff check .` | exit 0 |
| Backend run | `uv run uvicorn backend.main:app --port 8001 --reload` | `Uvicorn running` |
| Frontend build | `npm run build` (in `frontend`) | exit 0 |
| Manual data | `curl -F file=@tests/fixtures/prices.csv http://127.0.0.1:8001/api/bt/data-sources/upload` | 201 + `{"name":…}` |
| Manual backtest | `curl -X POST http://127.0.0.1:8001/api/bt/backtest -H 'Content-Type: application/json' -d @tests/fixtures/run.json` | 201 + `{"id":…}` |
| WS test | `uv run python tests/ws_smoke.py` (o `websocat ws://127.0.0.1:8001/api/bt/backtest/1/progress`) | receives `{"progress":…}` then `{"done":true}` |

## Scope

**In scope** (in `../bt-gui`):
- `backend/services/data_loader.py`, `backend/services/backtest_runner.py`
- `backend/models/backtest_config.py` (extend commission validation), `backend/models/data_source.py` (already, extend with upload handling)
- `backend/api/routes.py` (add `POST /data-sources/*`, `POST /backtest`, `WS /backtest/{id}/progress`, `GET /runs`, `GET /runs/{id}`)
- `frontend/src/bt/components/DataManager.tsx`, `frontend/src/bt/components/RunDialog.tsx`, `frontend/src/bt/components/ResultsDashboard.tsx`
- `frontend/src/api/bt.ts` (extend `dataApi`, `backtestApi`), `frontend/src/bt/store/btStore.ts` (add `runs`, `selectedRunId`)
- `tests/backend/test_data_loader.py`, `tests/backend/test_backtest_runner.py`, `tests/fixtures/prices.csv`

**Out of scope** (do NOT touch):
- `bt/` — no edits. Use `bt.Backtest`/`bt.Result` as-is.
- `Stocks_App/` — no edits (plan 005).
- Tree editor / algo stack — already done (plan 003), only integrate Run button.
- NiceGUI — archived.

## Git workflow

- Branch in `bt-gui`: `feat/004-data-runner-results` (from `feat/003-…`).
- Commits: `feat(data): data_loader + upload/ffn`, `feat(runner): async backtest + WS progress`, `feat(results): dashboard lightweight-charts`, `feat(api): wire routes`. Message style `feat:`/`fix:`.
- Do NOT push unless operator says.

## Steps

### Step 1: `data_loader.py` + DataSource routes

`backend/services/data_loader.py`:

```python
import io, pandas as pd, ffn
from fastapi import UploadFile


def load_csv(file: UploadFile) -> pd.DataFrame:
    # expects CSV with Date index col + one col per security (header = security names)
    # Try parse: first col as Date, rest as float
    content = file.file.read()
    df = pd.read_csv(io.BytesIO(content), index_col=0, parse_dates=True)
    df.index = pd.to_datetime(df.index)
    return df.sort_index()


def load_parquet(file: UploadFile) -> pd.DataFrame:
    content = file.file.read()
    return pd.read_parquet(io.BytesIO(content))


def fetch_ffn(tickers: list[str], start: str, end: str) -> pd.DataFrame:
    # ffn.get(tickers, start, end) → DataFrame
    import ffn

    df = ffn.get(",".join(tickers), start=start, end=end)
    # ffn may return Series for single ticker — normalize to DataFrame
    if isinstance(df, pd.Series):
        df = df.to_frame(tickers[0])
    return df


def validate_data(df: pd.DataFrame, expected_columns: list[str] | None = None) -> None:
    if df.empty:
        raise ValueError("empty DataFrame")
    if not isinstance(df.index, pd.DatetimeIndex):
        raise ValueError("index must be DateTimeIndex")
    if df.isna().all().all():
        raise ValueError("all NaN")
    if expected_columns and set(df.columns) != set(expected_columns):
        # soft warning — caller decides 422 vs allow
        pass
```

`backend/api/routes.py` — aggiungi:

```python
from fastapi import UploadFile, File, Depends
from backend.services.data_loader import load_csv, load_parquet, fetch_ffn
from backend.database import get_db, DataSource as DBSource


@router.post("/data-sources/upload", status_code=201)
def upload_data_source(name: str, type: str, file: UploadFile = File(...), db=Depends(get_db)):
    # type in {"price","volume","volatility","bidoffer",...}
    if file.filename.endswith(".csv"):
        df = load_csv(file)
    elif file.filename.endswith(".parquet"):
        df = load_parquet(file)
    else:
        raise HTTPException(400, "only .csv/.parquet")
    # persist: parquet bytes + meta
    buf = io.BytesIO()
    df.to_parquet(buf)
    blob = buf.getvalue()
    meta = {"shape": list(df.shape), "columns": list(df.columns), "start": str(df.index[0]), "end": str(df.index[-1])}
    row = DBSource(name=name, type=type, source="csv" if file.filename.endswith(".csv") else "parquet", path_or_tickers=file.filename, meta_json=meta, parquet_blob=blob)
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"id": row.id, "name": row.name, "meta": meta}


@router.post("/data-sources/fetch", status_code=201)
def fetch_data_source(name: str, type: str, tickers: list[str], start: str, end: str, db=Depends(get_db)):
    df = fetch_ffn(tickers, start, end)
    buf = io.BytesIO()
    df.to_parquet(buf)
    blob = buf.getvalue()
    meta = {"shape": list(df.shape), "columns": list(df.columns), "start": str(df.index[0]), "end": str(df.index[-1])}
    row = DBSource(name=name, type=type, source="ffn", path_or_tickers=",".join(tickers), meta_json=meta, parquet_blob=blob)
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"id": row.id, "name": row.name, "meta": meta}


@router.get("/data-sources")
def list_data_sources(db=Depends(get_db)): ...


@router.get("/data-sources/{sid}")
def get_data_source(sid: int, db=Depends(get_db)): ...


@router.get("/data-sources/{sid}/preview")
def preview_data_source(sid: int, limit: int = 5, db=Depends(get_db)):
    # return first/last `limit` rows as JSON (df.head(limit).to_dict)
    ...
```

Crea `tests/fixtures/prices.csv` (10 giorni, 2 colonne `AAPL,MSFT`) per test.

`tests/backend/test_data_loader.py`: `load_csv` con fixture, `validate_data` empty/NaN cases, `POST /data-sources/upload` via `TestClient` con `files={"file": ("prices.csv", csv_bytes, "text/csv")}`.

**Verify**: `uv run pytest tests/backend/test_data_loader.py -v` → pass. `curl -F file=@tests/fixtures/prices.csv "http://127.0.0.1:8001/api/bt/data-sources/upload?name=test&type=price"` (BE up) → 201.

### Step 2: `backtest_runner.py` + `POST /backtest` + WS progress

`backend/services/backtest_runner.py`:

```python
import asyncio, io, json, pandas as pd
from concurrent.futures import ThreadPoolExecutor
from sqlalchemy.orm import Session
from backend.models.strategy_tree import StrategyTree
from backend.models.backtest_config import BacktestConfig
from backend.services.tree_serializer import to_bt_strategy
from backend.database import BacktestRun as DBRun, DataSource as DBSource

executor = ThreadPoolExecutor(max_workers=2)
_progress: dict[int, dict] = {}  # run_id -> {progress: float, done: bool, error: str|None}

def _load_dataframes(db: Session, price_source_id: int, extra_ids: dict | None = None) -> tuple[pd.DataFrame, dict]:
    # price_source_id → DataFrame price; extra_ids: {volume: id, volatility: id, bidoffer: id, ...} → additional_data
    ...

def _build_commission(cfg: BacktestConfig):
    if cfg.commission.simple_fn:
        fn = eval(cfg.commission.simple_fn, {"__builtins__": {}})
        # already validated in Pydantic, but double-check callable
        return fn
    return None

def run_backtest_sync(run_id: int, tree: StrategyTree, cfg: BacktestConfig, price_df: pd.DataFrame, additional: dict, volume: pd.DataFrame | None, volatility: pd.DataFrame | None):
    # called in threadpool
    import bt
    strategy = to_bt_strategy(tree)
    commissions = _build_commission(cfg)
    # CostModel path if bidoffer/volume/volatility provided
    bt_obj = bt.Backtest(strategy, price_df, name=tree.name, initial_capital=cfg.initial_capital, commissions=commissions, integer_positions=cfg.integer_positions, additional_data=additional, volume=volume, volatility=volatility)
    # simple progress: update _progress[run_id] via strategy update hook or just 0→50→100
    _progress[run_id] = {"progress": 0.1, "done": False}
    bt_obj.run()
    _progress[run_id] = {"progress": 1.0, "done": True}
    # collect results: prices, weights, transactions, stats
    # prices: bt_obj.strategy.prices (Series), weights: bt_obj.weights, transactions: bt_obj.strategy.get_transactions()
    # Serialize to parquet bytes + stats_json
    return bt_obj

async def run_backtest_background(run_id: int, ...):
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(executor, run_backtest_sync, run_id, ...)
    # on done, persist to DB (update DBRun with stats_json, parquet blobs)
```

Semplifica v1: progress WS manda `0.1 → 1.0` (non per-bar, troppo chatty). In v2 si può hookare `strategy.update` per progress granulare.

`backend/api/routes.py` — aggiungi:

```python
from pydantic import BaseModel
from backend.models.backtest_config import BacktestConfig
from backend.models.strategy_tree import StrategyTree
from fastapi import WebSocket, WebSocketDisconnect, BackgroundTasks

class RunRequest(BaseModel):
    strategy_id: int | None = None  # if provided, load tree from DB
    tree: StrategyTree | None = None  # or inline
    config: BacktestConfig = BacktestConfig()
    price_source_id: int
    extra_source_ids: dict[str, int] = {}  # {"volume": 2, "volatility": 3}

@router.post("/backtest", status_code=201)
def create_backtest(req: RunRequest, background_tasks: BackgroundTasks, db=Depends(get_db)):
    # validate: tree or strategy_id required
    # create DBRun with status running, get id, schedule run_backtest_background
    # return {"id": run_id, "status": "running"}

@router.get("/runs")
def list_runs(db=Depends(get_db)): ...

@router.get("/runs/{run_id}")
def get_run(run_id: int, db=Depends(get_db)):
    # return stats_json + parquet as base64 or separate endpoints
    ...

@router.get("/runs/{run_id}/prices")
def get_run_prices(run_id: int, db=Depends(get_db)):
    # return prices_parquet decoded as JSON {dates:[], values:[]}
    ...

@router.websocket("/backtest/{run_id}/progress")
async def ws_progress(websocket: WebSocket, run_id: int):
    await websocket.accept()
    try:
        while True:
            prog = _progress.get(run_id, {"progress": 0, "done": False})
            await websocket.send_json(prog)
            if prog["done"] or prog.get("error"): break
            await asyncio.sleep(0.2)
    except WebSocketDisconnect: pass
```

Validazione commission: riusa `BacktestConfig` validator + `bt/backtest.py:204-213` check (non duplicare eval libero — usa lo stesso `CommissionConfig`).

Test `tests/backend/test_backtest_runner.py`: crea DataSource `price` con fixture CSV (AAPL/MSFT, 30 giorni), crea `StrategyTree` con `RunMonthly+WeighEqually+Rebalance`, POST `/backtest` con `price_source_id`, poll `GET /runs/{id}` fino a `done` o WS smoke, verifica `stats_json` contiene `cagr`/`max_drawdown`.

**Verify**: `uv run pytest tests/backend/test_backtest_runner.py -v` → pass (may take ~5s per backtest). `uv run ruff check .` → 0.

### Step 3: Frontend — DataManager + RunDialog

`frontend/src/api/bt.ts` — estendi:

```ts
export const dataApi = {
  list: () => request<{ id:number; name:string; type:string; source:string; meta:Record<string,unknown> }[]>('/api/bt/data-sources'),
  upload: (name: string, type: string, file: File) => {
    const fd = new FormData(); fd.append('file', file)
    return fetch(`${API_BASE}/api/bt/data-sources/upload?name=${encodeURIComponent(name)}&type=${type}`, { method: 'POST', body: fd }).then(async r => { if (!r.ok) throw new Error(await r.text()); return r.json() })
  },
  fetchFfn: (name: string, type: string, tickers: string[], start: string, end: string) =>
    request('/api/bt/data-sources/fetch', { method: 'POST', body: JSON.stringify({ name, type, tickers, start, end }) }),
  preview: (id: number) => request<{ columns:string[]; rows: Record<string,unknown>[] }>(`/api/bt/data-sources/${id}/preview`),
}

export const backtestApi = {
  create: (req: unknown) => request<{ id:number; status:string }>('/api/bt/backtest', { method: 'POST', body: JSON.stringify(req) }),
  listRuns: () => request<{ id:number; strategy_id:number; stats:Record<string,unknown>; created_at:string }[]>('/api/bt/runs'),
  getRun: (id: number) => request<unknown>(`/api/bt/runs/${id}`),
  getPrices: (id: number) => request<{ dates:string[]; values:number[] }>(`/api/bt/runs/${id}/prices`),
  wsProgress: (id: number) => new WebSocket(`${WS_BASE}/api/bt/backtest/${id}/progress`),
}
```

`frontend/src/bt/components/DataManager.tsx`:

* Tabella `dataApi.list()` con colonne `name/type/source/meta.shape` + preview button (chiama `preview(id)` → mostra 5 righe in `table`).
* Upload: input `name`, `type` select (`price/volume/volatility/bidoffer/coupons`), file `input type=file` + `Upload` button → `dataApi.upload`.
* FFN fetch: inputs `name`, `tickers` (textarea `AAPL,MSFT`), `start`/`end` date + `Fetch` → `dataApi.fetchFfn`.
* Mostra `meta` shape/date_range.

`frontend/src/bt/components/RunDialog.tsx`:

* Props: `tree: StrategyTree | null`, `onRunCreated: (id:number)=>void`.
* Form `BacktestConfig`: `initial_capital` number, `integer_positions` checkbox, `commission.simple_fn` Monaco editor (`@monaco-editor/react` già in deps, vedi `Stocks_App` usage in `PineCodeEditor.tsx`).
* Select `price_source_id` da `dataApi.list()` (filtra `type=="price"`).
* Extra sources opzionali: `volume`/`volatility`/`bidoffer` selects (se `commission.type=="bidoffer"` mostra warning se manca).
* `Run` button → `backtestApi.create({tree|strategy_id, config, price_source_id, extra_source_ids})` → `onRunCreated(id)` + WS `backtestApi.wsProgress(id)` con progress bar (`progress` 0-1 → width%).
* Validazione `simple_fn` live: se `eval` fallisce, mostra errore rosso (stesso check Pydantic, ma FE feedback immediato).

**Verify**: `npm run build` → exit 0. Manuale: upload `prices.csv` → appare in tabella, preview ok; configura run con tree da BuilderView → Run → progress bar avanza.

### Step 4: ResultsDashboard — equity/weights/drawdown/transactions

`frontend/src/bt/components/ResultsDashboard.tsx`:

Riutilizza pipeline `Stocks_App/frontend/src/components/StrategyBacktestView.tsx:172-624`:

* Helpers: `toUtcSeconds`, `sanitizeCandles`, `sanitizeLine`, `buildEquityCurve` non necessari — il BE già fornisce `prices`/`weights`/`drawdown` pronti. FE ricostruisce solo punti `lightweight-charts` da `GET /runs/{id}/prices` + `weights`.
* 3 chart `lightweight-charts` 5:
  - Price + equity overlay (come `StrategyBacktestView.tsx:520-553`).
  - Equity curve (`LineSeries` strategy vs buy&hold se disponibile).
  - Drawdown `AreaSeries` (`StrategyBacktestView.tsx:572-588`).
* Tabelle: metrics da `stats_json` (`bt/backtest.py:368` `calc_perf_stats()`), transactions da `GET /runs/{id}` (se BE espone `transactions_parquet` decoded).
* Compare: se `runs` multiple selezionate, overlay equity curves (come `StrategyBacktestView.tsx` multi-run logic).

Pattern `ResizeObserver` per responsive (`StrategyBacktestView.tsx:590-599`).

Integra in `App.tsx` / `BuilderView`:

```tsx
// App.tsx
const [runId, setRunId] = useState<number | null>(null)
{view === 'builder' && <BuilderView onRunCreated={id => { setRunId(id); setView('results')}} />}
{view === 'results' && <ResultsDashboard runId={runId} />}
{view === 'data' && <DataManager />}
```

**Verify**: `npm run build` → exit 0. Manuale E2E: run con `AAPL/MSFT` 30 giorni → `ResultsDashboard` mostra 3 chart + metrics table + transactions.

## Test plan

- `tests/backend/test_data_loader.py` — CSV/parquet load, ffn fetch mock (monkeypatch `ffn.get`), preview endpoint.
- `tests/backend/test_backtest_runner.py` — full run con 2 security, verifica `BacktestRun.stats_json` non vuoto, WS progress smoke (`TestClient.websocket_connect` se disponibile, altrimenti poll `GET /runs/{id}`).
- FE: `npm run build` + manuale upload→run→results (3 chart render).
- **Verify**: `uv run pytest -q` → all pass (≥6 tests total), `npm run build` → exit 0.

## Done criteria

- [ ] `uv run pytest -q` → all pass
- [ ] `uv run ruff check .` → exit 0
- [ ] `curl -F file=@tests/fixtures/prices.csv "http://127.0.0.1:8001/api/bt/data-sources/upload?name=e2e&type=price"` → 201 (BE up)
- [ ] `POST /api/bt/backtest` con `price_source_id` e `tree` inline → 201 + `GET /api/bt/runs/{id}` → `stats_json` contiene `cagr`/`max_dd` (poll fino a done)
- [ ] WS `ws://127.0.0.1:8001/api/bt/backtest/{id}/progress` → riceve `{"progress":1.0,"done":true}` (o poll fallback)
- [ ] FE: upload CSV → DataManager tabella aggiornata (manuale)
- [ ] FE: Run con `simple_fn` valida → progress bar → ResultsDashboard 3 chart + metrics (manuale)
- [ ] `npm run build` → exit 0, `dist/` exists
- [ ] `git -C ../bt-gui log --oneline -1 | grep -q "004\|data\|runner\|results"` → exit 0

## STOP conditions

- `ffn.get` signature differisce (`start`/`end` kwargs) — report `ffn.get` help, adatta `fetch_ffn`.
- `bt.Backtest` richiede `data.columns` == security names — se tree ha `Security` "AAPL" ma CSV ha colonna "aapl", case-sensitive mismatch → report, normalizza con `df.columns = [c.upper() for c in df.columns]` o valida 422.
- `parquet_blob` troppo grande per SQLite `LargeBinary` (limite ~1MB per default) — report size, fallback a file su disco `data/*.parquet` + path in DB.
- `WebSocket` non supportato da `uvicorn[standard]` senza `websockets` extra — report `uv run uvicorn --help`, install `websockets>=12`.
- `lightweight-charts` 5 `CandlestickSeries` factory maiuscola — se `npm run build` fallisce con `candlestickSeries not found`, fix import come `StrategyBacktestView.tsx:3` (`CandlestickSeries` maiuscolo).

## Maintenance notes

- `data_loader.fetch_ffn` dipende da network — test mock `ffn.get` per non fare chiamate reali in CI (come `Stocks_App` fa con `finance_logic` mock).
- `backtest_runner` `ThreadPoolExecutor(max_workers=2)` è v1 — se si vuole cancel, aggiungere `run_id → Future` map + `future.cancel()` su `DELETE /runs/{id}`.
- `ResultsDashboard` helpers `sanitizeLine`/`sanitizeCandles` — copia da `StrategyBacktestView.tsx:492-496` verbatim, mantieni allineamento se Stocks_App li modifica (aggiorna `docs/` se cambia).
- `commission.simple_fn` eval è ristretto a `{"__builtins__": {}}` + validazione 2 params — non eseguire mai stringa non validata; se si aggiunge `CostModel` (Sqrt/AlmgrenChriss), aggiungi `volume`/`volatility` DataSource handling in `data_loader`.
- `bt_gui.db` parquet blobs — per run storici, considera `GET /runs/{id}/export?format=csv` per scaricare senza caricare blob in JSON.

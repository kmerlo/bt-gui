# Documentazione Tecnica — bt-gui

## Architettura dati

### DataSource (tabella `data_sources`)

I dati indicatori pre-calcolati e upload CSV/Parquet sono in `data_sources`.

| Colonna | Tipo | Descrizione |
|---------|------|-------------|
| `id` | INTEGER | PK |
| `name` | VARCHAR | Nome univoco |
| `type` | VARCHAR | `price`, `volume`, `volatility`, `indicator` |
| `source` | VARCHAR | `ffn`, `csv`, `parquet`, `computed` |
| `path_or_tickers` | VARCHAR | Lista ticker o filename |
| `meta_json` | JSON | Metadati |
| `parquet_blob` | BLOB | DataFrame parquet |

Dati indicatori (`data_sources` con `type='indicator'`) sono solo per segnali pre-calcolati. I prezzi canonici NON sono più in `data_sources.parquet_blob` ma in `price_data`.

### PriceData (tabella `price_data`) — canonical price store

`price_data` è il sole price store dal 2026-08. `fetch_and_store_yf` via `yfinance` scrive qui; `data_sources` resta per indicatori.

| Colonna | Tipo | Descrizione |
|---------|------|-------------|
| `id` | INTEGER | PK |
| `symbol` | VARCHAR | Ticker upper (index) |
| `interval` | VARCHAR | `1d` default |
| `date` | DATETIME | Giorno (UTC naive) |
| `open` | FLOAT | Open |
| `high` | FLOAT | High |
| `low` | FLOAT | Low |
| `close` | FLOAT | Close |
| `adj_close` | FLOAT | Adj Close |
| `volume` | INTEGER | Volume |

Origine: `backend/services/data_loader.py:78` `fetch_and_store_yf(db, symbol, start, end)` via `yfinance.download`, flatten `MultiIndex` columns, upsert per `(symbol, interval, date)`. Lettura pivot in `backend/services/backtest_runner.py:40` `_load_prices_from_db(tickers)`.

`price_data` è interrogata da `backend/api/price_data.py:24` `list_price_data` (group-by symbol) e `backend/api/price_data.py:54` `get_price_rows` con `start/end/sort_by/sort_dir/search/limit/offset`. Pagination server-side (limit/offset) introdotta in plan 007.

> Dual path legacy: `backend/api/backtest.py:67` mantiene fallback `price_source_id` (blob) se `tickers` vuoto, ma canon è `tickers` → `price_data`.

### Formati di archiviazione

- **Nessun file esterno** per dati: tutto in SQLite `bt_gui.db` (+ `bt_gui_test.db` per test).
- DataFrame pandas serializzati come parquet bytes (`df.to_parquet()`) in `parquet_blob`.
- Deserializzazione con `pd.read_parquet(io.BytesIO(blob))`.

### Tabelle backtest_runs e strategies

- `backtest_runs`: `strategy_id`, `config_json`, `stats_json`, `prices_parquet`, `weights_parquet`, `transactions_parquet`.
- `strategies`: `name` unique, `tree_json` (StrategyTree JSON).

### Dual-DB isolation

Due DB file: `bt_gui.db` (main, dati utente) e `bt_gui_test.db` (test). Scelta persistita in `active_db.txt` (`main`/`test`). Proxy `backend/database.py:33` `_EngineProxy`/`_SessionProxy` indirizza `engine`/`SessionLocal` in base a `ACTIVE_DB`. Endpoint `GET/POST /api/bt/db` via `backend/api/health.py:17` permette switch da FE (`SettingsView` + top bar). `tests/conftest.py:5` imposta `test` per tutta la sessione pytest, quindi dati utente in main non vengono toccati.

### File map backend

`backend/api/routes.py:14` è il barrel `APIRouter(prefix="/api/bt")`. Domini scomposti (plan 002):

- `backend/api/strategies.py` — CRUD strategie
- `backend/api/data_sources.py` — upload/fetch ffn, preview/table
- `backend/api/price_data.py` — `price_data` canon, fetch yfinance, rows paginate
- `backend/api/indicators.py` — compute indicator
- `backend/api/backtest.py` — `POST /backtest` con batch `IN` fetches
- `backend/api/runs.py` — list/get/delete runs, WS progress
- `backend/api/health.py` — `/health`, `/db`, stats
- `backend/api/algos.py` — registry
- `backend/api/_query.py` — helper `apply_search`/`apply_sort` condivisi (plan 008)
- `backend/api/_helpers.py` — `_blob_to_df`/`_df_to_blob`

Services: `tree_serializer.py`, `algo_registry.py`, `data_loader.py` (yfinance primary), `backtest_runner.py` (threadpool + WS + commission_parser), `persistence.py`, `commission_parser.py` (whitelist AST).

### Tooling — rigenerazione tipi

I tipi FE (`frontend/src/types/bt.ts`) sono auto-generati da OpenAPI. In CI verificare il drift con:

```bash
npm run gen:types --prefix frontend && git diff --exit-code frontend/src/types/bt.ts
```

Frontend API barrel: `frontend/src/api/bt.ts` re-exporta domini `strategies/algos/data/price/runs/settings/request.ts` + `utils/format.ts` e `utils/listQuery.ts`.

### PriceData vs DataSource — riepilogo canon

- `price_data` = prezzi yfinance (OHLCV) — unica fonte per backtest (`_load_prices_from_db`).
- `data_sources` = indicatori (`type=indicator`), upload CSV/Parquet, ffn legacy. Non duplicare prezzi qui.
- Migrazione `.opencode/plans/007-unified-ticker-data.md` (ADR) promossa in `plans/README.md` note.

### Verifica

- `grep -c "price_data" my-docs/GUIDE_documentazione_tecnica.md` ≥3
- `wc -l my-docs/GUIDE_documentazione_tecnica.md` ≥100
- `grep -q "yfinance" plans/SPEC.md` deve passare

---

*Ultimo aggiornamento: 2026-08-30*

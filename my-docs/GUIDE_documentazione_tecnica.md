# Documentazione Tecnica — bt-gui

## Architettura dati

### DataSource (tabella `data_sources`)

I dati indicatori pre-calcolati e upload CSV/Parquet sono in `data_sources`.

| Colonna | Tipo | Descrizione |
|---------|------|-------------|
| `id` | INTEGER | PK |
| `name` | VARCHAR | Nome univoco |
| `type` | VARCHAR | `price`, `volume`, `volatility`, `indicator`, `signal` |
| `source` | VARCHAR | `ffn`, `csv`, `parquet`, `computed`, `computed_weight` |
| `path_or_tickers` | VARCHAR | Lista ticker o filename |
| `meta_json` | JSON | Metadati |
| `parquet_blob` | BLOB | DataFrame parquet |

Dati indicatori (`data_sources` con `type='indicator'` o `type='signal'`) sono per indicatori/signals pre-calcolati (`source=computed` o `computed_weight` per weight signals). I prezzi canonici NON sono più in `data_sources.parquet_blob` ma in `price_data`.

### PriceData (tabella `price_data`) — canonical price store

`price_data` è il sole price store dal 2026-08. `fetch_and_store_yf` via `yfinance` scrive qui; `data_sources` resta per indicatori/signals.

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

Origine: `backend/services/data_loader.py:78` `fetch_and_store_yf(db, symbol, start, end)` via `yfinance.download`, flatten `MultiIndex` columns, upsert per `(symbol, interval, date)`. Lettura pivot in `backend/services/backtest_runner.py:38` `_load_prices_from_db(tickers)` (source-aware, vedi sotto).

`price_data` è interrogata da `backend/api/price_data.py:24` `list_price_data` (group-by symbol) e `backend/api/price_data.py:54` `get_price_rows` con `start/end/sort_by/sort_dir/search/limit/offset`. Pagination server-side (limit/offset) introdotta in plan 007.

> Dual path legacy: `backend/api/backtest.py:67` mantiene fallback `price_source_id` (blob) se `tickers` vuoto, ma canon è `tickers` → `price_data`.

### Sorgente prezzi selezionabile — locale vs market (dal 2026-08-31, piano 025)

L'utente sceglie da Settings dove leggere i prezzi OHLCV:

| Sorgente | DB file | Scrittura | Lettura |
|----------|---------|-----------|---------|
| `local` (default) | `bt_gui.db` (`price_data`) | `fetch_and_store_yf` OK | ORM via `SessionLocal` |
| `market` | `../Stocks_App/backend/market.db` (`price_data`) | **bloccata 403** | SQL raw `engine_market` read-only |

- Persistenza: `backend/database.py:14` `PRICE_SOURCE_FILE` (`price_source.txt`) + `get_price_source()`/`set_price_source()` con `_PRICE_SOURCE_LOCK`. Stato in-memory + file, non in DB.
- Endpoint: `backend/api/price_source_settings.py:15` `GET /api/bt/settings/price-source` e `POST /api/bt/settings/price-source` (`{source:"local"|"market"}`).
- FE: `frontend/src/api/settings.ts:53` `priceSourceApi.get/set`, persisto anche in `localStorage` (`bt-settings:v1` `price_source`). Switch in `SettingsView` (card Sorgente dati) + `GET /api/bt/data/list` rispetta la setting.
- Service unificato: `backend/services/price_source.py:23` `load_price_rows()` / `list_price_tickers()` — branch su `get_price_source()`, `_load_local_rows` (ORM) vs `_load_market_rows` (SQL `SELECT ... WHERE symbol=:sym` + `GROUP BY symbol,interval`). Backtest e indicatori sono source-aware: `backtest_runner.py:38` `_load_prices_from_db` → `_load_prices_from_local` / `_load_prices_from_market` (raw SQL, pivot `flat→wide`, `ffill/bfill`, validazione zero/NaN), `indicators.py` usa `price_data` della sorgente attiva per `_load_prices_from_db`.
- Health: `GET /api/bt/health` ritorna `price_source` corrente; `GET /api/bt/stats` conta per DB attivo.

### Unified Data Adapter (`/api/bt/data`) — dal 2026-08-31

Endpoint unificato che instrada in base all'adapter selezionato nelle impostazioni:
| Endpoint | Adapter | Destinazione salvataggio |
|---|---|---|
| `POST /api/bt/data/fetch` | `ffn` | `data_sources` (parquet_blob) |
| `POST /api/bt/data/fetch` | `yfinance` | `price_data` (righe OHLCV) |
| `GET /api/bt/data/list` | — | RESTITUISCE entrambe le tabelle (rispetta `price_source` attivo) |

Il frontend legge `data_adapter` da `localStorage` (chiave `bt-settings:v1`) e passa l'adapter al fetch. Il componente `DataManager` usa `dataApi.fetch(adapter, params)` e `dataApi.listUnified()`. Dal 2026-08-31 `GET /api/bt/data/list` instrada `list_price_tickers` via `price_source.py` così `market.db` mostra tutti i ticker (via `priceDataApi.list({limit:1000})`) senza duplicare fetch.

### Indicator freshness checks — dal 2026-08-31

Gli indicatori salvati in `data_sources` (parquet_blob, `type='indicator'`) contengono nel meta un campo `date_range {start, end}` calcolato dall'index del DataFrame.

**Check al compute** (`backend/api/indicators.py:40-94`):
- Se il DB `price_data` contiene righe con date successive all'`end` richiesto → il backend ricalcola automaticamente l'indicatore con tutto il range disponibile e restituisce un warning in risposta.
- L'utente vede il banner giallo nell'IndicatorPanel che spiega cosa è successo.

**Check al backtest** (`backend/api/backtest.py:110-126`):
- Per ogni indicatore usato, confronta `meta.date_range` con `config.start`/`end` della strategia.
- Se lo start dell'indicatore è successivo allo start strategia → warning (dati mancanti all'inizio).
- Se l'end dell'indicatore è precedente all'end strategia → warning con istruzione: "Ricalcola l'indicatore nella sezione Indicators".
- I warning vengono restituiti in `POST /api/bt/backtest` e mostrati in RunDialog come box arancione prima dell'avvio.

**Perché parquet blob e non tabellare:** gli indicatori hanno strutture variabili (RSI = 1 colonna, MACD = 3 colonne, Bollinger = 3 colonne). Blob parquet evita una tabella dedicata per ogni tipo di indicatore e permette lettura rapida con `pd.read_parquet(blob)`.

### Indicator system via `pandas_ta_classic` — dal 2026-08-31

Sostituiti i 5 indicatori custom (SMA/EMA/RSI/MACD/Bollinger) con discovery dinamica da `pandas_ta_classic` (193 indicatori, `talib=False` pure-pandas):

- Registry: `backend/services/indicator_calculator.py:164` `INDICATOR_DEFS` costruito iterando `ta.Category` (skip `_SKIP_NAMES` e `_INDICATORS_NEEDING_EXTRA_COLS` che richiedono colonne OHLC extra). Ogni entry: `display`, `func` (wrapper `_make_wrapper(ind_name)`), `params` (da `inspect.signature` con `KNOWN_DEFAULTS` per SMA/EMA/RSI/MACD/BBands), `output_key`.
- Wrapper multi-ticker: `_make_wrapper` rileva `_is_multi_ticker(df)` (price DF wide senza colonna `close`); per ogni ticker colonna crea `single = DataFrame({"close":s})` e delega a `single.ta.<ind>(talib=False)`; ricompone `out_parts` con colonne `TICKER` o `TICKER_col`. Single-ticker path assicura `close` con `_close_col` e filtra `kwargs` per `sig_params`.
- Compute: `compute_indicator(type_str, df, params)` mergia defaults + user params, ritorna `(DataFrame|dict, meta)` con `date_range {start,end}` da `idx.min/max`. Wrapper backward-compat `compute_sma/ema/rsi/macd/bollinger` restano per test.
- Endpoint: `backend/api/indicators.py:POST /indicators/compute` usa `price_data` della sorgente attiva (`_load_prices_from_db`), batch compute salva **un unico record** `DataSource(type=indicator, source=computed)` con tutte le colonne ticker (es. `sma50` con colonne `AAPL,MSFT`). `DELETE /indicators/{id}` aggiunto. Lista via `GET /indicators`.
- FE: `IndicatorPanel` chip multi-selezione ticker della strategia (da `collectTickers`), delete button su riga saved, auto-refresh select dopo compute via evento `bt-indicator-refresh` ascoltato da `AlgoStack` per aggiornare dropdown senza reload.

### Formati di archiviazione

- **Nessun file esterno** per dati: tutto in SQLite `bt_gui.db` (+ `bt_gui_test.db` per test).
- DataFrame pandas serializzati come parquet bytes (`df.to_parquet()`) in `parquet_blob`.
- Deserializzazione con `pd.read_parquet(io.BytesIO(blob))`.

### Tabelle backtest_runs e strategies

- `backtest_runs`: `strategy_id`, `config_json`, `stats_json`, `prices_parquet`, `weights_parquet`, `transactions_parquet`.
- `strategies`: `name` unique, `tree_json` (StrategyTree JSON).

### Backtest runs: architettura blob parquet

I risultati del backtest sono salvati in 3 colonne `LargeBinary` come parquet bytes, non in tabelle separate:

| Colonna | Contenuto | Forma tipica | Dimensione |
|---|---|---|---|
| `prices_parquet` | Equity curve (`price`) + facoltativamente colonne peso per ticker | `(N_dates, 1+N_tickers)` | ~10-50 KB/run |
| `weights_parquet` | Pesi espliciti per ticker per riga temporale (solo strategie con pesi) | `(N_dates, N_tickers)` | ~5-20 KB/run |
| `transactions_parquet` | Log operazioni da `bt_obj.strategy.get_transactions()` | `(N_tx, ~6-8)` | ~1-5 KB/run |

**Perché parquet blob e non tabellare:** i dati di backtest hanno schema variabile (diversi run usano ticker diversi, diversi pesi) e non servono query complesse tra run. Il blob permette lettura atomica con `pd.read_parquet(blob)`.

**Letture:**
- `GET /runs/{id}/prices` → `_blob_to_df(prices_parquet)` → estrae colonna `price` + weights → array flat per chart FE. Supporta ora `start`/`end`/`limit`/`offset` (dall'8/31/2026).
- `GET /runs/{id}` → `_blob_to_df(transactions_parquet).reset_index().head(100)` → lista di dict per TransactionsTable (max 100 righe).
- Stats → già serializzati in `stats_json` (CAGR, Sharpe, maxDD ecc.) in formato JSON.

> Scrittura in `backend/services/backtest_runner.py:239-274`: dopo il backtest, `prices`, `weights`, `transactions` vengono serializzati come parquet e upsertati sulla riga `BacktestRun`.

**Paginazione equity curve** (dal 2026-08-31): `GET /api/bt/runs/{id}/prices` accetta query param `start`, `end`, `limit` (default 2000, max 20000), `offset`. Il backend legge il blob, filtra per data range, paginera le righe e restituisce `{dates, values, weights, total, offset, limit}`. Il frontend passa `start`/`end` dal `run.config` per default. Dal 2026-09-01 `useRunDetail.ts` usa `limit=20000` (prima 2000 troncava SMA200 che richiede ~2700 giorni).

**Stale indicator/signal handling** (dal 2026-09-01): `POST /api/bt/backtest` non fallisce più con 422 se `preset.indicator_source_ids` contiene IDs cancellati; li ignora e aggiunge `warnings: ["Indicatori cancellati e ignorati: ..."]` (cfr. `backend/api/backtest.py:121`).

### Dual-DB isolation

Due DB file: `bt_gui.db` (main, dati utente) e `bt_gui_test.db` (test). Scelta persistita in `active_db.txt` (`main`/`test`). Proxy `backend/database.py:33` `_EngineProxy`/`_SessionProxy` indirizza `engine`/`SessionLocal` in base a `ACTIVE_DB`. Endpoint `GET/POST /api/bt/db` via `backend/api/health.py:17` permette switch da FE (`SettingsView` + top bar). `tests/conftest.py:5` imposta `test` per tutta la sessione pytest, quindi dati utente in main non vengono toccati.

### Signal condition per `SelectWhere` — dal 2026-08-31

Campo `signal_condition` aggiunto a `AlgoConfig` (`backend/models/strategy_tree.py:14`):

```python
class AlgoConfig(BaseModel):
    class_name: str
    params: dict[str, Any] = {}
    signal_condition: dict[str, Any] | None = None  # {op, value?}
```

- Backend: `backend/services/tree_serializer.py:21` `_apply_signal_condition(indicator_df, condition, price_df)` con operatori `gt/lt/gte/lte` (vs threshold), `above/below` (price vs indicator), `cross_over/cross_down` (`df > df.shift(1)`), fallback `notna()` per backward-compat. Risoluzione in `_resolve_indicator_params`: se param `kind=="indicator"` e valore è ID numerico, carica `indicators[str(id)]`; skip se già `bool` o `Algo==WeighTarget` (pesi raw, mai condizionare); altrimenti applica condition con `price_df`.
- Strategia #1 esempio: `SelectWhere(signal="1", signal_condition={"op":"above"})` → `price > SMA50`.
- FE: `AlgoStack.tsx` selettore condizione accanto al dropdown indicatore (solo per `SelectWhere`); `WeighTarget` non mostra condizione.
- Validazione backtest: `backend/api/backtest.py:65` `_collect_security_names` + check `miss` → 422 se ticker manca in `price_df`.

### Signals & Weight Signals — dal 2026-09-01

Due endpoint per segnali booleani/peso salvati come `DataSource(type=signal)`:

| Endpoint | Funzione | Output | Meta |
|----------|----------|--------|------|
| `POST /api/bt/signals/compute` | `signal_engine.evaluate_expression(expr, indicators, price_df)` | `DataFrame[bool]` multi-ticker | `expression, symbols, indicator_ids, date_range` |
| `POST /api/bt/signals/compute-weights` | `SMA crossover weight +1/-1` | `DataFrame[float]` (+1/-1/0) | `fast_indicator_id, slow_indicator_id, symbols, date_range` |

- `backend/api/signals.py:26` `compute_signal`: carica `price_df` via `_load_prices_from_local(symbols,start,end,"close")`, carica indicatori da `indicator_ids` (blob → DataFrame, normalizza `:` in colonne), valida single-column vs multi-ticker con 422, `evaluate_expression` → `bool`, salva `DataSource(type=signal, source=computed)`, o `save=false` → preview.
- `backend/api/signals.py:126` `compute_weight_signal`: carica `fast`/`slow` DataFrame, auto-name `weight-{fastCol}-{slowCol}-long_only|-long/short` (preserva `_` in nomi, `-` tra segmenti), allinea su `union` index con `ffill`, `mask = fast.values > slow.values` element-wise (fix `.values` per mismatch `sma_50` vs `sma_200`), `1/0` mode (long-only) vs `1/-1` (long/short), `0` dove `slow` NaN, rinomina colonne a `req.symbols` (upper) così `WeighTarget` alloca a security reali, valida `len(symbols)==len(cols)` → 422 altrimenti, salva `source=computed_weight`.
- `GET /api/bt/signals` lista, `DELETE /api/bt/signals/{id}`.
- FE: `SignalPanel` (ticker auto-select dalla strategia, listener `bt-indicator-refresh`, tooltip WeighTarget +1/-1/0, dropdown `Indicatore 1/2` + mode `1/0|1/-1`), `IndicatorsView`/`SignalsView` tabelle paginate, `DataDetailView` sezione Signals.
- Backtest: `backend/api/backtest.py:152` preset `signal_source_ids` caricati come `indicators[str(sid)]` (già booleani, skip `_apply_signal_condition`); `run_backtest_sync` filtra indicatori/signals a `member_names` (`_collect_security_names`) e allinea a `price_df` index con `reindex+ffill+fillna(0)` per evitare `price is 0`.

### File map backend

`backend/api/routes.py:16` è il barrel `APIRouter(prefix="/api/bt")`. Domini scomposti (plan 002 + 025):

- `backend/api/strategies.py` — CRUD strategie
- `backend/api/data_sources.py` — upload/fetch ffn, preview/table
- `backend/api/data.py` — unified `POST /data/fetch` (ffn→blob / yfinance→price_data) + `GET /data/list` source-aware
- `backend/api/price_data.py` — `price_data` canon, fetch yfinance, rows paginate (source-aware via `price_source.py`)
- `backend/api/price_source_settings.py` — `GET/POST /settings/price-source`
- `backend/api/indicators.py` — compute indicator (pandas_ta_classic, multi-ticker, freshness checks)
- `backend/api/signals.py` — `POST /signals/compute` + `POST /signals/compute-weights`, list/delete
- `backend/api/backtest.py` — `POST /backtest` con batch `IN` fetches + warnings coverage + stale ID handling (422→ warning)
- `backend/api/runs.py` — list/get/delete runs, WS progress, `GET /runs/{id}/prices` con pagination `start/end/limit/offset`
- `backend/api/health.py` — `/health`, `/db`, stats (include `price_source`)
- `backend/api/algos.py` — registry (bt.algos + custom_algos, tooltip docstring)
- `backend/api/_query.py` — helper `apply_search`/`apply_sort` condivisi (plan 008)
- `backend/api/_helpers.py` — `_blob_to_df`/`_df_to_blob`

Services: `tree_serializer.py` (signal_condition), `algo_registry.py` (bt+custom discovery), `data_loader.py` (yfinance primary, `_flatten_yf_df`), `backtest_runner.py` (threadpool + WS + dual-source `_load_prices_from_local/_load_prices_from_market` + sanitize/align), `persistence.py`, `commission_parser.py` (whitelist AST), `indicator_calculator.py` (pandas_ta_classic, INDICATOR_DEFS), `signal_engine.py` (evaluate_expression), `price_source.py` (unified local/market loader), `custom_algos.py`.

### Tooling — rigenerazione tipi & avvio

I tipi FE (`frontend/src/types/bt.ts`) sono auto-generati da OpenAPI. In CI verificare il drift con:

```bash
npm run gen:types --prefix frontend && git diff --exit-code frontend/src/types/bt.ts
```

Frontend API barrel: `frontend/src/api/bt.ts` re-exporta domini `strategies/algos/data/price/runs/settings/request.ts` + `utils/format.ts` e `utils/listQuery.ts`. `AlgoStack` tooltip: `?` button con modal fixed (docstring da `algo_registry` `Args:`), `Tooltip.tsx` hover ponte (`marginBottom`).

Avvio rapido: `scripts/dev.sh` (unico comando BE `:8001` + FE `:3001`, cleanup Ctrl+C, `uv sync`) — cfr. `GUIDE-AVVIARE-GUI.md:1.0`.

Fix ordinamento Data: `frontend/src/utils/listQuery.ts` `typeof==='number'` prima di `localeCompare` per colonna `Rows`.

Equity curve pagination: `frontend/src/hooks/useRunDetail.ts:limit 20000` (prima 2000 troncava SMA200 con ~2700 giorni); robustezza 0/NaN: `backtest_runner.py:_sanitize_price_df` + validazioni 422 in `backtest.py`.

### PriceData vs DataSource — riepilogo canon

- `price_data` = prezzi yfinance (OHLCV) — unica fonte per backtest (`_load_prices_from_db` → local o market a seconda di `price_source`).
- `data_sources` = indicatori (`type=indicator`), signals (`type=signal` con `source=computed|computed_weight`), upload CSV/Parquet, ffn legacy. Non duplicare prezzi qui.
- `price_column` globale: `frontend/src/api/settings.ts:6` `price_column: 'close'|'adj_close'` in `bt-settings:v1` + card "Sorgente dati" in `SettingsView`; `btStore.ts:50` sync `loadSettings().price_column` su `backtestConfig.price_column` all'avvio e ad ogni `setTree`. Rimosso da `NodeInspector` e `RunDialog` (dal 2026-09-01).
- `BuilderPreset` (`backend/models/strategy_tree.py:26`): `ticker_start/ticker_end`, `price_column`, `extra_source_ids`, `indicator_source_ids`, `signal_source_ids`, `config` (BacktestConfig), `selected_node_id`. Persistito in `tree_json` per-strategia + fallback `bt-builder-preset:v1` in localStorage; Zustand `btStore` esteso con `tickerStart/tickerEnd/extraSourceIds/indicatorSourceIds`.
- Migrazione `.opencode/plans/007-unified-ticker-data.md` (ADR) promossa in `plans/README.md` note.

### Builder & Store — layout e navigazione (dal 2026-09-01)

- Layout `BuilderView`: griglia flex 2 righe — riga1 `Palette(180) | Canvas(flex:1) | RunDialog(340)` con `alignItems:stretch`, riga2 `Inspector(260) | Indicators(260) | Signals(300)`; toggle palette `showPalette` persistito. `NodeInspector` div `overflowX:hidden` (fix 320px), tab Indicators/Signals con tabelle paginate (pattern DataManager). `DataManager` → `DataDetailView` via evento `bt-navigate-price` con `priceSymbol` (non `parseInt`), `IndicatorsView`/`SignalsView` navigano a detail con item pre-selezionato.
- Nav hash routing: `<a href="#view">` + listener `hashchange` per right-click "Apri in nuova tab"; rimosso `write-hash` effect che sovrascriveva hash al mount (fix nuova tab vuota).
- FE api barrel: `frontend/src/api/bt.ts` re-exporta `strategies/algos/data/price/runs/settings/request` + `utils/format` e `utils/listQuery` (sort numerico per `Rows` count, `dd/mm/yyyy` via `DateInputIT` + `parseDateIT/formatDate`).

### Verifica

- `grep -c "price_data" my-docs/GUIDE_documentazione_tecnica.md` ≥3
- `wc -l my-docs/GUIDE_documentazione_tecnica.md` ≥100
- `grep -q "yfinance" plans/SPEC.md` deve passare

---

## Dipendenza da pacchetto `bt` (cartella `../bt`)

Il backend usa il codice della libreria `bt` presente nella cartella gemella `../bt`. L'installazione avviene in **modalità editable** tramite `pyproject.toml`:

```toml
[tool.uv.sources]
bt = { path = "../bt", editable = true }
```

Questo significa che ogni modifica al codice in `../bt` si propaga automaticamente a `bt-gui` senza reinstallazione.

### Import dal pacchetto `bt`

| File | Import |
|------|--------|
| `backend/services/tree_serializer.py:5,7` | `import bt` / `from bt.core import AlgoStack` |
| `backend/services/algo_registry.py:7,8` | `import bt.algos` / `from bt.core import Algo` |
| `backend/services/backtest_runner.py:141` | `import bt` |

La dipendenza è dichiarata anche in `[project]` come `bt>=1.2.0`, ma la source editable sovrascrive il resolution a `../bt`.

---

### Custom Algos (dal 2026-09-03)

Algos non presenti in `bt` upstream vivono in `backend/services/custom_algos.py` e sono scoperti automaticamente da `algo_registry.py:discover_algos()` (loop su `bt.algos` + `custom_algos`).

| Algo | File | Categoria | Params | Requires/Sets |
|------|------|-----------|--------|---------------|
| `StopLossTakeProfit` | `custom_algos.py:StopLossTakeProfit` | Risk | `stop_loss_long` (0.03), `take_profit_long` (0.5), `stop_loss_short` (0.03), `take_profit_short` (0.05), `trailing_long` (0), `trailing_short` (0) | Requires `weights` / Sets `weights`, `run_always=True` |
| `EntryGateMemory` | `custom_algos.py:EntryGateMemory` | Selection | `cross_signal` (indicator), `filter_signal` (indicator, optional), `period` (monthly/weekly/daily), `filter_mode` (at_entry/at_trigger/both) | Requires `universe`+signals / Sets `selected`, `run_always=True` |
| `RebalanceAlways` | `custom_algos.py:RebalanceAlways` | Execution | – | Wraps `Rebalance`, `run_always=True` |

- **Posizionamento tipico per entry periodica + exit daily (Tutorial 8A):** `EntryGateMemory(period=monthly, cross_signal, filter_signal, filter_mode) → WeighEqually → StopLossTakeProfit → RebalanceAlways`. Tutti e tre con `run_always=True` così: `EntryGateMemory` ricorda `crossUp` giornaliero fino al prossimo `period`, `StopLossTakeProfit` controlla SL/TP ogni giorno anche quando `EntryGateMemory` blocca, `RebalanceAlways` esegue il sell giornaliero.
- **Trailing come sostituto**: se `trailing_long>0` lo SL è `max_price*(1-trailing_long)` (long) / `min_price*(1+trailing_short)` (short); altrimenti fisso `entry*(1±stop_loss)`. TP resta sull'entry.
- **filter_mode** in `EntryGateMemory`: `at_entry` (default, `price>SMA200` rivalutato il giorno di entry), `at_trigger` (fotografato al giorno del cross), `both` (entrambi True).
- **FE**: nessun hard-code — `AlgoStack.tsx` lo elenca via `GET /api/bt/algos` con categoria Risk/Selection.

*Ultimo aggiornamento: 2026-09-03* — aggiunti StopLossTakeProfit (run_always), EntryGateMemory e RebalanceAlways; documentati piano 025 (price_source local/market), pandas_ta_classic (193 indicatori), signal_condition per SelectWhere, Signals & Weight Signals (compute-weights 1/-1 vs 1/0), price_column globale in Settings, Builder layout flex + hash routing, avvio dev.sh

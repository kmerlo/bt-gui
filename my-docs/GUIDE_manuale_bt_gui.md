# Manuale Utente — bt-gui

> Questo file raccoglie le istruzioni d'uso del software per l'utente finale. Vedi anche `my-docs/GUIDE-TUTORIAL_STRATEGIE.md` per l'esempio SMA-50 passo-passo.

---

## Panoramica

bt-gui ha 5 viste (sidebar hash routing `App.tsx`): **Builder**, **Results**, **Strategies**, **Price/Data**, **Settings**. DB switcher `main`/`test` è in header e in Settings.

---

## 1. Builder — palette, tree, inspector, simple_fn

- **Palette** a sinistra: trascina nodi `Strategy`, `Security`, `FixedIncomeStrategy`, `HedgeSecurity`, `CouponPayingSecurity` sul canvas.
- **Canvas** centrale: albero con drag `@dnd-kit`, reorder, selezione.
- **Inspector** a destra: modifica `name`, `type`, `params`; se `Strategy` mostra **Algo Stack** (add/remove/reorder, form auto da `GET /api/bt/algos/{name}/schema`).
- **Commission simple_fn**: campo `lambda q,p: q*p*0.001` con validazione regex FE e whitelist AST BE (`backend/services/commission_parser.py` permette `max/min/abs/round` e aritmetica). Lascia vuoto per nessuna commissione.
- **Save/Load**: toolbar `Save` persiste su `strategies` (SQLite), `Save as new` duplica; load da dropdown.
- **Ticker Catalog**: i Security `name` devono corrispondere a ticker in `price_data` (upper-case, es. `AAPL`).

## 2. Results — RunsTable + metriche

- **RunsTable** (`ResultsDashboard`): sticky header, sort `cagr/total_return/max_drawdown/sharpe/sortino`, filtri colonna, bulk delete, pagination.
- Seleziona un run → pannelli:
  - **Equity curve** (`lightweight-charts` LineSeries)
  - **Weights** heatmap/table
  - **Metrics** tabella da `Result.stats`
  - **Transactions** tabella paginata
  - **Drawdown** AreaSeries
- **Compare overlay** multi-run: deferred — vedi `my-docs/GUIDE_documentazione_tecnica.md`. Attuale single `d.sel` in `ResultsDashboard.tsx`.
- **Export** `.py` standalone: deferred.

## 3. Strategies — libreria

- Lista strategie salvate (`GET /api/bt/strategies` con `search/sort` via `_query` helper).
- **Save** crea, **Update** modifica, **Delete** singolo, **Bulk delete** multi.
- **Import/Export JSON** in Settings → Maintenance (scarica array strategie, reimporta).
- Ogni strategia contiene `StrategyTree` con `preset.indicator_source_ids` per segnali.

## 4. Price / Data — Ticker Catalog + DataDetail

### Ticker Catalog (DataManager)

- **Fetch yfinance** (`priceDataApi.fetch`): inserisci ticker (`AAPL,MSFT`), `start`/`end` opzionali → `POST /api/bt/price-data/fetch` chiama `fetch_and_store_yf` (yfinance) e upserta in `price_data`.
- Tabella ticker: `symbol`, `interval`, `start`, `end`, `count` (da `GET /api/bt/price-data` con `limit/offset`).
- **Bulk delete** non ancora — delete singolo `DELETE /api/bt/price-data/{symbol}`.
- **Preview/Table** per indicatori: lista indicatori `dataApi.listIndicators()`, tabella con `limit/offset/sort/search`.

### DataDetail (Price rows)

- Seleziona ticker → tabella price rows `GET /api/bt/price-data/{symbol}/rows` con server pagination (`limit/offset/sort_by/sort_dir/search`) introdotta in plan 007.
- Filtri: search globale, sort colonne `date/open/high/low/close/adj_close/volume`.

> Nota: il path legacy `data_sources` tipo `price` (ffn) è mantenuto per compat ma `price_data` è canonico.

## 5. Settings — simple_fn, capitale, adj_close, DB switcher

- **Backtest defaults**: `initial_capital`, `integer_positions`, `price_column` (`close` vs `adj_close`), `simple_fn`.
- **Aspetto**: `theme` dark, `lang` it/en.
- **Dati**: `data_adapter` mostra `ffn` legacy e `yfinance` futuro.
- **Database switcher**: bottoni `main` (verde) e `test` (blu) con conteggi strategie/ds/runs; `active_db.txt` persiste scelta. `pytest` usa sempre `test` (`tests/conftest.py`).
- **Preset save/load** (`btStore.ts:50`): salva `initial_capital`/`price_column`/`simple_fn` in store Zustand.
- **Manutenzione**: `Clear runs` (bulk delete), `Export strategie (JSON)`, `Import strategie`.

## 6. DB switcher globale

Header in tutte le pagine mostra `DB: main | test` con toggle. Switch richiede confirm e reload. `active_db.txt` mantiene scelta tra restart.

---

## Collegamenti

- Tutorial pratico: `my-docs/GUIDE-TUTORIAL_STRATEGIE.md` (SMA-50 con Ticker Catalog yfinance).
- Avvio: `my-docs/GUIDE-AVVIARE-GUI.md` (porte `:8001/:3001` standalone).

---

## 7. Note

- Tutti i path `my-docs` sono relativi alla root repo `bt-gui` (non `docs`). Vedi `my-docs/GUIDE-AVVIARE-GUI.md` per sync manuale.

*Ultimo aggiornamento: 2026-08-30*

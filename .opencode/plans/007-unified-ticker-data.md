# Piano 007 — Unified Ticker Data (relazionale + yfinance)

> **Branch**: `feat/unified-ticker-data`
> **Data**: 2026-08-29
> **Status**: PROPOSTA

## Obiettivo

Sostituire il modello attuale (blob parquet multi-ticker in `data_sources`) con una tabella relazionale **per-row**, identica allo schema `price_data` di Stocks_App. I dati esistenti vengono cancellati (nessuna migrazione). Fetch con **yfinance** invece di ffn.

---

## Schema finale

```sql
CREATE TABLE price_data (
    id INTEGER PRIMARY KEY,
    symbol VARCHAR NOT NULL,
    interval VARCHAR NOT NULL DEFAULT '1d',
    date DATETIME NOT NULL,
    open FLOAT,
    high FLOAT,
    low FLOAT,
    close FLOAT,
    adj_close FLOAT,
    volume INTEGER,
    UNIQUE(symbol, interval, date)
);
CREATE INDEX ix_price_data_symbol ON price_data(symbol);
CREATE INDEX ix_price_data_date ON price_data(date);
CREATE INDEX ix_price_data_interval ON price_data(interval);
```

Stesso identico schema di Stocks_App (`market.db`). Integrazione futura zero adapter.

**Nota**: `data_sources` viene mantenuta solo per indicatori (`type='indicator'`). I prezzi esistenti (tutorial1, BenchMark_USA) vengono cancellati.

---

## Comportamento yfinance vs ffn

```python
# Multi-ticker download
df = yf.download(["AAPL", "MSFT"], start="2024-01-01", end="2024-01-05")
# Restituisce MultiIndex columns: (Price, AAPL), (Close, AAPL), ...
# Estraiamo solo la colonna desiderata ('Close' o 'Adj Close') e flatteniamo:
price_col = "Adj Close"  # o 'Close'
prices = df[price_col].T  # index=ticker, columns=date → trasposto
# Oppure più semplice:
df_single = df.xs(price_col, level=0, axis=1)  # DataFrame date × ticker
df_single.columns = [str(c).upper() for c in df_single.columns]
```

yfinance restituisce timezone-aware timestamps (es. `2024-01-02 00:00:00-05:00`). Va pulito:
```python
df.index = df.index.tz_localize(None)  # remove tz
```

---

## Nuova opzione nel NodeInspector (root Strategy)

Il root Strategy node avrà un nuovo campo `price_column` nel preset:
- `"close"` (default) — usa la colonna `close` della tabella
- `"adj_close"` — usa la colonna `adj_close` (prezzo rettificato dividendi/split)

Questa scelta influenza solo il backtest, non il salvataggio in DB (entrambe le colonne sono sempre salvate).

---

## Modifiche Backend

### 1. `backend/database.py`
- Aggiungere modello `PriceData` con tabella `price_data` (stesso schema di Stocks_App)
- `init_db()` crea la tabella se non esiste
- **Nessuna migrazione** — i dati price esistenti in `data_sources` verranno cancellati manualmente dall'utente

### 2. `backend/services/data_loader.py`
- Rimuovere `fetch_ffn` (o mantenerla solo per legacy)
- Nuova funzione `fetch_and_store_yf(symbol_or_tickers, start, end) -> list[dict]`
  - Chiede a yfinance i dati
  - Salva ogni riga in `price_data` con upsert (symbol+interval+date univoco)
  - Supporta multi-ticker in una chiamata
  - Restituisce lista di symbol salvati
- Helper `_upsert_price_rows(db, symbol, df, interval)` che:
  - Carica righe esistenti in dict `{date: row}`
  - Per ogni riga del DF: update se esiste, insert se nuovo
  - `db.commit()`

### 3. `backend/models/backtest_config.py`
- Aggiungere `price_column: Literal["close", "adj_close"] = "close"`
- Aggiungere `start: str | None` e `end: str | None` opzionali

### 4. `backend/api/routes.py`
- **Nuove route:**
  - `GET /api/bt/price-data` → lista simboli con metadata (symbol, interval, start, end, count)
  - `POST /api/bt/price-data/fetch` → `{symbol, start, end}` → scarica da yfinance e salva
  - `GET /api/bt/price-data/{symbol}/rows` → query con start/end → restituisce righe come JSON
  - `DELETE /api/bt/price-data/{symbol}` → cancella tutti i dati di un simbolo
- **Backtest modificato:**
  - Payload: `{tickers, start, end, price_column, config, ...}`
  - Query SQL: `SELECT date, close, adj_close, volume FROM price_data WHERE symbol IN (...) AND date BETWEEN ? AND ? ORDER BY date`
  - Pivot: index=date, columns=ticker, values=`close` o `adj_close` in base a `price_column`
  - Fallback legacy: se `price_source_id` presente ma nessun ticker → usa `data_sources` blob

### 5. `backend/services/backtest_runner.py`
- Helper `_load_prices_from_db(tickers, start, end, price_column)` 
  - Esegue query SQL → costruisce DataFrame compatto per bt framework
- Il frame finale ha solo la colonna selezionata (close o adj_close) come valore, ma conserva index date

---

## Modifiche Frontend

### 6. `frontend/src/api/bt.ts`
- Aggiungere `priceDataApi`:
  - `list()` → simboli disponibili
  - `fetch(symbol, start, end)` → scarica da yfinance
  - `getRows(symbol, start, end)` → preview dati
  - `delete(symbol)` → cancella dati ticker
- `backtestApi.create` aggiunge campi `tickers`, `start`, `end`, `price_column`

### 7. `frontend/src/bt/store/btStore.ts`
- Rimuovere: `priceSourceId`, `extraSourceIds`, `indicatorSourceIds`
- Aggiungere:
  - `tickerStart: string` (default: today - 1 year)
  - `tickerEnd: string` (default: today)
  - `priceColumn: 'close' | 'adj_close'` (default: 'close')
- Il preset tree salva questi campi

### 8. `frontend/src/bt/components/NodeInspector.tsx`
- Root Strategy: aggiungere selettore `Price column` (close / adj_close)
- Date range picker (start/end) — già richiesto
- I valori vengono salvati nel preset della strategy

### 9. `frontend/src/bt/components/DataManager.tsx`
- Ridefinire come **Ticker Catalog**:
  - Tabella: symbol, interval, start_date, end_date, rows, azioni
  - Input: symbol + date range + bottone "Fetch"
  - Bottone "Refresh" per ricaricare lo storico di un ticker
  - Bottone "Delete" per rimuovere i dati di un ticker
- Sezione indicators ancora presente (legge da `data_sources` type=indicator)

### 10. `frontend/src/bt/components/RunDialog.tsx`
- Sostituire "Price source" select con:
  - Lista ticker disponibili da `priceDataApi.list()`
  - Date range (ereditato dalla root Strategy, editabile)
  - Selettore price_column (ereditato dalla root Strategy)
- Validazione: almeno un ticker selezionato

### 11. `frontend/src/bt/components/IndicatorPanel.tsx`
- Sostituire "Price source" con selezione ticker da `priceDataApi.list()`
- Al cambio ticker o range, invalidare indicatori cached
- Compute indicator: usa i dati del ticker selezionato dal DB (query SQL con range e price_column)

### 12. `frontend/src/types/bt.ts`
- Rigenerare con `npm run gen:types`

---

## Flow backtest nuovo modello

```
1. Security nodes nell'albero: AAPL, MSFT
2. NodeInspector (root): 
   - start=2023-01-01, end=2026-08-29
   - price_column=adj_close
3. Run → { tickers: ['AAPL','MSFT'], start, end, price_column: 'adj_close', config }
4. BE:
   a. SELECT date, close, adj_close, volume FROM price_data
      WHERE symbol IN ('AAPL','MSFT') AND date BETWEEN '2023-01-01' AND '2026-08-29'
      ORDER BY date
   b. Pivot: index=date, columns=['AAPL','MSFT'], values=adj_close
   c. Backtest come prima
5. Risultati salvati con start/end/price_column in config_json
```

---

## Checklist implementazione

- [ ] DB: modello `PriceData` + tabella creata da `init_db()`
- [ ] BE: `fetch_and_store_yf` con upsert logic (stesso pattern di Stocks_App)
- [ ] BE: route `/api/bt/price-data` (list, fetch, getRows, delete)
- [ ] BE: backtest usa `price_data` con WHERE symbol + date BETWEEN + price_column
- [ ] FE: `priceDataApi` in `api/bt.ts`
- [ ] FE: store: rimuovi priceSourceId, aggiungi tickerStart/End/priceColumn
- [ ] FE: NodeInspector mostra date range + price column selector per root
- [ ] FE: DataManager → Ticker Catalog (fetch yfinance, delete, refresh)
- [ ] FE: RunDialog usa tickers + date range + price column
- [ ] FE: IndicatorPanel usa ticker da price_data + invalida cache
- [ ] FE: tipi rigenerati
- [ ] Cancellare dati price esistenti in data_sources (tutorial1, BenchMark_USA)
- [ ] Test: pytest passa
- [ ] Build: `npm run build` passa

---

## Risorse colpite

| File | Modifica |
|------|----------|
| `backend/database.py` | + `PriceData` model |
| `backend/api/routes.py` | + route price-data, backtest esteso |
| `backend/services/data_loader.py` | + `fetch_and_store_yf`, `_upsert_price_rows` |
| `backend/services/backtest_runner.py` | + `_load_prices_from_db` |
| `backend/models/backtest_config.py` | + `price_column`, `start`, `end` |
| `frontend/src/api/bt.ts` | + `priceDataApi` |
| `frontend/src/types/bt.ts` | rigenerato |
| `frontend/src/bt/store/btStore.ts` | refactoring completo |
| `frontend/src/bt/components/NodeInspector.tsx` | + date range + price column per root |
| `frontend/src/bt/components/DataManager.tsx` | riscrivi come Ticker Catalog |
| `frontend/src/bt/components/RunDialog.tsx` | thay price source → tickers + dates + column |
| `frontend/src/bt/components/IndicatorPanel.tsx` | usa ticker DB + invalida cache |

---

## Backward compatibility

- Strategie esistenti che puntano a `price_source_id` → errore chiaro ("price data not found, fetch from Ticker Catalog")
- `data_sources` mantenuta per indicatori (`type='indicator'`) e upload CSV legacy
- Tabella `price_data` completamente nuova, zero dati iniziali

---

## Integrazione futura con Stocks_App

- Stesso schema `price_data` (stesse colonne, stessi indici)
- Possibilità di pointare allo stesso `market.db` tramite configurazione
- Query SQL identiche, zero adapter

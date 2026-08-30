# Tutorial: creare la strategia SMA above 50 con bt-gui

Questo tutorial guida passo passo alla replica dell'esempio *SMA Strategy* tratto dalla documentazione ufficiale di bt ([pmorissette.github.io/bt/examples.html](https://pmorissette.github.io/bt/examples.html)): long sui titoli sopra la media mobile a 50 giorni, pesi uguali, reb Bilanciamento mensile.

## Prerequisiti

- Backend in ascolto su `http://localhost:8001`
- Frontend in ascolto su `http://localhost:3001`
- Almeno un price source caricato (vedi Step 1)

---

## Step 1 — caricare i dati di prezzo (Ticker Catalog yfinance)

1. Nel menu cliccare **Ticker Catalog** (vista Data).
2. Campo **TICKER**: `AAPL` (per multi-ticker inserire `AAPL,MSFT,C,GS,GE` e ripetere fetch per ciascuno — yfinance canon è per singolo symbol via `priceDataApi.fetch` / `fetch_and_store_yf` in `backend/services/data_loader.py:78`).
3. **Start**: `2010-01-01` — lasciar vuoto End per ora.
4. Cliccare **Fetch** (yfinance).
5. Alla comparsa della riga nella tabella, verificare `count` >0. Ripetere per `MSFT,C,GS,GE`.

> Il prezzo è scaricato da `yfinance.download()` e salvato in `price_data` (tabella canonical `symbol/date/OHLCV`). Non più `data_sources.parquet_blob` né `ffn.get()` (ffn resta solo come adapter legacy in `backend/services/data_loader.py:21` `fetch_ffn`). I ticker vengono da `price_data` e sono usati dal backtest via `_load_prices_from_db`.

---

## Step 2 — pre-calcolare l'indicatore SMA(50)

1. Tornare in **Builder** e aprire il pannello **Indicators** (toolbar).
2. Nel pannello **Indicators**:
   - **Symbol**: selezionare `AAPL` (o uno dei ticker caricati — i dati vengono da `price_data` via yfinance, non da `data_sources` price blob).
   - **Indicator**: `SMA`.
   - **Period**: `50`.
   - **Name** (opzionale): `sma50_aapl`.
3. Cliccare **Compute & Save**.
4. L'indicatore è salvato come DataSource `type='indicator'` e come righe in `price_data`-derivato; compare in lista con tag `sma_50`. Per multi-ticker ripetere per ciascuno o usare `SelectWhere` con segnale globale.

> I ticker per l'indicatore vengono da `price_data` (yfinance), non più da `path_or_tickers` ffn. L'ID numerico dell'indicatore serve nello Step 4.

---

## Step 3 — costruire l'albero strategia

1. Nel **Canvas** (pannello centrale) cliccare sul nodo root **MyStrategy** (o rinominarlo in `above50sma`).
2. Dalla **Palette** a sinistra trascinare cinque nodi **Security** sul canvas, uno per volta, sopra il nodo root.
3. Per ogni Security, nell'**Inspector** a destra modificare il **name** nel ticker corrispondente:
   - `AAPL`
   - `MSFT`
   - `C`
   - `GS`
   - `GE`

> Solo i nodi di tipo **Strategy** o **FixedIncomeStrategy** possono avere figli. I Security sono foglie.

---

## Step 4 — compilare l'Algo Stack

Con il root **above50sma** ancora selezionato, nel pannello **Inspector** scorrere fino a **Algo Stack — 0 algos**.

Aggiungere gli algo in questo ordine esatto (cliccare **Add** dopo ogni selezione):

| Ordine | Algo          | Parametri da impostare                              |
|--------|---------------|-----------------------------------------------------|
| 1      | RunMonthly    | `run_on_first_date`: spuntare `true`               |
| 2      | SelectWhere   | **signal**: selezionare dal dropdown l'SMA(50) creato nello Step 2 |
| 3      | WeighEqually  | nessun parametro                                    |
| 4      | Rebalance     | nessun parametro                                    |

> Il campo **signal** di `SelectWhere` appare come `<select>` (non come input testo) perché lo schema BE lo ha marcato con `kind: "indicator"`. Le opzioni sono tutti gli indicatori salvati; selezionare quello SMA(50) appena creato.

Verificare che nell'Algo Stack compaia l'icona **`4 algos`** sul nodo root.

---

## Step 5 — eseguire il backtest

1. Nel pannello **Run Backtest** (colonna destra, sotto la toolbar):
   - **Price source**: selezionare il datasource di prezzo creato allo Step 1.
   - **Initial capital**: lasciare `100000` o impostare il valore desiderato.
   - Lasciare **integer positions** disattivato (i pesi continui sono più fedeli all'esempio bt).
   - Lasciare **Commission** vuoto (l'esempio non usa commissioni).
2. Cliccare **Run**.
3. Una barra di progresso appare sotto il bottone; al termine si viene reindirizzati automaticamente alla tab **Results**.

---

## Step 6 — leggere i risultati

Nella tab **Results** sono disponibili:

- **Equity curve** — grafico della crescita del portafoglio nel tempo.
- **Weights** — allocazione percentuale per ciascun ticker (se disponibile).
- **Metrics** — tabella con CAGR, Sharpe, Sortino, max drawdown, Calmar, win year %, ecc.
- **Transactions** — storico degli ordini di compra/vendita.

I valori attesi (riassunto dall'esempio bt originale):

| Metrica     | Valore approssimativo |
|-------------|-----------------------|
| Total Return | ~116%                |
| CAGR        | ~6,4%                 |
| Max Drawdown | ~−39%                 |
| Daily Sharpe | ~0,42                 |

> I valori reali possono variare leggermente in base alla data di fine (il database ffn viene aggiornato periodicamente).

---

## Suggerimenti aggiuntivi

- **Confrontare periodi SMA diversi** (10, 20, 40): ripetere gli Step 2–5 cambiando solo il parametro `period` dell'SMA e creando strategie separate da salvare con nomi distinti (`sma10`, `sma20`, ecc.).
- **Benchmark SPY**: creare una seconda strategia con solo `RunMonthly` + `SelectAll` + `WeighEqually` + `Rebalance` sul ticker `SPY` per confrontare il buy-and-hold Equal Weight con la strategia SMA.
- **Salvare la strategia**: prima di chiudere, cliccare **Save** nella toolbar per persistere l'albero in SQLite. Riaprire con **Load** → selezionare dal menu a tendina → **Load**.
 - **Export futuro** (deferred): `StrategyTree → .py` via `tree_serializer` è rimandato — vedi `plans/SPEC.md` §9. Per ora usare Save/Export JSON.

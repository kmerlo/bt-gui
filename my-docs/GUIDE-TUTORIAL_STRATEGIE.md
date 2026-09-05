# Tutorial: creare strategie con bt-gui

Questo file contiene tutorial passo passo per riprodurre gli esempi tratti dalla documentazione ufficiale di bt ([pmorissette.github.io/bt/examples.html](https://pmorissette.github.io/bt/examples.html)).

| # | Tutorial | Sorgente bt | Descrizione |
|---|----------|-------------|-------------|
| 1 | [SMA above 50](#tutorial-sma-above-50) | [SMA Strategy](https://pmorissette.github.io/bt/examples.html#sma-strategy) | long sui titoli sopra SMA(50), pesi uguali |
| 2 | SMA Crossover | [SMA Crossover Strategy](https://pmorissette.github.io/bt/examples.html#sma-crossover-strategy) | long/short su crossover SMA(50)/SMA(200) |
| 3 | [Exploring the Tree Structure](#tutorial-tree-structure) | [Exploring the Tree Structure](https://pmorissette.github.io/bt/examples.html#exploring-the-tree-structure) | strategie annidate (parent + 2 child) |
| 4 | [Buy and Hold](#tutorial-buy-and-hold) | [Buy and Hold Strategy](https://pmorissette.github.io/bt/examples.html#buy-and-hold-strategy) | rebalance mensile a pesi statici |
| 5 | [Trend Example 1](#tutorial-trend-1) | [Trend Example 1](https://pmorissette.github.io/bt/examples.html#trend-example-1) | trend-following 12M median + daily rebalance, EW vs InvVol, cap 40% |
| 6 | [Trend Example 2](#tutorial-trend-2) | [Trend Example 2](https://pmorissette.github.io/bt/examples.html#trend-example-2) | time-series momentum 12M return > 0, monthly long/flat su singolo ticker |
| 7 | [Strategy Combination](#tutorial-strategy-combination) | [Strategy Combination](https://pmorissette.github.io/bt/examples.html#strategy-combination) | parent Combined + 2 child (EW / InvVol) su 5 ticker, monthly, analisi pesi & equity singole |
| 8 | [Stop Loss & Take Profit](#tutorial-sl-tp) | [Using Pandas to set SL/TP](https://zachlim98.github.io/me/2020-12/Using-Pandas-to-set-SL) + esempio SPY | SPY long-only SL 5%/TP 15% con filtro SMA200 + crossUp SMA20 via StopLossTakeProfit |
| 9 | [ERC Risk Parity](#tutorial-erc) | [Equally Weighted Risk Contributions](https://pmorissette.github.io/bt/examples.html#equally-weighted-risk-contributions-portfolio) | SPY+TLT pesati a uguale risk-contribution via WeighERC |

---

# Tutorial 1 — SMA above 50 (long only, equal weight)

> Vedi [sezione SMA above 50](#tutorial-sma-above-50) più avanti in questo file.

---

# Tutorial 4 — Buy and Hold Strategy (rebalance mensile a pesi statici)

> Vedi [sezione Buy and Hold](#tutorial-buy-and-hold) più avanti in questo file.

---

# Tutorial 2 — SMA Crossover Strategy (long/short)

Questo tutorial guida alla replica dell'esempio *SMA Crossover Strategy* tratto dalla documentazione ufficiale di bt: long quando SMA(50) > SMA(200), short quando SMA(50) < SMA(200), su SPY.

## Prerequisiti

- Backend in ascolto su `http://localhost:8001`
- Frontend in ascolto su `http://localhost:3001`
- Almeno un price source caricato (vedi Step 1)

---

## Step 1 — caricare i dati di prezzo (SPY)

1. Nel menu cliccare **Ticker Catalog** (vista Data).
2. Campo **TICKER**: `SPY`.
3. **Start**: `2010-01-01` — lasciar vuoto End per ora.
4. Cliccare **Fetch** (yfinance).
5. Alla comparsa della riga nella tabella, verificare `count` >0.

> Il prezzo è scaricato da `yfinance.download()` e salvato in `price_data`.

---

## Step 2 — pre-calcolare SMA(50) e SMA(200)

1. Tornare in **Builder** e aprire il pannello **Indicators** (toolbar).
2. Nel pannello **Indicators**:
   - **Symbol**: selezionare `SPY`.
   - **Indicator**: `SMA`.
   - **Period**: `50`.
   - **Name** (opzionale): `sma50_spy`.
3. Cliccare **Compute & Save**.
4. Ripetere con **Period**: `200` e **Name**: `sma200_spy`.

> Gli ID numerici dei due indicatori salvati servono nello Step 4.

---

## Step 3 — costruire l'albero strategia

1. Nel **Canvas** cliccare sul nodo root **MyStrategy** (rinominarlo in `ma_cross`).
2. Dalla **Palette** trascinare un nodo **Security** sul canvas, sopra il nodo root.
3. Nell'**Inspector** modificare il **name** del Security in: `SPY`.

---

## Step 4 — creare il weight signal (SMA crossover)

1. Aprire il pannello **Signals** (bottone nella toolbar).
2. Nella sezione **Weight Signal (WeighTarget)** in basso:
   - **Fast SMA**: selezionare l'SMA(50) creato allo Step 2.
   - **Slow SMA**: selezionare l'SMA(200) creato allo Step 2.
   - **Tickers**: cliccare su `SPY` per selezionarlo.
   - **Name**: `ma_cross_weight`.
3. Cliccare **Compute Weight Signal**.
4. Verificare il messaggio di successo e la comparsa del signal nella lista.

> Il weight signal è un DataFrame con valori +1 (SMA50 > SMA200), −1 (SMA50 < SMA200), 0 (dati insufficienti). È salvato come DataSource `type='signal'`, `source='computed_weight'`.

---

## Step 5 — compilare l'Algo Stack

Con il root **ma_cross** ancora selezionato, nel pannello **Inspector** scorrere fino a **Algo Stack — 0 algos**.

Aggiungere gli algo in questo ordine esatto:

| Ordine | Algo         | Parametri da impostare                              |
|--------|--------------|-----------------------------------------------------|
| 1      | RunMonthly   | `run_on_first_date`: spuntare `true`               |
| 2      | WeighTarget  | **weights**: selezionare dal dropdown il weight signal `ma_cross_weight` creato nello Step 4 |
| 3      | Rebalance    | nessun parametro                                    |

> `RunMonthly` è obbligatorio con `WeighTarget`: senza di esso l'algo gira ogni giorno e, con `integer_positions` attivo, genera micro-transazioni quotidiane per mantenere il peso costante mentre il prezzo fluttua. L'esempio originale bt usa `RunMonthly` proprio per evitare questo.
> Il campo **weights** di `WeighTarget` appare come `<select>` perché lo schema BE lo ha marcato con `kind: "indicator"`. Le opzioni includono sia indicatori che signal salvati; selezionare quello con `source='computed_weight'`.

Verificare che nell'Algo Stack compaia l'icona **`3 algos`** sul nodo root.

---

## Step 6 — eseguire il backtest

1. Nel pannello **Run Backtest** (colonna destra):
   - **Price source**: selezionare il datasource SPY creato allo Step 1.
   - **Initial capital**: lasciare `100000`.
   - Lasciare **integer positions** disattivato.
   - Lasciare **Commission** vuoto.
2. Cliccare **Run**.
3. Al termine si viene reindirizzati alla tab **Results**.

---

## Step 7 — leggere i risultati

Nella tab **Results**:

- **Equity curve** — grafico della crescita del portafoglio.
- **Weights** — allocazione (dovrebbe mostrare +100% / −100% a seconda del crossover).
- **Metrics** — CAGR, Sharpe, max drawdown, ecc.

I valori attesi (riassunto dall'esempio bt originale, approssimativi):

| Metrica     | Valore approssimativo |
|-------------|-----------------------|
| Total Return | ~320%+ (varia con dati aggiornati) |
| CAGR        | ~12%                  |
| Max Drawdown | ~−34%                 |
| Daily Sharpe | ~0,75                 |

> I valori reali variano in base alla data di fine dei dati caricati.

---

## Suggerimenti aggiuntivi

- **Confrontare periodi diversi**: ripetere i tutorial 1 e 2 con SMA(20/50), SMA(10/50) per confrontare diverse configurazioni di crossover.
- **Salvare la strategia**: cliccare **Save** nella toolbar per persistere l'albero in SQLite.
- **Export futuro**: `StrategyTree → .py` via `tree_serializer` è rimandato — vedi `plans/SPEC.md` §9. Per ora usare Save/Export JSON.

---

# Tutorial 3 — Exploring the Tree Structure (strategie annidate)

> Vedi [sezione Exploring the Tree Structure](#tutorial-tree-structure) più avanti in questo file.

---

## Prerequisiti

- Backend in ascolto su `http://localhost:8001`
- Frontend in ascolto su `http://localhost:3001`
- Almeno due price source caricati (vedi Step 1)

---

## Step 1 — caricare i dati di prezzo (AAPL e MSFT)

1. Nel menu cliccare **Ticker Catalog** (vista Data).
2. Campo **TICKER**: `AAPL`.
3. **Start**: `2010-01-01` — lasciar vuoto End per ora.
4. Cliccare **Fetch** (yfinance).
5. Ripetere per `MSFT`.

> Entrambi i ticker devono avere count >0 nella tabella prima di procedere.

---

## Step 2 — pre-calcolare gli indicatori SMA per ciascun ticker

1. Tornare in **Builder** e aprire il pannello **Indicators** (toolbar).
2. Per ogni ticker, calcolare SMA(50) e SMA(200):
   - **Symbol**: `AAPL` → **Indicator**: `SMA`, **Period**: `50`, **Name**: `sma50_aapl`.
   - Cliccare **Compute & Save**.
   - Ripetere per `sma200_aapl` (Period `200`).
   - Ripetere per `sma50_msft` (Symbol `MSFT`, Period `50`) e `sma200_msft` (Period `200`).
3. Annotare gli ID numerici dei 4 indicatori creati.

> Gli ID servono per creare i weight signal negli Step 4 e 5.

---

## Step 3 — creare i weight signal per ciascun MA crossover

1. Aprire il pannello **Signals** (bottone nella toolbar).
2. Per il crossover AAPL:
   - **Indicatore 1** (fast): selezionare `sma50_aapl`.
   - **Indicatore 2** (slow): selezionare `sma200_aapl`.
   - **Modalità**: `1 / −1` (long/short).
   - **Tickers**: selezionare `AAPL`.
   - **Name**: `ma_cross_aapl`.
   - Cliccare **Compute Weight Signal**.
3. Ripetere per il crossover MSFT:
   - **Indicatore 1**: `sma50_msft`.
   - **Indicatore 2**: `sma200_msft`.
   - **Modalità**: `1 / −1`.
   - **Tickers**: `MSFT`.
   - **Name**: `ma_cross_msft`.
   - Cliccare **Compute Weight Signal**.

> Ogni weight signal è un DataFrame con valori +1 quando SMA50 > SMA200, −1 quando SMA50 < SMA200, 0 nei giorni con dati insufficienti.

---

## Step 4 — costruire l'albero strategia annidato

1. Nel **Canvas** cliccare sul nodo root **MyStrategy** e rinominarlo in `parent`.
2. Dalla **Palette** trascinare due nodi **Strategy** sul canvas, come figli del root (droppare sopra `parent`).
3. Rinominare il primo figlio in `aapl_ma_cross` e il secondo in `msft_ma_cross`.
4. Per ciascun figlio Strategy, aggiungere un nodo **Security** come suo figlio:
   - In `aapl_ma_cross`: aggiungere Security `AAPL`.
   - In `msft_ma_cross`: aggiungere Security `MSFT`.

> Solo i nodi di tipo **Strategy** (o **FixedIncomeStrategy**) possono avere figli. I Security sono foglie.

Verificare la struttura nel Canvas:
```
parent (Strategy)
├── aapl_ma_cross (Strategy)
│   └── AAPL (Security)
└── msft_ma_cross (Strategy)
    └── MSFT (Security)
```

---

## Step 5 — compilare l'Algo Stack di ciascun child strategy

### Child `aapl_ma_cross`

Selezionare il nodo `aapl_ma_cross` e aggiungere gli algo in questo ordine:

| Ordine | Algo        | Parametri                                          |
|--------|-------------|----------------------------------------------------|
| 1      | RunMonthly  | `run_on_first_date`: spuntare `true`              |
| 2      | WeighTarget | **weights**: selezionare il signal `ma_cross_aapl` |
| 3      | Rebalance   | nessun parametro                                   |

### Child `msft_ma_cross`

Selezionare il nodo `msft_ma_cross` e aggiungere gli algo in questo ordine:

| Ordine | Algo        | Parametri                                          |
|--------|-------------|----------------------------------------------------|
| 1      | RunMonthly  | `run_on_first_date`: spuntare `true`              |
| 2      | WeighTarget | **weights**: selezionare il signal `ma_cross_msft` |
| 3      | Rebalance   | nessun parametro                                   |

> Ogni child strategy contiene il proprio loop di trading: monthly rebalance con pesi long/short basati sul crossover SMA.

---

## Step 6 — compilare l'Algo Stack del root (parent)

Selezionare il nodo root `parent` e aggiungere gli algo in questo ordine:

| Ordine | Algo         | Parametri                            |
|--------|--------------|--------------------------------------|
| 1      | RunMonthly   | `run_on_first_date`: spuntare `true` |
| 2      | SelectAll    | nessun parametro                     |
| 3      | WeighInvVol  | nessun parametro                     |
| 4      | Rebalance    | nessun parametro                     |

> `SelectAll` seleziona tutti i figli strategy del root. `WeighInvVol` assegna i pesi inversamente proporzionali alla volatilità di ciascuna child strategy. `Rebalance` applica i pesi target.

Verificare che il root mostri **`4 algos`** e che ciascun figlio mostri **`3 algos`**.

---

## Step 7 — eseguire il backtest

1. Nel pannello **Run Backtest** (colonna destra):
   - **Price source**: selezionare i datasource AAPL e MSFT (se supportato dal dropdown multi-select; altrimenti assicurarsi che entrambi i ticker siano presenti in `price_data`).
   - **Initial capital**: lasciare `100000`.
   - Lasciare **integer positions** disattivato.
   - Lasciare **Commission** vuoto.
2. Cliccare **Run**.
3. Al termine si viene reindirizzati alla tab **Results**.

> Il backtest esegue prima le due child strategy in parallelo ("paper trade" interno), poi usa i loro equity curve come prezzi sintetici per allocare tra di esse secondo la volatilità inversa.

---

## Step 8 — leggere i risultati

Nella tab **Results**:

- **Equity curve** — andamento del portafoglio composto.
- **Weights** — allocazione percentuale tra `aapl_ma_cross` e `msft_ma_cross` (dovrebbe variare mensilmente in base alla volatilità relativa).
- **Metrics** — CAGR, Sharpe, max drawdown, ecc.

---

## Spiegazione concettuale

L'esempio illustra il concetto di **strategie di strategie** in bt:

1. Ogni child strategy (`aapl_ma_cross`, `msft_ma_cross`) è un backtest autonomo che genera un equity curve.
2. Il root (`parent`) treatta questi equity curve come "securità sintetiche" e vi alloca capitale.
3. `WeighInvVol` assegna più capitale alla child strategy con volatilità minore, riducendo il rischio complessivo del portafoglio composto.
4. `RunMonthly` su tutti i nodi assicura che il rebilanciamento avvenga solo una volta al mese, evitando micro-transazioni.

Questo pattern permette di costruire portafogli gerarchici complessi senza riscrivere logica di allocazione.

---

## Suggerimenti aggiuntivi

- **Aggiungere un terzo ticker**: ripetere Step 2–5 per `GS` o `C` e aggiungere un terzo child strategy nel root.
- **WeighEqually invece di WeighInvVol**: sostituire `WeighInvVol` con `WeighEqually` nel root per confrontare l'allocazione egualitaria con quella inverse-volatility.
- **Salvare la strategia**: cliccare **Save** prima di chiudere per persistere l'albero annidato in SQLite.

---

<a name="tutorial-tree-structure"></a>

---

<a name="tutorial-sma-above-50"></a>

# Tutorial 1 — SMA above 50 (long only, equal weight)

Questo tutorial guida passo passo alla replica dell'esempio *SMA Strategy* tratto dalla documentazione ufficiale di bt: long sui titoli sopra la media mobile a 50 giorni, pesi uguali, rebilanciamento mensile.

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

---

<a name="tutorial-buy-and-hold"></a>

# Tutorial 4 — Buy and Hold Strategy (rebalance mensile a pesi statici)

Questo tutorial replica l'esempio *Buy and Hold Strategy* tratto dalla documentazione ufficiale di bt: https://pmorissette.github.io/bt/examples.html#buy-and-hold-strategy — rebalance mensile a pesi fissi (es. 60% / 40%), il più semplice esempio di separazione tra **logica della strategia** e **dati**.

Codice originale bt (estratto):

```python
import bt
import pandas as pd

runMonthlyAlgo = bt.algos.RunMonthly(run_on_first_date=True)
weights = pd.Series([0.6, 0.4, 0.], index=rdf.columns)  # foo 0.6, bar 0.4, rf 0.
weighSpecifiedAlgo = bt.algos.WeighSpecified(**weights)
rebalAlgo = bt.algos.Rebalance()

strat = bt.Strategy('static', [runMonthlyAlgo, weighSpecifiedAlgo, rebalAlgo])
backtest = bt.Backtest(strat, pdf, integer_positions=False)
res = bt.run(backtest)
```

> Nell'esempio bt i dati sono sintetici (`foo`, `bar`, `rf` generati con `np.random.normal` e `100*np.cumprod(1+rdf)`). In bt-gui si usano dati reali yfinance — la logica è identica, cambiano solo i ticker.

## Prerequisiti

- Backend in ascolto su `http://localhost:8001`
- Frontend in ascolto su `http://localhost:3001`
- Almeno uno o due price source caricati (vedi Step 1)

---

## Step 1 — caricare i dati di prezzo

Scegliere una delle due varianti:

**Variante A — singolo ticker (più semplice, consigliata per primo test):**

1. Nel menu cliccare **Ticker Catalog** (vista Data).
2. Campo **TICKER**: `SPY`.
3. **Start**: `2010-01-01` — lasciare vuoto End per ora.
4. Cliccare **Fetch** (yfinance).
5. Verificare `count` >0 nella tabella.

**Variante B — due ticker per replicare 60/40 (come foo/bar dell'esempio):**

1. Ripetere lo stesso per `SPY` e `AGG` (proxy azionario/obbligazionario) — oppure `SPY` e `TLT`, `AAPL` e `MSFT`.
2. Verificare che entrambi abbiano `count` >0.

> I prezzi sono scaricati da `yfinance.download()` e salvati in `price_data`. Non serve pre-calcolare indicatori per questo tutorial.

---

## Step 2 — costruire l'albero strategia

1. Nel **Canvas** cliccare sul nodo root **MyStrategy** e rinominarlo in `static`.
2. Dalla **Palette** trascinare nodi **Security** sul canvas, sopra il root:
   - Variante A: un solo Security `SPY`.
   - Variante B: due Security `SPY` e `AGG` (o i due ticker scelti).
3. Verificare la struttura:

```
static (Strategy)
├── SPY (Security)
└── AGG (Security)   # solo variante B
```

> Solo i nodi **Strategy** possono avere figli; i Security sono foglie.

---

## Step 3 — compilare l'Algo Stack

Con il root **static** selezionato, nell'**Inspector** → **Algo Stack — 0 algos**, aggiungere in questo ordine esatto:

| Ordine | Algo            | Parametri da impostare |
|--------|-----------------|------------------------|
| 1      | RunMonthly      | `run_on_first_date`: spuntare `true` (`run_on_end_of_period` e `run_on_last_date` lasciare `false`) |
| 2      | WeighSpecified  | **weights**: inserire JSON con i pesi target, es. `{"SPY": 0.6, "AGG": 0.4}` (variante A: `{"SPY": 1.0}`) |
| 3      | Rebalance       | nessun parametro |

**Nota sul campo `weights` di `WeighSpecified`:** è un `string` perché l'algo bt ha firma `__init__(self, **weights)` (chiavi arbitrarie = ticker). La GUI lo espone come unico campo testo. Formati accettati dal backend (`backend/services/algo_registry.py:121`):

- JSON: `{"SPY": 0.6, "AGG": 0.4}` ← consigliato
- Coppie separate da virgola: `SPY:0.6,AGG:0.4` o `SPY=0.6,AGG=0.4`
- Oggetto già come dict se inviato via API

> `WeighSpecified(**weights)` copia i pesi in `target.temp['weights']` ad ogni chiamata; `Rebalance` li applica. `RunMonthly(run_on_first_date=True)` fa sì che il rebalance avvenga solo il primo giorno di ogni mese (e il primo giorno del backtest) — senza di esso il rebalance girerebbe ogni giorno generando micro-transazioni per mantenere il peso costante mentre i prezzi fluttuano.

**Variante semplificata senza `WeighSpecified`:** per un buy-and-hold equal-weight basta sostituire `WeighSpecified` con `WeighEqually` (nessun parametro) — utile se si vuole solo verificare il flusso senza inserire JSON.

Verificare che l'Algo Stack mostri **`3 algos`** e nessun warning "requires weights".

---

## Step 4 — eseguire il backtest

1. Nel pannello **Run Backtest** (colonna destra):
   - **Price source**: selezionare il datasource SPY (variante A) o assicurarsi che entrambi i datasource siano presenti (variante B — il runner carica tutti i ticker presenti in `price_data` per i Security dell'albero).
   - **Initial capital**: lasciare `100000`.
   - Lasciare **integer positions** disattivato (`False` — come `integer_positions=False` dell'esempio bt; con `True` le posizioni sono arrotondate a lotti interi).
   - Lasciare **Commission** vuoto.
2. Cliccare **Run**.
3. Al termine si viene reindirizzati alla tab **Results**.

> La logica della strategia è separata dai dati — come nell'esempio bt `bt.Backtest(strat, pdf)` — lo stesso albero `static` può essere rieseguito su periodi o ticker diversi cambiando solo il price source.

---

## Step 5 — leggere i risultati

Nella tab **Results**:

- **Equity curve** — `res.prices` / `strategy.values` nell'esempio bt; crescita del portafoglio (parte da `initial_capital`).
- **Weights** — `res.plot_security_weights()` nell'esempio; allocazione mensile (dovrebbe restare ~60/40, con drift intra-mese e riallineamento a fine mese).
- **Metrics** — `res.stats` nell'esempio; CAGR, Sharpe, max drawdown, Calmar, ecc.
- **Transactions / Outlays** — `strategy.outlays` e `strategy.outlays / price` nell'esempio; controvalore speso e variazione posizioni (`positions.diff(1)`).

Valori attesi con dati sintetici dell'esempio originale (2017-01-01 → 2017-12-29, `rdf` random seed 1, `pdf=100*cumprod(1+rdf)`):

| Metrica | Valore (dati fake bt) |
|---------|-----------------------|
| Total Return | ~22.9% |
| CAGR | ~23.1% |
| Max Drawdown | ~−6.9% |
| Calmar | ~3.3 |
| Daily Sharpe | ~1.80 |

> Con dati reali (SPY/AGG dal 2010) i valori saranno diversi — es. SPY buy-and-hold 2010→oggi CAGR ~12%, max drawdown ~−33%. L'importante è verificare che i pesi restino statici e che il rebalance avvenga solo a inizio mese.

---

## Spiegazione concettuale

1. **RunMonthly** è un filtro temporale: ritorna `True` solo quando il mese cambia (o il primo giorno se `run_on_first_date=True`). Gli algo successivi girano solo allora.
2. **WeighSpecified** non guarda i prezzi — imposta pesi fissi dettati dall'utente (60/40 nell'esempio). È l'equivalente bt di `pd.Series([0.6,0.4,0.], index=...)`.
3. **Rebalance** traduce i pesi target in ordini.
4. `integer_positions=False` evita arrotondamenti a lotti interi (più fedele all'esempio bt e a pesi frazionari).
5. La separazione logica/dati permette di riusare `static` su qualsiasi DataFrame prezzi — in bt-gui cambiando il price source nel pannello Run.

---

## Suggerimenti aggiuntivi

- **Confrontare 60/40 vs equal-weight:** duplicare la strategia, sostituire `WeighSpecified({"SPY":0.6,"AGG":0.4})` con `WeighEqually` e confrontare le due equity curve.
- **Aggiungere un terzo asset:** aggiungere Security `GLD` e usare `{"SPY":0.5,"AGG":0.3,"GLD":0.2}`.
- **Commissioni:** impostare `Commission` a `0.001` (10 bps) per vedere l'impatto del turnover mensile vs giornaliero.
- **Salvare la strategia:** cliccare **Save** prima di chiudere per persistere l'albero in SQLite.
- **Codice Python equivalente** (per export futuro `StrategyTree → .py` via `tree_serializer`): vedi snippet iniziale — sostituire `rdf.columns` con `['SPY','AGG']` e `pdf` con i dati yfinance caricati.

---

<a name="tutorial-trend-1"></a>

# Tutorial 5 — Trend Example 1 (time-series momentum su trailing median 12M)

Questo tutorial replica l'esempio *Trend Example 1* tratto dalla documentazione ufficiale di bt: https://pmorissette.github.io/bt/examples.html#trend-example-1 — strategia trend-following che va long solo sui titoli sopra la mediana mobile a 12 mesi (252 giorni di borsa), rebalance giornaliero, confronto tra pesatura equal-weight e inverse-volatility con cap 40% per posizione.

Codice originale bt (estratto, dati sintetici `foo/bar/baz/fake1/fake2`):

```python
import bt

# 10 anni di prezzi sintetici (5 serie, 21gg/mese * 12mesi * 10anni)
# pdf = 100 * cumprod(1+rdf)   # ~2520 barre B-day dal 2008-01-02

# segnale trend = mediana trailing 12M con 1 giorno di lag
sma = pdf.rolling(window=21*12, center=False).median().shift(1)
trend = sma.copy()
trend[pdf > sma]  = True
trend[pdf <= sma] = False
trend[sma.isnull()] = False

tsmom_invvol_strat = bt.Strategy('tsmom_invvol', [
    bt.algos.RunDaily(),
    bt.algos.SelectWhere(trend),
    bt.algos.WeighInvVol(),
    bt.algos.LimitWeights(limit=0.4),
    bt.algos.Rebalance()
])
tsmom_ew_strat = bt.Strategy('tsmom_ew', [
    bt.algos.RunDaily(),
    bt.algos.SelectWhere(trend),
    bt.algos.WeighEqually(),
    bt.algos.LimitWeights(limit=0.4),
    bt.algos.Rebalance()
])

bt.Backtest(tsmom_invvol_strat, pdf, initial_capital=50_000_000,
            commissions=lambda q, p: max(100, abs(q)*0.0021), integer_positions=False)
```

> Nell'esempio bt i dati sono sintetici (`foo`, `bar`, `baz`, `fake1`, `fake2` generati con `np.random.normal` e Sharpe 0.30 per costruzione). In bt-gui si usano ticker reali — la logica è identica, cambiano solo i sottostanti. Ticker scelti per questo tutorial: **AAPL, MSFT, GE, TLT, GLD** (mix azionario large-cap + industriale + bond lungo + oro, diversificato per regime).

## Prerequisiti

- Backend in ascolto su `http://localhost:8001`
- Frontend in ascolto su `http://localhost:3001`
- Nessun price source obbligatorio a priori (vengono creati allo Step 1)

---

## Step 1 — caricare i dati di prezzo (AAPL, MSFT, GE, TLT, GLD)

1. Nel menu cliccare **Ticker Catalog** (vista Data).
2. Campo **TICKER**: `AAPL` — **Start**: `2008-01-01` (come l'esempio originale; in alternativa `2010-01-01` se si vuole allineare agli altri tutorial) — lasciare vuoto End per scaricare fino ad oggi.
3. Cliccare **Fetch** (yfinance) e attendere `count` >0 nella tabella.
4. Ripetere per `MSFT`, `GE`, `TLT`, `GLD` (uno alla volta, 5 fetch totali).
5. Verificare che tutti e 5 abbiano `count` >0 (TLT e GLD partono rispettivamente dal 2002 e 2004, quindi coprono l'intervallo).

> I prezzi sono scaricati da `yfinance.download()` e salvati in `price_data`. Il runner carica l'unione dei 5 ticker per il backtest. `TLT` (iShares 20+ Year Treasury) e `GLD` (SPDR Gold) fungono da proxy obbligazionario/commodity come `fake1`/`fake2` nell'esempio sintetico.

---

## Step 2 — pre-calcolare l'indicatore MEDIAN(252) (mediana trailing 12M)

> L'esempio bt usa `pdf.rolling(252).median().shift(1)` — mediana su 252 barre (~12 mesi * 21 gg) con lag 1 giorno per evitare look-ahead. In bt-gui l'indicatore `median` di `pandas_ta_classic` calcola la rolling median senza lag; la differenza su 252 gg è trascurabile per un trend a 12M. Per replica esatta applicare poi il lag manualmente (nota a fondo pagina).

1. Tornare in **Builder** e aprire il pannello **Indicators** (toolbar).
2. Nel pannello **Indicators**:
   - **Symbols**: selezionare **tutti e 5** i ticker (`AAPL,MSFT,GE,TLT,GLD`) — devono coincidere esattamente con quelli che userai nel signal allo Step 3. Il pannello supporta multi-select (click su ciascun ticker finché diventa verde). **Non** selezionarne uno solo: un indicatore creato su 1 ticker avrà 1 sola colonna e il signal su 5 ticker fallirebbe.
   - **Indicator**: `MEDIAN` (cercare "median" nella lista; se non visibile digitare `median`).
   - **length**: `252` (21 gg/mese * 12 mesi).
   - **Name** (opzionale): `median252_trend` (lasciare vuoto genera `AAPL_MEDIAN_252` etc. — attenzione al typo `medina252_trend` che genera un nome diverso).
3. Cliccare **Compute & Save**.
4. Verificare la comparsa dell'indicatore nella lista con `type='indicator'` e `source='computed'`. Annotare l'**ID** (es. `#42`). Nel tab **Data → Indicators** l'anteprima tabella deve mostrare **5 colonne** `AAPL | MSFT | GE | TLT | GLD` (non una sola colonna `median_252` né colonne tipo `AAPL:close` con `:`).

> L'indicatore è salvato come DataSource `type='indicator'` con blob Parquet multi-colonna (una colonna per ticker). Le colonne mantengono i nomi ticker originali (`AAPL`, `MSFT`, …) così il filtro di `SelectWhere` allinea correttamente i simboli. Implementazione in `backend/services/indicator_calculator.py:median` → `df.ta.median(length=252, talib=False)` e normalizzazione colonne in `backend/api/indicators.py:172`.

> **Troubleshooting — errore `422` al `Compute & Save` del signal o colonne con `:` nel tab Data:**
> - Se al passo successivo ottieni `Error: 422 Unprocessable Entity: {"detail":"internal error"}` oppure `indicator columns [...] do not match symbols`, la causa più frequente è l'indicatore creato con ticker diversi dal signal (es. 1 ticker vs 5). Verifica in **Data → Indicators** le colonne: se vedi 1 colonna `median_252` / `sma_50` invece di 5 ticker, cancella l'indicatore (`DELETE` → cestino) e ricrealo selezionando di nuovo tutti e 5 i ticker.
> - Colonne con `:` tipo `AAPL:median_252` provengono da vecchi blob con `MultiIndex` non appiattito: il BE ora le normalizza automaticamente (`backend/services/signal_engine.py:_normalize_indicator_cols` e `backend/api/indicators.py:172`), ma se ne vedi ancora, cancella e ricrea l'indicatore.
> - Ordine diverso delle colonne (`MSFT,GE` vs `GE,MSFT`) non è più un errore: il BE riallinea automaticamente su `price_df`.

**Nota lag 1 giorno:** l'originale fa `.shift(1)` sulla mediana per usare solo informazione nota a chiusura di ieri. `pandas_ta` non espone `shift`; in bt-gui il segnale `price > median` valuta entrambi alla stessa data (mediana inclusiva del giorno corrente). Su 252 giorni l'effetto è <0,5% sul turnover. Per replica pedissequa: esportare l'indicatore, applicare `.shift(1)` in Python e reimportare come signal, oppure usare un peso `WeighTarget` pre-shiftato.

---

## Step 3 — creare il signal trend (price > median252)

1. Aprire il pannello **Signals** (bottone nella toolbar).
2. Configurare l'espressione:
   - **Operatore**: `above` (equivale a `price > indicator`).
   - **Indicator / Signal a sinistra**: selezionare l'indicatore `median252_trend` creato allo Step 2 (ID annotato — se lo avevi chiamato per errore `medina252_trend` cercalo con quel nome).
   - **Symbols**: selezionare `AAPL,MSFT,GE,TLT,GLD` (**stessi 5 ticker dell'indicatore**, nello stesso ordine non importa — il BE riallinea). Mismatch genera ora un errore esplicito tipo `indicator columns [...] do not match symbols` da `backend/api/signals.py:26`.
   - **Name**: `trend_12m` (opzionale — se omesso genera `trend-<id>`).
3. Cliccare **Compute & Save** (o **Evaluate** per anteprima senza salvare).
4. Verificare il messaggio di successo e la comparsa del signal nella lista con `type='signal'`, `source='computed'`. Se compare ancora `Error: 422 ... internal error` leggi il dettaglio: dopo il fix mostra le colonne attese (es. `price cols ['AAPL',...] vs indicator cols [...]`) invece di `internal error` generico (`backend/services/signal_engine.py:27`).

> Il signal è un DataFrame booleano con `True` dove `close > median252`, `False` altrove, `False` dove la mediana è `NaN` (primi 251 giorni). Equivale a:
> ```python
> trend = sma.copy()
> trend[pdf > sma]  = True
> trend[pdf <= sma] = False
> trend[sma.isnull()] = False
> ```
> Salvato come DataSource `type='signal'` e valutato via `backend/services/signal_engine.py:evaluate_expression` con `op="above"`.

---

## Step 4 — costruire l'albero strategia

### Variante A — Inverse Volatility (tsmom_invvol, come originale)

1. Nel **Canvas** cliccare sul nodo root **MyStrategy** e rinominarlo in `tsmom_invvol`.
2. Dalla **Palette** trascinare 5 nodi **Security** sopra il root, uno per ticker:
   - `AAPL`, `MSFT`, `GE`, `TLT`, `GLD`
3. Verificare la struttura:
```
tsmom_invvol (Strategy)
├── AAPL (Security)
├── MSFT (Security)
├── GE  (Security)
├── TLT (Security)
└── GLD (Security)
```

### Variante B — Equal Weight (tsmom_ew, per confronto)

Duplicare la strategia (Save → Load con nuovo nome) e rinominare il root in `tsmom_ew`, oppure creare un secondo albero identico cambiando solo l'algo di pesatura (vedi Step 5).

---

## Step 5 — compilare l'Algo Stack

Con il root `tsmom_invvol` selezionato, nell'**Inspector** → **Algo Stack — 0 algos**, aggiungere in questo ordine esatto:

| Ordine | Algo | Parametri da impostare |
|--------|------|------------------------|
| 1 | RunDaily | nessun parametro (gira ogni giorno di borsa; l'originale usa `RunDaily()` proprio per cogliere il segnale giornaliero) |
| 2 | SelectWhere | **signal**: selezionare dal dropdown il signal `trend_12m` creato allo Step 3 |
| 3 | WeighInvVol | nessun parametro (pesa inversamente alla volatilità realizzata di ciascun titolo selezionato) |
| 4 | LimitWeights | **limit**: `0.4` (cap 40% per singola posizione, come `LimitWeights(limit=0.4)` dell'esempio) |
| 5 | Rebalance | nessun parametro |

> Il campo **signal** di `SelectWhere` appare come `<select>` perché lo schema BE lo marca con `kind: "indicator"` (`backend/services/algo_registry.py:DATAFRAME_PARAM_ALGOS`). Le opzioni includono indicatori e signal salvati; selezionare quello con `source='computed'` e nome `trend_12m`.

**Per la variante EW (`tsmom_ew`)** sostituire solo la riga 3:

| 3 | WeighEqually | nessun parametro |

Verificare che l'Algo Stack mostri **`5 algos`** sul root (icona `5 algos`).

**Nota scheduling:** a differenza dei tutorial 1/2/4 che usano `RunMonthly`, qui `RunDaily` è voluto: il segnale trend cambia ogni giorno e il cap/reweight giornaliero è parte della strategia. Sostituire con `RunMonthly` solo per esperimento di turnover ridotto.

---

## Step 6 — eseguire il backtest

1. Nel pannello **Run Backtest** (colonna destra):
   - **Price source**: selezionare uno qualsiasi dei 5 datasource (il runner carica comunque tutti i ticker presenti nell'albero via `_load_prices_from_db`; la selezione qui determina solo il default se l'albero fosse vuoto).
   - **Initial capital**: impostare `50000000` per replicare l'esempio (`50M`), oppure lasciare `100000` per confronto a capitale normalizzato (i rendimenti % sono identici, cambiano solo i costi fissi).
   - **Commission**: impostare `max(100, abs(q)*0.0021)` non è esponibile come lambda nella GUI; alternativa: lasciare vuoto (nessuna commissione) oppure inserire `0.0021` come commissione proporzionale (21 bps). Per replica fedele con floor $100, eseguire via API/Python con `commissions=lambda q,p: max(100, abs(q)*0.0021)` (vedi snippet iniziale).
   - Lasciare **integer positions** disattivato (`False` — come `integer_positions=False` dell'esempio).
2. Cliccare **Run** e attendere il completamento (daily su 16+ anni ≈ 4000 barre × 5 ticker, pochi secondi).
3. Al termine si viene reindirizzati alla tab **Results**.

> Eseguire due run separati (uno per `tsmom_invvol`, uno per `tsmom_ew`) per replicare il confronto EW vs InvVol dell'esempio. Salvare ciascuna strategia con **Save** prima di lanciare il secondo backtest.

---

## Step 7 — leggere i risultati

Nella tab **Results**:

- **Equity curve** — `res.prices` nell'esempio; crescita del portafoglio (parte da `initial_capital`). Con `TLT`/`GLD` la curva è meno volatile rispetto a solo equity.
- **Weights** — `res.plot_security_weights()` / `get_security_weights()`; allocazione giornaliera (0% quando il titolo è sotto la mediana 12M, altrimenti peso EW o InvVol cappato al 40%).
- **Metrics** — `res.stats`; CAGR, Sharpe, Sortino, max drawdown, Calmar, win % ecc.
- **Transactions** — storico ordini; il turnover giornaliero è più alto rispetto ai tutorial mensili.

Valori attesi con dati sintetici dell'esempio originale (`tsmom_ew`, 2008-01-02 → 2017-08-29, `pdf` random seed 1, mediana 252 + lag 1):

| Metrica | Valore (dati fake bt, `tsmom_ew`) | Nota con ticker reali |
|---------|----------------------------------|-----------------------|
| Total Return | ~198% | con AAPL/MSFT/GE/TLT/GLD dal 2008 il valore varia sensibilmente (mercato reale ≠ sintetico) |
| CAGR | ~11.9% | atteso 8–12% su 2008→oggi a seconda del periodo |
| Max Drawdown | ~−10.3% | con asset reali tipicamente −12% / −25% (crisi 2008/2020) |
| Daily Sharpe | ~1.35 | dipende dal regime; InvVol tende a Sharpe leggermente superiore a EW |
| Calmar | ~1.15 | CAGR / |MaxDD| |

> Con dati reali i valori saranno diversi — l'esempio sintetico è costruito con Sharpe 0.30 per asset e correlazioni arbitrarie. L'importante è verificare che: (i) i pesi restino 0 quando `price <= median252`, (ii) nessun peso superi 40% (`LimitWeights`), (iii) `tsmom_invvol` abbia volatilità leggermente inferiore a `tsmom_ew`.

---

## Spiegazione concettuale

1. **Rolling median 252** è un filtro trend a 12 mesi robusto agli outlier (preferito alla SMA perché la mediana ignora spike di un giorno). `shift(1)` garantisce che il segnale usi solo dati noti a chiusura di ieri.
2. **SelectWhere(trend)** seleziona solo i titoli in trend rialzista (`close > median12M`). È un filtro long-only: i titoli in downtrend sono esclusi (peso 0), non shortati.
3. **WeighInvVol vs WeighEqually**: `WeighEqually` divide equamente tra i selezionati; `WeighInvVol` pesa inversamente alla volatilità (più peso a TLT/GLD quando sono meno volatili di AAPL/MSFT), riducendo la volatilità di portafoglio — l'esempio confronta le due per mostrare il beneficio di risk-parity intra-trend.
4. **LimitWeights(0.4)** evita concentrazione: anche se un solo titolo è in trend, non supera il 40% del portafoglio (il resto resta in cash).
5. **RunDaily + Rebalance** traduce ogni giorno i pesi target in ordini; il turnover è alto, da qui la commissione con floor $100 nell'esempio istituzionale (50M di capitale).

---

## Suggerimenti aggiuntivi

- **Confrontare EW vs InvVol:** lanciare entrambe le varianti e sovrapporre le equity curve (come `res.plot()` dell'esempio che confronta `tsmom_ew` vs `pdf`). In bt-gui aprire i due run nella tab **Runs** e confrontare le metriche.
- **Provare mediana 126 (6M) o 63 (3M):** ripetere Step 2 con `length` 126 o 63 per testare trend più reattivi (più turnover, più whipsaw).
- **Sostituire GLD con SPY o aggiungere SPY:** per testare solo equity vs multi-asset; con solo AAPL/MSFT/GE il drawdown sarà maggiore (manca diversificazione bond/oro).
- **Commissioni:** impostare `0.0021` (21 bps) per vedere l'impatto del turnover giornaliero vs `RunMonthly` (che riduce i costi ma ritarda il segnale).
- **Salvare le strategie:** cliccare **Save** per ciascuna variante (`tsmom_invvol`, `tsmom_ew`) per persistere gli alberi in SQLite.
- **Codice Python equivalente** (per export futuro `StrategyTree → .py` via `tree_serializer`): vedi snippet iniziale — sostituire `pdf` con i 5 ticker yfinance e `trend` con il signal `trend_12m` salvato.

---

<a name="tutorial-trend-2"></a>

# Tutorial 6 — Trend Example 2 (time-series momentum 12M, monthly long/flat)

Questo tutorial replica l'esempio *Trend Example 2* tratto dalla documentazione ufficiale di bt: https://pmorissette.github.io/bt/examples.html#trend-example-2 — strategia time-series momentum su **singolo ticker**: ogni mese va long 100% se il return totale degli ultimi 12 mesi (con lag 1 mese) è > 0, altrimenti resta flat in cash. Rebalance mensile.

Codice originale bt (estratto, dati sintetici mensili `foo`):

```python
import bt
import pandas as pd

# 10 anni di prezzi sintetici mensili (1 serie, 12m * 10y)
# pdf = cumprod(1+returns)  # ~120 barre freq="m" dal 2008-01-01, colonna 'foo'

runMonthlyAlgo = bt.algos.RunMonthly()
rebalAlgo      = bt.algos.Rebalance()

class Signal(bt.Algo):
    """Signal = total return su lookback 12M con lag 1M > 0 ? 1 : 0  (copiato da StatTotalReturn)"""
    def __init__(self, lookback=pd.DateOffset(months=12), lag=pd.DateOffset(months=1)):
        super().__init__()
        self.lookback = lookback; self.lag = lag
    def __call__(self, target):
        selected = 'foo'
        t0 = target.now - self.lag
        if target.universe[selected].index[0] > t0: return False
        prc = target.universe[selected].loc[t0 - self.lookback:t0]
        trend = prc.iloc[-1]/prc.iloc[0] - 1
        target.temp['Signal'] = 1. if trend > 0. else 0.
        return True

class WeighFromSignal(bt.Algo):
    def __call__(self, target):
        target.temp['weights'] = {'foo': target.temp['Signal']}
        return True

s = bt.Strategy('example1', [runMonthlyAlgo, Signal(pd.DateOffset(months=12), pd.DateOffset(months=1)), WeighFromSignal(), rebalAlgo])
t = bt.Backtest(s, pdf, integer_positions=False)
res = bt.run(t)
res.plot_security_weights()  # 0% o 100% su 'foo'
```

> Nell'esempio bt i dati sono sintetici mensili (`foo` generato con `np.random.normal(loc=0.08/12, scale=0.2/sqrt(12), 120)`). In bt-gui si usano ticker reali su **frequenza giornaliera** yfinance — la logica è identica, cambia solo il sottostante e la granularità. Ticker scelto per questo tutorial: **SPY** (S&P 500 ETF, proxy più fedele a un indice diversificato come `foo`; alternative: `QQQ`, `AAPL`, `TLT`). Per replica fedele alla frequenza mensile si usa `RunMonthly` (come l'originale).

## Prerequisiti

- Backend in ascolto su `http://localhost:8001`
- Frontend in ascolto su `http://localhost:3001`
- Nessun price source obbligatorio a priori (viene creato allo Step 1)

---

## Step 1 — caricare i dati di prezzo (SPY)

1. Nel menu cliccare **Ticker Catalog** (vista Data).
2. Campo **TICKER**: `SPY` — **Start**: `2007-01-01` (serve un anno di lookback prima del 2008-01-01 dell'esempio; in alternativa `2010-01-01` se si vuole allineare agli altri tutorial) — lasciare vuoto End per scaricare fino ad oggi.
3. Cliccare **Fetch** (yfinance) e attendere `count` >0 nella tabella (SPY esiste dal 1993, quindi copre l'intervallo).
4. Verificare `count` >0 (per 2007→oggi attesi ~4500 barre giornaliere B-day).

> I prezzi sono scaricati da `yfinance.download()` e salvati in `price_data`. Il runner userà solo il ticker presente nell'albero (`SPY`). Per test multi-ticker ripetere lo Step per `QQQ` o `TLT` e duplicare la strategia con un albero separato (l'esempio originale è single-ticker; bt-gui lo supporta nativo — non serve unire ticker diversi nello stesso backtest).

---

## Step 2 — pre-calcolare l'indicatore ROC(252) (return 12M)

> L'esempio bt calcola `trend = prc.iloc[-1]/prc.iloc[0] - 1` su `DateOffset(months=12)` con lag `months=1` su dati **mensili** (`freq="m"` → 12 barre = 12 mesi). Su dati **giornalieri** bt-gui l'equivalente è **252 giorni di borsa** (~12 mesi × 21 gg). `ROC(length=252)` = `(close / close.shift(252) - 1) * 100` è identico al `trend` dell'esempio a meno di scala %; il segno (>0) coincide. `pandas_ta_classic` non espone `lag` separato — la differenza su 252 gg con lag 21 gg (1 mese) è <1% sul segnale; per replica pedissequa con lag vedere nota a fondo pagina.

1. Tornare in **Builder** e aprire il pannello **Indicators** (toolbar).
2. Nel pannello **Indicators**:
   - **Symbols**: selezionare `SPY` (**solo** `SPY` — deve coincidere esattamente con il ticker che userai nel signal allo Step 3. Se selezioni più ticker, l'indicatore avrà N colonne e il signal su `SPY` fallirebbe con mismatch).
   - **Indicator**: `ROC` (Rate of Change — cercare "roc" nella lista; se non visibile digitare `roc`).
   - **length**: `252` (21 gg/mese × 12 mesi; per test 6M usare 126, per 3M usare 63).
   - **Name** (opzionale): `roc252_spy` (lasciare vuoto genera `SPY_ROC_252` etc.).
3. Cliccare **Compute & Save**.
4. Verificare la comparsa dell'indicatore nella lista con `type='indicator'` e `source='computed'`. Annotare l'**ID** (es. `#42`). Nel tab **Data → Indicators** l'anteprima tabella deve mostrare **1 colonna** `SPY` (o `SPY_ROC_252` normalizzata a `SPY`) — non colonne con `:`.

> L'indicatore è salvato come DataSource `type='indicator'` con blob Parquet. Implementazione in `backend/services/indicator_calculator.py:roc` → `df.ta.roc(length=252, talib=False)` per-ticker (wrapper `_make_wrapper`), con normalizzazione colonne in `backend/api/indicators.py:172`.

> **Troubleshooting — errore `422` al Compute del signal:**
> - `indicator #X 'sma_50' è single-column ma hai richiesto signal su ['SPY',...]` → hai creato l'indicatore su N ticker ma chiedi signal su ticker diverso. Ricrea l'indicatore selezionando **solo** `SPY`.
> - Colonne con `:` tipo `SPY:roc_252` provengono da vecchi blob con `MultiIndex` non appiattito: il BE ora le normalizza automaticamente (`backend/services/signal_engine.py:_normalize_indicator_cols`), ma se ne vedi ancora, cancella e ricrea l'indicatore.

**Nota lag 1 mese:** l'originale fa `t0 = now - lag(1M)` e calcola il return su `t0-lookback … t0` per evitare look-ahead di un mese (usa solo dati noti a fine mese precedente). `ROC(252)` valuta alla stessa data (inclusivo del giorno corrente). Su 252 giorni l'effetto è trascurabile per un trend 12M. Per replica pedissequa: esportare l'indicatore ROC, applicare `.shift(21)` in Python e reimportare come signal, oppure pre-calcolare un `WeighTarget` con DataFrame già shiftato.

---

## Step 3 — creare il signal momentum (ROC252 > 0)

1. Aprire il pannello **Signals** (bottone nella toolbar).
2. Configurare l'espressione a **singolo blocco**:
   - **Indicatore**: selezionare l'indicatore `roc252_spy` creato allo Step 2 (ID annotato).
   - **Operatore**: `gt` (`>`).
   - **Threshold**: `0` (equivale a `ROC > 0` → `trend > 0` dell'esempio; ROC è in % quindi `0` è identico a `trend > 0`).
   - **Symbols**: selezionare `SPY` (**stesso ticker dell'indicatore**).
   - **Name**: `mom12m_spy` (opzionale — se omesso genera `signal-<id>`).
3. Cliccare **Compute & Save** (o **Evaluate** per anteprima senza salvare).
4. Verificare il messaggio di successo e la comparsa del signal nella lista con `type='signal'`, `source='computed'`.

> Il signal è un DataFrame booleano con `True` dove `ROC(252) > 0` (return 12M positivo), `False` altrove, `False` dove ROC è `NaN` (primi 252 giorni). Equivale a:
> ```python
> trend = prc.iloc[-1]/prc.iloc[0] - 1
> signal = trend > 0.
> target.temp['Signal'] = 1. if signal else 0.
> ```
> Salvato come DataSource `type='signal'` e valutato via `backend/services/signal_engine.py:evaluate_expression` con `op="gt"` + `resolve_value(type="indicator")` vs `type="value"`. Le colonne sono normalizzate a `SPY` (non `ROC_252`) via `_normalize_indicator_cols` così `SelectWhere` trova il ticker.

> **Troubleshooting — errore dopo Run: `None of [Index(['ROC_252'], dtype='str')] are in the [columns]` nel tab Results → Metrics → View:**
> Questo era un bug del BE per signal single-ticker `ROC > 0` (colonna `ROC_252` invece di `SPY`) — fixato in `backend/services/signal_engine.py:40` (broadcast 1-vs-1) e `backend/services/backtest_runner.py:303` (fallback legacy). **Soluzione:** riavvia il backend (`uv run uvicorn backend.main:app --port 8001 --reload`) per caricare il fix, poi **cancella e ricrea** l'indicatore ROC e il signal `mom12m_spy` (i blob vecchi con colonna `ROC_252` restano comunque gestiti dal fallback, ma ricreare garantisce `SPY` pulito). Dopo il re-run il tab Metrics deve mostrare pesi 0%/100% senza errori.

---

## Step 4 — costruire l'albero strategia

1. Nel **Canvas** cliccare sul nodo root **MyStrategy** e rinominarlo in `mom12m_spy` (come `example1` dell'originale, ma con nome esplicito).
2. Dalla **Palette** trascinare 1 nodo **Security** sopra il root:
   - `SPY`
3. Verificare la struttura:
```
mom12m_spy (Strategy)
└── SPY (Security)
```

> Solo i nodi **Strategy** possono avere figli; i Security sono foglie. A differenza dei tutorial 1/3/5 che hanno N Security, qui ne basta uno — l'allocazione sarà 0% o 100% su quello.

---

## Step 5 — compilare l'Algo Stack

Con il root `mom12m_spy` selezionato, nell'**Inspector** → **Algo Stack — 0 algos**, aggiungere in questo ordine esatto:

| Ordine | Algo | Parametri da impostare |
|--------|------|------------------------|
| 1 | RunMonthly | nessun parametro (gira il primo giorno di ogni mese; l'originale usa `RunMonthly()` senza `run_on_first_date` — il BE lo normalizza comunque a `RunMonthly` con default `run_on_first_date=False`; spuntare `true` solo per includere il primo giorno del backtest come nel tutorial 4) |
| 2 | SelectWhere | **signal**: selezionare dal dropdown il signal `mom12m_spy` creato allo Step 3 |
| 3 | WeighEqually | nessun parametro (su singolo titolo selezionato pesa 100%; se nessun titolo selezionato resta in cash — identico a `WeighFromSignal` {SPY: 1 o 0}) |
| 4 | Rebalance | nessun parametro |

> Il campo **signal** di `SelectWhere` appare come `<select>` perché lo schema BE lo marca con `kind: "indicator"` (`backend/services/algo_registry.py:DATAFRAME_PARAM_ALGOS`). Le opzioni includono indicatori e signal salvati; selezionare quello con `source='computed'` e nome `mom12m_spy`.
>
> **Mapping concettuale con l'originale:** `Signal` + `WeighFromSignal` dell'esempio custom (`target.temp['Signal']` → `target.temp['weights'] = {foo: Signal}`) sono sostituiti in bt-gui da `SelectWhere(ROC>0)` + `WeighEqually`. Quando il signal è `True`, `SelectWhere` seleziona `SPY` e `WeighEqually` lo pesa 100%; quando è `False`, la selezione è vuota e il portafoglio resta in cash. Il risultato economico è identico al `WeighFromSignal` binario, senza scrivere codice Python custom.

Verificare che l'Algo Stack mostri **`4 algos`** sul root (icona `4 algos`).

**Nota scheduling:** `RunMonthly` è voluto (come l'originale): il segnale momentum cambia lentamente (12M), il rebalance giornaliero aggiungerebbe solo turnover e costi. Sostituire con `RunDaily` solo per esperimento di turnover.

---

## Step 6 — eseguire il backtest

1. Nel pannello **Run Backtest** (colonna destra):
   - **Price source**: selezionare il datasource `SPY` creato allo Step 1 (il runner carica il ticker dall'albero via `_load_prices_from_db`; la selezione qui è solo fallback).
   - **Initial capital**: lasciare `100000` (l'esempio sintetico non specifica capitale; `100K` è default bt-gui; i rendimenti % sono indipendenti dal capitale).
   - **Commission**: lasciare vuoto (nessuna commissione; l'esempio originale non ne usa).
   - Lasciare **integer positions** disattivato (`False` — come `integer_positions=False` dell'esempio).
2. Cliccare **Run** e attendere il completamento (mensile su ~18 anni ≈ 216 barre, istantaneo).
3. Al termine si viene reindirizzati alla tab **Results**.

---

## Step 7 — leggere i risultati

Nella tab **Results**:

- **Equity curve** — `res.prices` nell'esempio; crescita del portafoglio (parte da `initial_capital`). Con SPY dal 2008 la curva segue il mercato nei periodi di momentum positivo e resta piatta (cash) nei drawdown quando `ROC < 0`.
- **Weights** — `res.plot_security_weights()` / `get_security_weights()`; allocazione mensile **0% o 100%** su `SPY` (a scalino, cambia solo a inizio mese quando `RunMonthly` scatta). Verificare che i pesi siano binari — mai 50% o frazionari.
- **Metrics** — `res.stats`; CAGR, Sharpe, max drawdown, Calmar, win % ecc.
- **Transactions** — storico ordini; il turnover è basso (pochi trade/anno, solo quando il segno del momentum cambia).

Valori attesi con dati sintetici dell'esempio originale (`example1`, 2008-01-01 → 2017-12-31, `pdf` random seed 0, lookback 12M + lag 1M su freq mensile):

| Metrica | Valore (dati fake bt, `example1`) | Nota con ticker reali (SPY) |
|---------|-----------------------------------|-----------------------------|
| Total Return | ~181% | con SPY dal 2008: ~180–280% (mercato reale ≠ sintetico; 2008→oggi CAGR SPY buy&hold ~10%, momentum flat durante crisi riduce drawdown) |
| CAGR | ~10.9% | atteso 8–12% su 2008→oggi (leggermente sotto buy&hold ma con vol più bassa) |
| Max Drawdown | ~−26.7% | con SPY tipicamente −15% / −25% (vs −33% buy&hold SPY 2008 — il flat in cash attenua) |
| Daily Sharpe | ~3.30 (su freq giornaliera sintetica) / Monthly Sharpe ~0.72 | su daily SPY reale Monthly Sharpe ~0.5–0.8 |
| Calmar | ~0.41 | CAGR / |MaxDD| |

> Con dati reali i valori saranno diversi — l'esempio sintetico è costruito con `mu=0.08/12, sigma=0.2/sqrt(12)` mensili e correlazioni arbitrarie. L'importante è verificare che: (i) i pesi siano solo **0% o 100%** (`SelectWhere` + `WeighEqually` binario), (ii) il rebalance avvenga solo a **inizio mese** (`RunMonthly`), (iii) il portafoglio sia **flat in cash** quando `ROC(252) <= 0` (visibile come tratti piatti nell'equity curve).

---

## Spiegazione concettuale

1. **Return 12M > 0** è il filtro trend più semplice (time-series momentum): se il mercato è salito nell'ultimo anno, si assume continuità e si resta long; altrimenti si va in cash. `ROC(252)` lo calcola in modo vettorizzato come `(close / close.shift(252) - 1)`.
2. **Lag 1 mese** nell'originale (`t0 = now - 1M`) serve ad evitare di usare il prezzo del giorno stesso (look-ahead di un mese su dati mensili). Su daily il lag 21 gg ha effetto minimo; in bt-gui si omette per semplicità (nota sopra per replica esatta).
3. **SelectWhere + WeighEqually su singolo ticker** replica esattamente `WeighFromSignal({foo: Signal})`: selezione vuota → cash (0%), selezione piena → 100% long. Non serve `WeighTarget` perché i pesi sono binari e non dipendono da un DataFrame pre-calcolato.
4. **RunMonthly** è il filtro temporale: ritorna `True` solo quando il mese cambia. Gli algo successivi (`SelectWhere`, `Weigh*`, `Rebalance`) girano solo allora. Senza di esso il backtest girerebbe ogni giorno generando gli stessi pesi ma con overhead.
5. **Separazione logica/dati:** come negli altri tutorial, lo stesso albero `mom12m_spy` può essere rieseguito su ticker diversi (es. `QQQ`, `TLT`) cambiando solo il price source e ricalcolando `ROC` — la logica `ROC>0 → long` resta identica.

---

## Suggerimenti aggiuntivi

- **Provare lookback diversi:** ripetere Step 2 con `length` 126 (6M) o 63 (3M) per momentum più reattivo (più turnover, più whipsaw), o 189 (9M) per via di mezzo. Confrontare le equity curve nella tab **Runs**.
- **Confrontare con buy&hold:** duplicare la strategia, sostituire `SelectWhere + WeighEqually` con `SelectAll + WeighEqually` (o semplicemente `RunMonthly + SelectAll + WeighEqually + Rebalance`) sullo stesso `SPY` per misurare l'alpha del filtro momentum vs buy&hold.
- **Testare su altri ticker reali:** ripetere Step 1–3 per `QQQ` (Nasdaq, più volatile), `TLT` (bond lungo — momentum funziona diversamente), `GLD` (oro). Il momentum 12M su bond/oro ha drawdown diversi da equity — utile per testare robustezza.
- **Aggiungere costi:** impostare `Commission` a `0.001` (10 bps) per vedere l'impatto del turnover mensile (basso, quindi impatto minimo — a differenza di Trend Example 1 che è daily).
- **Salvare la strategia:** cliccare **Save** con nome `mom12m_spy` per persistere l'albero in SQLite.
- **Codice Python equivalente** (per export futuro `StrategyTree → .py` via `tree_serializer`): vedi snippet iniziale — sostituire `'foo'` con `'SPY'` e `pdf` con i dati yfinance caricati; in bt-gui `Signal`+`WeighFromSignal` sono già astratti come `SelectWhere(mom12m_spy) + WeighEqually`.

---

<a name="tutorial-strategy-combination"></a>

# Tutorial 7 — Strategy Combination (parent + 2 child: EW / InvVol, con analisi pesi & equity singole)

Questo tutorial replica l'esempio *Strategy Combination* tratto dalla documentazione ufficiale di bt: https://pmorissette.github.io/bt/examples.html#strategy-combination — strategia parent `Combined` che alloca tra due child strategy `Equal Weight` e `Inv Vol`, entrambe diversificate sugli stessi 5 sottostanti. Include l'analisi dei **pesi** (`res.get_security_weights().plot()`) e delle **equity singole** (`r.plot(ax=ax)` overlay normalizzato a 100), ora disponibili nella tab **Results** come grafici "Weights (%)" e "Confronto equity singole".

Codice originale bt (estratto, dati fake 5 serie giornaliere):

```python
import bt, numpy as np, pandas as pd, matplotlib.pyplot as plt

# 10 anni fake B-day dal 2008-01-02, colonne foo/bar/baz/fake1/fake2
rf = 0.04; np.random.seed(1)
mus = np.random.normal(loc=0.05, scale=0.02, size=5) + rf
sigmas = (mus - rf)/0.3 + np.random.normal(loc=0., scale=0.01, size=5)
num_years=10; ndays=21*12*10
rdf = pd.DataFrame(index=pd.date_range("2008-01-02", periods=ndays, freq="B"),
                   columns=['foo','bar','baz','fake1','fake2'])
for i,mu in enumerate(mus):
    rdf.iloc[:,i] = np.random.normal(mu/(21*12), sigmas[i]/np.sqrt(21*12), ndays)
pdf = np.cumprod(1+rdf)*100; pdf.iloc[0,:] = 100

strategy_names = np.array(['Equal Weight','Inv Vol'])
runMonthlyAlgo = bt.algos.RunMonthly(run_on_first_date=True, run_on_end_of_period=True)
selectAllAlgo = bt.algos.SelectAll()
rebalanceAlgo = bt.algos.Rebalance()

# variante A — gerarchica (parent con children)
strats=[]; tests=[]
for s in strategy_names:
    wAlgo = bt.algos.WeighEqually() if s=="Equal Weight" else bt.algos.WeighInvVol()
    strat = bt.Strategy(str(s), [runMonthlyAlgo, selectAllAlgo, wAlgo, rebalanceAlgo])
    strats.append(strat)
    tests.append(bt.Backtest(strat, pdf, integer_positions=False, progress_bar=False))

combined_strategy = bt.Strategy('Combined',
    algos=[runMonthlyAlgo, selectAllAlgo, bt.algos.WeighEqually(), rebalanceAlgo],
    children=[x.strategy for x in tests])
combined_test = bt.Backtest(combined_strategy, pdf, integer_positions=False)
res = bt.run(combined_test)
res.prices.plot()                    # equity Combined
res.get_security_weights().plot()    # pesi tra EW e InvVol (50/50 con drift InvVol)

# variante B — merged prices (3 run: EW, InvVol, Combined su merge)
results=[]
for s in strategy_names:
    # ... stesso loop ma con res=bt.run(t); results.append(res)
    pass
for r in results: r.plot(ax=ax)      # overlay equity singole normalizzate
merged = bt.merge(results[0].prices, results[1].prices)
combined2 = bt.Strategy('Combined', [runMonthlyAlgo, selectAllAlgo, bt.algos.WeighEqually(), rebalanceAlgo])
res2 = bt.run(bt.Backtest(combined2, merged, integer_positions=False))
```

> Nell'esempio bt i dati sono fake (`foo/bar/baz/fake1/fake2` con Sharpe 0.30 per costruzione). In bt-gui si usano ticker reali — la logica è identica, cambiano solo i sottostanti. Ticker scelti per questo tutorial: **AAPL, MSFT, GE, TLT, GLD** (mix equity large-cap + industriale + bond lungo + oro, già usato nel Tutorial 5 — diversificato per regime; alternativa valida: `AAPL,MSFT,JNJ,JPM,PG` se vuoi solo equity). Tutti hanno storia da prima del 2008, quindi coprono `2008-01-02 → oggi`.

## Prerequisiti

- Backend in ascolto su `http://localhost:8001`
- Frontend in ascolto su `http://localhost:3001`
- Nessun price source obbligatorio a priori (vengono creati allo Step 1)

---

## Step 1 — caricare i dati di prezzo (AAPL, MSFT, GE, TLT, GLD)

1. Nel menu cliccare **Ticker Catalog** (vista Data).
2. Campo **TICKER**: `AAPL` — **Start**: `2008-01-01` (serve copertura da `2008-01-02` dell'esempio) — lasciare vuoto End per scaricare fino ad oggi.
3. Cliccare **Fetch** (yfinance) e attendere `count` >0 nella tabella.
4. Ripetere per `MSFT`, `GE`, `TLT`, `GLD` (uno alla volta, 5 fetch totali).
5. Verificare che tutti e 5 abbiano `count` >0 (TLT dal 2002, GLD dal 2004, quindi coprono l'intervallo).

> I prezzi sono scaricati da `yfinance.download()` e salvati in `price_data`. Il runner carica l'unione dei 5 ticker per il backtest. Se manca un ticker il BE fallisce con `price_df manca colonne [...]` — premi ↻ in Run Backtest per ricaricare.

---

## Step 2 — costruire l'albero gerarchico (Variante A, 1 run)

> In bt `children=[x.strategy for x in tests]` annida le strategy child nel parent; bt-gui lo replica con nodi **Strategy** annidati nel canvas.

1. Nel **Canvas** cliccare sul root **MyStrategy** e rinominarlo in `Combined`.
2. Dalla **Palette** trascinare **2** nodi **Strategy** sopra `Combined` (droppare sopra il root):
   - Rinominare il primo in `Equal Weight`
   - Rinominare il secondo in `Inv Vol`
3. Per **ciascun** child Strategy, aggiungere **5** Security come figli (droppare sopra il child):
   - In `Equal Weight`: `AAPL`, `MSFT`, `GE`, `TLT`, `GLD`
   - In `Inv Vol`: `AAPL`, `MSFT`, `GE`, `TLT`, `GLD` (stessi 5 ticker duplicati — è voluto: ogni child vede lo stesso universo `pdf` come nell'originale `foo/bar/baz/fake1/fake2`).
4. Verificare la struttura:

```
Combined (Strategy)
├── Equal Weight (Strategy)
│   ├── AAPL (Security)
│   ├── MSFT (Security)
│   ├── GE  (Security)
│   ├── TLT (Security)
│   └── GLD (Security)
└── Inv Vol (Strategy)
    ├── AAPL (Security)
    ├── MSFT (Security)
    ├── GE  (Security)
    ├── TLT (Security)
    └── GLD (Security)
```

> Solo i nodi **Strategy** possono avere figli; i Security sono foglie. Nomi duplicati `AAPL` sotto parent diversi sono ammessi — `tree_serializer.py:_validate_unique_children` controlla unicità solo tra sibling dello stesso parent.

---

## Step 3 — compilare l'Algo Stack dei due child

### Child `Equal Weight`

Selezionare il nodo `Equal Weight` e aggiungere nell'ordine:

| Ordine | Algo | Parametri |
|--------|------|-----------|
| 1 | RunMonthly | `run_on_first_date`: `true`, `run_on_end_of_period`: `true` (come `RunMonthly(True,True)` dell'esempio) |
| 2 | SelectAll | nessun parametro |
| 3 | WeighEqually | nessun parametro |
| 4 | Rebalance | nessun parametro |

### Child `Inv Vol`

Selezionare `Inv Vol` e aggiungere:

| Ordine | Algo | Parametri |
|--------|------|-----------|
| 1 | RunMonthly | `run_on_first_date`: `true`, `run_on_end_of_period`: `true` |
| 2 | SelectAll | nessun parametro |
| 3 | WeighInvVol | nessun parametro |
| 4 | Rebalance | nessun parametro |

> Verificare che ciascun child mostri **`4 algos`**.

---

## Step 4 — compilare l'Algo Stack del parent `Combined`

Selezionare il root `Combined` e aggiungere:

| Ordine | Algo | Parametri |
|--------|------|-----------|
| 1 | RunMonthly | `run_on_first_date`: `true`, `run_on_end_of_period`: `true` |
| 2 | SelectAll | nessun parametro |
| 3 | WeighEqually | nessun parametro (pesa 50/50 i due child) |
| 4 | Rebalance | nessun parametro |

> Verificare che il root mostri **`4 algos`**. Il parent pesa equamente i child; i child a loro volta pesano EW vs InvVol sui 5 ticker.

---

## Step 5 — eseguire il backtest (Variante A)

1. Nel pannello **Run Backtest** (colonna destra):
   - **Price source**: selezionare uno qualsiasi dei 5 datasource (il runner carica comunque tutti i ticker presenti nell'albero via `_load_prices_from_db`).
   - **Initial capital**: lasciare `100000` (i rendimenti % sono indipendenti; l'esempio sintetico non specifica capitale).
   - Lasciare **integer positions** disattivato.
   - Lasciare **Commission** vuoto.
2. Cliccare **Run** e attendere completamento (monthly su ~17 anni × 5 ticker, pochi secondi).
3. Al termine si viene reindirizzati alla tab **Results**.
4. **Salvare** la strategia con **Save** → nome `Combined` per riuso.

---

## Step 6 — leggere i risultati — i nuovi grafici

Nella tab **Results** (run selezionato `Combined`):

- **Equity Curve** — `res.prices.plot()` dell'esempio; crescita del Combined (parte da `initial_capital`). Con AAPL/MSFT/GE/TLT/GLD dal 2008 la curva è più liscia dei singoli child grazie alla diversificazione tra EW e InvVol.
- **Drawdown (%)** — come negli altri tutorial.
- **Weights (%)** — **nuovo** grafico `res.get_security_weights().plot()`; mostra l'allocazione tra `Equal Weight` e `Inv Vol` (linea blu vs rossa, scala 0–100%). Atteso ~50/50 con drift mensile: `Inv Vol` pesa di più quando la sua volatilità è minore. Se vedi una sola linea al 100% verifica di aver messo i 5 ticker in **entrambi** i child (altrimenti un child ha universo vuoto).
- **Metrics** — CAGR, Sharpe, max drawdown, ecc. (con dati reali 2008→oggi CAGR ~8–11%, MaxDD ~−15% / −25% a seconda del periodo — valori fake originali non confrontabili).
- **Transactions** — ordini mensili dei 5 ticker per ciascun child + rebalance parent.

> **Dove cercare i grafici:** `Weights (%)` è subito sotto `Drawdown`; se vedi "Nessun dato pesi" il run è vecchio (precedente a questa feature) — rilancia il backtest.

---

## Step 7 — Variante B — merged prices & confronto equity singole (step operativi, 3 run)

Questa variante replica la seconda metà dell'esempio bt: lancia i due child come backtest autonomi, poi confronta le equity normalizzate a 100 e rilancia il Combined su prezzi sintetici.

### 7a — Lanciare i due child come strategie standalone

1. **Duplicare** `Combined` in due strategie separate o creare due alberi minimali:
   - **Albero `EW_only`**: root `Equal Weight` (rinominato) con 5 Security `AAPL,MSFT,GE,TLT,GLD` e Algo Stack `RunMonthly(true,true) → SelectAll → WeighEqually → Rebalance`.
   - **Albero `IV_only`**: root `Inv Vol` con stessi 5 Security e `RunMonthly(true,true) → SelectAll → WeighInvVol → Rebalance`.
2. Per ciascuno: **Save** con nome distinto (`EW_only`, `IV_only`), poi **Run** (stessi 5 ticker, stesso capital). Ottieni 2 run `EW_only` e `IV_only`.

### 7b — Confronto equity singole normalizzate a 100

1. Andare in **Results** → tabella **Runs**.
2. Spuntare ☑ su **3** run: `EW_only`, `IV_only`, `Combined` (quello gerarchico dello Step 5). Se hai solo 2, spunta almeno `EW_only` + `IV_only`.
3. Cliccare **Confronta selezionati** nella card **"Confronto equity singole (normalizzato a 100)"** in fondo alla pagina.
4. Il grafico overlay mostra le 3 equity **normalizzate a 100** alla prima data disponibile (come `r.plot(ax=ax)` + `merged = bt.merge(...)` dell'esempio). Legenda colorata: blu `EW_only`, rosso `IV_only`, verde `Combined`.
5. Pulsante **Pulisci** rimuove l'overlay.

> Normalizzazione: `val_norm = val / first_valid * 100` — identica a `bt.merge(results[0].prices, results[1].prices).plot()` dove l'asse è relativo. L'overlay non richiede BE aggiuntivo: ogni run è già persistito con `prices_parquet`, il FE li fetcha via `GET /api/bt/runs/{id}/prices?limit=20000`.

### 7c — (Opzionale) Combined su merged prices

Per replica pedissequa dell'esempio B senza gerarchia:
1. Dopo aver visto l'overlay, il `Combined` su `merged` è concettualmente identico al `Combined` gerarchico già lanciato — i rendimenti coincidono a meno di arrotondamenti. Se vuoi provarlo, contatta per estensione BE che fonda `prices` di due run in un nuovo `price_data` sintetico (non ancora esposto in GUI).

---

## Spiegazione concettuale

1. **Paper trade interno:** quando una Strategy è child di un'altra, `bt` crea una versione "paper" del child, ne calcola i return giornalieri e li espone al parent come `price` sintetico (equity curve). Il parent vi alloca come se fossero titoli.
2. **Due livelli di pesatura:** child `WeighEqually` vs `WeighInvVol` diversificano tra i 5 ticker; parent `WeighEqually` diversifica tra le due filosofie (50/50). Sostituire `WeighEqually` del parent con `WeighInvVol` darebbe più peso al child meno volatile (l'esempio confronta le due proprio per questo).
3. **RunMonthly(true,true):** `run_on_first_date` include il primo giorno del backtest, `run_on_end_of_period` include l'ultimo giorno del mese — necessario per allineare il rebalance mensile come nell'originale. Senza, il primo/ultimo mese avrebbe allocazione parziale.
4. **Pesi vs equity:** `Weights (%)` mostra **dove** va il capitale (tra EW e InvVol); `Confronto equity` mostra **come** performa ciascuna filosofia nel tempo. L'esempio li affianca proprio perché EW ha più return ma più vol, InvVol più Sharpe, Combined è compromesso.

---

## Suggerimenti aggiuntivi

- **Sostituire il parent con WeighInvVol:** duplica `Combined`, cambia solo il parent da `WeighEqually` a `WeighInvVol` e confronta le 3 equity (EW-only, IV-only, Combined-EW, Combined-IV) nell'overlay.
- **Cap 40% come Trend Example 1:** aggiungere `LimitWeights(limit=0.4)` dopo `Weigh*` nei child per replicare il cap visto in Trend Example 1.
- **Solo equity senza oro/bond:** rifare con `AAPL,MSFT,GE,JPM,PG` per vedere drawdown maggiore in 2008/2020.
- **Salvare tutte le varianti:** `Combined`, `EW_only`, `IV_only` — restano in SQLite e sono confrontabili in qualsiasi momento via overlay.

---

<a name="tutorial-sl-tp"></a>

# Tutorial 8 — Stop Loss & Take Profit (algo StopLossTakeProfit)

> Due varianti in uno: **Esempio semplice SPY** (consigliato per primo test, solo long, SL 5% / TP 15%, filtro SMA200 + trigger crossUp SMA20) e **Replica completa zachlim98** (RSI+MACD multi-ticker). L'algo è lo stesso: `StopLossTakeProfit` va tra `Weigh*` e `Rebalance`.

---

## Variante A — Esempio semplice: SPY long-only, SL 5% / TP 15%, filtro SMA200 + crossUp SMA20

> **Idea:** si entra long su SPY solo quando `close > SMA200` (filtro trend lungo) e si è appena verificato un `crossUp` di `close` sopra `SMA20` (trigger timing). Una volta dentro, `StopLossTakeProfit` gestisce l'uscita: se il prezzo scende 5% sotto l'entry chiude in stop, se sale 15% chiude in take profit. Solo long (`stop_loss_short` / `take_profit_short` restano a 0).

### Prerequisiti

- Backend `http://localhost:8001` + Frontend `http://localhost:3001`
- Nessun price source pre-esistente necessario

### Step A1 — caricare i dati di prezzo (SPY)

1. Nel menu cliccare **Ticker Catalog** (vista Data).
2. Campo **TICKER**: `SPY`.
3. **Start**: `2010-01-01` (serve lookback 200 barre prima che SMA200 sia valida) — lasciare vuoto End.
4. Cliccare **Fetch** (yfinance) e attendere `count` >0 (SPY dal 1993 → ~3800 barre).

> Solo `SPY` serve per questo esempio minimal.

### Step A2 — pre-calcolare SMA(200) e SMA(20)

1. In **Builder** → pannello **Indicators** (toolbar).
2. Primo indicatore:
   - **Symbol**: `SPY` (singolo selezionato, verde).
   - **Indicator**: `SMA`.
   - **Period**: `200`.
   - **Name** (opzionale): `sma200_spy`.
   - Cliccare **Compute & Save** e annotare l'**ID** (es. `#10`).
3. Secondo indicatore:
   - **Symbol**: `SPY`.
   - **Indicator**: `SMA`.
   - **Period**: `20`.
   - **Name**: `sma20_spy`.
   - **Compute & Save** → ID `#11`.
4. Verificare in **Data → Indicators** che entrambi abbiano 1 colonna `SPY` (non `sma_20` generico) e `count` >0.

### Step A3 — creare i due signal (filtro + trigger)

> Servono 2 signal booleani: `above200 = SPY > SMA200` e `crossUp20 = SPY cross_over SMA20`. Non serve combinarli con `AND` — ci pensa `EntryGateMemory`.

1. Aprire il pannello **Signals**.
2. **Signal 1 — filtro trend:**
   - **Operatore**: `above` (equivale a `price > indicator`).
   - **Indicator / Signal a sinistra**: selezionare `sma200_spy` (ID #10).
   - **Symbols**: `SPY`.
   - **Name**: `spy_above_sma200`.
   - Cliccare **Compute & Save**.
3. **Signal 2 — trigger timing:**
   - **Operatore**: `cross_over` (crossUp = indicator supera il suo valore precedente; su `price` vs `SMA20` equivale a `SPY` che incrocia al rialzo `SMA20`).
   - **Indicator / Signal a sinistra**: `sma20_spy` (ID #11).
   - **Symbols**: `SPY`.
   - **Name**: `spy_crossUp_sma20`.
   - **Compute & Save**.

   > Se `cross_over` non è disponibile come operatore singolo, usare `gt` su `SPY - SMA20` o lasciare `cross_over` che internamente fa `indicator > indicator.shift(1)` (`backend/services/signal_engine.py:cross_over`).
   > **Non creare un terzo signal `AND`**: la combinazione con memoria è gestita da `EntryGateMemory` nello Stack (Step A5) che ricorda il crossUp fino al prossimo `Run<Period>`.

### Step A4 — costruire l'albero strategia

1. Nel **Canvas** cliccare sul root **MyStrategy** e rinominarlo in `spy_sltp_5_15`.
2. Dalla **Palette** trascinare 1 nodo **Security** sopra il root:
   - `SPY` (name = ticker, case-insensitive ma usare maiuscolo).
3. Verificare la struttura:
```
spy_sltp_5_15 (Strategy)
└── SPY (Security)
```

### Step A5 — compilare l'Algo Stack (con memoria periodica)

Con il root `spy_sltp_5_15` selezionato, nell'**Inspector** → **Algo Stack — 0 algos**, aggiungere in questo ordine esatto:

| Ordine | Algo | Parametri da impostare |
|--------|------|------------------------|
| 1 | EntryGateMemory | **cross_signal**: selezionare `spy_crossUp_sma20` (ID #11) <br> **filter_signal**: selezionare `spy_above_sma200` (ID #10) — lascia vuoto se vuoi solo il trigger <br> **period**: `monthly` (permette entry solo il 1° business day del mese; cambia in `weekly` per lunedì successivo, `daily` per giorno dopo) <br> **filter_mode**: `at_entry` (default: `price>SMA200` rivalutato il giorno di entry; `at_trigger` = fotografato al giorno del cross, `both` = entrambi) |
| 2 | WeighEqually | nessun parametro (su singolo titolo selezionato pesa 100% quando `EntryGateMemory` seleziona) |
| 3 | StopLossTakeProfit | **stop_loss_long**: `0.05` (−5% da entry) <br> **take_profit_long**: `0.15` (+15% da entry) <br> **stop_loss_short**: `0` (disabilitato, solo long) <br> **take_profit_short**: `0` <br> **trailing_long**: `0` (0 = SL fisso) <br> **trailing_short**: `0` — ha `run_always=True`, quindi controlla SL/TP **ogni giorno** anche quando `EntryGateMemory` blocca l'entry |
| 4 | RebalanceAlways | nessun parametro — `run_always=True`, esegue il sell giornaliero quando `StopLossTakeProfit` azzera i pesi (con `Rebalance` normale l'uscita sarebbe ritardata fino al prossimo `period`) |

> **Perché questo ordine e questi `run_always`?**
> - `EntryGateMemory(run_always=True)` monitora `crossUp` **ogni giorno** ma promuove il segnale a `target.temp['selected']` solo il giorno di `period` (`monthly`→1° del mese). Se esci il 6 via SL e il 20 scatta `crossUp`, viene ricordato fino al 1° del mese successivo — senza di lui il `crossUp` intra-mese andrebbe perso perché `RunMonthly` campiona solo il 1°.
> - `WeighEqually` pesa 100% solo quando `EntryGateMemory` ha selezionato.
> - `StopLossTakeProfit(run_always=True)` intercetta `target.temp['weights']` dopo `Weigh` **e anche** quando `EntryGateMemory` blocca (nessun peso nuovo) ma c’è una posizione aperta: confronta `close` con `entry` e forza `weights={}` se SL/TP bucato.
> - `RebalanceAlways(run_always=True)` esegue l’ordine di uscita quel giorno stesso. Con `Rebalance` normale l’uscita aspetterebbe il prossimo `period`.
> Verificare che l'Algo Stack mostri **`4 algos`**. Categorie: `EntryGateMemory` in **Selection**, `StopLossTakeProfit`/`RebalanceAlways` in **Risk/Execution**.

**Granularità configurabile:** sostituisci `period` in `EntryGateMemory` per cambiare quando si può rientrare dopo un’uscita: `monthly`→1° mese, `weekly`→lunedì, `daily`→giorno dopo (rientri immediati). Lo SL/TP resta sempre daily.

**Nota sul crossUp:** `cross_over` richiede 2 barre di `SMA20` valide (primi 20gg `NaN` → `False`). I primi ~200gg `SMA200` è `NaN` → nessun entry prima di `2010-10` — normale.

**Mappatura esempio richiesto:**
- Solo long → `stop_loss_short=0`, `take_profit_short=0`.
- SL 5% → `stop_loss_long=0.05` (entry 100 → SL 95).
- TP 15% → `take_profit_long=0.15` (entry 100 → TP 115).
- Filtro `close > SMA200` → `filter_signal=spy_above_sma200`, `filter_mode=at_entry` (default: rivalutato il giorno di entry; usa `at_trigger` se vuoi fotografarlo al giorno del cross).
- Trigger `crossUp SMA20` → `cross_signal=spy_crossUp_sma20` (ricordato fino al prossimo `period`).

### Step A6 — eseguire il backtest

1. Nel pannello **Run Backtest** (colonna destra):
   - **Price source**: selezionare il datasource `SPY` creato allo Step A1 (il runner carica comunque `SPY` dall'albero via `_load_prices_from_db`).
   - **Initial capital**: `100000`.
   - **Commission**: lasciare vuoto (o `0.001` = 10 bps per testare impatto).
   - Lasciare **integer positions** disattivato.
2. Cliccare **Run**.
3. Attendere completamento (daily su ~15 anni ≈ 3800 barre × 1 ticker, pochi secondi) → redirect a **Results**.

### Step A7 — leggere i risultati

Nella tab **Results**:

- **Equity curve** — sale a scalini: resta piatta quando fuori mercato (filtro o dopo SL/TP) e segue SPY quando in posizione.
- **Weights** — **solo 0% o 100%** su `SPY` (long-only). Verifica che dopo un'entrata il peso vada a 0% quando `close` tocca 95% o 115% dell'entry (SL/TP), prima che `SelectWhere` tolga il titolo.
- **Metrics** — CAGR, Sharpe, maxDD.

**Debug rapido:** se vedi sempre 0%:
- controlla che `sma200_spy` e `sma20_spy` abbiano entrambi colonna `SPY` (non 2 colonne diverse) — mismatch genera `422`.
- controlla che il signal `spy_entry_long` sia `True` almeno qualche giorno (anteprima tabella in **Signals → Evaluate** deve mostrare `True` sparsi).

**Confronto utile:** duplica la strategia (`Save` → `Load` con nuovo nome `spy_no_sltp`), rimuovi `StopLossTakeProfit` dallo Stack e rilancia. In **Results** spunta entrambi i run e usa **Confronto equity singole** per vedere l'effetto SL/TP sul drawdown.

---

## Variante B — Replica completa zachlim98 (RSI+MACD, multi-ticker)

Questa variante replica l'esempio *Using Pandas to set SL/TP* tratto dal blog di zachlim98: https://zachlim98.github.io/me/2020-12/Using-Pandas-to-set-SL — strategia long/short che entra con RSI>50 + MACD_diff>0 ed esce con stop loss fisso (−3 %) o take profit (+50 % per long, −5 % per short). A differenza dell'articolo (loop pandas + `WeighTarget` manuale), in bt-gui si usa l'algo nativo **`StopLossTakeProfit`** inserito tra il `Weigh*` e il `Rebalance`, senza script esterno.

### Prerequisiti Variante B

- Backend in ascolto su `http://localhost:8001`
- Frontend in ascolto su `http://localhost:3001`
- Almeno un price source caricato (vedi Step B1)

### Step B1 — caricare i dati di prezzo

1. Nel menu cliccare **Ticker Catalog** (vista Data).
2. Campo **TICKER**: `NFLX` (minimo) o `NFLX,AAPL,GOOG` (replica completa articolo).
3. **Start**: `2015-02-01` — lasciare vuoto End.
4. Cliccare **Fetch** (yfinance).
5. Verificare `count` >0.

> I prezzi sono scaricati da `yfinance.download()` e salvati in `price_data`. L'esempio originale usa Tiingo; yfinance è l'equivalente gratuito in bt-gui.

### Step B2 — pre-calcolare RSI(14) e MACD (opzionale)

Per l'ingresso si possono usare due strade:

**Strada veloce (consigliata per provare SL_TP):** saltare RSI/MACD e usare `SelectAll + WeighEqually` come generatore di pesi — `StopLossTakeProfit` intercetterà comunque SL/TP.

**Replica fedele articolo:** calcolare RSI e MACD e creare un signal composito da usare con `SelectWhere` prima del `Weigh*`.

1. In **Builder** → pannello **Indicators**:
   - **Symbol**: multi-select sui ticker caricati.
   - **Indicator**: `RSI` period `14` → **Compute & Save**.
   - Ripetere per `MACD` (diff) se disponibile.
2. In **Signals** → creare signal `RSI>50 AND MACD_diff>0` per long (e `RSI<50 AND MACD_diff<0` per short).

> Se `MACD_diff` non compare come indicatore standalone, usa direttamente la strada veloce (`SelectAll`). L'obiettivo è mostrare `StopLossTakeProfit`, non il calcolo RSI/MACD.

### Step B3 — costruire l'albero strategia

1. Nel **Canvas** cliccare sul root **MyStrategy** e rinominarlo in `rsi_macd_sltp`.
2. Dalla **Palette** trascinare 3 nodi **Security** sopra il root:
   - `NFLX`, `AAPL`, `GOOG`
3. Verificare la struttura:
```
rsi_macd_sltp (Strategy)
├── NFLX (Security)
├── AAPL (Security)
└── GOOG (Security)
```

### Step B4 — compilare l'Algo Stack

Con il root `rsi_macd_sltp` selezionato, nell'**Inspector** → **Algo Stack — 0 algos**, aggiungere in questo ordine esatto:

| Ordine | Algo | Parametri da impostare |
|--------|------|------------------------|
| 1 | SelectAll | nessun parametro (seleziona tutti i ticker; in alternativa `SelectWhere` con signal RSI/MACD dello Step B2) |
| 2 | WeighEqually | nessun parametro (pesa 1/N = 33% ciascuno) |
| 3 | StopLossTakeProfit | **stop_loss_long**: `0.03` (−3% da entry) <br> **take_profit_long**: `0.5` (+50% da entry) <br> **stop_loss_short**: `0.03` (+3%) <br> **take_profit_short**: `0.05` (−5%) <br> **trailing_long**: `0` (0 = SL fisso, >0 = trailing) <br> **trailing_short**: `0` — con `run_always=True` per exit daily anche se aggiungi un `Run*` prima |
| 4 | RebalanceAlways | nessun parametro (usa `RebalanceAlways` se l’entry è `RunMonthly/Weekly`, altrimenti `Rebalance` normale va bene per entry daily) |

> Verificare che l'Algo Stack mostri **`4 algos`**. La categoria in palette è **Risk** (prefisso `Stop`). `RebalanceAlways` è necessario solo se metti un `Run*` prima di `SelectWhere` e vuoi exit daily.

**Variante trailing stop:** per testare il trailing, impostare:

| Variante | Parametri |
|----------|-----------|
| Long trailing 3% | `trailing_long`: `0.03`, `stop_loss_long`: `0` (ignorato), `take_profit_long`: `0.5` (TP resta attivo) |
| Short trailing 3% | `trailing_short`: `0.03`, `stop_loss_short`: `0` |

`trailing` è **sostituto** del fisso: se `trailing_long>0` lo SL segue `max_price*(1-trailing_long)` invece di `entry*(1-stop_loss_long)`. TP resta indipendente.

**Esempio articolo mappato:**
- Long SL 0.97→ `stop_loss_long=0.03`, TP 1.5→ `take_profit_long=0.5`
- Short SL 1.03→ `stop_loss_short=0.03`, TP 0.95→ `take_profit_short=0.05`

### Step B5 — eseguire il backtest

1. Nel pannello **Run Backtest**:
   - **Price source**: selezionare i datasource NFLX/AAPL/GOOG.
   - **Initial capital**: `100000`.
   - **Commission**: l'originale usa `lambda q,p: max(1, abs(q)*0.05)` (5% min $1). Nella GUI inserire `0.05` (il floor fisso non è esponibile).
   - Lasciare **integer positions** disattivato.
2. Cliccare **Run**.
3. Al termine si viene reindirizzati alla tab **Results**.

> Per confrontare con e senza SL/TP: duplica la strategia, rimuovi `StopLossTakeProfit` dallo stack e rilancia — confronta le equity in **Results → Confronto equity singole**.

### Step B6 — leggere i risultati

Nella tab **Results**:

- **Equity curve** — crescita con SL/TP attivi.
- **Weights** — allocazione giornaliera: ±33% quando in posizione, 0% dopo SL/TP (gap visibili come azzeramenti isolati), poi 33% di nuovo al rientro successivo (l'algo riapre alla barra successiva quando `Weigh*` ripropone peso).
- **Metrics** — CAGR, Sharpe, max drawdown.

Valori attesi (articolo, Tiingo 2015-02→2020-10, commissione 5%):

| Metrica | Test1 (con SL/TP) | Benchmark (buy & hold) |
|---------|-------------------|------------------------|
| Total Return | ~189% | ~424% |
| CAGR | ~20,5% | ~33,8% |
| Max Drawdown | ~−31% | ~−34,7% |
| Daily Sharpe | ~0,93 | ~1,14 |

> Con yfinance i valori saranno leggermente diversi. L'importante è verificare che: (i) i pesi vadano a 0 isolatamente su SL/TP, (ii) il drawdown sia contenuto, (iii) il trailing (se attivato) esca su rimbalzo dal massimo/minimo e non sull'entry.

---

## Spiegazione concettuale (valida per entrambe le varianti)

1. **Weigh*** produce pesi target (es. `WeighEqually` → 33% long o 100% su SPY). Da solo non sa gestire uscite intra-posizione.
2. **StopLossTakeProfit** è **stateful**: memorizza per ticker `entry_price` e `trail_high/low` sul `self` dell'algo (stessa istanza riusata ogni barra da `bt`). Alla prima barra con peso ≠0 salva entry; alle barre successive confronta `close` con `SL/TP` (fissi) o `max_price*(1-trailing)` (trailing) e azzera il peso se triggerato.
3. **Trailing come sostituto**: con `trailing_long=0.03`, SL = `max(close_since_entry) * 0.97` — sale solo, mai scende. Sostituisce `stop_loss_long`; TP resta calcolato sull'entry.
4. **Close giornaliero**: il trigger usa `close` di `target.universe` allineato a `price_data` (nessun high/low intrabar). Implementazione in `backend/services/custom_algos.py:StopLossTakeProfit` + discovery in `backend/services/algo_registry.py`.
5. **Commissione alta (5%)**: penalizza turnover per mostrare che la strategia non batte buy&hold anche con SL/TP.

---

## Suggerimenti aggiuntivi

- **Confrontare con buy&hold:** duplica, rimuovi `StopLossTakeProfit` e confronta due run in overlay.
- **Variare parametri:** prova `stop_loss_long=0.05 / take_profit_long=0.3` o `trailing_long=0.03` per vedere turnover diverso.
- **Usare WeighTarget con signal RSI/MACD:** sostituisci `SelectAll+WeighEqually` con `SelectWhere(signal rsi_macd) + WeighEqually` per ingresso filtrato + SL/TP a valle.
- **Altri ticker:** `MSFT, TSLA, AMZN` — stessa logica, basta ricaricare prezzi.
- **Salvare:** **Save** → persiste albero con `StopLossTakeProfit` in SQLite; `tree_serializer.py` ricostruisce correttamente l'algo custom.

---

<a name="tutorial-erc"></a>

# Tutorial 9 — ERC Risk Parity (equal risk contribution su SPY+TLT)

Questo tutorial replica l'esempio *Equally Weighted Risk Contributions Portfolio* tratto dalla documentazione ufficiale di bt: https://pmorissette.github.io/bt/examples.html#equally-weighted-risk-contributions-portfolio — portafoglio dove ogni asset contribuisce in misura uguale al rischio totale (risk parity a 2 asset), ribilanciato via `WeighERC`.

Codice originale bt (estratto, dati sintetici `foo` ad alta vol / `bar` a bassa vol / `rf` cash):

```python
import bt
import pandas as pd

runAfterDaysAlgo = bt.algos.RunAfterDays(20*6 + 1)   # warmup ~6 mesi di dati
selectTheseAlgo  = bt.algos.SelectThese(['foo', 'bar'])  # esclude 'rf'
weighERCAlgo     = bt.algos.WeighERC(lookback=pd.DateOffset(days=20*6),
    covar_method='standard', risk_parity_method='slsqp',
    maximum_iterations=1000, tolerance=1e-9, lag=pd.DateOffset(days=1))
rebalAlgo = bt.algos.Rebalance()

strat = bt.Strategy('ERC', [runAfterDaysAlgo, selectTheseAlgo, weighERCAlgo, rebalAlgo])
backtest = bt.Backtest(strat, pdf, integer_positions=False)
res = bt.run(backtest)
res.get_security_weights().plot()   # bar (bassa vol) pesa più di foo: a parità di risk budget, l'asset meno volatile prende più capitale
```

> Nell'esempio bt i dati sono sintetici (`foo` vol 20%, `bar` vol 5%, correlazione 0.25, `rf` 2% fisso, 2015–2018 BDay). In bt-gui si usano ticker reali con lo stesso contrasto di volatilità: **SPY** (equity, alta vol ≈ ruolo di `foo`) + **TLT** (Treasury 20Y+, bassa vol ≈ ruolo di `bar`). Non serve un equivalente di `rf`: in bt-gui il cash è implicito (capitale non allocato), quindi bastano 2 Security.

## Prerequisiti

- Backend in ascolto su `http://localhost:8001`
- Frontend in ascolto su `http://localhost:3001`
- Nessun price source obbligatorio a priori (vengono creati allo Step 1)

---

## Step 1 — caricare i dati di prezzo (SPY, TLT)

1. Nel menu cliccare **Ticker Catalog** (vista Data).
2. Campo **TICKER**: `SPY` — **Start**: `2014-01-01` (serve ~6 mesi di warmup prima del 2015; in alternativa `2010-01-01` per allinearsi agli altri tutorial) — lasciare vuoto End per scaricare fino ad oggi.
3. Cliccare **Fetch** (yfinance) e attendere `count` >0 nella tabella.
4. Ripetere per `TLT` (esiste dal 2002, copre l'intervallo).
5. Verificare che entrambi abbiano `count` >0.

> I prezzi sono scaricati da `yfinance.download()` e salvati in `price_data`. Il runner carica l'unione dei 2 ticker per il backtest. `TLT` è l'asset a bassa volatilità del pair (come `bar` nell'esempio sintetico); senza contrasto di vol l'ERC degenera in ~50/50 e il tutorial perde senso — non sostituire TLT con un secondo equity ad alta vol.

---

## Step 2 — nessun indicatore / signal da pre-calcolare

`WeighERC` calcola da solo la matrice di covarianza dai rendimenti dei prezzi su `lookback` — non serve il pannello **Indicators** né **Signals** per questo tutorial. Passare direttamente allo Step 3.

---

## Step 3 — costruire l'albero strategia

1. Nel **Canvas** cliccare sul nodo root **MyStrategy** e rinominarlo in `erc`.
2. Dalla **Palette** trascinare 2 nodi **Security** sopra il root, uno per ticker:
   - `SPY`
   - `TLT`
3. Verificare la struttura:
```
erc (Strategy)
├── SPY (Security)
└── TLT (Security)
```

> Solo i nodi **Strategy** possono avere figli; i Security sono foglie.

---

## Step 4 — compilare l'Algo Stack

Con il root `erc` selezionato, nell'**Inspector** → **Algo Stack — 0 algos**, aggiungere in questo ordine esatto (cliccare **Add** dopo ogni selezione):

| Ordine | Algo | Parametri da impostare |
|--------|------|------------------------|
| 1 | RunAfterDays | **days**: `121` (= `20*6+1` dell'esempio: ~6 mesi di warmup affinché la covarianza abbia dati sufficienti) |
| 2 | SelectAll | nessun parametro (seleziona SPY+TLT; vedi nota sotto su `SelectThese`) |
| 3 | WeighERC | **covar_method**: `standard` <br> **risk_parity_method**: `slsqp` <br> **maximum_iterations**: `1000` <br> **tolerance**: `1e-9` <br> **lookback** e **lag**: lasciare **vuoti** (= default 3 mesi / 0 giorni; vedi nota) |
| 4 | Rebalance | nessun parametro |

> **Perché `SelectAll` e non `SelectThese(['SPY','TLT'])` come nell'originale?** `SelectThese.tickers` è un parametro **lista**, ma la GUI espone ogni parametro algo come singolo campo testo (`frontend/src/bt/components/AlgoStack.tsx:218` + `backend/services/algo_registry.py:289` — tutto `type: string`). Una stringa `"SPY,TLT"` arriverebbe a bt come scalare e romperebbe la selezione. Con solo 2 Security nell'albero, `SelectAll` seleziona esattamente `SPY`+`TLT` — identico a `SelectThese`, con zero differenze economiche. (L'`rf` dell'esempio non va escluso perché in bt-gui non esiste come Security: il cash è implicito.)
>
> **Perché `lookback`/`lag` restano ai default?** Stesso motivo tecnico: sono `DateOffset` pandas, non esprimibili come testo nel campo GUI (`_coerce_param_value` in `backend/services/algo_registry.py:136` gestisce solo bool/numerici). I default bt (`lookback` 3 mesi, `lag` 0) sono una buona approssimazione dei 6 mesi/1 giorno originali su dati reali. I 4 parametri impostati (`covar_method`, `risk_parity_method`, `maximum_iterations`, `tolerance`) sono stringhe/numeri e passano invariati — replica fedele del setup di ottimizzazione originale (richiede `scipy`, presente nelle dipendenze BE per il metodo `slsqp`).
>
> **Campo `tolerance`:** digitare `1e-9` — il BE lo converte in `float` perché il default è `float` (`1e-08`).
>
> **Campi `initial_weights` e `risk_weights` (lasciare vuoti):** entrambi sono list di float con default intelligente (`None` → inverse-vol per `initial_weights`, `[0.5, 0.5]` per `risk_weights`). Il BE non ha un parser per parametri tipo `list`, mentre la GUI li espone come campo testo singolo: una stringa come `"0.5,0.5"` verrebbe passata come `str` e `calc_erc_weights` fallirebbe con `TypeError`. Se non si intende cambiare il risk budget target (es. volere un asset a contribuire il 70% del rischio totale), lasciare questi campi **vuoti** e sfruttare i default — l'esempio originale usa esattamente i default. Entrambi servono solo per casi avanzati di generalized risk parity o per dare un starting point diverso all'ottimizzatore.

Verificare che l'Algo Stack mostri **`4 algos`** sul root e nessun warning.

---

## Step 5 — eseguire il backtest

1. Nel pannello **Run Backtest** (colonna destra):
   - **Price source**: selezionare uno qualsiasi dei 2 datasource (il runner carica comunque tutti i ticker presenti nell'albero via `_load_prices_from_db`).
   - **Initial capital**: lasciare `100000`.
   - Lasciare **integer positions** disattivato (`False` — come `integer_positions=False` dell'esempio; con `True` i pesi ERC frazionari verrebbero distorti dall'arrotondamento).
   - Lasciare **Commission** vuoto.
2. Cliccare **Run** e attendere il completamento (pochi secondi; l'ottimizzazione `slsqp` gira solo nei giorni di rebalance dopo il warmup).
3. Al termine si viene reindirizzati alla tab **Results**.

---

## Step 6 — leggere i risultati

Nella tab **Results**:

- **Equity curve** — crescita del portafoglio ERC (parte da `initial_capital`). Attesa più liscia di SPY buy-and-hold grazie al peso dominante di TLT.
- **Weights** — `res.get_security_weights()` nell'esempio; allocazione **stabile nel tempo, TLT prevalente (~60–70%) e SPY minoritario (~30–40%)**. È la firma dell'ERC: a parità di budget di rischio, l'asset meno volatile (TLT) riceve più capitale. Se vedi ~50/50 fissi, `WeighERC` non sta girando (verifica ordine dello Stack e `days=121`).
- **Metrics** — CAGR, Sharpe, max drawdown. Con SPY+TLT dal 2015: volatilità attesa sensibilmente sotto SPY buy-and-hold, Sharpe tipicamente superiore a entrambi i buy-and-hold singoli.
- **Transactions** — turnover basso (i pesi ERC su 2 asset cambiano lentamente).

Valori attesi con dati sintetici dell'esempio originale (`foo` 20% / `bar` 5% / corr 0.25, 2015-01-01 → 2018-12-31):

| Metrica | Nota |
|---------|------|
| Pesi | `bar` (bassa vol) ~70–80%, `foo` ~20–30% — mai 50/50 |
| Total Risk Contribution | ~uguale dai due asset (grafico `trc_target` dell'esempio: le due linee si sovrappongono) |

> Con dati reali (SPY/TLT) le percentuali esatte differiscono — il contrasto di vol reale (SPY ~16–20%, TLT ~12–15%) è minore di quello sintetico (20% vs 5%), quindi i pesi saranno meno estremi. L'importante è verificare che: (i) **TLT pesi più di SPY**, (ii) i pesi **non** siano 50/50 fissi, (iii) nulla cambi prima di ~121 giorni di warmup (`RunAfterDays` blocca tutto lo Stack fino ad allora).

**Debug rapido:** se l'equity è piatta a `initial_capital` per tutto il periodo, le cause in ordine sono: (1) manca `Rebalance` come ultimo algo dello Stack — senza di lui i pesi `WeighERC` non diventano mai ordini (da ora il pannello Run avvisa con un confirm prima di lanciare); (2) i ticker dell'albero non corrispondono a `price_data` (ricarica con ↻ in Run Backtest). Se il run fallisce con errore su `slsqp`, verificare che `scipy` sia installato nel BE (`uv run python -c "import scipy"`).

---

## Spiegazione concettuale

1. **ERC = risk parity, non capital parity.** `WeighEqually` dà 50/50 del *capitale*; `WeighInvVol` pesa 1/vol (ignora le correlazioni); `WeighERC` risolve `w_i · (Σw)_i = budget` uguale per ogni asset usando la **covarianza completa** — con 2 asset correlati positivamente è l'unico dei tre a equalizzare davvero il contributo al rischio. Implementazione: `bt.algos.WeighERC.__call__` → `ffn.calc_erc_weights` su rendimenti di `lookback`.
2. **RunAfterDays(121) è warmup statistico, non scheduling.** A differenza di `RunMonthly`/`RunDaily` (filtri che si ripetono), scatta una sola volta: prima i rendimenti su cui calcolare la covarianza non esistono. Senza, le prime barre avrebbero pesi su covarianza quasi vuota.
3. **SelectAll su 2 Security ≡ SelectThese.** L'originale esclude `rf` (cash come terza colonna del DataFrame fake); in bt-gui il cash non è un Security, quindi non c'è nulla da escludere.
4. **`integer_positions=False` è obbligatorio concettualmente:** i pesi ERC (es. 37,2%) su capitale finito richiedono frazioni; l'arrotondamento a lotti interi introdurrebbe un tracking error spurio proprio dove si misura la parità di rischio.

---

## Suggerimenti aggiuntivi

- **Confrontare ERC vs EW vs InvVol:** duplicare la strategia (`Save` → `Load` con nuovo nome), sostituire solo `WeighERC` con `WeighEqually` e poi con `WeighInvVol`, rilanciare i 3 run e confrontare le equity in **Results → Confronto equity singole** (come Variante B del Tutorial 7). ERC dovrebbe mostrare vol più bassa di EW; la differenza con InvVol è sottile su 2 asset (emerge con 3+ asset correlati).
- **Aggiungere GLD come terzo asset:** fetch `GLD`, aggiungere Security, rilanciare — qui ERC si differenzia davvero da InvVol perché la covarianza a 3 asset conta.
- **Provare `covar_method=ledoit-wolf` (default bt):** shrinkage della covarianza, pesi più stabili su lookback corti; confrontare il turnover nelle Transactions.
- **Cap come Trend Example 1:** aggiungere `LimitWeights(limit=0.4)` dopo `WeighERC` per impedire a TLT di superare il 40% (rompe la parità esatta, utile per confronto).
- **Salvare la strategia:** cliccare **Save** con nome `erc` per persistere l'albero in SQLite.

---

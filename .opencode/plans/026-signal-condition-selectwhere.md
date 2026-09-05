# Piano 026 — Signal Condition per SelectWhere

## Problema

Il parametro `signal` di `SelectWhere` riceve direttamente il DataFrame float dell'indicatore.
`SelectWhere` cerca `sig == True` → nessuna selezione → zero transazioni.

Manca il passaggio intermedio: **condizione che trasforma i valori float in booleani**.

## Stato attuale (sbagliato)

```
Indicatore (SMA float) → SelectWhere(signal="1") → bt framework
```

## Stato corretto

```
Indicatore (SMA float) + Signal Condition → DataFrame booleano → SelectWhere
```

## Design Signal Condition

### Formato (oggetto JSON nel param `signal_condition`)

| Campo | Tipo | Descrizione |
|-------|------|-------------|
| `op` | string | Operatore: `gt`, `lt`, `gte`, `lte`, `above`, `below`, `cross_over`, `cross_down` |
| `value` | number | Threshold (usato solo per gt/lt/gte/lte) |
| `comparison` | string | `"price"` per sopra/sotto vs prezzo |

### Operatori supportati

| op | condizione | risultato |
|----|-----------|-----------|
| `gt` | `indicator > value` | default value=0 |
| `lt` | `indicator < value` | default value=0 |
| `gte` | `indicator >= value` | default value=0 |
| `lte` | `indicator <= value` | default value=0 |
| `above` | `price > indicator` | long when price sopra indicatore |
| `below` | `price < indicator` | long quando price sotto indicatore |
| `cross_over` | `indicator > indicator.shift(1)` | crossover (indicatore sale) |
| `cross_down` | `indicator < indicator.shift(1)` | crossunder (indicatore scende) |

### Fallback backward-compatible

Se `signal_condition` è null/assente: usa `notna()` (mantenendo compatibilità).

## Modifiche richieste

### 1. Backend — modello (`backend/models/strategy_tree.py`)

Aggiungere campo opzionale a `AlgoConfig`:

```python
class AlgoConfig(BaseModel):
    class_name: str
    params: dict[str, Any] = {}
    signal_condition: dict[str, Any] | None = None  # NEW
```

### 2. Backend — serializer (`backend/services/tree_serializer.py`)

Nuova funzione `_apply_signal_condition(indicator_df, condition, price_df)` e aggiornamento
di `_resolve_indicator_params` per accettare `price_df`.

### 3. Backend — backtest runner (`backend/services/backtest_runner.py`)

Passare `price_df` a `to_bt_strategy`.

### 4. Backend — API backtest (`backend/api/backtest.py`)

Rimuovere il fix `notna()` improvvisato. La conversione booleana avverrà tramite `signal_condition`.

### 5. Frontend — AlgoStack (`frontend/src/bt/components/AlgoStack.tsx`)

Quando il parametro `signal` è di kind=indicator, mostrare accanto al dropdown anche un
selettore di condizione. Salvare `signal_condition` come campo separato nell'algo.

### 6. Frontend — type regeneration

Dopo modifica del modello backend, eseguire `npm run gen:types`.

## Done Criteria

- [ ] Strategia con `SelectWhere` + `signal_condition: {"op": "above"}` esegue backtest con transazioni
- [ ] Strategia senza `signal_condition` (backward-compat) mantiene comportamento attuale
- [ ] UI mostra selettore condizione accanto al dropdown indicatore
- [ ] Tutti i test passati (`pytest -q`, `npm run build`)
- [ ] Fix `notna()` rimosso da `backtest.py`

## File da modificare

| File | Tipo |
|------|------|
| `backend/models/strategy_tree.py` | +1 campo |
| `backend/services/tree_serializer.py` | +funzione, modifiche risoluzione |
| `backend/services/backtest_runner.py` | +passaggio price_df |
| `backend/api/backtest.py` | -rimuovi notna() |
| `frontend/src/bt/components/AlgoStack.tsx` | +selettore condizione |
| `frontend/src/types/bt.ts` | rigenerato |

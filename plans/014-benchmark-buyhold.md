# 014 — Benchmark buy&hold nel Run Backtest

## Scopo
Ticker benchmark (default SPY) comprato a inizio strategia e tenuto buy&hold:
linea extra sull'equity chart + stats di confronto (outperformance, alpha, beta, IR).

## Contratto
- `POST /api/bt/backtest`: nuovo campo opzionale `benchmark_ticker` (salvato in `config_json`).
- `GET /api/bt/runs/{id}`: aggiunge `benchmark_ticker` + `benchmark` (stats confronto) | null.
- `GET /api/bt/runs/{id}/prices`: aggiunge query `?benchmark_ticker=` (override) e campo
  `benchmark: {ticker, dates, values}` | null, allineato all'index strategia, normalizzato
  su `initial_capital`. Senza benchmark → risposte identiche a prima (retrocompatibile).
- Nessuna migration: tutto in `config_json` + calcolo on-the-fly in `services/benchmark.py`.
- Validazione morbida: benchmark senza dati → `benchmark: null` + hint, mai 422, mai impatto sul run.

## Formule (reso giornalieri, rf=0, 252 gg)
- `beta = Cov(rs,rb)/Var(rb)`; `alpha = mean(rs-beta*rb)*252`; `corr = Corr(rs,rb)`
- `tracking_error = std(rs-rb)*sqrt(252)`; `IR = mean(rs-rb)/std(rs-rb)*sqrt(252)`
- `outperformance = TR_strat - TR_bench`; benchmark TR/CAGR/maxDD come la strategia.

## Done criteria
- [ ] RunDialog ha input benchmark (default SPY), inviato al BE e persistito
- [ ] Equity chart mostra linea benchmark + legenda; run vecchie invariate
- [ ] Pannello benchmark con TR/CAGR/maxDD/outperformance/alpha/beta/IR
- [ ] `uv run pytest -q tests/backend/test_benchmark.py` verde
- [ ] `npm run build` verde (FE), `uv run ruff check .` verde (BE)

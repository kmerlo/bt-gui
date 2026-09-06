# 031 — Builder: Saved scoped per strategia + colonna Strategia nei tab

## Scopo
Nel builder le liste "Saved" di indicatori/segnali mostrano tutto il DB (rumore).
Si vuole: (a) Saved = solo IDs referenziati negli algo della strategia corrente;
(b) tab Indicators/Signals con colonna Strategia (lista nomi, `—` se orfano);
(c) al Salva la strategia fotografa i link (`preset.indicator/signal_source_ids`).

Decisioni utente: "usato" = referenziato negli algo; fotografia = link per ID;
colonna = lista nomi virgola; Saved = solo corrente (nuova strategia → vuoto).

## Stato attuale (verificato)
- `BuilderPreset` BE ha già entrambi i campi (`strategy_tree.py:30-32`), ma
  `buildPresetForTree` (`preset.ts:102-119`) scrive solo `indicator_source_ids`.
- `backtest.py:125-166` legge già entrambi → nessun cambio BE sul run.
- Walk IDs già inline in `RunDialog.tsx:194-210` → estrarre in util condiviso.
- `bt.ts` generato non ha `signal_source_ids` → rigenerare dopo il BE.

## Cambiamenti
1. `frontend/src/bt/utils/collectIds.ts` (nuovo, <60 righe): `collectReferencedIds(tree)`
   — walk `root.algos[].params` (stringhe numeriche) + `preset.*_source_ids`.
   Vitest `collectIds.test.ts` (unico check runnable FE).
2. `RunDialog.tsx` riusa l'util (stesso comportamento).
3. `useStrategySave.ts`: al Salva partiziona gli IDs raccolti (via
   `listIndicators`/`listSignals`) e scrive entrambi i campi preset; fallback:
   tutto in `indicator_source_ids` se la fetch fallisce (il BE li risolve comunque).
4. `IndicatorPanel.tsx` / `SignalPanel.tsx`: Saved filtrato per IDs usati;
   titolo `Saved — this strategy (N)` + hint se vuoto o appena-creato-non-referenziato.
5. BE `backend/api/usage.py` (nuovo): `GET /api/bt/usage` →
   `{indicators: {id: [nomi]}, signals: {id: [nomi]}}` da scan `strategies.tree_json`
   (algos + preset), solo IDs esistenti in `data_sources`. Nessuna migrazione.
   Registrare in `routes.py`. Modello Pydantic `UsageResponse` per OpenAPI.
6. `npm run gen:types` (BE su :8001) → `bt.ts` rigenerato.
7. `api/data.ts` + `IndicatorsView.tsx` / `SignalsView.tsx`: colonna Strategia
   (join su usage), delete-confirm con nomi strategie.
8. `tests/backend/test_usage.py` (pattern in-memory come `test_persistence.py`).

## STOP / Done criteria
- `npm run build` 0, `uv run ruff check .` 0, `uv run pytest -q` 0, `npx vitest run` 0.
- Strategia nuova → Saved vuoti; dopo ref in algo + Salva → Saved popolati;
  tab mostrano nome strategia; Load ripristina.
- Mai DELETE senza `WHERE name LIKE test_/tmp_/mock_` (§11 inviolabile).

## Non si fa
- Snapshot-copia blob; toggle "mostra tutti"; `signalSourceIds` live nello store.

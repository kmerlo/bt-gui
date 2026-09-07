# Plan 034: Commissioni — flag di attivazione formula / parametri

## Status

- **Priority**: P2 — **Effort**: S — **Risk**: LOW — **Category**: feature
- **Planned/executed**: 2026-09-07 — **Stato**: DONE (segue plan 033)

## Richiesta

Valori commissioni precompilabili dai default Settings, ma applicati solo se il
relativo flag è attivo. Un flag sulla formula, uno sui parametri. Entrambi i
flag = messaggio di errore.

## Design (ponytail)

- Due booleani `commission_formula_enabled` / `commission_params_enabled` in
  `BtSettings` (`bt-settings:v1`, default `false`) e `BuilderBacktestConfig`
  (`bt-builder-preset:v1`, backfill dai Settings) — ancora solo localStorage,
  BE e preset strategia invariati come schema.
- `validateCommission(formula, params, flags)`: entrambi i flag → errore
  «attiva o la formula o i parametri, non entrambi»; flag formula → formula
  obbligatoria e lambda; flag parametri → parametri obbligatori e validi;
  tutto spento → valido (nessuna commissione, valori ignorati).
- `resolveCommissionFn` applica solo il flag attivo, altrimenti `''`.
- `CommissionField` mostra checkbox «Applica formula» / «Applica parametri» +
  hint «precompilato, non applicato (flag spento)» quando ci sono valori con
  flag spento. `setTree` preserva anche i flag; `buildPresetForTree` risolve
  via flag così la strategia salvata resta eseguibile.

## Verifica (tutte ok)

- `npm run test` (vitest) → 16 passed (3 nuovi casi flag: entrambi=errore, precompilato-spento ignorato, flag-vuoto=errore)
- `npx eslint` sui file toccati → ok
- `npm run build` → ok (solo warning chunk-size pre-esistente)
- BE invariato (nessun test BE toccato in questo plan)

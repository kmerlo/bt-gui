# Plan 033: Commissioni builder — doppia modalità formula / 3 parametri

## Status

- **Priority**: P2 — **Effort**: S — **Risk**: LOW — **Category**: feature
- **Planned/executed**: 2026-09-07 — **Stato**: DONE

## Richiesta

Nel builder, per le commissioni: poter scrivere una formula libera
`lambda q, p: max(my_commissions_min, min(my_commissions_max, p * abs(q) * my_commissions_perc))`
OPPURE compilare solo le 3 variabili `my_commissions_min/max/perc` e applicare quella formula.
Scelte utente: UI in builder + Settings · perc in % (0.1 = 0,1%) · conflitto = errore · persistenza solo localStorage.

## Design (ponytail)

- BE invariato come contratto (`CommissionConfig.simple_fn`, `parse_commission_fn`): la FE invia sempre e solo una `simple_fn` risolta. Nessuna rigenerazione `types/bt.ts`, nessun cambio preset strategia.
- Logica pura in `frontend/src/bt/utils/commission.ts` (zero JSX/store): `validateCommission` (o/o + range), `buildCommissionFn` (perc/100, cap omesso se vuoto, floor omesso se nullo/0), `resolveCommissionFn`, `previewCommissionCost` (aritmetica, mai eval).
- UI riusata `frontend/src/bt/components/CommissionField.tsx` in `RunDialog` e `SettingsView` (default).
- Persistenza: 3 campi `number | null` in `BtSettings` (`bt-settings:v1`) e `BuilderBacktestConfig` (`bt-builder-preset:v1`) con backfill; `setTree` li preserva al cambio strategia; `buildPresetForTree` salva la formula risolta così la strategia resta eseguibile.

## Bug trovato ed eliminato

`commission_parser.py` permetteva `max/min/abs/round` nella whitelist ma l'`eval` girava con `__builtins__` vuoti → `NameError` a runtime per qualsiasi formula con `max()` (incluse quelle già salvate, es. `test_persistence.py`). Fix: `_SAFE_FUNCS` con solo le 4 funzioni nei globals dell'eval (l'AST resta il gate, nessun ampliamento della superficie).

## Verifica (tutte ok)

- `uv run pytest -q` → 197 passed, 3 skipped (2 nuovi test clamp/floor/cap)
- `uv run ruff check .` → ok
- `npm run build` → ok (solo warning chunk-size pre-esistente)
- `npx eslint` sui file toccati → ok
- `npm run test` (vitest) → 13 passed (7 nuovi in `commission.test.ts`)
- Smoke BE: `max(1, min(100, p*abs(q)*0.001))` → floor/cap/raw corretti
- `git diff --stat backend/ frontend/src/types/` → solo `commission_parser.py` (runtime env), nessun cambio schema/tipi

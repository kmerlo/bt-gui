# Plan 006: Supporto indicatori pre-calcolati e algo con ref a DataFrame

## Status
- **Priority**: P1 · **Effort**: M · **Risk**: LOW
- **Depends on**: plans/004 (DataManager + Backtest runner già funzionanti)

## Problema
Gli esempi `bt` (SMA above 50, Trend, Strategy Combination) richiedono algoli che ricevono DataFrame pre-calcolati. Attualmente la GUI non può pre-calcolare indicatori e non supporta parametri indicator negli algo schema.

## Soluzione in 9 step
1. `backend/services/indicator_calculator.py` — funzioni pure per SMA/EMA/RSI/MACD/Bollinger
2. Estendere `algo_registry.py` — classificazione DataFrame params + context injection
3. Nuove route `/api/bt/indicators/*` in `routes.py`
4. Estendere `backtest_runner.py` + `tree_serializer.py` — risoluzione indicator ref
5. Frontend: `IndicatorPanel.tsx` — UI compute+save indicatori
6. Estendere `AlgoStack.tsx` — select per parametri indicator
7. Integrazione in `BuilderView.tsx` — toggle pannello indicatori
8. Rigenerazione tipi + verifiche (build, test, lint)
9. E2E manuale: replica esempio SMA above 50

## File da modificare/creare
- `backend/services/indicator_calculator.py` [CREARE]
- `backend/services/algo_registry.py` [MODIFICARE]
- `backend/services/tree_serializer.py` [MODIFICARE]
- `backend/services/backtest_runner.py` [MODIFICARE]
- `backend/api/routes.py` [MODIFICARE]
- `frontend/src/bt/components/IndicatorPanel.tsx` [CREARE]
- `frontend/src/bt/components/AlgoStack.tsx` [MODIFICARE]
- `frontend/src/bt/store/btStore.ts` [MODIFICARE]
- `frontend/src/bt/components/BuilderView.tsx` [MODIFICARE]
- `frontend/src/api/bt.ts` [MODIFICARE]
- `tests/backend/test_indicator_calculator.py` [CREARE]
- `tests/backend/test_algos_with_indicators.py` [CREARE]

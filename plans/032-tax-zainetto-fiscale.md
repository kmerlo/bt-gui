# 032 — Tassazione + zainetto fiscale con scadenza + profili globali

## Obiettivo
Box "Run Backtest": aliquota gain % + checkbox zainetto. Tassazione immediata
su ogni trade profittevole, equity al netto. Dividendi/coupon sempre tassati,
mai compensabili. Zainetto FIFO con scadenza 31/12(anno_perdita+4).
Profili fiscali globali riusabili + mapping ticker→profilo per run.

## Contratti dati
- `get_transactions()` bt = solo quantity/price → P&L ricostruito FIFO in post-process.
- Coupon: serie per-unit (formato bt), nodi `CouponPayingSecurity`, cash =
  per_unit × posizione ricostruita. No gross-up (niente doppio conteggio).
- Dividendi: CSV manuale, colonne=ticker, valori=**cash totale accreditato**.
  Gross-up in post-process (bt li ignora) + tassa alla distribuzione.
- Run salva snapshot `{gain_rate, div_rate}` per ticker in `config_json`
  → edit futuri dei profili non alterano run vecchi.

## File
- BE: `models/backtest_config.py` (+TaxConfig), `models/data_source.py`
  (+"dividends"), `database.py` (+TaxProfile), `services/tax.py` (nuovo, puro),
  `services/backtest_runner.py` (integrazione), `api/backtest.py` (snapshot),
  `api/tax_profiles.py` (nuovo CRUD), `api/routes.py` (include).
- FE: `api/tax.ts` (nuovo), `api/bt.ts` (barrel), `bt/store/preset.ts`,
  `bt/store/btStore.ts`, `bt/components/TaxPanel.tsx` (nuovo, estratto da
  RunDialog per regola 300 righe), `bt/components/RunDialog.tsx`,
  `bt/components/TaxProfilesPanel.tsx` (nuovo), `bt/components/SettingsView.tsx`
  (solo mount), `types/bt.ts` (rigenerato).
- Test: `tests/backend/test_tax_carry.py` (puro, no DB).

## Done
- Esempio 1000/600/600 → tasse attese; loss 2026 usabile fino 31/12/2030.
- Dividendi tassati senza intaccare carry; `npm run build` + `pytest` verdi.

## Fasi
1. Gain + zainetto + 2 caselle. 2. Dividendi/coupon + profili + mapping.

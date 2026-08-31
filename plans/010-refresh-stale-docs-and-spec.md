# Plan 010: Refresh stale docs — PriceData canon, SPEC and tutorial yfinance

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat c83f4bf..HEAD -- my-docs/GUIDE_documentazione_tecnica.md my-docs/GUIDE_manuale_bt_gui.md my-docs/GUIDE-TUTORIAL_STRATEGIE.md my-docs/GUIDE-AVVIARE-GUI.md plans/SPEC.md`
> If files changed, compare "Current state" excerpts before proceeding.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: 002 (api split), 009 (tooling gate), .opencode/plans/007-unified-ticker-data
- **Category**: docs
- **Planned at**: commit `c83f4bf`, 2026-08-30

## Why this matters

Docs are actively wrong and cost onboarding time now. `GUIDE_documentazione_tecnica.md:6` documents only `data_sources(id,name,type,...parquet_blob)` and omits `price_data` (symbol,interval,date,OHLCV) which is canonical since `backend/database.py:94` + `services/data_loader.py:78` (`fetch_and_store_yf`). `GUIDE_manuale_bt_gui.md:1` is 14-line placeholder while `AGENTS.md:117` routes all user how-to there — 12 feature batches shipped with no manual (sticky tables, bulk delete, DB isolation switch, preset). `plans/SPEC.md:329` and `GUIDE-TUTORIAL_STRATEGIE.md:16` still describe `ffn` primary while live code is `yfinance` primary (`fetch_ffn` is legacy). The `.opencode/plans/007-unified-ticker-data.md` price_data migration has no ADR in `plans/README.md`.

## Current state

- `my-docs/GUIDE_documentazione_tecnica.md:35` — 43-line stub: tables `strategies`, `data_sources`, `backtest_runs` only; no `price_data`; no dual-DB `bt_gui.db`/`bt_gui_test.db` + `active_db.txt` + `_EngineProxy`; describes monolithic `backend/api/routes.py:14` instead of split `backend/api/*.py`.
- `my-docs/GUIDE_manuale_bt_gui.md:1-14` — placeholder `Sezione 1 — Titolo sezione`; `AGENTS.md:117` says user docs → `GUIDE_manuale_bt_gui.md`.
- `my-docs/GUIDE-TUTORIAL_STRATEGIE.md:16,110,113` — Step 1 `Fetch FFN`, missing Ticker Catalog yfinance flow; `Export futuro: quando disponibile`.
- `my-docs/GUIDE-AVVIARE-GUI.md:259` — references `docs/` not `my-docs/` and `scripts/sync-from-bt-gui.sh` future promise.
- `plans/SPEC.md:294,329,372` — promises `StrategyTree → .py` export, multi-run overlay, `ffn` v1; code has no overlay (`ResultsDashboard.tsx:58` single `d.sel`) and primary is `yfinance`.
- `.opencode/plans/007-unified-ticker-data.md` — real price_data migration lives outside `plans/`.

- Conventions: `AGENTS.md §8` routing: user → `GUIDE_manuale_bt_gui.md`, technical → `GUIDE_documentazione_tecnica.md`; `my-docs/GUIDE-CODING_PRACTICES.md §1` 300-line rule.

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Lint | `uv run ruff check .` | exit 0 (docs-only, but keep gate) |
| FE build | `npm run build --prefix frontend` | exit 0 |
| Docs check | `grep -rn "price_data" my-docs/GUIDE_documentazione_tecnica.md` | ≥3 hits |
| Tutorial check | `grep -rn "yfinance\|Ticker Catalog" my-docs/GUIDE-TUTORIAL_STRATEGIE.md` | ≥1 hit |

## Scope

**In scope**:
- `my-docs/GUIDE_documentazione_tecnica.md` — rewrite stub with real schema
- `my-docs/GUIDE_manuale_bt_gui.md` — populate 5 views + DB switcher
- `my-docs/GUIDE-TUTORIAL_STRATEGIE.md` — rewrite Steps 1-2 to yfinance catalog
- `my-docs/GUIDE-AVVIARE-GUI.md` — fix paths, remove/implement sync promise
- `plans/SPEC.md` — amend §9 decision 2 to yfinance-canonical, mark export/overlay/heatmap as deferred
- `plans/README.md` or `.opencode/plans/007` → promote to `plans/006-unified-ticker-data.md` ADR note

**Out of scope**:
- Code changes to `price_data` or `data_loader.py`
- New UI features (overlay/export) — direction plan 011

## Git workflow

- Branch: `advisor/010-refresh-stale-docs`
- Commit: `docs: make PriceData canonical, fix tutorial/SPEC yfinance, fill manual`
- Do NOT push unless instructed.

## Steps

### Step 1: Rewrite GUIDE_documentazione_tecnica.md technical section

Replace 43-line stub with:

- Table `PriceData(id,symbol,interval,date,open,high,low,close,adj_close,volume)` — note `price_data` is sole price store, `data_sources` kept for computed indicators only.
- Dual-DB isolation: `bt_gui.db`/`bt_gui_test.db`, `active_db.txt`, `_EngineProxy/_SessionProxy`, `GET/POST /api/bt/db` via `backend/api/health.py:17-58`.
- File map `backend/api/*.py` (routes.py is barrel, domains in `strategies.py`, `data_sources.py`, `price_data.py`, `backtest.py`, `runs.py`, `health.py`, `algos.py`, `indicators.py`).
- Keep tooling line: `npm run gen:types --prefix frontend && git diff --exit-code frontend/src/types/bt.ts` (already present at `:37` after 006).
- Bump `*Ultimo aggiornamento: 2026-08-30*`.

**Verify**: `grep -c "PriceData\|price_data" my-docs/GUIDE_documentazione_tecnica.md` ≥3

### Step 2: Fill GUIDE_manuale_bt_gui.md

Populate with 5 sections matching `App.tsx:11` Views: Builder (palette/tree/inspector + `simple_fn`), Results (RunsTable + overlay note), Strategies (save/load + Save as new), Data/Data-detail (Ticker Catalog fetch yfinance, bulk delete, preview/table), Settings (simple_fn, capital, adj_close). Add DB switcher (`App.tsx:35` `main`/`test`) and preset save/load (`btStore.ts:50`).

Cross-link `GUIDE-TUTORIAL_STRATEGIE.md` as worked SMA-50 example. Replace placeholders, keep `my-docs/` routing intact.

**Verify**: `wc -l my-docs/GUIDE_manuale_bt_gui.md` ≥80; `grep -c "Builder\|Results\|Strategies\|Price" my-docs/GUIDE_manuale_bt_gui.md` ≥4

### Step 3: Fix tutorial and AVVIARE paths

- `my-docs/GUIDE-TUTORIAL_STRATEGIE.md` Steps 1-2: replace `Fetch FFN` + `path_or_tickers` with `Ticker Catalog → Fetch yfinance` per `priceDataApi.fetch` (`frontend/src/api/bt.ts:164`) and `fetch_and_store_yf` (`backend/services/data_loader.py:78`). Keep Steps 3-5 strategy shape but note tickers come from `price_data`.
- `my-docs/GUIDE-AVVIARE-GUI.md:259-260`: change `docs/` → `my-docs/`, and either add `scripts/sync-from-bt-gui.sh` stub or remove future promise with `ponytail: sync manual until integration stabilizes`.

**Verify**: `grep -q "yfinance" my-docs/GUIDE-TUTORIAL_STRATEGIE.md && echo ok`

### Step 4: Amend SPEC and promote ADR 007

- `plans/SPEC.md:329 §9 decision 2`: flip `ffn` v1 → `yfinance` canonical, `ffn` as legacy adapter.
- `plans/SPEC.md:294,372`: mark `StrategyTree → .py` export, heatmap, multi-run overlay as `deferred — see direction 011`, keep acceptance but flag not in v1.
- Promote `.opencode/plans/007-unified-ticker-data.md` → add one-line entry in `plans/README.md` references or copy summary as ADR note `plans/ADR-007-price-data-canonical.md`.

**Verify**: `grep -q "yfinance.*canonical\|price_data.*canonical" plans/SPEC.md && echo ok`

## Test plan

- Docs-only: no pytest needed beyond gate `uv run ruff check .` → 0 (no Python change).
- Manual: open `my-docs/GUIDE_documentazione_tecnica.md` and confirm PriceData table renders; `npm run build --prefix frontend` → 0.

## Done criteria

- [ ] `grep -rn "price_data" my-docs/GUIDE_documentazione_tecnica.md` ≥3; file ≥100 lines, describes `backend/api/*.py` split
- [ ] `wc -l my-docs/GUIDE_manuale_bt_gui.md` ≥80 and covers 5 views + DB switcher
- [ ] `grep -q "yfinance" my-docs/GUIDE-TUTORIAL_STRATEGIE.md` and `grep -q "yfinance" plans/SPEC.md`
- [ ] `grep -rn "docs/" my-docs/GUIDE-AVVIARE-GUI.md` → 0 (all `my-docs/`)
- [ ] `uv run ruff check .` → 0
- [ ] `plans/README.md` row 010 → DONE

## STOP conditions

- `price_data` to `data_sources` price path is still dual-written in `backend/api/backtest.py:67` fallback (`price_source_id` legacy) — don't remove fallback code, just document `price_data` as canonical.
- Manual fill would require screenshots not available — STOP, use text checklists only, no image assets.
- SPEC amendment would contradict `../bt/plans/SPEC.md` sibling — STOP, amend only `bt-gui/plans/SPEC.md` local copy, note divergence in ADR.

## Maintenance notes

- Future price_data bulk-delete (direction-03) and compare overlay (direction-01) should update `GUIDE_manuale_bt_gui.md` corresponding sections.
- Keep `GUIDE_documentazione_tecnica.md` in sync when adding new `backend/api/*.py` domains; add file to drift check in future plans.

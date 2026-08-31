# Plan 004: Split ResultsDashboard god component (548 lines)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 8f78919..HEAD -- frontend/src/bt/components/ResultsDashboard.tsx`
> If the file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch, treat it as STOP.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: 003 (preserves store shape; order not hard but sequential is safer for reviews)
- **Category**: tech-debt
- **Planned at**: commit `8f78919`, 2026-08-30

## Why this matters

`ResultsDashboard.tsx` is 548 lines (>500 hard limit) and violates `GUIDE 5` (hook vs component separation). It mixes equity/drawdown chart sync (`227-304`), metrics grouping (`114-125`, `461-501`), transactions table (`127-149`, `503-543`), and runs list with filters (`152-410`) in one component. No hook can be reused or tested. Splitting restores one-responsibility and brings every file under 300.

## Current state

- `frontend/src/bt/components/ResultsDashboard.tsx:1-548` — single default export `ResultsDashboard({runId})` with:
  - Style const `S` (6-24), helpers `toTime:26`, `sanitizeLine:31`, `buildDrawdown:43`, `PERCENT_KEYS:57`, `METRIC_GROUPS:67`, `formatMetric:73`
  - State: 12 `useState` for filters/sort/collapsed/selected/expanded/prices/stats/tx (84-112)
  - `groupedMetrics` useMemo (114-125), `txCols/txDisplay/txHandleSort` (127-149)
  - `refresh` (153-180), `loadDetail` (182-194), `toggleExpanded` (196-209), auto-refresh `hasRunning` (214-219)
  - Chart sync `useEffect` 80 lines (227-304) with `createChart`, `LineSeries`, `AreaSeries`, crosshair sync, `ResizeObserver`
  - Render: runs table 75 lines (375-449), metrics 40 lines (462-501), transactions 40 lines (503-543)
- `frontend/src/bt/store/btStore.ts` provides `runs` etc. but `ResultsDashboard` keeps its own `runs` state duplicating store — acceptable to keep local for now.

Repo conventions:

- `GUIDE 5` — hooks `hooks/useXxx.ts` zero JSX, components only JSX, store Zustand.
- `frontend/src/hooks/` does not exist yet (plan 005 creates it or this plan creates subset). Create `frontend/src/bt/hooks/` or `frontend/src/hooks/` — prefer `frontend/src/bt/hooks/` to match `bt/` domain (see `AGENTS.md:3` — `hooks/useTreeDrag.ts` etc. at `frontend/src/hooks/` in spec but `frontend/src/bt/` is current layout; pick one and be consistent — this plan uses `frontend/src/hooks/` per `GUIDE`).

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| FE build | `npm run build --prefix frontend` | exit 0 |
| Lint | `uv run ruff check .` | exit 0 |

## Scope

**In scope**:

- `frontend/src/bt/components/ResultsDashboard.tsx` (refactor to orchestrator <150 lines)
- `frontend/src/hooks/useRunsTable.ts` (create)
- `frontend/src/hooks/useRunDetail.ts` (create)
- `frontend/src/hooks/useEquityCharts.ts` (create)
- `frontend/src/bt/components/RunsTable.tsx` (create)
- `frontend/src/bt/components/MetricsPanel.tsx` (create)
- `frontend/src/bt/components/TransactionsTable.tsx` (create)

**Out of scope**:

- `frontend/src/bt/store/btStore.ts` (plan 003)
- `backend/*`
- `frontend/src/api/bt.ts`

## Git workflow

- Branch: `advisor/004-split-results-dashboard`
- Commit: `refactor(ui): split ResultsDashboard into hooks and panels`
- Do NOT push unless instructed.

## Steps

### Step 1: Extract hooks

Create three hooks — each zero JSX, per `GUIDE 5`:

1. `frontend/src/hooks/useRunsTable.ts` — owns `runs`, `search/searchDraft`, `sortBy/sortDir`, `fId/fStrategyName/.../fStats`, `selected`, `expanded`, `refresh`, `toggleOne/toggleAll/handleDeleteOne/handleBulkDelete/resetFilters`, `hasRunning` polling (interval 1500). Export `{ runs, sel, setSel, ... , refresh }`. Copy logic verbatim from `ResultsDashboard.tsx:84-219` and `306-354`.
2. `frontend/src/hooks/useRunDetail.ts` — owns `prices, stats, tx, expanded, sel` detail loading: `loadDetail`, `toggleExpanded`, `groupedMetrics` memo. Move `groupedMetrics` (114-125) here.
3. `frontend/src/hooks/useEquityCharts.ts` — owns `chartRef, ddRef, prices` chart effect (227-304) plus helpers `toTime, sanitizeLine, buildDrawdown`. Export `useEquityCharts(prices) => { chartRef, ddRef }`. Keep `lightweight-charts` imports here.

Each hook must be <150 lines.

**Verify**: `npm run build --prefix frontend` → still builds (hooks not yet wired).

### Step 2: Extract panels

Create pure components (only JSX + props):

- `frontend/src/bt/components/RunsTable.tsx` — table from `375-449`, props: `runs, selected, expanded, sortBy, sortDir, filters, onSort, onFilter, onToggleOne, onToggleAll, onToggleExpanded, onDeleteOne`. Move `S.table/th/...` styles or import shared `S`.
- `frontend/src/bt/components/MetricsPanel.tsx` — from `462-501`, props `stats, groupedMetrics, collapsed, setCollapsed`. Move `PERCENT_KEYS, METRIC_GROUPS, formatMetric` here or to `hooks/useRunDetail`.
- `frontend/src/bt/components/TransactionsTable.tsx` — from `503-543`, props `tx, txCols, txDisplay, txSortKey, txSortDir, txFilters, onSort, onFilter`. Keep memo logic in `useRunDetail` or here — pick one, document.

Each component <150 lines, no `useState` beyond local UI toggle.

**Verify**: `npm run build --prefix frontend` → 0

### Step 3: Recompose ResultsDashboard as orchestrator

Rewrite `ResultsDashboard.tsx` to <150 lines:

```tsx
export default function ResultsDashboard({ runId }: { runId: number | null }) {
  const table = useRunsTable(runId)
  const detail = useRunDetail(table.sel)
  const charts = useEquityCharts(detail.prices)
  return (
    <div style={S.wrap}>
      <RunsTable {...table} onToggleExpanded={detail.toggleExpanded} />
      {table.sel && <EquityCharts refs={charts} />}
      {detail.stats && <MetricsPanel {...detail} />}
      {detail.tx.length>0 && <TransactionsTable {...detail} />}
    </div>
  )
}
```

Keep `S.wrap/card` thin or import from panels. Delete duplicated helpers.

**Verify**: `wc -l frontend/src/bt/components/ResultsDashboard.tsx` → <150; `wc -l frontend/src/hooks/useRunsTable.ts frontend/src/hooks/useEquityCharts.ts` → each <200; `npm run build --prefix frontend` → 0

## Test plan

- No new backend tests. FE build is gate. Manual sanity: `npm run dev -- --port 3001` and check Results view still filters/sorts and charts sync.
- Keep behavior identical — no prop renaming that breaks `App.tsx` usage.

## Done criteria

- [ ] `wc -l frontend/src/bt/components/ResultsDashboard.tsx` < 150
- [ ] `ls frontend/src/hooks/useRunsTable.ts frontend/src/hooks/useEquityCharts.ts frontend/src/bt/components/RunsTable.tsx frontend/src/bt/components/MetricsPanel.tsx` all exist
- [ ] No file in `frontend/src/bt/components/` exceeds 300 lines (`wc -l` check)
- [ ] `npm run build --prefix frontend` exits 0
- [ ] `uv run ruff check .` exits 0
- [ ] `plans/README.md` row 004 → DONE

## STOP conditions

- Drift: `ResultsDashboard.tsx` structure doesn't match excerpts (e.g. already split) — STOP.
- Any hook needs to import a component (JSX leak) — STOP, hooks must stay zero JSX.
- FE build fails due to `lightweight-charts` import moved — STOP and keep `createChart, LineSeries, AreaSeries` in the hook that owns the effect, not the component.

## Maintenance notes

- New table columns: add to `useRunsTable` filter state and to `RunsTable` props once.
- Chart sync logic lives in `useEquityCharts` — future pan/zoom changes there, not in orchestrator.

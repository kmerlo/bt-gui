# Plan 003: Deduplicate btStore.ts (435 lines, 8× saveStoredPreset)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `advisor-plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 8f78919..HEAD -- frontend/src/bt/store/btStore.ts`
> If the file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch, treat it as STOP.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none (parallelizable with 001/002, but merge after 002 to avoid conflicts)
- **Category**: tech-debt
- **Planned at**: commit `8f78919`, 2026-08-30

## Why this matters

`frontend/src/bt/store/btStore.ts` is 435 lines (>300 soft limit, near 500 hard) and repeats the same `saveStoredPreset({...})` block 8 times (every setter). Adding one field now requires 8 edits — a guaranteed bug where one path forgets to persist. The file also mixes helpers (`uid`, `loadStoredPreset`, `buildPresetForTree`, tree-mutators) with the Zustand store, violating `GUIDE 5` (hook/store/component separation).

## Current state

- `frontend/src/bt/store/btStore.ts:1-435` — entire file. Key excerpts:
  - `BUILDER_PRESET_KEY = 'bt-builder-preset:v1'` (line 11), `StoredPreset` type (22-31), `loadStoredPreset` (44-69), `saveStoredPreset` (71-77), `defaultPreset` (79-97), `createDefaultTree` (99-115), `buildPresetForTree` (118-136), `findNode/findParent/updateNodeRec/...` (143-188), `BtStore` type (192-219), store creation with `_stored/_defPreset/_init` (221-435).
  - Every setter repeats:
    ```ts
    setTickerStart: (tickerStart) => {
      set({ tickerStart })
      const s = get()
      saveStoredPreset({ tickerStart, tickerEnd: s.tickerEnd, priceColumn: s.priceColumn, extraSourceIds: s.extraSourceIds, indicatorSourceIds: s.indicatorSourceIds, backtestConfig: s.backtestConfig, selectedId: s.selectedId, showIndicators: s.showIndicators })
    },
    ```
    8 occurrences: `setSelected:288`, `toggleIndicators:304`, `setTickerStart:318`, `setTickerEnd:332`, `setPriceColumn:346`, `setExtraSourceIds:360`, `setIndicatorSourceIds:374`, `setBacktestConfig:388` (and `setTree` variant at 272).

Repo conventions:

- `GUIDE 1` — file <300 lines, `GUIDE 6` — Zustand for shared state, `GUIDE 2` — extract at 2nd related function.
- Target split: `btStore.ts` stays <250 lines, helpers go to `bt/store/preset.ts` and `bt/store/treeOps.ts`.

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| FE build | `npm run build --prefix frontend` | exit 0 |
| Lint | `npm run build --prefix frontend` doubles as typecheck (`tsc -b`) | exit 0 |
| Tests BE | `uv run pytest -q` | all pass (no BE change, sanity) |

## Scope

**In scope**:

- `frontend/src/bt/store/btStore.ts` (refactor)
- `frontend/src/bt/store/preset.ts` (create)
- `frontend/src/bt/store/treeOps.ts` (create)

**Out of scope**:

- `frontend/src/bt/components/*` — no component changes.
- `backend/*` — nothing.
- `frontend/src/types/bt.ts` — auto-generated, never edit by hand (`AGENTS.md:1`).

## Git workflow

- Branch: `advisor/003-deduplicate-btstore`
- Commit: `refactor(store): deduplicate btStore preset persistence`
- Do NOT push unless instructed.

## Steps

### Step 1: Extract `preset.ts`

Create `frontend/src/bt/store/preset.ts`:

- Move: `BUILDER_PRESET_KEY`, `StoredPreset`, `BuilderBacktestConfig` (or keep type in `btStore.ts` and import), `getToday`, `getOneYearAgo`, `loadStoredPreset`, `saveStoredPreset`, `defaultPreset`, `buildPresetForTree`, `applyPresetToTree`.
- Export `loadStoredPreset`, `saveStoredPreset`, `defaultPreset`, `buildPresetForTree`, `applyPresetToTree`, `BUILDER_PRESET_KEY`.
- Keep `loadSettings` import there (it was in `btStore.ts:3`). Ensure `verbatimModuleSyntax` — use `import type`.

**Verify**: `npm run build --prefix frontend` → still passes (import path updated in `btStore.ts` next).

### Step 2: Extract `treeOps.ts`

Create `frontend/src/bt/store/treeOps.ts`:

- Move: `uid`, `findNode`, `findParent`, `updateNodeRec`, `addChildRec`, `removeRec`, `insertAtRec`, `createDefaultTree`.
- Export them. `createDefaultTree` stays exported from there and re-exported from `btStore.ts` if external callers import it (they do: `BuilderView.tsx:2`).

**Verify**: `npm run build --prefix frontend` → 0

### Step 3: Deduplicate persistence via `persist()` helper

In `frontend/src/bt/store/btStore.ts`:

- Import from `./preset` and `./treeOps`.
- Replace every 8-line `saveStoredPreset({...})` block with a single helper:
  ```ts
  function persist(get: () => BtStore) {
    const s = get()
    saveStoredPreset({ tickerStart: s.tickerStart, tickerEnd: s.tickerEnd, priceColumn: s.priceColumn, extraSourceIds: s.extraSourceIds, indicatorSourceIds: s.indicatorSourceIds, backtestConfig: s.backtestConfig, selectedId: s.selectedId, showIndicators: s.showIndicators })
  }
  ```
- Then each setter becomes `setTickerStart: (v) => { set({ tickerStart: v }); persist(get) }` etc. For `setTree`, keep the existing `if (raw && ...)` branch but end with `persist` logic via `saveStoredPreset` already there → replace with `persist` call that reads from `get()` after `set(next)`.
- Ensure file drops below 300 lines (`wc -l frontend/src/bt/store/btStore.ts`).

**Verify**: `wc -l frontend/src/bt/store/btStore.ts` → <300; `grep -c "saveStoredPreset" frontend/src/bt/store/btStore.ts` → 1 (only the import + persist helper), not 8.

### Step 4: Re-export for compatibility

If external imports break, add re-exports at bottom of `btStore.ts`:

```ts
export { createDefaultTree } from './treeOps'
export type { StoredPreset, BuilderBacktestConfig } from './preset'
```

But prefer keeping `createDefaultTree` imported from `treeOps` directly in callers — update `BuilderView.tsx` import if needed (single line).

**Verify**: `npm run build --prefix frontend` → 0; `uv run pytest -q` → 0

## Test plan

- No new backend tests. Manual FE sanity: `npm run build` must pass (covers `noUnusedLocals` etc.).
- Optional: add `frontend/src/bt/store/btStore.test.ts` trivial test that `setTickerStart` persists (if test infra exists) — skip if no vitest setup; don't introduce new tooling.

## Done criteria

- [ ] `wc -l frontend/src/bt/store/btStore.ts` < 300 (target <250)
- [ ] `grep -n "saveStoredPreset" frontend/src/bt/store/btStore.ts` → ≤2 matches (import + helper)
- [ ] `ls frontend/src/bt/store/preset.ts frontend/src/bt/store/treeOps.ts` both exist
- [ ] `npm run build --prefix frontend` exits 0
- [ ] `uv run ruff check .` exits 0 (if BE untouched, trivially)
- [ ] `advisor-plans/README.md` row 003 → DONE

## STOP conditions

- Drift: `btStore.ts` excerpt mismatches (e.g. `StoredPreset` already moved).
- `npm run build` fails due to circular import `preset.ts <-> btStore.ts` — STOP and inline `loadSettings` instead of importing store.
- Any external file still imports `createDefaultTree` from `btStore.ts` and now fails — STOP and add re-export rather than chasing callers.

## Maintenance notes

- New preset fields: add to `StoredPreset` in `preset.ts` and to `persist()` once — not per-setter.
- Tree ops: add new helpers in `treeOps.ts`, not in `btStore.ts`.

# Plan 005: Extract BuilderView hooks and deduplicate findDup

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 8f78919..HEAD -- frontend/src/bt/components/BuilderView.tsx frontend/src/bt/store/btStore.ts`
> If files changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch, treat it as STOP.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: 003 (uses `treeOps` exports), 004 (hook layout decision)
- **Category**: tech-debt
- **Planned at**: commit `8f78919`, 2026-08-30

## Why this matters

`BuilderView.tsx` is 372 lines (>300) and violates `GUIDE 2` (extract at 2nd function) and `GUIDE 5` (logic in hooks). `handleSave` and `handleSaveAsNew` duplicate the `findDup` validation (20 lines each) and tree assembly (`preset`, `targetName`, `toSave`) verbatim. Drag logic (`onDragStart/onDragEnd` 80 lines) belongs in `hooks/useTreeDrag.ts` per `AGENTS.md:3`. The store helpers `findNode/findParent` are already being moved in plan 003 — this plan consumes them.

## Current state

- `frontend/src/bt/components/BuilderView.tsx:1-372`:
  - `PaletteCard` (25-52), `uid` (54-56)
  - `BuilderView` default export (58-372): `tree/setTree/addChild/moveNode` from `useBtStore`, `nameDraft/savedId/msg/activeType/rows/loadId/showIndicators` states, `useEffect` bootstrap (62-92), `refreshList` (94-102), `handleSave` (104-154), `handleSaveAsNew` (156-205), `handleLoad` (207-222), `handleNew` (224-231), `treeNameCommit` (233-239), `onDragStart` (241-245), `onDragEnd` (247-315), render `DndContext` (324-372).
  - Duplicate `findDup` closure inside both `handleSave` and `handleSaveAsNew`:
    ```ts
    const dup = (() => {
      const findDup = (node: NodeConfig): string | null => {
        if (node.children.length > 0) {
          const seen = new Map<string, string>()
          for (const c of node.children) {
            if (seen.has(c.name)) return `'${c.name}' duplicato sotto '${node.name}'`
            seen.set(c.name, c.id ?? c.name)
          }
          for (const c of node.children) { const d = findDup(c); if (d) return d }
        }
        return null
      }
      return findDup(freshTree.root as NodeConfig)
    })()
    ```
- `frontend/src/bt/store/btStore.ts` already exports `findNode/findParent` — after plan 003 they live in `treeOps.ts`.
- No `frontend/src/hooks/` exists yet.

Repo conventions: `GUIDE 2` extract at 2nd function, `GUIDE 5` hook = zero JSX.

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| FE build | `npm run build --prefix frontend` | exit 0 |
| Lint | `uv run ruff check .` | exit 0 |

## Scope

**In scope**:

- `frontend/src/hooks/useTreeDrag.ts` (create)
- `frontend/src/hooks/useStrategySave.ts` (create)
- `frontend/src/bt/components/BuilderView.tsx` (refactor to <150 lines)
- `frontend/src/bt/components/PaletteCard.tsx` (optional extract, if needed to hit line target)

**Out of scope**:

- `backend/*`
- `frontend/src/bt/store/*` (plan 003 owns it; import from there)
- `frontend/src/bt/components/TreeEditor.tsx`, `NodeInspector.tsx` — don't touch.

## Git workflow

- Branch: `advisor/005-builder-hooks-dedup`
- Commit: `refactor(ui): extract BuilderView drag and save hooks`
- Do NOT push unless instructed.

## Steps

### Step 1: Create `useTreeDrag` hook

Create `frontend/src/hooks/useTreeDrag.ts`:

- Export `function useTreeDrag(tree, addChild, moveNode): { activeType, onDragStart, onDragEnd }`
- Move `onDragStart` (241-245) and `onDragEnd` (247-315) verbatim. Import `findNode, findParent` from `../bt/store/treeOps` (or `btStore` if 003 not yet merged — handle both via re-export).
- Keep `uid()` import from `treeOps` or local. Keep `NODE_TYPES` type.
- Zero JSX. <150 lines.

**Verify**: `npm run build --prefix frontend` → transient fail is ok (hook not yet used), but file must typecheck when imported.

### Step 2: Create `useStrategySave` hook and deduplicate `findDup`

Create `frontend/src/hooks/useStrategySave.ts`:

- Move `refreshList`, `handleSave`, `handleSaveAsNew`, `handleLoad`, `handleNew`, `treeNameCommit` out of `BuilderView`.
- Deduplicate `findDup` into a single exported helper `function findDuplicateName(root: NodeConfig): string | null` at top of this file (single implementation). Both save paths call it.
- Deduplicate tree assembly into `function assembleTreeToSave(tree, nameDraft, getState)` that does `buildPresetForTree`, `targetName`, `toSave` once.
- Export `{ rows, loadId, setLoadId, savedId, msg, nameDraft, setNameDraft, handleSave, handleSaveAsNew, handleLoad, handleNew, treeNameCommit }`.

**Verify**: `npm run build --prefix frontend` → 0 after wiring.

### Step 3: Recompose BuilderView as orchestrator

Refactor `BuilderView.tsx` to ~120 lines:

- Keep `PaletteCard` or move to `PaletteCard.tsx` if needed to stay <150.
- Import hooks:
  ```ts
  const { activeType, onDragStart, onDragEnd } = useTreeDrag(tree, addChild, moveNode)
  const save = useStrategySave(tree, setTree, nameDraft, setNameDraft, setMsg)
  ```
- Render stays same `DndContext` + `Palette` + `TreeEditor` + `NodeInspector` + `IndicatorPanel`.
- Remove duplicated `findDup` blocks — now single call.

**Verify**: `wc -l frontend/src/bt/components/BuilderView.tsx` → <150; `npm run build --prefix frontend` → 0; `grep -c "findDup" frontend/src/bt/components/BuilderView.tsx` → 0 (only in hook).

## Test plan

- FE build is gate. Manual drag-and-drop and Save/Save as new still work, duplicate name shows error `"'X' duplicato sotto 'Y'"`.
- `uv run pytest -q` → all pass (no BE change).

## Done criteria

- [ ] `wc -l frontend/src/bt/components/BuilderView.tsx` < 150
- [ ] `ls frontend/src/hooks/useTreeDrag.ts frontend/src/hooks/useStrategySave.ts` exist, each <150 lines
- [ ] `grep -rn "findDup" frontend/src` → exactly 1 definition in `useStrategySave.ts` (no duplicate)
- [ ] `npm run build --prefix frontend` exits 0
- [ ] `plans/README.md` row 005 → DONE

## STOP conditions

- Drift: `BuilderView.tsx` already <150 or `findDup` already deduped — STOP and update README.
- `useTreeDrag` needs JSX (`DragOverlay`) — STOP, keep `DragOverlay` in `BuilderView`, hook returns only data/callbacks.
- FE build fails due to `treeOps` circular import — STOP and import directly from `btStore.ts` fallback.

## Maintenance notes

- New node types: add to `NODE_TYPES` in `useTreeDrag`, not in `BuilderView`.
- Save validation: single `findDuplicateName` in `useStrategySave.ts` — add future checks there.

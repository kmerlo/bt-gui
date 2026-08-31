# Plan 020: Add null guard for tree load in useStrategySave

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to
> the next step. If anything in the "STOP conditions" section occurs,
> stop and report — do not improvise. When done, update the status row
> for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 3203810..HEAD -- frontend/src/hooks/useStrategySave.ts`
> If the file content differs from the excerpts below, compare carefully
> before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S (10 min)
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `3203810`, 2026-08-30
- **Issue**: —

## Why this matters

`useStrategySave.ts:122-124` casts the API response tree with `as unknown as StrategyTree` and then uses non-null assertions (`t!`) without checking if `t` is actually present. If the backend returns a strategy row whose `tree` field is null (corrupt or legacy row), `t!.name` throws a runtime TypeError, crashing the save-load flow and leaving the UI in an inconsistent state.

## Current state

**File**: `frontend/src/hooks/useStrategySave.ts`, lines 117–130:

```tsx
  const handleLoad = async (): Promise<void> => {
    const sid = Number(loadId)
    if (!sid) return
    try {
      const r = await strategiesApi.get(sid)
      const t = r.tree as unknown as StrategyTree
      setTree(t!)
      setNameDraft(t!.name)
      setSavedId(sid)
      setMsg(`loaded #${sid}`)
    } catch (e) {
      setMsg(String(e))
    }
  }
```

Same pattern appears at lines 76 and 81 (update path):
```tsx
        setTree(r.tree as unknown as StrategyTree)
```

## Commands you will need

| Purpose   | Command                           | Expected on success |
|-----------|-----------------------------------|---------------------|
| Typecheck | `cd frontend && npm run typecheck` | exit 0              |
| Build     | `cd frontend && npm run build`     | exit 0              |

## Scope

**In scope**:
- `frontend/src/hooks/useStrategySave.ts`

**Out of scope**:
- Any other file
- Backend changes

## Steps

### Step 1: Add null guard in handleLoad

Replace lines 121–124:

```tsx
      const r = await strategiesApi.get(sid)
      const t = r.tree as unknown as StrategyTree
      setTree(t!)
      setNameDraft(t!.name)
```

With:

```tsx
      const r = await strategiesApi.get(sid)
      const t = r.tree as unknown as StrategyTree | null | undefined
      if (!t) {
        setMsg(`strategy #${sid} has no tree data`)
        return
      }
      setTree(t)
      setNameDraft(t.name)
```

### Step 2: Add null guard in handleSave (update path)

In `handleSave` (line 76), replace:
```tsx
        setTree(r.tree as unknown as StrategyTree)
```
with:
```tsx
        const loaded = r.tree as unknown as StrategyTree | null | undefined
        if (!loaded) { setMsg('invalid tree in response'); return }
        setTree(loaded)
```

### Step 3: Add null guard in handleSave (create path)

In `handleSave` (line 81), same pattern — add the guard.

### Step 4: Add null guard in handleSaveAsNew

In `handleSaveAsNew` (line 107), same pattern — add the guard.

## Test plan

No new automated test. Manual verification:
1. Load a strategy with a valid tree → should work as before.
2. Simulate a null tree response (temporarily modify the API mock or use browser DevTools to intercept) → should show an error message, not crash.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `cd frontend && npm run typecheck` exits 0
- [ ] `cd frontend && npm run build` exits 0
- [ ] `grep -n "t!" frontend/src/hooks/useStrategySave.ts` returns 0 matches (no non-null assertions on potentially-null values)
- [ ] `grep -n "if (!t)" frontend/src/hooks/useStrategySave.ts` returns ≥ 1 match
- [ ] `git diff --name-only` lists only `frontend/src/hooks/useStrategySave.ts`

## STOP conditions

- TypeScript complains about `r.tree` type after the cast → STOP and report. The type of `r.tree` may have changed; read the current `StrategyRow` type in `frontend/src/api/strategies.ts` first.

## Maintenance notes

- The `as unknown as StrategyTree` casts remain — they are a separate issue (plan not in scope). This plan only adds the null guard.
- If `strategiesApi.get` is ever updated to return a properly typed response, these casts can be removed.

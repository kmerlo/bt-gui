# Plan 022: Remove console.log from AlgoStack

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to
> the next step. If anything in the "STOP conditions" section occurs,
> stop and report — do not improvise. When done, update the status row
> for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 3203810..HEAD -- frontend/src/bt/components/AlgoStack.tsx`
> If the file content differs from the excerpts below, compare carefully
> before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: S (5 min)
- **Risk**: LOW
- **Depends on**: plans/021.md (ESLint must be working first, otherwise the removal won't be enforced)
- **Category**: tech-debt
- **Planned at**: commit `3203810`, 2026-08-30
- **Issue**: —

## Why this matters

`AlgoStack.tsx:153` contains a `console.log` that fires on every algo list load in production. It outputs the number of loaded algos and the first 3 names. This is debug noise that violates the project's production-code hygiene standards (no stray logging in shipped code). ESLint with `no-console` rule (enabled in plan 009) would catch this, but the log was added before the lint gate existed.

## Current state

**File**: `frontend/src/bt/components/AlgoStack.tsx`, line 153:

```tsx
        console.log(`[AlgoStack] Loaded ${l.length} algos`, l.slice(0, 3).map(a => a.name))
```

This is inside a `useEffect` that loads the algo list on mount.

## Commands you will need

| Purpose   | Command                           | Expected on success |
|-----------|-----------------------------------|---------------------|
| Lint      | `cd frontend && npm run lint`     | exit 0              |
| Build     | `cd frontend && npm run build`    | exit 0              |

## Scope

**In scope**:
- `frontend/src/bt/components/AlgoStack.tsx` — remove line 153

**Out of scope**:
- Any other file
- No logic changes

## Steps

### Step 1: Delete the console.log line

Remove line 153 from `frontend/src/bt/components/AlgoStack.tsx`:

```tsx
        console.log(`[AlgoStack] Loaded ${l.length} algos`, l.slice(0, 3).map(a => a.name))
```

The surrounding code (lines 149–158) should remain intact:
```tsx
    algosApi
      .list()
      .then((l) => {
        setMetas(l)
        if (l.length > 0 && !l.find((x) => x.name === sel)) setSel(l[0].name)
      })
      .catch((e) => {
        console.error('[AlgoStack] Failed to load algos:', e)
      })
```

Note: `console.error` on line 157 is acceptable (it logs actual errors); only the `console.log` diagnostic is removed.

## Test plan

```bash
cd frontend && npm run lint
```
Expected: exit 0.

```bash
cd frontend && npm run build
```
Expected: exit 0.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -n "console\.log" frontend/src/bt/components/AlgoStack.tsx` returns 0 matches
- [ ] `grep -n "console\.error" frontend/src/bt/components/AlgoStack.tsx` returns ≥ 1 match (error logging preserved)
- [ ] `cd frontend && npm run lint` exits 0
- [ ] `cd frontend && npm run build` exits 0
- [ ] `git diff --name-only` lists only `frontend/src/bt/components/AlgoStack.tsx`

## STOP conditions

- ESLint reports other errors in this file after the removal → STOP and fix those too (they're pre-existing, not introduced by this plan).

## Maintenance notes

- `console.error` for actual failures is fine — it helps with debugging production issues. Only diagnostic `console.log` calls should be removed.
- If algo-loading diagnostics are needed in the future, use a proper logging library or a debug flag gated by `import.meta.env.DEV`.

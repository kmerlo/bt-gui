# Plan 013: Fix WebSocket leak and uncancellable poll in RunDialog

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to
> the next step. If anything in the "STOP conditions" section occurs,
> stop and report — do not improvise. When done, update the status row
> for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 3203810..HEAD -- frontend/src/bt/components/RunDialog.tsx`
> If the file content differs from the excerpts below, compare carefully
> before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S (30 min)
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `3203810`, 2026-08-30
- **Issue**: —

## Why this matters

`RunDialog.tsx` creates a `WebSocket` directly inside `handleRun` (not in a `useEffect`) and never closes it on unmount or re-render. The `ws.onerror` fallback starts an untracked `setTimeout(poll, 1000)` loop that also survives re-renders. Result: navigating away during a backtest leaves an open WS and possibly multiple concurrent pollers, each calling `setProgress` / `setRunning` on a possibly-unmounted component.

## Current state

**File**: `frontend/src/bt/components/RunDialog.tsx` (214 lines)

The relevant section (lines 116–152):

```tsx
    try {
      const res = await backtestApi.create({...})
      const id = res.id
      onRunCreated?.(id)
      setMsg(`run #${id} started`)
      const ws = backtestApi.wsProgress(id)
      ws.onmessage = (ev: MessageEvent) => {
        try {
          const d = JSON.parse(ev.data as string) as { progress: number; done: boolean; error?: string }
          setProgress(d.progress)
          if (d.error) setMsg(`error: ${d.error}`)
          if (d.done) { ws.close(); setRunning(false); setProgress(1) }
        } catch { /* ignore */ }
      }
      ws.onerror = () => {
        let tries = 0
        const poll = async () => {
          tries++
          try {
            const r = await backtestApi.getRun(id)
            if (r.stats) { setProgress(1); setRunning(false); return }
          } catch { /* ignore */ }
          if (tries < 30) setTimeout(poll, 500)
          else setRunning(false)
        }
        setTimeout(poll, 1000)
      }
    } catch (e) {
      setMsg(String(e))
      setRunning(false)
    }
```

The repo convention for effects is `useEffect` + cleanup. See `frontend/src/hooks/useRunsTable.ts` for the standard pattern (fetch in effect, cleanup aborts).

## Commands you will need

| Purpose   | Command                           | Expected on success |
|-----------|-----------------------------------|---------------------|
| Typecheck | `cd frontend && npm run typecheck` | exit 0              |
| Build     | `cd frontend && npm run build`     | exit 0              |

## Scope

**In scope** (the only file to modify):
- `frontend/src/bt/components/RunDialog.tsx`

**Out of scope**:
- Any other component
- `frontend/src/api/runs.ts` (the `wsProgress` helper is fine as-is)
- Backend changes

## Steps

### Step 1: Add a `useRef` for the abort signal and the poll timer

Add at the top of the component body (after existing `useState` declarations):

```tsx
  const abortRef = useRef({ stopped: false, pollTimer: -1 as number })
  const wsRef = useRef<WebSocket | null>(null)
```

Make sure `useRef` is imported from `'react'` (line 1 currently imports `useEffect, useState` only — add `useRef`).

### Step 2: Wrap WS setup in a `useEffect` with cleanup

Replace the entire `try { ... } catch (e) { ... }` block in `handleRun` (lines 116–152) with a call to a new helper function `startProgress(id)` defined outside the component (or as a `useCallback`), and drive it from a `useEffect` that depends on `running`:

```tsx
  useEffect(() => {
    if (!running) return
    const id = /* run id — see note below */
    // ...
  }, [running])
```

Actually, the simplest and most correct approach is to refactor `handleRun` to use a `useEffect` that watches a `runId` state variable:

1. Add `const [runId, setRunId] = useState<number | null>(null)` before `handleRun`.
2. In `handleRun`, after getting `res.id`, call `setRunId(id)` instead of setting progress directly.
3. Add a new `useEffect` that watches `runId`:

```tsx
  useEffect(() => {
    const id = runId
    if (id == null) return
    const ws = backtestApi.wsProgress(id)
    wsRef.current = ws
    abortRef.current = { stopped: false, pollTimer: -1 }
    const onMsg = (ev: MessageEvent) => {
      try {
        const d = JSON.parse(ev.data as string) as { progress: number; done: boolean; error?: string }
        setProgress(d.progress)
        if (d.error) setMsg(`error: ${d.error}`)
        if (d.done) { ws.close(); setRunning(false); setProgress(1) }
      } catch { /* ignore */ }
    }
    const onErr = () => {
      let tries = 0
      const poll = async () => {
        if (abortRef.current.stopped) return
        tries++
        try {
          const r = await backtestApi.getRun(id)
          if (r.stats) { setProgress(1); setRunning(false); return }
        } catch { /* ignore */ }
        if (tries >= 30) { setRunning(false); return }
        abortRef.current.pollTimer = window.setTimeout(poll, 500) as unknown as number
      }
      abortRef.current.pollTimer = window.setTimeout(poll, 1000) as unknown as number
    }
    ws.addEventListener('message', onMsg)
    ws.addEventListener('error', onErr)
    return () => {
      abortRef.current.stopped = true
      if (abortRef.current.pollTimer) window.clearTimeout(abortRef.pollTimer)
      ws.close()
      ws.removeEventListener('message', onMsg)
      ws.removeEventListener('error', onErr)
      wsRef.current = null
    }
  }, [runId])
```

### Step 3: Update handleRun to only set state, not manage WS

`handleRun` should now only:
- Validate inputs
- Call `backtestApi.create()`
- Call `setRunId(res.id)` and `onRunCreated?.(res.id)`
- Set `setRunning(true)` and `setProgress(0.05)`

Remove all WS/poll logic from `handleRun`.

### Step 4: Remove the standalone `ws` and `poll` state variables

The old `ws` const inside `handleRun` and the nested `poll` closure are gone. The `tries` counter now lives inside the `onErr` closure and is captured by the `poll` closure inside `useEffect`.

## Test plan

No new test file needed. Verify manually:
1. Start a backtest → watch progress bar fill.
2. Navigate away (switch to another view tab) while running → check browser DevTools Network tab: WS should be closed (no "pending" connections after unmount).
3. Trigger a WS error path (hard by design, but verify no console errors appear).

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `cd frontend && npm run typecheck` exits 0
- [ ] `cd frontend && npm run build` exits 0
- [ ] No `ws.onmessage =` or `ws.onerror =` assignments remain in `RunDialog.tsx` (only `addEventListener` in the effect)
- [ ] `useEffect` has a `return () => { ... }` cleanup that calls `ws.close()` and clears the poll timer
- [ ] `git diff --name-only` lists only `frontend/src/bt/components/RunDialog.tsx`

## STOP conditions

- TypeScript reports an error you cannot fix after two reasonable attempts → STOP and report.
- The `useEffect` dependencies cause an infinite render loop → STOP and report.

## Maintenance notes

- If `backtestApi.wsProgress` is ever changed to return a different object shape, update the `addEventListener` calls accordingly.
- The poll timeout uses `window.setTimeout` return as `number` (TypeScript types it as `number | ReturnType<typeof setTimeout>`). The `as unknown as number` cast suppresses the type difference — acceptable for this small utility.

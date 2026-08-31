# Plan 024: Add frontend test infrastructure with Vitest

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to
> the next step. If anything in the "STOP conditions" section occurs,
> stop and report — do not improvise. When done, update the status row
> for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 3203810..HEAD -- frontend/package.json frontend/vite.config.ts frontend/src/bt/store/btStore.ts`
> If the file content differs from the excerpts below, compare carefully
> before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M (~2 h)
- **Risk**: LOW
- **Depends on**: plans/021.md (ESLint must be working first so lint errors don't block test setup)
- **Category**: tests
- **Planned at**: commit `3203810`, 2026-08-30
- **Issue**: —

## Why this matters

The frontend has zero test infrastructure. The most user-facing layer (Builder → Run → Results) has no automated regression net. Any refactor to `btStore.ts` or components can break silently until manual E2E catches it. Adding Vitest + `@testing-library/react` with one characterizing test for `btStore.setTree` round-trip establishes the foundation for future FE tests.

## Current state

**`frontend/package.json`**: No test-related dependencies or scripts.
```json
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "typecheck": "tsc -b --noEmit",
    "lint": "eslint .",
    "preview": "vite preview",
    "gen:types": "openapi-typescript http://localhost:8001/openapi.json -o src/types/bt.ts"
  }
```

**`frontend/vite.config.ts`** — check if it exists and what it contains (Vite config is needed for Vitest integration).

The project uses React 19, TypeScript strict, and Zustand `^5`.

## Commands you will need

| Purpose   | Command                              | Expected on success |
|-----------|--------------------------------------|---------------------|
| Test      | `cd frontend && npx vitest run`      | 1 test pass         |
| Build     | `cd frontend && npm run build`       | exit 0              |
| Lint      | `cd frontend && npm run lint`        | exit 0              |

## Scope

**In scope**:
- `frontend/package.json` — add `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom` as devDeps; add `test` and `test:watch` scripts
- `frontend/vite.config.ts` — add Vitest plugin configuration
- `frontend/vitest.config.ts` — create dedicated Vitest config
- `frontend/tests/frontend/setup.ts` — test setup file
- `frontend/tests/frontend/btStore.test.ts` — first characterizing test

**Out of scope**:
- Testing any component (next plan)
- Testing hooks
- CI integration (future plan)
- Snapshot tests

## Steps

### Step 1: Check existing vite.config.ts

Read `frontend/vite.config.ts`. If it doesn't exist, check `frontend/vite.config.js` or `frontend/vite.config.mjs`. The Vitest config will extend or mirror it.

### Step 2: Install test dependencies

```bash
cd frontend && npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom @types/jest-dom
```

### Step 3: Add test scripts to package.json

Add to the `scripts` object:
```json
    "test": "vitest run",
    "test:watch": "vitest"
```

### Step 4: Create `frontend/vitest.config.ts`

```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/frontend/setup.ts'],
    globals: true,
  },
})
```

### Step 5: Create `frontend/tests/frontend/setup.ts`

```ts
import '@testing-library/jest-dom/vitest'
```

### Step 6: Write the first characterizing test

**`frontend/tests/frontend/btStore.test.ts`**:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useBtStore } from '@/bt/store/btStore'
import type { StrategyTree } from '@/types/bt'

function createTestTree(name: string = 'test-tree'): StrategyTree {
  return {
    name,
    root: {
      id: 'root-1',
      name,
      type: 'Strategy',
      algos: [],
      children: [],
    },
    version: 1,
  }
}

describe('btStore', () => {
  beforeEach(() => {
    // Reset store to clean state before each test
    useBtStore.getState().setTree(null as unknown as StrategyTree)
    useBtStore.getState().setSelected(null)
  })

  it('sets tree and selects root node', () => {
    const tree = createTestTree('my-strategy')
    useBtStore.getState().setTree(tree)
    expect(useBtStore.getState().tree).toBe(tree)
    expect(useBtStore.getState().selectedId).toBe('root-1')
  })

  it('persists tickerStart and tickerEnd via preset', () => {
    useBtStore.getState().setTickerStart('01/01/2024')
    useBtStore.getState().setTickerEnd('31/12/2024')
    expect(useBtStore.getState().tickerStart).toBe('01/01/2024')
    expect(useBtStore.getState().tickerEnd).toBe('31/12/2024')
  })

  it('returns null tree when setTree(null) is called', () => {
    useBtStore.getState().setTree(createTestTree())
    expect(useBtStore.getState().tree).not.toBeNull()
    useBtStore.getState().setTree(null as unknown as StrategyTree)
    expect(useBtStore.getState().tree).toBeNull()
  })
})
```

### Step 7: Run the test suite

```bash
cd frontend && npx vitest run
```

Expected: 3 tests pass.

## Test plan

```bash
cd frontend && npx vitest run
```
Expected: 3 tests pass, 0 failures.

```bash
cd frontend && npm run build
```
Expected: exit 0 (test files are excluded from build by Vite).

```bash
cd frontend && npm run lint
```
Expected: exit 0 (test files should pass lint; if `no-unused-vars` flags test imports, adjust the rule).

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `frontend/vitest.config.ts` exists
- [ ] `frontend/tests/frontend/setup.ts` exists
- [ ] `frontend/tests/frontend/btStore.test.ts` exists with ≥ 3 tests
- [ ] `cd frontend && npx vitest run` exits 0 with ≥ 3 passing tests
- [ ] `cd frontend && npm run build` exits 0
- [ ] `git diff --name-only` shows only the planned files (plus `package-lock.json`)

## STOP conditions

- `vitest` installation fails due to Node version incompatibility → STOP and report. Check `node --version` and `npm ls vitest` before proceeding.
- The existing `btStore.ts` reset pattern (`setTree(null)`) doesn't work as expected → read `btStore.ts:74-114` to understand the `setTree` implementation and adjust the test `beforeEach` accordingly.

## Maintenance notes

- Vitest shares the Vite config, so `@/` path alias works in tests without extra configuration.
- The `globals: true` in vitest config allows `describe`, `it`, `expect` without importing — match the style of existing backend tests if preferred.
- Future test plans should add component tests following this same pattern.

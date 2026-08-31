# Plan 021: Fix broken npm run lint with ESLint flat config

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to
> the next step. If anything in the "STOP conditions" section occurs,
> stop and report — do not improvise. When done, update the status row
> for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 3203810..HEAD -- frontend/package.json frontend/eslint.config.*`
> If the file content differs from the excerpts below, compare carefully
> before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S (20 min)
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `3203810`, 2026-08-30
- **Issue**: —

## Why this matters

`frontend/package.json:10` defines `"lint": "eslint ."` but no ESLint config file exists in `frontend/`. Running `npm run lint` prints ESLint v10's migration warning and exits non-zero. This means the CI pipeline (`.github/workflows/ci.yml`) never runs FE linting, and developers have no lint gate. The fix is to add an ESLint flat config (`eslint.config.ts`) with a minimal sensible rule set.

## Current state

**`frontend/package.json`** (relevant lines):
```json
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "typecheck": "tsc -b --noEmit",
    "lint": "eslint .",
    "preview": "vite preview",
    "gen:types": "openapi-typescript http://localhost:8001/openapi.json -o src/types/bt.ts"
  },
  "devDependencies": {
    ...
    "eslint": "^10.3.0",
    ...
  }
```

**No `frontend/eslint.config.*` file exists.** ESLint v9+ requires a flat config file; without one, `eslint .` fails with a migration message.

CI (`.github/workflows/ci.yml`) currently runs `tsc -b` and `vite build` but not `eslint`.

## Commands you will need

| Purpose   | Command                              | Expected on success |
|-----------|--------------------------------------|---------------------|
| Lint      | `cd frontend && npm run lint`        | exit 0              |
| Build     | `cd frontend && npm run build`       | exit 0              |

## Scope

**In scope**:
- `frontend/eslint.config.ts` (create)
- `frontend/package.json` (no changes needed — lint script already exists)
- `.github/workflows/ci.yml` (add `npm run lint` step)

**Out of scope**:
- Adding new eslint plugins beyond `@eslint/js` and `plugin:react-hooks/recommended`
- Formatting rules (handled by ruff for BE, Prettier not needed for FE)
- Any backend changes

## Steps

### Step 1: Create `frontend/eslint.config.ts`

Create the file with this content:

```ts
import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-non-null-assertion': 'off', // already caught by TS strict
    },
  },
  {
    ignores: ['dist/', 'src/types/bt.ts'],
  },
)
```

### Step 2: Install the missing ESLint plugins

The config references `@eslint/js`, `typescript-eslint`, and `eslint-plugin-react-hooks`. Check if they're already in `package.json`:

```bash
cd frontend && npm ls @eslint/js typescript-eslint eslint-plugin-react-hooks 2>&1 | head -20
```

If any are missing, install them:
```bash
cd frontend && npm install -D @eslint/js typescript-eslint eslint-plugin-react-hooks
```

### Step 3: Run lint and fix any issues

```bash
cd frontend && npm run lint
```

If there are errors, fix them. The most common issues will be:
- Unused variables (auto-fixable with `--fix`)
- Explicit `any` (change to proper types or mark as `warn`)

Run with auto-fix first:
```bash
cd frontend && npx eslint . --fix
```

Then run again to verify clean.

### Step 4: Add lint to CI

In `.github/workflows/ci.yml`, add `npm run lint` after `npm run typecheck`:

```yaml
      - run: npm run typecheck --prefix frontend && npm run lint --prefix frontend && npm run build --prefix frontend
```

## Test plan

```bash
cd frontend && npm run lint
```
Expected: exit 0, no errors.

```bash
cd frontend && npm run build
```
Expected: exit 0.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `frontend/eslint.config.ts` exists
- [ ] `cd frontend && npm run lint` exits 0
- [ ] `cd frontend && npm run build` exits 0
- [ ] `.github/workflows/ci.yml` includes `npm run lint` in the FE job
- [ ] `src/types/bt.ts` is excluded from linting (generated file)

## STOP conditions

- Lint reports more than 10 errors after `--fix` → STOP and report. The config may need tweaking; don't spend more than 30 min on this.
- `typescript-eslint` version is incompatible with TS 6.0.2 → check `npm install` output; if it fails, use `typescript-eslint` v7.x which supports TS 5.x and report back.

## Maintenance notes

- `@typescript-eslint/no-non-null-assertion: 'off'` is intentional — the TS strict config already catches these at compile time, and runtime null checks are handled by plan 008.
- The generated file `src/types/bt.ts` is excluded because it's auto-generated and should not be linted.
- If new rules are needed later, add them to the `rules` object in the config.

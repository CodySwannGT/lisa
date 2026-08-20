# Apply Lisa to acmeorgd/frontend and acmeorgb/frontend-v2

## Overview

Run `bun run dev <path> -y` from Lisa on both projects, then commit and push. Fix any breakages and upstream fixes to Lisa if needed.

Both projects are on Lisa v1.12.1 (current Lisa is v1.15.0+ with the jest setupFiles fix from earlier). Lisa will apply `all/` + `typescript/` + `expo/` templates.

## Key Risks

### acmeorgd/frontend
- **On `main` branch** - must create a feature branch first
- Has `jest.config.js` (CommonJS, multi-project config for eslint-plugins + expo tests). Lisa will create `jest.config.ts` alongside it - the .js file must be deleted or it will conflict
- `jest.setup.pre.js` is minimal (only `__ExpoImportMetaRegistry` + `structuredClone`) - does NOT define `__DEV__`. Since the updated Lisa template has empty `setupFiles`, no jest-expo setup will run automatically. Need to either use `jest-expo` preset in local config or add `__DEV__` definition to setup.pre.js
- Multi-project config (eslint-plugin tests in node env + expo tests) will be lost - need to handle eslint plugin testing in `jest.config.local.ts`
- 98% coverage threshold - need to preserve in `jest.thresholds.json`

### acmeorgb/frontend-v2
- **On `dev` branch** - must create a feature branch first
- Has `jest.config.ts` that will be overwritten by Lisa template
- `jest.setup.pre.js` is comprehensive (defines `__DEV__`, bridge mocks, turbo module proxy, etc.) - similar to acmeorga
- Custom `testMatch`, `moduleNameMapper`, `transformIgnorePatterns` need to go into `jest.config.local.ts`
- 70% coverage threshold (matches Lisa default)

## Execution Plan

### Task 1: Create feature branches (parallel)
- `cd ~/workspace/acmeorgd/frontend && git checkout -b chore/update-lisa`
- `cd ~/workspace/acmeorgb/frontend-v2 && git checkout -b chore/update-lisa`

### Task 2: Run Lisa on both (sequential, from lisa dir)
```bash
cd ~/workspace/lisa
bun run dev ~/workspace/acmeorgd/frontend -y
bun run dev ~/workspace/acmeorgb/frontend-v2 -y
```

### Task 3: Fix acmeorgd/frontend post-Lisa
1. **Delete old jest.config.js** - conflicts with new jest.config.ts
2. **Create jest.config.local.ts** with:
   - Multi-project support for eslint plugin tests (node env)
   - `setupFiles: ["<rootDir>/jest.setup.pre.js"]`
   - `setupFilesAfterEnv: ["<rootDir>/jest.setup.js"]`
   - `moduleNameMapper` for `@/` paths
   - `testMatch` patterns from old config
   - `testPathIgnorePatterns` for `/components/ui/`
   - `transformIgnorePatterns` specific to this project
3. **Update jest.setup.pre.js** - Add `__DEV__`, `IS_REACT_ACT_ENVIRONMENT`, `IS_REACT_NATIVE_TEST_ENVIRONMENT` globals (currently missing, relied on jest-expo preset)
4. **Update jest.thresholds.json** - Set to 98% (project's current threshold)
5. **Run `bun run test:cov`** to verify tests pass
6. **Run `bun run lint`**, **`bun run typecheck`**, **`bun run knip`** to check for other issues

### Task 4: Fix acmeorgb/frontend-v2 post-Lisa
1. **Create/update jest.config.local.ts** with:
   - `setupFiles: ["<rootDir>/jest.setup.pre.js"]`
   - `setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"]`
   - `moduleNameMapper` for `features/`, `e2e/`, `@/components/`, `@/providers/`, `@/hooks/`, `@/`
   - `testMatch` patterns from old config
   - `transformIgnorePatterns` specific to this project
   - `coveragePathIgnorePatterns` if needed
   - `testPathIgnorePatterns` for eslint plugin test files matching
2. **Run `bun run test:cov`** to verify tests pass
3. **Run `bun run lint`**, **`bun run typecheck`**, **`bun run knip`** to check for other issues

### Task 5: Fix any Lisa upstream issues
- If either project reveals template bugs, fix in Lisa and commit

### Task 6: Commit and push all repos
- Use `/git:commit` skill for conventional commits
- Push with `GIT_SSH_COMMAND="ssh -o ServerAliveInterval=30 -o ServerAliveCountMax=5"`

## Critical Files

| File | Project | Action |
|------|---------|--------|
| `jest.config.js` | acmeorgd | Delete (replaced by jest.config.ts) |
| `jest.config.local.ts` | acmeorgd | Create with project-specific config |
| `jest.setup.pre.js` | acmeorgd | Update to add __DEV__ and RN globals |
| `jest.thresholds.json` | acmeorgd | Update to 98% thresholds |
| `jest.config.local.ts` | acmeorgb | Create with project-specific config |
| Various Lisa-managed files | both | Auto-applied by Lisa |

## Skills to Use
- `/jsdoc-best-practices` when writing new jest.config.local.ts files
- `/git:commit` for atomic commits

## Verification

```bash
# acmeorgd - verify all quality gates pass
cd ~/workspace/acmeorgd/frontend
bun run test:cov
bun run test:integration
bun run lint
bun run typecheck
bun run knip

# acmeorgb - verify all quality gates pass
cd ~/workspace/acmeorgb/frontend-v2
bun run test:cov
bun run test:integration
bun run lint
bun run typecheck
bun run knip

# Push both to verify pre-push hooks pass end-to-end
```

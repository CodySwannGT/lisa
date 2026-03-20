# Plan: Fix api-creator Lisa Onboarding (Conform to Standards)

## Context

The initial onboarding (PR #4) took shortcuts: relaxed ESLint rules in `eslint.config.local.ts`, raised thresholds, lowered coverage requirements, modified Lisa-managed files, and skipped conforming the codebase to Lisa standards. This plan corrects all 8 issues the user raised — the project must fully conform to Lisa defaults with zero local overrides.

## Sessions

| Session | Date | Branch |
|---------|------|--------|
| Initial onboarding | 2026-03-19 | `chore/lisa-onboarding` |
| Corrections (this plan) | 2026-03-19 | `chore/lisa-onboarding` (continue) |

---

## Issue 1: Remove `globals: true` from vitest.config.local.ts

All 9 test files already import `describe`, `it`, `expect` from `"vitest"` explicitly. The `globals: true` override is unnecessary.

**File**: `vitest.config.local.ts`
**Action**: Remove `globals: true`. Keep only `test.include` for the `test/` directory path.

```ts
const config: ViteUserConfig = {
  test: {
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
  },
};
```

---

## Issue 2: Reset eslint.thresholds.json to Lisa defaults & fix code

**File**: `eslint.thresholds.json`
**Action**: Reset to `{ "cognitiveComplexity": 10, "maxLines": 300, "maxLinesPerFunction": 75 }`

### Files exceeding maxLines (300)

| File | Current Lines | Action |
|------|--------------|--------|
| `src/generator/cli-project-emitter.ts` | 842 | Split into 3 files |
| `src/generator/client-emitter.ts` | 466 | Split into 2 files |
| `src/parser/type-inferrer.ts` | 461 | Split into 2 files |
| `src/runtime/project-runner.ts` | 379 | Split into 2 files |
| `src/commands/test.ts` | 373 | Split into 2 files |

### Refactoring strategy for cli-project-emitter.ts (842 → 3 files)

- `src/generator/cli-project-emitter.ts` — Keep `emitProjectPackageJson`, `emitProjectTsconfig`, `emitProjectGitignore`, `emitProjectBinEntry`, `emitProjectReadme` + helpers (`singularize`, `camelToKebab`, `kebabToCamel`)
- `src/generator/auth-emitter.ts` — Extract `emitAuthModule`
- `src/generator/commands-emitter.ts` — Extract `emitCommandsModule` (split GraphQL vs REST into separate helper functions to reduce cognitive complexity)
- `src/generator/cli-entrypoint-emitter.ts` — Extract `emitCli` (split auth command generation into helpers)

### Refactoring strategy for client-emitter.ts (466 → 2 files)

- `src/generator/client-emitter.ts` — Keep core client class emission
- `src/generator/client-method-emitter.ts` — Extract per-method emission logic (GraphQL vs REST)

### Refactoring strategy for type-inferrer.ts (461 → 2 files)

- `src/parser/type-inferrer.ts` — Keep public API (`inferTypes`, `inferRequestTypes`) and top-level `inferTypeFromBodies`
- `src/parser/property-inferrer.ts` — Extract `inferPropertyDefinition`, `inferArrayProperty`, `mergeObjectShapes`, `mergeScalarTypes` and helpers

### Refactoring strategy for project-runner.ts (379 → 2 files)

- `src/runtime/project-runner.ts` — Keep `registerProjectRunCommands` orchestration
- `src/runtime/endpoint-command-builder.ts` — Extract `registerEndpointCommand` logic, split GraphQL vs REST handlers

### Refactoring strategy for commands/test.ts (373 → 2 files)

- `src/commands/test.ts` — Keep command registration and high-level flow
- `src/commands/test-parsers.ts` — Extract `parseEndpoints`, `parseMethods`, `buildTestSource` helpers

### Functions exceeding maxLinesPerFunction (75) and cognitive complexity (10)

After file splits, further decompose large functions:
- `emitCommandsModule` (343 lines, complexity 94) → extract `emitGraphQLEndpoint()`, `emitRestEndpoint()`, `buildActionHandler()`
- `emitCli` (208 lines) → extract `emitAuthSetupCommand()`, `emitAuthStatusCommand()`, `emitParseAuthFromInput()`
- `registerEndpointCommand` (181 lines, complexity 40) → extract `buildGraphQLAction()`, `buildRestAction()`
- `inferPropertyDefinition` (91 lines, complexity 27) → extract `inferScalarProperty()`, `inferNestedObjectProperty()`, `inferMixedProperty()`
- `inferArrayProperty` (84 lines) → extract `inferObjectArrayElements()`, `inferPrimitiveArrayElements()`

---

## Issue 3: Use Lisa's .gitignore

**File**: `api-creator/.gitignore`
**Action**: Replace with Lisa's `all/copy-contents/.gitignore` template (204 lines) + append api-creator-specific entries at the end:

```
# api-creator specific
recordings
generated
*.har
airbnb/
*.auth
```

Remove the `.claude/memory/` entry (Issue 5). Remove `.lisabak/`, `coverage/`, `.eslintcache` entries (already in Lisa template).

---

## Issue 4: Upstream `coverage` to Lisa's .prettierignore

**File**: `lisa/typescript/copy-overwrite/.prettierignore`
**Action**: Add `coverage` line to the template so all TypeScript projects benefit.

Do NOT modify api-creator's `.prettierignore` directly (Lisa-managed, copy-overwrite).

---

## Issue 5: Don't gitignore .claude/memory/

Handled in Issue 3 — the line is removed when replacing .gitignore with Lisa template.

---

## Issue 6: Reset vitest.thresholds.json to 70% & add test coverage

**File**: `vitest.thresholds.json`
**Action**: Reset to `{ "global": { "statements": 70, "branches": 70, "functions": 70, "lines": 70 } }`

Current coverage: 28.66% statements, 24.71% branches, 32.48% functions, 29.31% lines.

### Files needing tests (sorted by impact)

| Directory | Current Coverage | Priority | Strategy |
|-----------|-----------------|----------|----------|
| `src/commands/` (6 files) | 0% | High | Mock fs/readline, test command logic |
| `src/runtime/` (4 files) | 0% | High | Mock fs/child_process, test curl-parser and project-manager |
| `src/recorder/` (3 files) | 0% | Medium | Mock Playwright, test capture logic |
| `src/generator/codegen.ts` | 0% | High | Pure function, easy to test |
| `src/generator/diff-merger.ts` | 0% | High | Mostly pure logic, easy to test |
| `src/generator/cli-project-emitter.ts` | 0% | High | String generators, easy to snapshot test |
| `src/parser/har-reader.ts` | 0% | Medium | Mock fs, test parsing logic |

### Test writing approach

1. Start with pure functions that need no mocking (codegen, emitters, diff-merger)
2. Add tests for parsers with mock data (curl-parser, har-reader)
3. Add command tests with mocked I/O (commands/*)
4. Add runtime tests with mocked fs/child_process
5. Skip recorder tests if possible (Playwright mocking is complex) — coverage may still reach 70% without them if other areas are well-covered

---

## Issue 7: Don't modify knip.json

**File**: `knip.json`
**Action**: Revert to Lisa default (no `"eslint", "prettier", "knip", "ast-grep"` in `ignoreBinaries`). These binaries are already declared as direct devDependencies in package.json, so knip can resolve them without ignore entries.

Verify that the Lisa postinstall has already reset knip.json to the default. If it has stale edits, let Lisa overwrite it by re-running: `node node_modules/@codyswann/lisa/dist/index.js --yes --skip-git-check .`

---

## Issue 8: Empty eslint.config.local.ts & fix all errors

**File**: `eslint.config.local.ts`
**Action**: Reset to empty default:

```ts
export default [];
```

Then fix ALL ESLint violations in the codebase. Categories of fixes:

| Rule | Count | Fix Strategy |
|------|-------|-------------|
| `functional/no-let` | ~83 | Replace with `const` + ternary, reduce, or restructure |
| `functional/immutable-data` | ~100+ | Replace `push` with spread, mutation with new objects |
| `no-param-reassign` | ~10 | Use new const variables instead of reassigning params |
| `jsdoc/require-jsdoc` | many | Add JSDoc to all exported functions/interfaces |
| `jsdoc/require-returns` | many | Add `@returns` to JSDoc blocks |
| `jsdoc/require-description` | many | Add descriptions to JSDoc blocks |
| `jsdoc/require-param-description` | many | Add descriptions to `@param` tags |
| `code-organization/enforce-statement-order` | ~31 | Reorder: definitions → side effects → return |
| `sonarjs/cognitive-complexity` | 6 | Decompose functions (addressed in Issue 2 refactoring) |
| `sonarjs/prefer-regexp-exec` | ~10 | Replace `.match()` with `RegExp.exec()` |
| `sonarjs/no-alphabetical-sort` | ~5 | Add `localeCompare` compare function |
| `sonarjs/slow-regex` | ~5 | Optimize or flag as acceptable (code-gen string literals) |
| `sonarjs/no-duplicate-string` | ~5 | Extract to named constants |
| `sonarjs/no-duplicated-branches` | ~2 | Merge identical branches |
| `sonarjs/reduce-initial-value` | ~1 | Add initial value to reduce calls |
| `sonarjs/no-nested-template-literals` | ~2 | Extract inner templates to variables |

---

## Execution Order

1. **Upstream .prettierignore** (Issue 4) — Lisa repo change, quick
2. **Reset eslint.config.local.ts** to empty (Issue 8)
3. **Reset eslint.thresholds.json** to defaults (Issue 2)
4. **Reset vitest.config.local.ts** — remove globals (Issue 1)
5. **Replace .gitignore** with Lisa template + project entries (Issues 3, 5)
6. **Revert knip.json** to Lisa default (Issue 7)
7. **Refactor large files** — split files exceeding 300 lines (Issue 2)
8. **Decompose large functions** — reduce to <75 lines and complexity <10 (Issue 2)
9. **Fix all ESLint violations** — functional, jsdoc, sonarjs, code-organization (Issue 8)
10. **Run `bun run format`** to fix any Prettier issues from refactoring
11. **Add test coverage** to reach 70% (Issue 6)
12. **Reset vitest.thresholds.json** to 70/70/70/70 (Issue 6)
13. **Verify all checks pass**: build, typecheck, lint, test, format:check, knip
14. **Commit, push, watch CI**

## Critical Files

| File | Action |
|------|--------|
| `lisa/typescript/copy-overwrite/.prettierignore` | Add `coverage` |
| `api-creator/eslint.config.local.ts` | Reset to `export default []` |
| `api-creator/eslint.thresholds.json` | Reset to `{10, 300, 75}` |
| `api-creator/vitest.config.local.ts` | Remove `globals: true` |
| `api-creator/vitest.thresholds.json` | Reset to `{70, 70, 70, 70}` |
| `api-creator/.gitignore` | Replace with Lisa template + project entries |
| `api-creator/knip.json` | Revert to Lisa default |
| `api-creator/src/generator/cli-project-emitter.ts` | Split into 4 files |
| `api-creator/src/generator/client-emitter.ts` | Split into 2 files |
| `api-creator/src/parser/type-inferrer.ts` | Split into 2 files |
| `api-creator/src/runtime/project-runner.ts` | Split into 2 files |
| `api-creator/src/commands/test.ts` | Split into 2 files |
| `api-creator/test/**` | Add extensive new test files |

## Verification

1. `bun run build` exits 0
2. `bun run typecheck` exits 0
3. `bun run lint` exits 0 (no relaxed rules, default thresholds)
4. `bun run test` exits 0 (all tests pass)
5. `bun run test:cov` — all coverage ≥70%
6. `bun run format:check` exits 0
7. `bun run knip` exits 0
8. Pre-commit and pre-push hooks pass
9. CI passes on GitHub Actions

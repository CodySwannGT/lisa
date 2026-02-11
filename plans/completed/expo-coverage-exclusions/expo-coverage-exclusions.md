# Upstream Expo Coverage Exclusions from frontend-v2

## Context

frontend-v2 added coverage exclusions for `app/` route files and `*View.{ts,tsx}` presentational files in their project-local `jest.config.local.ts`. These are Expo-wide patterns that should be in Lisa's managed Expo Jest config so all Expo projects benefit:

- **`app/` routes**: Expo Router uses file-based routing — `app/` contains thin wrappers (8-15 lines) that just import and render feature components. No business logic to test.
- **`*View.{ts,tsx}` files**: In the Container/View pattern, View files are purely presentational (no `useState`, `useEffect`, or business logic). Coverage should focus on Container files that hold logic.

**Source of change**: `frontend-v2` commit `6c5a7b93` — "chore: exclude app routes and view files from test coverage"

## Approach

Modify `jest.expo.ts` (Lisa-managed Expo config) to:
1. Remove `"app/**/*.{ts,tsx}"` from the `collectCoverageFrom` inclusion list (line 103)
2. Add `"!**/*View.{ts,tsx}"` negation pattern alongside existing `defaultCoverageExclusions`

This means:
- `app/` files simply won't be collected (no inclusion = no collection)
- `*View.{ts,tsx}` files in any included directory (components, features, etc.) will be excluded via negation

No changes to `jest.base.ts` — these patterns are Expo-specific, not cross-stack.

## Files to Modify

| File | Change |
|------|--------|
| `expo/copy-overwrite/jest.expo.ts` | Remove `app/` inclusion, add View exclusion, update preamble |
| `tests/unit/config/jest-expo.test.ts` | Update directory pattern test, add View/app exclusion tests |

## Tasks

### Task 1: Create branch and open draft PR

### Task 2: Update Expo Jest config to exclude app routes and View files

**File**: `expo/copy-overwrite/jest.expo.ts`

1. Remove `"app/**/*.{ts,tsx}"` from `collectCoverageFrom` (line 103)
2. Add `"!**/*View.{ts,tsx}"` before `...defaultCoverageExclusions` spread
3. Update JSDoc preamble (lines 24-26) to document why app/ and View files are excluded

### Task 3: Update jest-expo tests for new coverage patterns (TDD)

**File**: `tests/unit/config/jest-expo.test.ts`

1. RED: Update existing test "scopes collectCoverageFrom to Expo source directories" (line 61) — remove `app` from the regex since it's no longer an inclusion pattern
2. RED: Add test verifying `app/` is NOT in the inclusion patterns
3. RED: Add test verifying `*View.{ts,tsx}` negation pattern is present
4. GREEN: Changes from Task 2 should make all tests pass
5. REFACTOR: Clean up if needed

### Task 4: Product/UX review using `product-reviewer` agent

### Task 5: CodeRabbit code review

### Task 6: Local code review via `/plan-local-code-review`

### Task 7: Technical review using `tech-reviewer` agent

### Task 8: Implement valid review suggestions

Runs after all reviews (tasks 4-7) complete.

### Task 9: Simplify code using `code-simplifier` agent

### Task 10: Update/add/remove tests as needed

### Task 11: Update/add/remove documentation (JSDoc, markdown)

### Task 12: Verify all verification metadata in existing tasks

### Task 13: Collect learnings using `learner` agent

### Task 14: Archive the plan

## Verification

```bash
# Run the jest-expo tests
bun run test -- tests/unit/config/jest-expo.test.ts

# Verify app/ is not in collectCoverageFrom inclusions
bun run test -- tests/unit/config/jest-expo.test.ts -t "does not include app directory"

# Full test suite passes
bun run test
```

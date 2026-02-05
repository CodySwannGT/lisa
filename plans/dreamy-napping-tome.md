# Plan: Exclude `__fixtures__` from Jest coverage thresholds

## Context

The ESLint ignore config (`eslint.ignore.config.json:59`) already excludes `**/__fixtures__/**`, but the Jest `defaultCoverageExclusions` in `jest.base.ts` does not. Fixture directories contain test data, not production code, and should not count toward (or against) coverage thresholds.

## Branch & PR

- Branch: `fix/inclusive-integration-test-patterns` (current branch, already has an open PR)
- Push to existing PR

## Changes

### 1. Update template source: `typescript/copy-overwrite/jest.base.ts`

Add `"!**/__fixtures__/**"` to the `defaultCoverageExclusions` array (after `!**/__mocks__/**`, before `!**/components/ui/**`).

### 2. Update Lisa's own config: `jest.base.ts` (root)

Same change — keep in sync with the template.

### 3. Update test: `tests/unit/config/jest-base.test.ts`

Add assertion: `expect(defaultCoverageExclusions).toContain("!**/__fixtures__/**")` in the `defaultCoverageExclusions` describe block.

## Task List

After approval, create the following tasks using TaskCreate:

1. **Add `__fixtures__` exclusion to jest.base.ts template and root** — modify both files, run tests
2. **Run CodeRabbit review** — `/coderabbit:review`
3. **Run local code review** — `/plan:local-code-review`
4. **Implement valid review suggestions**
5. **Simplify code with code-simplifier agent**
6. **Update/verify tests** — ensure `jest-base.test.ts` covers the new exclusion
7. **Verify all task verification metadata**
8. **Archive plan** — move to `plans/completed/`, move task sessions, commit and push

## Verification

```bash
bun test -- tests/unit/config/jest-base.test.ts
```

Expected: all tests pass, including a new assertion for `__fixtures__` exclusion.

## Sessions
| f2a27ec5-c09f-48f9-b1cd-8d7ac5bf94c6 | 2026-02-05T14:42:36Z | plan |

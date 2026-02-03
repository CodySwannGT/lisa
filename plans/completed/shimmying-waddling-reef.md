# Fix PR Review Findings for jest.base.ts and jest.config.local.ts

## Summary

Address 4 of 5 PR review findings. One finding (deep merge for mergeConfigs) is rejected as unnecessary per KISS/YAGNI — shallow merge is correct for Jest config objects.

## Findings Assessment

| # | Finding | Verdict | Reason |
|---|---------|---------|--------|
| 1 | `mergeThresholds` drops non-global overrides | **Fix** | Real bug — per-path threshold keys from overrides are silently dropped |
| 2 | Misleading comment in `jest.config.local.ts` | **Fix** | Comment implies replacement but mergeConfigs concatenates arrays |
| 3 | `mergeConfigs` needs deep merge | **Skip** | Shallow merge is correct — `transform`, `moduleNameMapper` are flat; deep merge could cause unexpected behavior |
| 4 | Add JSDoc scope docs to template `mergeThresholds` | **Fix** | Update JSDoc to reflect new behavior after fix #1 |
| 5 | Update tests | **Fix** | Add test coverage for per-path threshold preservation |

## Tasks (in parallel where possible)

### Task 1: Fix `mergeThresholds` in both files (parallel with Task 2)

**Files:**
- `typescript/copy-overwrite/jest.base.ts` (template — source of truth)
- `jest.base.ts` (project copy — managed by Lisa)

**Change** (line 58-67 in both files):

```typescript
// Before
export const mergeThresholds = (
  defaults: Config["coverageThreshold"],
  overrides: Config["coverageThreshold"]
): Config["coverageThreshold"] => ({
  ...defaults,
  global: {
    ...(defaults?.global as Record<string, number>),
    ...(overrides?.global as Record<string, number>),
  },
});

// After
export const mergeThresholds = (
  defaults: Config["coverageThreshold"],
  overrides: Config["coverageThreshold"]
): Config["coverageThreshold"] => ({
  ...defaults,
  ...overrides,
  global: {
    ...(defaults?.global as Record<string, number>),
    ...(overrides?.global as Record<string, number>),
  },
});
```

Also update JSDoc on the template to document per-path key preservation:

```typescript
/**
 * Merges project-specific threshold overrides into default thresholds.
 * Allows projects to selectively raise or lower coverage requirements
 * via jest.thresholds.json without replacing the entire threshold object.
 *
 * Spreads all top-level keys from both defaults and overrides (including
 * per-path/per-file patterns like `"./src/api/": { branches: 80 }`).
 * The `global` key receives special treatment: its properties are
 * shallow-merged so individual metrics can be overridden without
 * replacing the entire global object.
 *
 * @param defaults - Base thresholds from the stack config
 * @param overrides - Project-specific overrides from jest.thresholds.json
 * @returns Merged thresholds with overrides taking precedence
 */
```

**Skills:** `/jsdoc-best-practices` when writing JSDoc

### Task 2: Update comment in `jest.config.local.ts` (parallel with Task 1)

**File:** `jest.config.local.ts`

**Change** (line 13):

```typescript
// Before
// Lisa uses tests/ directory instead of default src/**/*.test.ts

// After
// Lisa prefers tests/ as the primary test location. Note: mergeConfigs
// concatenates arrays, so this entry combines with the stack's testMatch
// (which may include src/**/*.test.ts), resulting in both patterns being active.
```

### Task 3: Add tests for per-path threshold preservation

**File:** `tests/unit/config/jest-base.test.ts`

Add test cases to `mergeThresholds` describe block:

1. Test that per-path keys from overrides are preserved
2. Test that per-path keys from defaults are preserved when not in overrides
3. Test that per-path keys from overrides take precedence over defaults

### Task 4: Update documentation preambles

Verify JSDoc preambles are accurate in all modified files.

## Verification

```bash
# Run existing + new tests
bun run test -- tests/unit/config/jest-base.test.ts

# Verify template and project file are in sync
diff jest.base.ts typescript/copy-overwrite/jest.base.ts

# Lint
bun run lint -- jest.base.ts jest.config.local.ts typescript/copy-overwrite/jest.base.ts

# Typecheck
bun run typecheck
```

## Not Changing

**`mergeConfigs` deep merge** — The shallow merge is intentional and documented. Jest config objects (`transform`, `moduleNameMapper`) are flat key-value maps where shallow merge is the correct semantic. Deep merge would prevent users from replacing configs and adds complexity without practical benefit. The existing test at line 128-142 validates this behavior explicitly.

---
description: Increase test coverage to a specified threshold percentage
allowed-tools: Read, Bash, Glob, Grep
argument-hint: <threshold-percentage>
model: sonnet
---

# Increase Test Coverage

Target threshold: $ARGUMENTS%

If no argument provided, prompt the user for a target.

## Step 1: Gather Requirements

1. **Find coverage config** (jest.config.js, vitest.config.ts, .nycrc, etc.)
2. **Run coverage report** to get current state:
   ```bash
   bun run test:cov 2>&1 | head -100
   ```
3. **Identify the 20 files with lowest coverage**, noting:
   - File path
   - Current coverage % (lines, branches, functions)
   - Which lines/branches are uncovered

## Step 2: Generate Brief

Compile findings into a detailed brief:

```
Increase test coverage from [current]% to $ARGUMENTS%.

## Files Needing Coverage (ordered by coverage gap)

1. src/services/user.ts - 23% coverage (target: $ARGUMENTS%)
   - Uncovered: lines 45-67, 89-102
   - Missing branch coverage: lines 34, 56
2. src/utils/helpers.ts - 34% coverage (target: $ARGUMENTS%)
   - Uncovered: lines 12-45
...

## Configuration
- Config file: [path to coverage config]
- Update thresholds to $ARGUMENTS% for: lines, branches, functions, statements

## Acceptance Criteria
- All files meet $ARGUMENTS% coverage threshold
- `bun run test:cov` passes with no threshold violations

## Verification
Command: `bun run test:cov`
Expected: All thresholds pass at $ARGUMENTS%
```

## Step 3: Bootstrap Project

Run `/project:bootstrap` with the generated brief as a text prompt.

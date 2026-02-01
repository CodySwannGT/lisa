---
name: project-reduce-max-lines-per-function
description: This skill should be used when reducing the maximum lines per function threshold and fixing all violations. It updates the eslint threshold configuration, identifies functions exceeding the new limit, generates a brief with refactoring strategies, and bootstraps a project to split oversized functions.
allowed-tools: ["Read", "Bash", "Glob", "Grep"]
argument-hint: "<max-lines-per-function-value>"
model: sonnet
---

# Reduce Max Lines Per Function

Target threshold: $ARGUMENTS lines per function

If no argument provided, prompt the user for a target.

## Step 1: Gather Requirements

1. **Read current config** from eslint thresholds (eslint.thresholds.json or similar)
2. **Run lint** with the new threshold to find violations:
   ```bash
   bun run lint 2>&1 | grep "max-lines-per-function"
   ```
3. **Note for each violation**:
   - File path and line number
   - Function name
   - Current line count

If no violations at $ARGUMENTS, report success and exit.

## Step 2: Generate Brief

Compile findings into a detailed brief:

```
Reduce max lines per function threshold to $ARGUMENTS.

## Functions Exceeding Threshold (ordered by line count)

1. src/services/user.ts:processUser (95 lines, target: $ARGUMENTS)
   - Line 45, function spans lines 45-140
2. src/utils/helpers.ts:validateInput (82 lines, target: $ARGUMENTS)
   - Line 23, function spans lines 23-105
...

## Configuration Change
- File: eslint.thresholds.json
- Change: maxLinesPerFunction to $ARGUMENTS

## Refactoring Strategies
- **Extract functions**: Break function into smaller named functions
- **Early returns**: Reduce nesting with guard clauses
- **Extract conditions**: Move complex boolean logic into named variables
- **Use lookup tables**: Replace complex switch/if-else chains with object maps
- **Consolidate logic**: Merge similar code paths

## Acceptance Criteria
- All functions at or below $ARGUMENTS lines
- `bun run lint` passes with no max-lines-per-function violations

## Verification
Command: `bun run lint 2>&1 | grep "max-lines-per-function" | wc -l`
Expected: 0
```

## Step 3: Bootstrap Project

Run `/project-bootstrap` with the generated brief as a text prompt.

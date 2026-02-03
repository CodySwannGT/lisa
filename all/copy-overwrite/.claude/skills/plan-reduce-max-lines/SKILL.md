---
name: plan-reduce-max-lines
description: This skill should be used when reducing the maximum file lines threshold and fixing all violations. It updates the eslint threshold configuration, identifies files exceeding the new limit, generates a brief with refactoring strategies, and creates a plan with tasks to split oversized files.
allowed-tools: ["Read", "Bash", "Glob", "Grep"]
argument-hint: "<max-lines-value>"

---

# Reduce Max Lines

Target threshold: $ARGUMENTS lines per file

If no argument provided, prompt the user for a target.

## Step 1: Gather Requirements

1. **Read current config** from eslint thresholds (eslint.thresholds.json or similar)
2. **Run lint** with the new threshold to find violations:
   ```bash
   bun run lint 2>&1 | grep "max-lines"
   ```
3. **Note for each violation**:
   - File path
   - Current line count

If no violations at $ARGUMENTS, report success and exit.

## Step 2: Create Plan

In plan mode, create a plan that includes the following details:

```markdown
Reduce max file lines threshold to $ARGUMENTS.

## Files Exceeding Threshold (ordered by line count)

1. src/services/user.ts (450 lines, target: $ARGUMENTS)
2. src/utils/helpers.ts (380 lines, target: $ARGUMENTS)
3. src/components/Dashboard.tsx (320 lines, target: $ARGUMENTS)
...

## Configuration Change
- File: eslint.thresholds.json
- Change: maxLines to $ARGUMENTS

## Refactoring Strategies
- **Extract modules**: Break file into smaller focused modules
- **Remove duplication**: Consolidate repeated logic
- **Delete dead code**: Remove unused functions/code paths
- **Simplify logic**: Use early returns, reduce nesting

## Acceptance Criteria
- All files at or below $ARGUMENTS lines
- `bun run lint` passes with no max-lines violations

## Verification
Command: `bun run lint 2>&1 | grep "max-lines" | wc -l`
Expected: 0
```

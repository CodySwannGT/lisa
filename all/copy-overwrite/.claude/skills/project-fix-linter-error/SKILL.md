---
name: project-fix-linter-error
description: This skill should be used when fixing all violations of one or more ESLint rules across the codebase. It runs the linter, groups violations by rule and file, generates a brief with fix strategies, and bootstraps a project to implement the fixes.
allowed-tools: ["Read", "Bash", "Glob", "Grep"]
argument-hint: "<rule-1> [rule-2] [rule-3] ..."
model: sonnet
---

> **DEPRECATED**: This skill is deprecated. Use `/plan-fix-linter-error` instead, which integrates with Claude's native plan mode.
> This skill will be removed in a future release.

# Fix Linter Errors

Target rules: $ARGUMENTS

If no arguments provided, prompt the user for at least one lint rule name.

## Step 1: Gather Requirements

1. **Parse rules** from $ARGUMENTS (space-separated)
2. **Run linter** to collect all violations:
   ```bash
   bun run lint 2>&1
   ```
3. **Group violations** by rule, then by file, noting:
   - File path and line numbers
   - Violation count per file
   - Sample error messages

## Step 2: Generate Brief

Compile findings into a detailed brief:

```
Fix ESLint violations for rules: $ARGUMENTS

## Violations by Rule

### [rule-name-1] (X total violations across Y files)

1. src/services/user.ts (5 violations)
   - Line 23: [error message]
   - Line 45: [error message]
   - Line 67: [error message]
   ...
2. src/utils/helpers.ts (3 violations)
   - Line 12: [error message]
   ...

### [rule-name-2] (X total violations across Y files)
...

## Fix Strategies
- **Complexity rules** (sonarjs/*): Extract functions, early returns, simplify conditions
- **Style rules** (prettier/*, import/order): Apply formatting fixes
- **Best practice rules** (react-hooks/*, prefer-const): Refactor to recommended pattern
- **Type rules** (@typescript-eslint/*): Add proper types, remove `any`

## Acceptance Criteria
- `bun run lint` passes with zero violations for: $ARGUMENTS
- Each rule's fixes committed separately: `fix(lint): resolve [rule-name] violations`

## Verification
Command: `bun run lint 2>&1 | grep -E "($ARGUMENTS)" | wc -l`
Expected: 0
```

## Step 3: Bootstrap Project

Run `/project-bootstrap` with the generated brief as a text prompt.

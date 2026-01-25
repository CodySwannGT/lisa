---
description: Fix all violations of one or more ESLint rules across the codebase
allowed-tools: Read, Write, Edit, Bash, Task, TaskCreate, TaskUpdate, TaskList, TaskGet
argument-hint: <rule-1> [rule-2] [rule-3] ...
model: sonnet
---

# Fix Linter Errors

Target rules: $ARGUMENTS

Parse the arguments as space-separated ESLint rule names. If no arguments provided, prompt the user for at least one lint rule name.

## Setup

Check for active project: `cat .claude-active-project 2>/dev/null`

If active, include `metadata: { "project": "<project-name>" }` in TaskCreate calls.

## Step 1: Parse Rules

Split `$ARGUMENTS` into individual rule names (space-separated).

Example inputs:
- `sonarjs/cognitive-complexity` → 1 rule
- `sonarjs/cognitive-complexity @typescript-eslint/no-explicit-any` → 2 rules
- `react-hooks/exhaustive-deps import/order prefer-const` → 3 rules

## Step 2: Enable Rules

For each rule, find the ESLint config and set it to `"error"` severity if not already enabled.

## Step 3: Identify Violations

Run linting and collect violations for all target rules:

```bash
bun run lint 2>&1 | grep -E "(rule-1|rule-2|...)"
```

Group violations by:
1. **Rule name** (primary grouping)
2. **File path** (secondary grouping)

Count violations per file per rule.

## Step 4: Create Tasks

Create tasks organized by rule, then by file:

For each rule:
- Create a parent task: "Fix all [rule-name] violations ([N] files, [M] total)"
- Create child tasks for each file with violations, ordered by count (highest first)

Each file task should include:
- File path and violation count for that specific rule
- Sample error messages
- Fix approach based on rule type:
  - **Complexity rules** (`sonarjs/*`): Extract functions, use early returns, simplify conditions
  - **Style rules** (`prettier/*`, `import/order`): Apply formatting fixes
  - **Best practice rules** (`react-hooks/*`, `prefer-const`): Refactor to follow recommended pattern
  - **Type rules** (`@typescript-eslint/*`): Add proper types, remove `any`

## Step 5: Execute

Process rules sequentially (to avoid conflicts), but parallelize file fixes within each rule:

For each rule:
1. Launch up to 5 sub-agents to fix files for that rule in parallel
2. Wait for all files to be fixed
3. Run `bun run lint` to verify rule is now clean
4. Commit all fixes for that rule with message: `fix(lint): resolve [rule-name] violations`
5. Move to next rule

## Step 6: Report

```
Lint rule fix complete:

| Rule | Files Fixed | Violations Resolved |
|------|-------------|---------------------|
| rule-1 | N1 | M1 |
| rule-2 | N2 | M2 |
| ... | ... | ... |

Total: [N] files fixed, [M] violations resolved
```

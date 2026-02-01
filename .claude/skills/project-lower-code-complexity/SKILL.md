---
name: project-lower-code-complexity
description: This skill should be used when reducing the cognitive complexity threshold of the codebase. It lowers the threshold by 2, identifies functions that exceed the new limit, generates a brief with refactoring strategies, and bootstraps a project to fix all violations.
allowed-tools: ["Read", "Bash", "Glob", "Grep"]
---

# Lower Code Complexity

Reduces the cognitive complexity threshold by 2 and fixes all violations.

## Step 1: Gather Requirements

1. **Read current threshold** from eslint config (cognitive-complexity rule)
2. **Calculate new threshold**: current - 2 (e.g., 15 -> 13)
3. **Run lint** with the new threshold to find violations:
   ```bash
   bun run lint 2>&1 | grep "cognitive-complexity"
   ```
4. **Note for each violation**:
   - File path and line number
   - Function name
   - Current complexity score

If no violations at new threshold, report success and exit.

## Step 2: Generate Brief

Compile findings into a detailed brief:

```
Reduce cognitive complexity threshold from [current] to [new].

## Functions Exceeding Threshold (ordered by complexity)

1. src/services/user.ts:processUser (complexity: 18, target: [new])
   - Line 45, function spans lines 45-120
2. src/utils/helpers.ts:validateInput (complexity: 15, target: [new])
   - Line 23, function spans lines 23-67
...

## Configuration Change
- File: [eslint config path]
- Change: cognitive-complexity threshold from [current] to [new]

## Refactoring Strategies
- **Extract functions**: Break complex logic into smaller, named functions
- **Early returns**: Reduce nesting with guard clauses
- **Extract conditions**: Move complex boolean logic into named variables
- **Use lookup tables**: Replace complex switch/if-else chains with object maps

## Acceptance Criteria
- All functions at or below complexity [new]
- `bun run lint` passes with no cognitive-complexity violations

## Verification
Command: `bun run lint 2>&1 | grep "cognitive-complexity" | wc -l`
Expected: 0
```

## Step 3: Bootstrap Project

Run `/project-bootstrap` with the generated brief as a text prompt.

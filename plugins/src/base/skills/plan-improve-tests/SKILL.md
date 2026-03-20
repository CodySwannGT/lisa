---
name: plan-improve-tests
description: This skill should be used when improving test quality. It scans the test suite for weak, brittle, or poorly-written tests, generates a brief with improvement opportunities, and creates a plan with tasks to strengthen the tests.
allowed-tools: ["Read", "Bash", "Glob", "Grep"]
---

# Improve Test Quality

Target: $ARGUMENTS

If no argument provided, scan the full test suite.

## Step 1: Gather Requirements

1. **Run test suite** to establish baseline:
   ```bash
   bun run test 2>&1 | tail -20
   ```
2. **Scan test files** for quality issues:
   - Weak assertions (`toBeTruthy`, `toBeDefined` instead of specific values)
   - Missing edge cases (no boundary values, no error paths)
   - Implementation coupling (testing internals rather than behavior)
   - Missing error path coverage
   - Duplicated setup that could indicate missing abstractions
3. **Identify 10-20 test files** with highest improvement potential, noting:
   - File path
   - Issues found (weak assertions, missing edge cases, etc.)
   - Estimated impact of improvement

## Step 2: Compile Brief and Delegate

Compile the gathered information into a structured brief:

```text
Improve test quality across the test suite.

Test files needing improvement (ordered by impact):
1. [test file] - [issues found]
   - Weak assertions: [count]
   - Missing edge cases: [description]
   - Implementation coupling: [description]
2. ...

Verification: `bun run test` -> Expected: All tests pass, improved assertions and coverage
```

Invoke `/plan-execute` with this brief to create the implementation plan.

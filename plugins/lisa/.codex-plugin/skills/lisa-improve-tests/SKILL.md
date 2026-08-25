---
name: lisa-improve-tests
description: "improving test quality"
allowed-tools: ["Read", "Bash", "Glob", "Grep"]
---

# Improve Test Quality

Target: $ARGUMENTS

If no argument provided, scan the full test suite.

## Step 1: Gather Requirements

1. **Run test suite** to establish baseline:
   ```bash
   bun run test >test.log 2>&1; status=$?
   tail -20 test.log; echo "exit=$status"
   ```
   The status is captured before the pipe, because a pipeline reports its LAST stage's exit code — `tail` always succeeds, so a failing run reads as `exit=0` (`falsifiable-checks`, pager-shadowed status).
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

Invoke `/lisa:implement` with this brief to create the implementation plan.

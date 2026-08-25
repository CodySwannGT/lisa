---
name: lisa-improve-test-coverage
description: "increasing test coverage to a…"
allowed-tools: ["Read", "Bash", "Glob", "Grep"]

---

# Increase Test Coverage

Target threshold: $ARGUMENTS%

If no argument provided, prompt the user for a target.

## Step 1: Gather Requirements

1. **Find coverage config** (jest.config.js, vitest.config.ts, .nycrc, etc.)
2. **Run coverage report** to get current state:
   ```bash
   status=0
   bun run test:cov >coverage.log 2>&1 || status=$?
   head -n 100 coverage.log; echo "exit=$status"
   ```
   The status is captured before the pipe, because a pipeline reports its LAST stage's exit code — `head` always succeeds, so a failing run reads as `exit=0` (`falsifiable-checks`, pager-shadowed status). `|| status=$?` rather than `; status=$?`: under `set -e` the `;` form exits before the assignment, so the failure is never reported at all.
3. **Identify the 20 files with lowest coverage**, noting:
   - File path
   - Current coverage % (lines, branches, functions)
   - Which lines/branches are uncovered

## Step 2: Compile Brief and Delegate

Compile the gathered information into a structured brief:

```
Increase test coverage from [current]% to $ARGUMENTS%.

Files needing coverage (ordered by coverage gap):
1. [file] - [current]% coverage (target: $ARGUMENTS%)
   - Uncovered: [lines]
   - Missing branch coverage: [lines]
2. ...

Configuration: [config file path], update thresholds to $ARGUMENTS%

Verification: `bun run test:cov` → Expected: All thresholds pass at $ARGUMENTS%
```

Invoke `/lisa:implement` with this brief to create the implementation plan.

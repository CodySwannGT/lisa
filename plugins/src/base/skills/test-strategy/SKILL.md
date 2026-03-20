---
name: test-strategy
description: "Test strategy design. Coverage matrix, edge cases, TDD sequence planning, test quality review. Behavior-focused testing over implementation details."
---

# Test Strategy

Design test strategies, write tests, and review test quality.

## Analysis Process

1. **Read existing tests** -- understand the project's test conventions (describe/it structure, naming, helpers)
2. **Identify test types needed** -- unit, integration, E2E based on the scope of changes
3. **Map edge cases** -- boundary values, empty inputs, error states, concurrency scenarios
4. **Check coverage gaps** -- run existing tests to understand current coverage of affected files
5. **Design verification commands** -- proof commands that empirically demonstrate the code works

## Test Writing Process

1. **Analyze the source file** to understand its functionality
2. **Identify untested code paths**, edge cases, and error conditions
3. **Write comprehensive, meaningful tests** (not just coverage padding)
4. **Follow the project's existing test patterns** and conventions
5. **Ensure tests are readable and maintainable**

## Output Format

Structure findings as:

```
## Test Analysis

### Test Matrix
| Component | Test Type | What to Test | Priority |
|-----------|-----------|-------------|----------|

### Edge Cases
- [edge case] -- why it matters

### Coverage Targets
- `path/to/file.ts` -- current: X%, target: Y%

### Test Patterns (from codebase)
- Pattern: [description] -- found in `path/to/test.spec.ts`

### Verification Commands
| Task | Proof Command | Expected Output |
|------|--------------|-----------------|

### TDD Sequence
1. [first test to write] -- covers [behavior]
2. [second test] -- covers [behavior]
```

## Rules

- Always run `bun run test` to understand current test state before recommending or writing new tests
- Match existing test conventions -- do not introduce new test patterns
- Every test must have a clear "why" -- no tests for testing's sake
- Focus on testing behavior, not implementation details
- Verification commands must be runnable locally (no CI/CD dependencies)
- Prioritize tests that catch regressions over tests that verify happy paths
- Write comprehensive tests, not just coverage padding

# Plan: Fibonacci Generator

## Context

- **Input**: Free text — "create a fibonacci generator"
- **Type**: Story/Feature
- **Branch**: `feat/fibonacci-generator` (from `main`)
- **PR target**: `main`

## Sessions

## Analysis

### Requirements

Create two pure utility functions for computing Fibonacci numbers:

1. `fibonacci(n)` — returns the nth Fibonacci number (F(0)=0, F(1)=1, F(n)=F(n-1)+F(n-2))
2. `fibonacciSequence(length)` — returns the first `length` Fibonacci numbers as a readonly array

### Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| File location | `src/utils/fibonacci.ts` | Follows existing utils pattern |
| `fibonacci(n)` implementation | Tuple reduce: `[prev, curr] -> [curr, prev+curr]` | O(n) time, O(1) space, fully functional, no mutation |
| `fibonacciSequence(length)` implementation | `Array.from().reduce()` with spread | Functional, immutable; O(n^2) irrelevant with n<=79 cap |
| Dependency direction | Independent implementations | Each function is self-contained; no delegation between them |
| Safe integer handling | Cap at n<=78 / length<=79 | F(79) exceeds `Number.MAX_SAFE_INTEGER`; silent precision loss violates "never cover up bugs" |
| Error type | `RangeError` | Standard JS error for numeric range violations; no custom class (YAGNI) |
| Error messages | Include received value | `"Expected a non-negative integer for n, got ${String(n)}"` |
| Return type | `readonly number[]` for sequence | Immutability-first philosophy |
| Export style | `export function` declarations | Matches existing `src/utils/*.ts` pattern |
| JSDoc | `@param` + `@returns` + `@throws` | Complete documentation of API contract |

### Security

- Input validation at function entry (negative, non-integer, NaN, Infinity, exceeds cap)
- No new dependencies (zero CVE surface)
- Cap prevents DoS via large inputs
- No I/O, no auth, no secrets

### Acceptance Criteria

- [ ] `fibonacci(0)` returns `0`
- [ ] `fibonacci(1)` returns `1`
- [ ] `fibonacci(10)` returns `55`
- [ ] `fibonacci(78)` returns the correct value (last safe integer result)
- [ ] `fibonacci(79)` throws `RangeError`
- [ ] `fibonacci(-1)` throws `RangeError`
- [ ] `fibonacci(3.5)` throws `RangeError`
- [ ] `fibonacci(NaN)` throws `RangeError`
- [ ] `fibonacci(Infinity)` throws `RangeError`
- [ ] `fibonacciSequence(0)` returns `[]`
- [ ] `fibonacciSequence(1)` returns `[0]`
- [ ] `fibonacciSequence(7)` returns `[0, 1, 1, 2, 3, 5, 8]`
- [ ] `fibonacciSequence(79)` returns correct 79-element sequence (last element is F(78))
- [ ] `fibonacciSequence(80)` throws `RangeError`
- [ ] `fibonacciSequence(-1)` throws `RangeError`
- [ ] Return type of `fibonacciSequence` is `readonly number[]`
- [ ] Both functions exported from `src/utils/index.ts` barrel
- [ ] JSDoc with `@param`, `@returns`, `@throws`
- [ ] 100% test coverage on `src/utils/fibonacci.ts`

### Implementation Approach

#### `fibonacci(n: number): number`

Tuple reduce — O(n) time, O(1) space:

```typescript
export function fibonacci(n: number): number {
  validateNonNegativeInteger(n, "n");
  if (n > MAX_SAFE_N) {
    throw new RangeError(
      `fibonacci(n) exceeds Number.MAX_SAFE_INTEGER for n > ${String(MAX_SAFE_N)}`
    );
  }
  if (n <= 1) return n;

  const [, result] = Array.from({ length: n - 1 }).reduce<
    readonly [number, number]
  >(([prev, curr]) => [curr, prev + curr] as const, [0, 1]);

  return result;
}
```

#### `fibonacciSequence(length: number): readonly number[]`

Array.from + reduce with spread — O(n^2) but capped at 79:

```typescript
export function fibonacciSequence(length: number): readonly number[] {
  validateNonNegativeInteger(length, "length");
  if (length > MAX_SAFE_LENGTH) {
    throw new RangeError(
      `fibonacciSequence(length) exceeds Number.MAX_SAFE_INTEGER for length > ${String(MAX_SAFE_LENGTH)}`
    );
  }
  if (length === 0) return [];

  return Array.from({ length }).reduce<readonly number[]>(
    (acc, _, i) => [...acc, i < 2 ? i : (acc[i - 1] ?? 0) + (acc[i - 2] ?? 0)],
    []
  );
}
```

#### Shared validation helper (private)

```typescript
const MAX_SAFE_N = 78;
const MAX_SAFE_LENGTH = 79;

function validateNonNegativeInteger(value: number, name: string): void {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    throw new RangeError(
      `Expected a non-negative integer for ${name}, got ${String(value)}`
    );
  }
}
```

### Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/utils/fibonacci.ts` | Create | Two exported functions + private validation helper + constants |
| `tests/unit/utils/fibonacci.test.ts` | Create | Comprehensive unit tests (~21 test cases) |
| `src/utils/index.ts` | Modify | Add `export * from "./fibonacci.js";` (alphabetical, before file-operations) |

## Tasks

### Task 1: Create branch and open draft PR

**Type:** Task

**Description:** Create branch `feat/fibonacci-generator` from `main` and open a draft PR targeting `main`.

**Acceptance Criteria:**
- [ ] Branch `feat/fibonacci-generator` exists
- [ ] Draft PR is open targeting `main`
- [ ] PR title: "feat: add fibonacci generator utility functions"

**Verification:**
- Type: `manual-check`
- Command: `gh pr view --json state,isDraft,title`
- Expected: `isDraft: true`, title matches

```json
{
  "plan": "fibonacci-generator",
  "type": "task",
  "skills": [],
  "verification": {
    "type": "manual-check",
    "command": "gh pr view --json state,isDraft,title",
    "expected": "isDraft: true, state: OPEN"
  }
}
```

### Task 2: Write failing tests for fibonacci(n) — TDD RED

**Type:** Task

**Description:** Write unit tests for the `fibonacci(n)` function following TDD RED phase. Create the test file and a minimal stub implementation (functions that throw "not implemented") so imports compile. Run tests to confirm they all FAIL.

Tests to write:
- Base cases: `fibonacci(0) === 0`, `fibonacci(1) === 1`
- Computed values: `fibonacci(2) === 1`, `fibonacci(10) === 55`, `fibonacci(20) === 6765`
- Boundary: `fibonacci(78)` returns correct value
- Validation: negative (-1), non-integer (3.5), NaN, Infinity, -Infinity all throw RangeError
- Safe integer cap: `fibonacci(79)` throws RangeError

**Acceptance Criteria:**
- [ ] `tests/unit/utils/fibonacci.test.ts` exists with fibonacci describe block
- [ ] `src/utils/fibonacci.ts` exists with stub exports
- [ ] All fibonacci tests FAIL (RED confirmed)

**Relevant Research:**
- Test imports: `import { describe, it, expect } from "@jest/globals";`
- Source imports: `import { fibonacci } from "../../../src/utils/fibonacci.js";`
- Outer describe: `"fibonacci utilities"`

**Implementation Details:**
- Create `src/utils/fibonacci.ts` with stubs: `export function fibonacci(n: number): number { throw new Error("not implemented"); }`
- Create `tests/unit/utils/fibonacci.test.ts` with all fibonacci tests
- Do NOT update barrel yet

**Testing Requirements:** This task IS the test-writing task. Verify tests exist and fail.

**Verification:**
- Type: `test`
- Command: `bun run test -- tests/unit/utils/fibonacci.test.ts 2>&1 | tail -5`
- Expected: Tests run and FAIL (non-zero exit code, "Tests: X failed")

```json
{
  "plan": "fibonacci-generator",
  "type": "task",
  "skills": ["jsdoc-best-practices"],
  "verification": {
    "type": "test",
    "command": "bun run test -- tests/unit/utils/fibonacci.test.ts 2>&1 | tail -5",
    "expected": "Tests fail (RED phase confirmed)"
  }
}
```

### Task 3: Implement fibonacci(n) — TDD GREEN

**Type:** Task

**Description:** Implement the `fibonacci(n)` function to make all fibonacci tests pass. Use tuple reduce approach: `Array.from({ length: n - 1 }).reduce<readonly [number, number]>(([prev, curr]) => [curr, prev + curr] as const, [0, 1])`. Include input validation and MAX_SAFE_INTEGER cap.

**Acceptance Criteria:**
- [ ] All fibonacci tests pass
- [ ] Implementation uses tuple reduce (O(n) time, O(1) space)
- [ ] Input validation throws RangeError with received value
- [ ] n > 78 throws RangeError
- [ ] JSDoc with `@param`, `@returns`, `@throws`

**Implementation Details:**
- Add `validateNonNegativeInteger` private helper
- Add `MAX_SAFE_N = 78` constant
- Implement `fibonacci` function per architecture decision
- File preamble JSDoc

**Verification:**
- Type: `test`
- Command: `bun run test -- tests/unit/utils/fibonacci.test.ts --verbose 2>&1 | grep -E "(PASS|FAIL|fibonacci)"`
- Expected: All fibonacci tests PASS

```json
{
  "plan": "fibonacci-generator",
  "type": "task",
  "skills": ["jsdoc-best-practices"],
  "verification": {
    "type": "test",
    "command": "bun run test -- tests/unit/utils/fibonacci.test.ts --verbose 2>&1 | grep -E '(PASS|FAIL|fibonacci)'",
    "expected": "All fibonacci tests PASS"
  }
}
```

### Task 4: Write failing tests for fibonacciSequence — TDD RED

**Type:** Task

**Description:** Add unit tests for `fibonacciSequence(length)` to the existing test file. Run to confirm they FAIL while fibonacci tests still pass.

Tests to write:
- Empty: `fibonacciSequence(0)` returns `[]`
- Single: `fibonacciSequence(1)` returns `[0]`
- Two: `fibonacciSequence(2)` returns `[0, 1]`
- Known: `fibonacciSequence(8)` returns `[0, 1, 1, 2, 3, 5, 8, 13]`
- Boundary: `fibonacciSequence(79)` returns 79-element array with correct last element
- Validation: negative (-1), non-integer (2.7), NaN, Infinity all throw RangeError
- Safe integer cap: `fibonacciSequence(80)` throws RangeError
- Readonly return type verification

**Acceptance Criteria:**
- [ ] fibonacciSequence describe block added to test file
- [ ] All fibonacciSequence tests FAIL
- [ ] All fibonacci tests still PASS

**Verification:**
- Type: `test`
- Command: `bun run test -- tests/unit/utils/fibonacci.test.ts --verbose 2>&1 | tail -10`
- Expected: fibonacci tests pass, fibonacciSequence tests fail

```json
{
  "plan": "fibonacci-generator",
  "type": "task",
  "skills": ["jsdoc-best-practices"],
  "verification": {
    "type": "test",
    "command": "bun run test -- tests/unit/utils/fibonacci.test.ts --verbose 2>&1 | tail -10",
    "expected": "fibonacci tests pass, fibonacciSequence tests fail"
  }
}
```

### Task 5: Implement fibonacciSequence — TDD GREEN

**Type:** Task

**Description:** Implement `fibonacciSequence(length)` to make all tests pass. Use `Array.from().reduce()` with spread pattern. Include input validation and MAX_SAFE_LENGTH cap.

**Acceptance Criteria:**
- [ ] All fibonacciSequence tests pass
- [ ] All fibonacci tests still pass
- [ ] Implementation uses reduce with spread (functional, immutable)
- [ ] Returns `readonly number[]`
- [ ] length > 79 throws RangeError
- [ ] JSDoc with `@param`, `@returns`, `@throws`

**Implementation Details:**
- Add `MAX_SAFE_LENGTH = 79` constant
- Implement `fibonacciSequence` per architecture decision
- JSDoc preamble

**Verification:**
- Type: `test`
- Command: `bun run test -- tests/unit/utils/fibonacci.test.ts`
- Expected: All tests PASS

```json
{
  "plan": "fibonacci-generator",
  "type": "task",
  "skills": ["jsdoc-best-practices"],
  "verification": {
    "type": "test",
    "command": "bun run test -- tests/unit/utils/fibonacci.test.ts",
    "expected": "All tests PASS"
  }
}
```

### Task 6: Update barrel export and full verification

**Type:** Task

**Description:** Add `export * from "./fibonacci.js";` to `src/utils/index.ts` in alphabetical order (before `file-operations`). Run full verification suite.

**Acceptance Criteria:**
- [ ] `src/utils/index.ts` exports fibonacci module
- [ ] All tests pass
- [ ] Lint passes
- [ ] Typecheck passes
- [ ] 100% coverage on `src/utils/fibonacci.ts`

**Implementation Details:**
- Edit `src/utils/index.ts` to add the barrel export
- Run full verification

**Verification:**
- Type: `test`
- Command: `bun run test -- tests/unit/utils/fibonacci.test.ts && bun run lint -- src/utils/fibonacci.ts tests/unit/utils/fibonacci.test.ts && bun run typecheck`
- Expected: All pass with zero errors

```json
{
  "plan": "fibonacci-generator",
  "type": "task",
  "skills": [],
  "verification": {
    "type": "test",
    "command": "bun run test -- tests/unit/utils/fibonacci.test.ts && bun run lint -- src/utils/fibonacci.ts tests/unit/utils/fibonacci.test.ts && bun run typecheck",
    "expected": "All pass with zero errors"
  }
}
```

### Task 7: Product/UX review

**Type:** Task

**Description:** Run product/UX review using `product-reviewer` agent. Validate the fibonacci functions work correctly from a developer's perspective. Verify error messages are clear, return types are correct, and the API is intuitive.

**Acceptance Criteria:**
- [ ] Product review completed
- [ ] All acceptance criteria from the plan verified
- [ ] Any findings documented

**Verification:**
- Type: `manual-check`
- Command: `bun run test -- tests/unit/utils/fibonacci.test.ts`
- Expected: All tests pass, product review findings documented

```json
{
  "plan": "fibonacci-generator",
  "type": "task",
  "skills": [],
  "verification": {
    "type": "manual-check",
    "command": "bun run test -- tests/unit/utils/fibonacci.test.ts",
    "expected": "All tests pass"
  }
}
```

### Task 8: CodeRabbit code review

**Type:** Task

**Description:** Run CodeRabbit AI code review on the changes using the `coderabbit` agent.

**Acceptance Criteria:**
- [ ] CodeRabbit review completed
- [ ] Findings documented

**Verification:**
- Type: `manual-check`
- Command: N/A (review output is the deliverable)
- Expected: Review findings documented

```json
{
  "plan": "fibonacci-generator",
  "type": "task",
  "skills": ["coderabbit:code-review"],
  "verification": {
    "type": "manual-check",
    "command": "echo 'CodeRabbit review completed'",
    "expected": "Review findings documented"
  }
}
```

### Task 9: Local code review

**Type:** Task

**Description:** Run local code review via `/plan-local-code-review` skill comparing the feature branch to main.

**Acceptance Criteria:**
- [ ] Local code review completed
- [ ] Findings documented

**Verification:**
- Type: `manual-check`
- Command: N/A (review output is the deliverable)
- Expected: Review findings documented

```json
{
  "plan": "fibonacci-generator",
  "type": "task",
  "skills": ["plan-local-code-review"],
  "verification": {
    "type": "manual-check",
    "command": "echo 'Local code review completed'",
    "expected": "Review findings documented"
  }
}
```

### Task 10: Technical review

**Type:** Task

**Description:** Run technical review using `tech-reviewer` agent. Check correctness, security, and performance. Explain findings in beginner-friendly plain English.

**Acceptance Criteria:**
- [ ] Technical review completed
- [ ] Findings ranked by severity
- [ ] Any issues documented

**Verification:**
- Type: `manual-check`
- Command: N/A (review output is the deliverable)
- Expected: Review findings documented

```json
{
  "plan": "fibonacci-generator",
  "type": "task",
  "skills": [],
  "verification": {
    "type": "manual-check",
    "command": "echo 'Technical review completed'",
    "expected": "Review findings documented"
  }
}
```

### Task 11: Implement valid review suggestions

**Type:** Task

**Description:** Review findings from Tasks 7-10 (product review, CodeRabbit, local code review, technical review). Implement any valid suggestions. Skip suggestions that conflict with the architecture decisions in this plan.

**Acceptance Criteria:**
- [ ] All valid review suggestions implemented
- [ ] Tests still pass after changes
- [ ] Lint and typecheck still pass

**Verification:**
- Type: `test`
- Command: `bun run test -- tests/unit/utils/fibonacci.test.ts && bun run lint -- src/utils/fibonacci.ts tests/unit/utils/fibonacci.test.ts && bun run typecheck`
- Expected: All pass

```json
{
  "plan": "fibonacci-generator",
  "type": "task",
  "skills": [],
  "verification": {
    "type": "test",
    "command": "bun run test -- tests/unit/utils/fibonacci.test.ts && bun run lint -- src/utils/fibonacci.ts tests/unit/utils/fibonacci.test.ts && bun run typecheck",
    "expected": "All pass"
  }
}
```

### Task 12: Simplify code

**Type:** Task

**Description:** Run code simplification using `code-simplifier` agent on `src/utils/fibonacci.ts` and `tests/unit/utils/fibonacci.test.ts`. Focus on clarity, consistency, and maintainability while preserving all functionality.

**Acceptance Criteria:**
- [ ] Code simplified where possible
- [ ] All tests still pass
- [ ] No functionality removed

**Verification:**
- Type: `test`
- Command: `bun run test -- tests/unit/utils/fibonacci.test.ts`
- Expected: All tests pass

```json
{
  "plan": "fibonacci-generator",
  "type": "task",
  "skills": [],
  "verification": {
    "type": "test",
    "command": "bun run test -- tests/unit/utils/fibonacci.test.ts",
    "expected": "All tests pass"
  }
}
```

### Task 13: Update/add/remove tests as needed

**Type:** Task

**Description:** After review implementation and simplification, check if any tests need updating, adding, or removing. Ensure 100% coverage on `src/utils/fibonacci.ts`.

**Acceptance Criteria:**
- [ ] 100% statement, branch, function, and line coverage
- [ ] All tests pass
- [ ] No redundant or obsolete tests

**Verification:**
- Type: `test-coverage`
- Command: `bun run test -- --coverage --collectCoverageFrom='src/utils/fibonacci.ts' tests/unit/utils/fibonacci.test.ts`
- Expected: 100% coverage on all metrics

```json
{
  "plan": "fibonacci-generator",
  "type": "task",
  "skills": [],
  "verification": {
    "type": "test-coverage",
    "command": "bun run test -- --coverage --collectCoverageFrom='src/utils/fibonacci.ts' tests/unit/utils/fibonacci.test.ts",
    "expected": "100% coverage"
  }
}
```

### Task 14: Update documentation

**Type:** Task

**Description:** Ensure JSDoc documentation on both exported functions includes `@param`, `@returns`, and `@throws` tags. Add a file preamble to `src/utils/fibonacci.ts`. Invoke `/jsdoc-best-practices` skill to validate.

**Acceptance Criteria:**
- [ ] File preamble JSDoc on `src/utils/fibonacci.ts`
- [ ] `@param`, `@returns`, `@throws` on both exported functions
- [ ] JSDoc follows project standards (why over what)

**Skills to Invoke:** `jsdoc-best-practices`

**Verification:**
- Type: `manual-check`
- Command: `bun run lint -- src/utils/fibonacci.ts`
- Expected: No JSDoc lint errors

```json
{
  "plan": "fibonacci-generator",
  "type": "task",
  "skills": ["jsdoc-best-practices"],
  "verification": {
    "type": "manual-check",
    "command": "bun run lint -- src/utils/fibonacci.ts",
    "expected": "No lint errors"
  }
}
```

### Task 15: Verify all verification metadata

**Type:** Task

**Description:** Re-run every verification command from Tasks 1-14. Confirm each task's expected output matches reality.

**Acceptance Criteria:**
- [ ] All verification commands produce expected results
- [ ] No regressions

**Verification:**
- Type: `test`
- Command: `bun run test -- tests/unit/utils/fibonacci.test.ts && bun run lint -- src/utils/fibonacci.ts tests/unit/utils/fibonacci.test.ts && bun run typecheck`
- Expected: All pass

```json
{
  "plan": "fibonacci-generator",
  "type": "task",
  "skills": [],
  "verification": {
    "type": "test",
    "command": "bun run test -- tests/unit/utils/fibonacci.test.ts && bun run lint -- src/utils/fibonacci.ts tests/unit/utils/fibonacci.test.ts && bun run typecheck",
    "expected": "All pass"
  }
}
```

### Task 16: Collect learnings

**Type:** Task

**Description:** Run the `learner` agent to collect task learnings from this plan. Process each learning through `skill-evaluator` to create skills, add rules, or discard.

**Acceptance Criteria:**
- [ ] Learnings collected from all completed tasks
- [ ] Each learning evaluated for skill/rule creation

**Verification:**
- Type: `manual-check`
- Command: N/A (learner output is the deliverable)
- Expected: Learnings processed

```json
{
  "plan": "fibonacci-generator",
  "type": "task",
  "skills": [],
  "verification": {
    "type": "manual-check",
    "command": "echo 'Learnings collected'",
    "expected": "Learnings processed"
  }
}
```

### Task 17: Archive the plan

**Type:** Task

**Description:** Archive this plan after all other tasks are complete:

1. Create a folder named `fibonacci-generator` in `./plans/completed`
2. Rename the plan to reflect its actual contents if needed
3. Move it into `./plans/completed/fibonacci-generator/`
4. Read session IDs from `./plans/completed/fibonacci-generator/`
5. Move each `~/.claude/tasks/<session-id>` directory to `./plans/completed/fibonacci-generator/tasks`
6. Update any "in_progress" task to "completed"
7. Git push all changes to the PR
8. Mark PR as ready: `gh pr ready`
9. Enable auto-merge: `gh pr merge --auto --merge`
10. Commit and push changes to the PR

**Acceptance Criteria:**
- [ ] Plan archived in `./plans/completed/fibonacci-generator/`
- [ ] Task data moved
- [ ] All tasks marked completed
- [ ] PR marked ready
- [ ] Auto-merge enabled
- [ ] Final push completed

**Verification:**
- Type: `manual-check`
- Command: `ls ./plans/completed/fibonacci-generator/ && gh pr view --json state,isDraft`
- Expected: Plan file exists, isDraft: false

```json
{
  "plan": "fibonacci-generator",
  "type": "task",
  "skills": [],
  "verification": {
    "type": "manual-check",
    "command": "ls ./plans/completed/fibonacci-generator/ && gh pr view --json state,isDraft",
    "expected": "Plan archived, PR ready (isDraft: false)"
  }
}
```

## Task Dependencies

```text
Task 1 (branch/PR)
  └── Task 2 (tests RED - fibonacci)
        └── Task 3 (implement GREEN - fibonacci)
              └── Task 4 (tests RED - fibonacciSequence)
                    └── Task 5 (implement GREEN - fibonacciSequence)
                          └── Task 6 (barrel export + verification)
                                ├── Task 7 (product review)      ─┐
                                ├── Task 8 (CodeRabbit review)    ├── parallel
                                ├── Task 9 (local code review)    │
                                └── Task 10 (technical review)   ─┘
                                      └── Task 11 (implement review suggestions)
                                            └── Task 12 (simplify code)
                                                  ├── Task 13 (update tests)     ─┐
                                                  └── Task 14 (update docs)      ─┘ parallel
                                                        └── Task 15 (verify all metadata)
                                                              └── Task 16 (collect learnings)
                                                                    └── Task 17 (archive plan)
```

## Implementation Team

Spawn an Agent Team with these specialized agents:

| Agent | Type | Use For |
|-------|------|---------|
| `implementer` | `implementer` | Tasks 2-6, 11 (code implementation, TDD) |
| `reviewer-product` | `product-reviewer` | Task 7 (product/UX review) |
| `reviewer-coderabbit` | `coderabbit` | Task 8 (CodeRabbit AI review) |
| `reviewer-tech` | `tech-reviewer` | Task 10 (technical review) |
| `simplifier` | `code-simplifier` | Task 12 (code simplification) |
| `test-agent` | `test-coverage-agent` | Task 13 (test coverage) |
| `learner` | `learner` | Task 16 (collect learnings) |

The **team lead** handles:
- Task 1 (branch/PR creation)
- Task 9 (local code review via `/plan-local-code-review`)
- Task 15 (verify all metadata)
- Task 17 (archive plan)
- All git operations (commits, pushes, PR management)

Tasks 7, 8, 9, 10 run in **parallel** after Task 6 completes.
Tasks 13, 14 run in **parallel** after Task 12 completes.

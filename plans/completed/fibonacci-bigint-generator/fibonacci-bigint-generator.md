# Plan: Fibonacci BigInt Generator

## Context

Replace the existing Number-based Fibonacci utility with a BigInt-based `function*` generator and convenience functions. Remove old plans and stale artifacts. This is a demo/exercise utility demonstrating generator patterns, BigInt, and functional style — not a core governance feature.

**Input:** Free text — "remove any previous plan and/or implementation of fibonacci generators and create a new fibonacci generator"

**Plan type:** Task

**Branch:** `feat/fibonacci-bigint-generator`
**PR target:** `main`

## Research Summary

### Phase 1 Findings

**Existing artifacts to remove (tracked in git):**
- `src/utils/fibonacci.ts` — Number-based implementation, capped at fib(78)
- `tests/unit/utils/fibonacci.test.ts` — 22 tests for old implementation
- `src/utils/index.ts` line 1 — Re-export (will be re-added for new implementation)
- `plans/fibonacci-demo-script.md` — Old unarchived plan (375 lines)

**Artifacts to keep (per user decisions):**
- `plans/foamy-swinging-squid.md` — Untracked, cannot delete per CLAUDE.md rules
- `claude-review.md` — Untracked, cannot delete per CLAUDE.md rules
- `plans/completed/fibonacci-generator/` — Historical archive
- `CHANGELOG.md` — Never modify per CLAUDE.md rules
- `AGENT_TEAM_TEST.md` — Fibonacci references are illustrative examples
- `.claude/rules/PROJECT_RULES.md` — Fibonacci references are illustrative examples
- Local git branches `feat/fibonacci-generator`, `feat/fibonacci-script` — User chose to keep

**Zero production consumers** of fibonacci functions — removal is clean and safe.

### Phase 2 Sub-Plans

**Architecture:**
- Three exports: `fibonacciGenerator()`, `fibonacci(n)`, `fibonacciSequence(length)`
- Generator uses `let` with scoped `eslint-disable functional/no-let` (user approved)
- `fibonacci(n)` uses efficient tuple-reduce approach (O(1) space, O(n) time)
- `fibonacciSequence(length)` wraps generator with `Array.from`
- No artificial caps — BigInt has no precision limit, YAGNI

**Test Strategy:**
- ~30 tests across 3 describe blocks
- TDD sequence: RED (write BigInt tests) → GREEN (implement) → REFACTOR
- Coverage target: 100% across all metrics
- Hardcoded known values, generator laziness tests, type assertions

**Security:**
- Only theoretical DoS risk from very large inputs — proportional to demo utility risk level
- No artificial cap needed — document O(n) time complexity in JSDoc
- No new dependencies, pure TypeScript computation

**Product:**
- Gherkin flows for all functions including error cases
- BigInt return type needs clear JSDoc documentation (may surprise developers expecting Number)
- No feature flag needed — pure utility

### Phase 3 Review Corrections

**Devil's advocate findings incorporated:**
1. **NOT a breaking change** — fibonacci is not part of the published npm package (`dist/` barrel excludes it). Commit uses `feat:` not `feat!:`.
2. **fibonacci(n) uses efficient O(1) space** — Tuple-reduce approach instead of O(n) Array.from allocation.
3. **Type safety** — `Generator<bigint, never, unknown>` ensures `.value` is always `bigint` (never undefined since generator never completes).
4. **eslint-disable confirmed** — User approved the scoped exception for generator `let` declarations.

**Consistency checker findings incorporated:**
1. Generator type aligned to `Generator<bigint, never, unknown>` across all specifications.
2. Security gap acknowledged — analysis applies to new BigInt architecture (conclusions unchanged: no cap needed for demo utility).

## Implementation Approach

### API Design

```typescript
/** Infinite lazy generator yielding Fibonacci numbers as BigInt */
export function* fibonacciGenerator(): Generator<bigint, never, unknown>

/** Compute the nth Fibonacci number (0-indexed) using BigInt */
export function fibonacci(n: number): bigint

/** Generate the first `length` Fibonacci numbers as a readonly BigInt array */
export function fibonacciSequence(length: number): readonly bigint[]
```

### Algorithm

**Generator** — Iterative with mutable state (standard generator pattern):
```typescript
function* fibonacciGenerator(): Generator<bigint, never, unknown> {
  /* eslint-disable functional/no-let */
  let a = 0n;
  let b = 1n;
  /* eslint-enable functional/no-let */
  while (true) {
    yield a;
    [a, b] = [b, a + b];
  }
}
```

**fibonacci(n)** — Efficient tuple-reduce (O(1) space, no `let`):
```typescript
function fibonacci(n: number): bigint {
  // validation...
  if (n <= 1) return BigInt(n);
  const [, result] = Array.from({ length: n - 1 }).reduce<readonly [bigint, bigint]>(
    ([prev, curr]) => [curr, prev + curr] as const,
    [0n, 1n]
  );
  return result;
}
```

**fibonacciSequence(length)** — Wraps generator with Array.from:
```typescript
function fibonacciSequence(length: number): readonly bigint[] {
  // validation...
  const gen = fibonacciGenerator();
  return Array.from({ length }, () => gen.next().value);
}
```

### Files to Modify

| File | Action | Details |
|------|--------|---------|
| `src/utils/fibonacci.ts` | Rewrite | Delete all 79 lines, replace with BigInt generator implementation |
| `tests/unit/utils/fibonacci.test.ts` | Rewrite | Delete all 110 lines, replace with new BigInt test suite |
| `src/utils/index.ts` | No change | Barrel export `export * from "./fibonacci.js"` stays as-is |
| `plans/fibonacci-demo-script.md` | Delete | Old unarchived plan, tracked in git |

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Number type | BigInt | Unlimited precision, removes arbitrary fib(78) cap |
| Generator type | `Generator<bigint, never, unknown>` | Precise: yields bigint, never returns, no `.next()` args |
| `fibonacci(n)` param type | `number` (not `bigint`) | Ergonomic — callers write `fibonacci(10)` not `fibonacci(10n)` |
| `fibonacci(n)` algorithm | Tuple-reduce | O(1) space, O(n) time, no `let`, functional |
| `fibonacciSequence` algorithm | Generator + Array.from | DRY — reuses generator as single source of truth |
| eslint-disable | Scoped to 2 `let` declarations | User approved; generator requires mutable state |
| Input caps | None | BigInt has no precision limit; YAGNI for demo utility |
| Commit type | `feat:` | Not a breaking change — fibonacci not in published npm package |
| 3 exports | Educational | Demonstrates generators, BigInt, and functional patterns |

## Tasks

### Task 1: Create branch and open draft PR

**Subject:** Create feature branch and open draft PR
**ActiveForm:** Creating branch and draft PR

**Type:** Task

**Description:** Create branch `feat/fibonacci-bigint-generator` from `main`. Open a draft PR targeting `main`. No implementation before the draft PR exists.

**Acceptance Criteria:**
- [ ] Branch `feat/fibonacci-bigint-generator` exists
- [ ] Draft PR open targeting `main`

**Verification:**
- Type: `manual-check`
- Command: `gh pr view --json state,isDraft --jq '{state, isDraft}'`
- Expected: `{"state":"OPEN","isDraft":true}`

```json
{
  "plan": "fibonacci-bigint-generator",
  "type": "task",
  "skills": [],
  "verification": {
    "type": "manual-check",
    "command": "gh pr view --json state,isDraft --jq '{state, isDraft}'",
    "expected": "{\"state\":\"OPEN\",\"isDraft\":true}"
  }
}
```

---

### Task 2: Delete old Fibonacci implementation and plan

**Subject:** Remove old Fibonacci implementation and stale plan
**ActiveForm:** Removing old Fibonacci artifacts

**Type:** Task

**Description:** Delete the old Number-based Fibonacci implementation and the stale unarchived plan:
1. Delete `src/utils/fibonacci.ts` (old implementation)
2. Delete `tests/unit/utils/fibonacci.test.ts` (old tests)
3. Delete `plans/fibonacci-demo-script.md` (old unarchived plan)
4. Do NOT modify `src/utils/index.ts` yet — the barrel export will be satisfied by the new file in Task 3.
5. Do NOT delete: `plans/foamy-swinging-squid.md` (untracked), `claude-review.md` (untracked), `plans/completed/fibonacci-generator/` (archive), `CHANGELOG.md`.

**Acceptance Criteria:**
- [ ] `src/utils/fibonacci.ts` deleted
- [ ] `tests/unit/utils/fibonacci.test.ts` deleted
- [ ] `plans/fibonacci-demo-script.md` deleted
- [ ] No untracked files deleted

**Verification:**
- Type: `manual-check`
- Command: `! ls src/utils/fibonacci.ts 2>/dev/null && ! ls tests/unit/utils/fibonacci.test.ts 2>/dev/null && ! ls plans/fibonacci-demo-script.md 2>/dev/null && echo "All deleted"`
- Expected: `All deleted`

```json
{
  "plan": "fibonacci-bigint-generator",
  "type": "task",
  "skills": [],
  "verification": {
    "type": "manual-check",
    "command": "! ls src/utils/fibonacci.ts 2>/dev/null && ! ls tests/unit/utils/fibonacci.test.ts 2>/dev/null && ! ls plans/fibonacci-demo-script.md 2>/dev/null && echo 'All deleted'",
    "expected": "All deleted"
  }
}
```

---

### Task 3: Write failing tests for new Fibonacci BigInt generator (TDD RED)

**Subject:** Write failing tests for BigInt Fibonacci generator
**ActiveForm:** Writing failing Fibonacci tests (TDD RED phase)

**Type:** Task

**Description:** Following TDD, write the complete test suite BEFORE the implementation. Create `tests/unit/utils/fibonacci.test.ts` with all tests for `fibonacciGenerator`, `fibonacci`, and `fibonacciSequence`. All tests should FAIL (RED) since the implementation doesn't exist yet.

Test structure:
- `describe("fibonacci utilities")` (top-level)
  - `describe("fibonacciGenerator")` — laziness, correct values, type assertions, independence
  - `describe("fibonacci")` — base cases, known values, large values, type assertions, error cases
  - `describe("fibonacciSequence")` — empty, single, known sequences, type assertions, error cases

Known values to use (hardcoded, never computed):
- fib(0)=0n, fib(1)=1n, fib(2)=1n, fib(5)=5n, fib(10)=55n, fib(20)=6765n
- fib(78)=8944394323791464n, fib(100)=354224848179261915075n
- fib(200)=280571172992510140037611932413038677189525n

Include JSDoc preamble on the test file. Import from `"../../../src/utils/fibonacci.js"`.

**Skills to Invoke:** jsdoc-best-practices

**Acceptance Criteria:**
- [ ] Test file created at `tests/unit/utils/fibonacci.test.ts`
- [ ] Tests for all three exports (generator, fibonacci, fibonacciSequence)
- [ ] Generator laziness test using `.next()` calls
- [ ] BigInt type assertion tests (`typeof` checks)
- [ ] Error case tests for negative, non-integer, NaN, Infinity, -Infinity
- [ ] Hardcoded known values only (no computed expectations)
- [ ] JSDoc preamble present
- [ ] Tests fail because implementation doesn't exist (RED phase)

**Verification:**
- Type: `test`
- Command: `bun run test -- tests/unit/utils/fibonacci.test.ts 2>&1 | tail -5`
- Expected: Tests fail (compilation/import error since source doesn't exist yet)

```json
{
  "plan": "fibonacci-bigint-generator",
  "type": "task",
  "skills": ["jsdoc-best-practices"],
  "verification": {
    "type": "test",
    "command": "bun run test -- tests/unit/utils/fibonacci.test.ts 2>&1 | tail -5",
    "expected": "Tests fail (RED phase - source file does not exist yet)"
  }
}
```

**Blocked by:** Task 2

---

### Task 4: Implement BigInt Fibonacci generator (TDD GREEN)

**Subject:** Implement BigInt Fibonacci generator and convenience functions
**ActiveForm:** Implementing Fibonacci generator (TDD GREEN phase)

**Type:** Task

**Description:** Create `src/utils/fibonacci.ts` with three exports:
1. `fibonacciGenerator()` — `function*` yielding infinite BigInt Fibonacci sequence
2. `fibonacci(n)` — Compute nth Fibonacci number using tuple-reduce (O(1) space)
3. `fibonacciSequence(length)` — Generate first N numbers wrapping the generator

Implementation requirements:
- Use `/* eslint-disable functional/no-let */` scoped to the 2 `let` declarations in the generator (user approved)
- Use matching `/* eslint-enable functional/no-let */` immediately after declarations
- `fibonacci(n)` uses tuple-reduce approach, NOT Array.from with generator (O(1) space)
- `fibonacciSequence(length)` uses `Array.from({ length }, () => gen.next().value)` wrapping generator
- Input validation: `!Number.isInteger(n) || n < 0` → `RangeError` with descriptive message
- Generator takes no parameters, has no validation
- JSDoc preamble explaining why BigInt (unlimited precision) and why generator (lazy evaluation)
- Each function has JSDoc with `@param`, `@returns`, `@throws` tags
- Return type: `Generator<bigint, never, unknown>`

**Skills to Invoke:** jsdoc-best-practices

**Acceptance Criteria:**
- [ ] `src/utils/fibonacci.ts` created with all three exports
- [ ] Generator uses BigInt with scoped eslint-disable
- [ ] fibonacci(n) uses O(1) space tuple-reduce
- [ ] fibonacciSequence wraps generator
- [ ] Input validation throws RangeError with descriptive messages
- [ ] JSDoc preamble and function docs present
- [ ] All tests from Task 3 pass (GREEN phase)

**Verification:**
- Type: `test`
- Command: `bun run test -- tests/unit/utils/fibonacci.test.ts`
- Expected: All tests pass

```json
{
  "plan": "fibonacci-bigint-generator",
  "type": "task",
  "skills": ["jsdoc-best-practices"],
  "verification": {
    "type": "test",
    "command": "bun run test -- tests/unit/utils/fibonacci.test.ts",
    "expected": "All tests pass"
  }
}
```

**Blocked by:** Task 3

---

### Task 5: Commit cleanup and implementation

**Subject:** Commit removal of old code and new implementation
**ActiveForm:** Committing Fibonacci changes

**Type:** Task

**Description:** Create atomic conventional commits:
1. First commit: `refactor: remove old Number-based fibonacci implementation` (deletion of old files + plan)
2. Second commit: `feat: add BigInt fibonacci generator with convenience functions` (new implementation + tests)

Use `/git-commit` skill. Commit message uses `feat:` (NOT `feat!:` — fibonacci is not part of published npm package, so return type change is not a breaking change).

**Skills to Invoke:** git-commit

**Acceptance Criteria:**
- [ ] Two clean conventional commits
- [ ] No `BREAKING CHANGE` in commit messages
- [ ] Working directory clean after commits

**Verification:**
- Type: `manual-check`
- Command: `git log --oneline -2`
- Expected: Two commits with conventional prefixes (refactor: and feat:)

```json
{
  "plan": "fibonacci-bigint-generator",
  "type": "task",
  "skills": ["git-commit"],
  "verification": {
    "type": "manual-check",
    "command": "git log --oneline -2",
    "expected": "Two commits: refactor: ... and feat: ..."
  }
}
```

**Blocked by:** Task 4

---

### Task 6: Run product/UX review

**Subject:** Run product/UX review on Fibonacci implementation
**ActiveForm:** Running product/UX review

**Type:** Task

**Description:** Use `product-reviewer` agent to validate the Fibonacci utility from a developer's perspective. Verify API intuitiveness, error message clarity, BigInt return type documentation, and generator usage patterns.

**Verification:**
- Type: `manual-check`
- Command: `bun run test -- tests/unit/utils/fibonacci.test.ts`
- Expected: All tests pass, review findings documented

```json
{
  "plan": "fibonacci-bigint-generator",
  "type": "task",
  "skills": [],
  "verification": {
    "type": "manual-check",
    "command": "bun run test -- tests/unit/utils/fibonacci.test.ts",
    "expected": "All tests pass, review findings documented"
  }
}
```

**Blocked by:** Task 5

---

### Task 7: Run CodeRabbit code review

**Subject:** Run CodeRabbit code review on implementation
**ActiveForm:** Running CodeRabbit review

**Type:** Task

**Description:** Run `coderabbit:code-review` to get automated AI code review on the Fibonacci implementation.

**Skills to Invoke:** coderabbit:code-review

**Verification:**
- Type: `manual-check`
- Command: Review output inspected for critical issues
- Expected: No critical issues

```json
{
  "plan": "fibonacci-bigint-generator",
  "type": "task",
  "skills": ["coderabbit:code-review"],
  "verification": {
    "type": "manual-check",
    "command": "Review output inspected",
    "expected": "No critical issues"
  }
}
```

**Blocked by:** Task 5

---

### Task 8: Run local code review

**Subject:** Run local code review on implementation
**ActiveForm:** Running local code review

**Type:** Task

**Description:** Run `/plan-local-code-review` skill to review implementation against coding standards, CLAUDE.md compliance, and git history context.

**Skills to Invoke:** plan-local-code-review

**Verification:**
- Type: `manual-check`
- Command: Review output inspected for critical issues
- Expected: No critical issues

```json
{
  "plan": "fibonacci-bigint-generator",
  "type": "task",
  "skills": ["plan-local-code-review"],
  "verification": {
    "type": "manual-check",
    "command": "Review output inspected",
    "expected": "No critical issues"
  }
}
```

**Blocked by:** Task 5

---

### Task 9: Run technical review

**Subject:** Run technical review on implementation
**ActiveForm:** Running technical review

**Type:** Task

**Description:** Use `tech-reviewer` agent to review correctness, security, and performance of the Fibonacci implementation. Specifically verify: generator type safety, tuple-reduce correctness, BigInt handling, and input validation completeness.

**Verification:**
- Type: `manual-check`
- Command: Review output inspected
- Expected: No critical issues

```json
{
  "plan": "fibonacci-bigint-generator",
  "type": "task",
  "skills": [],
  "verification": {
    "type": "manual-check",
    "command": "Review output inspected",
    "expected": "No critical issues"
  }
}
```

**Blocked by:** Task 5

---

### Task 10: Implement valid review suggestions

**Subject:** Implement valid suggestions from all reviews
**ActiveForm:** Implementing review suggestions

**Type:** Task

**Description:** Review findings from Tasks 6, 7, 8, and 9. Implement any valid suggestions that improve correctness, security, or clarity. Skip suggestions that conflict with project philosophy, are cosmetic-only, or add unnecessary complexity (YAGNI).

**Acceptance Criteria:**
- [ ] All valid suggestions implemented
- [ ] All tests still pass
- [ ] Lint and typecheck still pass

**Verification:**
- Type: `test`
- Command: `bun run test -- tests/unit/utils/fibonacci.test.ts && bun run lint -- src/utils/fibonacci.ts tests/unit/utils/fibonacci.test.ts && bun run typecheck`
- Expected: All pass

```json
{
  "plan": "fibonacci-bigint-generator",
  "type": "task",
  "skills": [],
  "verification": {
    "type": "test",
    "command": "bun run test -- tests/unit/utils/fibonacci.test.ts && bun run lint -- src/utils/fibonacci.ts tests/unit/utils/fibonacci.test.ts && bun run typecheck",
    "expected": "All pass"
  }
}
```

**Blocked by:** Tasks 6, 7, 8, 9

---

### Task 11: Simplify code

**Subject:** Simplify Fibonacci implementation with code-simplifier agent
**ActiveForm:** Simplifying implementation

**Type:** Task

**Description:** Use `code-simplifier:code-simplifier` agent to identify simplification opportunities in the new Fibonacci implementation and tests. Focus on recently modified files.

**Verification:**
- Type: `test`
- Command: `bun run test -- tests/unit/utils/fibonacci.test.ts`
- Expected: All tests still pass after simplification

```json
{
  "plan": "fibonacci-bigint-generator",
  "type": "task",
  "skills": [],
  "verification": {
    "type": "test",
    "command": "bun run test -- tests/unit/utils/fibonacci.test.ts",
    "expected": "All tests still pass"
  }
}
```

**Blocked by:** Task 10

---

### Task 12: Update/add/remove tests as needed

**Subject:** Verify and update test coverage after review changes
**ActiveForm:** Verifying test coverage

**Type:** Task

**Description:** After review implementations and simplifications, verify all tests still pass and coverage is 100%. Add any missing tests identified during reviews. Remove any tests that are no longer relevant.

**Verification:**
- Type: `test-coverage`
- Command: `bun run test -- --coverage --collectCoverageFrom='src/utils/fibonacci.ts' tests/unit/utils/fibonacci.test.ts`
- Expected: 100% coverage across all metrics

```json
{
  "plan": "fibonacci-bigint-generator",
  "type": "task",
  "skills": [],
  "verification": {
    "type": "test-coverage",
    "command": "bun run test -- --coverage --collectCoverageFrom='src/utils/fibonacci.ts' tests/unit/utils/fibonacci.test.ts",
    "expected": "100% coverage across all metrics"
  }
}
```

**Blocked by:** Task 11

---

### Task 13: Update/add/remove documentation

**Subject:** Verify JSDoc and documentation completeness
**ActiveForm:** Verifying documentation

**Type:** Task

**Description:** Ensure JSDoc preambles are present on both `src/utils/fibonacci.ts` and `tests/unit/utils/fibonacci.test.ts`. Verify function documentation explains "why" not just "what" per jsdoc-best-practices. Specifically verify:
- Module preamble explains why BigInt (unlimited precision) and why generator (lazy evaluation)
- Each function has `@param`, `@returns`, `@throws` tags
- BigInt return type is explicitly documented (UX concern from product review)
- No README or CHANGELOG updates (per CLAUDE.md rules)

**Skills to Invoke:** jsdoc-best-practices

**Verification:**
- Type: `documentation`
- Command: `grep -c "@module\|@param\|@returns\|@throws" src/utils/fibonacci.ts`
- Expected: At least 8 matches (module + 3 functions × param/returns/throws)

```json
{
  "plan": "fibonacci-bigint-generator",
  "type": "task",
  "skills": ["jsdoc-best-practices"],
  "verification": {
    "type": "documentation",
    "command": "grep -c '@module\\|@param\\|@returns\\|@throws' src/utils/fibonacci.ts",
    "expected": "At least 8 matches"
  }
}
```

**Blocked by:** Task 11

---

### Task 14: Verify all verification metadata

**Subject:** Run all verification commands from all tasks
**ActiveForm:** Running all verification commands

**Type:** Task

**Description:** Go through every task in this plan and re-run its verification command. Confirm all pass.

**Verification:**
- Type: `manual-check`
- Command: `bun run test -- tests/unit/utils/fibonacci.test.ts && bun run test -- --coverage --collectCoverageFrom='src/utils/fibonacci.ts' tests/unit/utils/fibonacci.test.ts && bun run lint && bun run typecheck && bun run format:check`
- Expected: All pass

```json
{
  "plan": "fibonacci-bigint-generator",
  "type": "task",
  "skills": [],
  "verification": {
    "type": "manual-check",
    "command": "bun run test -- tests/unit/utils/fibonacci.test.ts && bun run test -- --coverage --collectCoverageFrom='src/utils/fibonacci.ts' tests/unit/utils/fibonacci.test.ts && bun run lint && bun run typecheck && bun run format:check",
    "expected": "All pass"
  }
}
```

**Blocked by:** Tasks 12, 13

---

### Task 15: Collect learnings

**Subject:** Collect learnings using learner agent
**ActiveForm:** Collecting learnings

**Type:** Task

**Description:** Use `learner` agent to process implementation learnings into skills/rules. Focus on: generator pattern with eslint-disable, BigInt testing patterns, tuple-reduce for O(1) space fibonacci, and any other discoveries.

**Verification:**
- Type: `manual-check`
- Command: Learner agent output reviewed
- Expected: Learnings processed

```json
{
  "plan": "fibonacci-bigint-generator",
  "type": "task",
  "skills": [],
  "verification": {
    "type": "manual-check",
    "command": "Learner agent output reviewed",
    "expected": "Learnings processed"
  }
}
```

**Blocked by:** Tasks 11, 12, 13, 14

---

### Task 16: Archive the plan

**Subject:** Archive the plan to plans/completed
**ActiveForm:** Archiving plan

**Type:** Task

**Description:** Follow the archive procedure from plan-governance.md exactly:
1. `mkdir -p ./plans/completed/fibonacci-bigint-generator`
2. Rename plan file if needed to reflect actual contents
3. `mv plans/fibonacci-bigint-generator.md ./plans/completed/fibonacci-bigint-generator/fibonacci-bigint-generator.md`
4. Verify source is gone: `! ls plans/fibonacci-bigint-generator.md 2>/dev/null && echo "Source removed"`
5. Parse session IDs from the `## Sessions` table in the moved plan file
6. Move each task directory: `mv ~/.claude/tasks/<session-id> ./plans/completed/fibonacci-bigint-generator/tasks/`
7. Update any `in_progress` tasks to `completed` via TaskUpdate
8. Final git operations:
   ```bash
   git add . && git commit -m "chore: archive fibonacci-bigint-generator plan"
   GIT_SSH_COMMAND="ssh -o ServerAliveInterval=30 -o ServerAliveCountMax=5" git push
   gh pr ready
   gh pr merge --auto --merge
   ```

**Verification:**
- Type: `manual-check`
- Command: `ls plans/completed/fibonacci-bigint-generator/fibonacci-bigint-generator.md && ! ls plans/fibonacci-bigint-generator.md 2>/dev/null && echo "Archived"`
- Expected: `Archived`

```json
{
  "plan": "fibonacci-bigint-generator",
  "type": "task",
  "skills": [],
  "verification": {
    "type": "manual-check",
    "command": "ls plans/completed/fibonacci-bigint-generator/fibonacci-bigint-generator.md && ! ls plans/fibonacci-bigint-generator.md 2>/dev/null && echo 'Archived'",
    "expected": "Archived"
  }
}
```

**Blocked by:** All other tasks

---

## Implementation Team

When ready to implement, create an Agent Team with these roles:

| Agent | Type | Tasks | Purpose |
|-------|------|-------|---------|
| `implementer` | `implementer` | 2, 3, 4 | Delete old code, write tests (RED), implement (GREEN) |
| `tech-reviewer` | `tech-reviewer` | 9 | Technical review (correctness, security, performance) |
| `product-reviewer` | `product-reviewer` | 6 | Product/UX review from developer perspective |
| `test-coverage-agent` | `test-coverage-agent` | 12 | Verify and update test coverage |
| `code-simplifier:code-simplifier` | plugin | 11 | Code simplification |
| `coderabbit:code-reviewer` | plugin | 7 | Automated AI code review |
| `learner` | `learner` | 15 | Post-implementation learning |

The **team lead** handles: Task 1 (branch/PR), Task 5 (commits), Task 8 (local code review), Task 10 (implementing review suggestions), Tasks 13-14 (docs, verification), Task 16 (archive).

Tasks 6, 7, 8, 9 should run **in parallel** after Task 5. Tasks 12 and 13 can run **in parallel** after Task 11.

## Sessions

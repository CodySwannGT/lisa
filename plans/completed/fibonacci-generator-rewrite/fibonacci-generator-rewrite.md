# Fibonacci Generator Rewrite

## Context

**Input**: Free text — "remove any previous plan and/or implementation of fibonacci generators and create a new fibonacci generator"
**Plan type**: Task
**User note**: "I know this is trivial, but it's a test, so I don't want you to skip anything"

This is a process exercise. The user wants the full plan-create → plan-implement cycle executed end-to-end. The existing fibonacci implementation already matches the target API (bigint generator with 3 exports), but the task is to delete everything and rewrite from scratch.

## Branch and PR

- **Branch**: `feat/fibonacci-generator-rewrite`
- **Base**: `main`
- **PR**: Draft PR opened before implementation begins

## Analysis

### Existing Artifacts (to be removed)

| Artifact | Path | Status |
|----------|------|--------|
| Source | `src/utils/fibonacci.ts` (89 lines) | Tracked — delete |
| Tests | `tests/unit/utils/fibonacci.test.ts` (187 lines) | Tracked — delete |
| Barrel export line | `src/utils/index.ts` line 1 | Tracked — no change needed (same path reused) |
| Archived plan 1 | `plans/completed/fibonacci-generator/` (24 files) | Tracked — delete |
| Archived plan 2 | `plans/completed/fibonacci-bigint-generator/` (1 file) | Tracked — delete |
| Untracked plan stub | `plans/foamy-swinging-squid.md` | Untracked — CANNOT delete per CLAUDE.md |
| Untracked review | `claude-review.md` | Untracked — CANNOT delete per CLAUDE.md |
| Remote branches | `feat/fibonacci-generator`, `feat/fibonacci-bigint-generator`, `feat/fibonacci-script` | Not deleting (out of scope) |

### New Implementation Design

Three exports, all using `bigint`, following the established project patterns:

```typescript
export function* fibonacciGenerator(): Generator<bigint, never, unknown>
export function fibonacci(n: number): bigint
export function fibonacciSequence(length: number): readonly bigint[]
```

**Key decisions:**
- `bigint` for arbitrary precision (no overflow)
- `function*` generator with `eslint-disable functional/no-let` for mutable state
- `fibonacci()` and `fibonacciSequence()` delegate to `fibonacciGenerator()` (DRY — single source of truth per PROJECT_RULES.md)
- Inline `if` guard clauses for validation (not helper functions, per ESLint Statement Order rule)
- `RangeError` with parameter name and actual value in message
- `readonly bigint[]` return type on sequence (immutability-first)

### Commit Strategy

| Commit | Contents | Rationale |
|--------|----------|-----------|
| 1 | Create branch + draft PR | Git workflow requirement |
| 2 | Delete archived plan directories | Safe standalone — no code depends on plans |
| 3 | Delete old fibonacci.ts + tests, create new fibonacci.ts + tests (atomic) | Barrel export constraint: must delete and create in same commit |
| 4 | Update PROJECT_RULES.md examples | After implementation finalized |

### Security Assessment

Low risk. Pure stateless math utility with no I/O, no secrets, no network access. Input validation (`RangeError` for negative, non-integer, NaN, Infinity) is the only security-relevant measure. No upper bound needed (internal utility, YAGNI).

### PROJECT_RULES.md Updates

Two sections need `bigint` updates:
1. **ESLint Statement Order** (lines ~70, ~77): Change `: number` return type to `: bigint`
2. **Test Isolation** (lines ~94-101): Change `[0, 1, 1, 2, 3]` to `[0n, 1n, 1n, 2n, 3n]` and update function call examples

Three sections already use `bigint` — no changes needed:
3. **Barrel Export Pre-commit Constraint** (line ~142): Just references file path
4. **ESLint Disable Comments** (lines ~155-158): Already uses `0n`, `1n`
5. **DRY Principle** (lines ~177-192): Already uses `bigint`

## Tasks

### Task 1: Create branch and open draft PR

**Type:** Task

**Description:** Create the feature branch from main and open a draft PR. No implementation before the draft PR exists.

**Acceptance Criteria:**
- [ ] Branch `feat/fibonacci-generator-rewrite` created from `main`
- [ ] Draft PR opened targeting `main`
- [ ] PR description includes plan summary

**Verification:**
- Type: `manual-check`
- Command: `gh pr view --json state,isDraft,baseRefName`
- Expected: `"state": "OPEN", "isDraft": true, "baseRefName": "main"`

```json
{
  "plan": "fibonacci-generator-rewrite",
  "type": "task",
  "skills": [],
  "verification": {
    "type": "manual-check",
    "command": "gh pr view --json state,isDraft,baseRefName",
    "expected": "state OPEN, isDraft true, baseRefName main"
  }
}
```

### Task 2: Delete archived fibonacci plans

**Type:** Task

**Description:** Remove the two archived fibonacci plan directories from `plans/completed/`. These contain the original Number-based plan (with 21 task JSON files) and the BigInt replacement plan.

**Acceptance Criteria:**
- [ ] `plans/completed/fibonacci-generator/` deleted (24 tracked files)
- [ ] `plans/completed/fibonacci-bigint-generator/` deleted (1 tracked file)
- [ ] Changes committed with `git rm -r`

**Implementation Details:**
```bash
git rm -r plans/completed/fibonacci-generator/ plans/completed/fibonacci-bigint-generator/
git commit -m "chore: remove archived fibonacci plan directories"
```

**Verification:**
- Type: `manual-check`
- Command: `! ls plans/completed/fibonacci-generator 2>/dev/null && ! ls plans/completed/fibonacci-bigint-generator 2>/dev/null && echo "Plans removed"`
- Expected: `Plans removed`

```json
{
  "plan": "fibonacci-generator-rewrite",
  "type": "task",
  "skills": [],
  "verification": {
    "type": "manual-check",
    "command": "! ls plans/completed/fibonacci-generator 2>/dev/null && ! ls plans/completed/fibonacci-bigint-generator 2>/dev/null && echo 'Plans removed'",
    "expected": "Plans removed"
  }
}
```

### Task 3: Write new fibonacci tests (TDD RED phase)

**Type:** Task

**Description:** Delete the old test file and write new tests from scratch following TDD. Write all 33 tests covering the 3 exports before any implementation exists. Tests should fail (RED) because the source file will also be deleted in this step.

**Important:** The old `src/utils/fibonacci.ts` must also be deleted in this step so that the tests are genuinely RED (module not found). However, since the barrel export constraint requires atomic delete+create, we delete both old files but do NOT commit yet — the commit happens in Task 4 after implementation.

**Acceptance Criteria:**
- [ ] Old `src/utils/fibonacci.ts` deleted
- [ ] Old `tests/unit/utils/fibonacci.test.ts` deleted
- [ ] New `tests/unit/utils/fibonacci.test.ts` written with 33 tests
- [ ] Tests cover: fibonacciGenerator (7 tests), fibonacci (13 tests), fibonacciSequence (13 tests)
- [ ] All tests use hardcoded known values (not computed)
- [ ] Tests import from `@jest/globals` and use `.js` extension for source imports
- [ ] JSDoc file preamble on test file

**Test Matrix:**

`fibonacciGenerator`:
- First value is 0n
- Second value is 1n
- First 8 values match [0n, 1n, 1n, 2n, 3n, 5n, 8n, 13n]
- Each yielded value has typeof "bigint"
- done is false on every next() call (laziness)
- Two independent instances don't share state
- After 100 calls, done is still false (never terminates)

`fibonacci`:
- fib(0) = 0n, fib(1) = 1n, fib(2) = 1n
- fib(5) = 5n, fib(10) = 55n, fib(20) = 6765n
- fib(78) = 8944394323791464n (beyond Number.MAX_SAFE_INTEGER)
- fib(100) = 354224848179261915075n
- fib(200) = 280571172992510140037611932413038677189525n
- Returns bigint type
- Throws RangeError for: -1, 3.5, NaN, Infinity, -Infinity

`fibonacciSequence`:
- length 0 returns []
- length 1 returns [0n]
- length 2 returns [0n, 1n]
- length 8 returns [0n, 1n, 1n, 2n, 3n, 5n, 8n, 13n]
- Returns Array.isArray true
- All elements are bigint type
- Throws RangeError for: -1, 2.7, NaN, Infinity, -Infinity

**Skills to Invoke:** `/jsdoc-best-practices`

**Verification:**
- Type: `test`
- Command: `NODE_ENV=test npx jest tests/unit/utils/fibonacci.test.ts 2>&1 | tail -5`
- Expected: All 33 tests FAIL (RED phase — source module does not exist)

```json
{
  "plan": "fibonacci-generator-rewrite",
  "type": "task",
  "skills": ["/jsdoc-best-practices"],
  "verification": {
    "type": "test",
    "command": "NODE_ENV=test npx jest tests/unit/utils/fibonacci.test.ts 2>&1 | tail -5",
    "expected": "Tests: 33 failed, 33 total (module not found)"
  }
}
```

### Task 4: Implement fibonacci module (TDD GREEN phase)

**Type:** Task

**Description:** Write the new `src/utils/fibonacci.ts` from scratch with all 3 exports. All 33 tests should pass after implementation. Commit the atomic change (deleted old files + new test file + new source file) in a single commit.

**Acceptance Criteria:**
- [ ] `src/utils/fibonacci.ts` created with 3 exports
- [ ] `fibonacciGenerator()` is a `function*` yielding infinite bigint sequence
- [ ] `fibonacci(n)` delegates to `fibonacciGenerator()` (DRY)
- [ ] `fibonacciSequence(length)` delegates to `fibonacciGenerator()` (DRY)
- [ ] Input validation: inline `if` guard clauses throwing `RangeError` with parameter name and value
- [ ] Scoped `eslint-disable functional/no-let` for generator mutable state
- [ ] JSDoc file preamble and function docs with `@param`, `@returns`, `@throws`, `@remarks`, `@example`
- [ ] All 33 tests pass (GREEN)
- [ ] Atomic commit: old file deletions + new files in single commit
- [ ] Barrel export (`src/utils/index.ts`) still works (same path, same export names)

**Implementation Details:**
- File: `src/utils/fibonacci.ts`
- Generator: `function*` with `let a = 0n; let b = 1n;` and `while(true) { yield a; [a, b] = [b, a + b]; }`
- fibonacci(n): `if (!Number.isInteger(n) || n < 0) throw new RangeError(...)` → create gen → `Array.from({ length: n }, () => gen.next())` → `return gen.next().value`
- fibonacciSequence(length): same validation → `Array.from({ length }, () => gen.next().value)`

**Skills to Invoke:** `/jsdoc-best-practices`

**Verification:**
- Type: `test`
- Command: `NODE_ENV=test npx jest tests/unit/utils/fibonacci.test.ts`
- Expected: `Tests: 33 passed, 33 total`

```json
{
  "plan": "fibonacci-generator-rewrite",
  "type": "task",
  "skills": ["/jsdoc-best-practices"],
  "verification": {
    "type": "test",
    "command": "NODE_ENV=test npx jest tests/unit/utils/fibonacci.test.ts",
    "expected": "Tests: 33 passed, 33 total"
  }
}
```

### Task 5: Verify full test suite and coverage

**Type:** Task

**Description:** Run the full test suite to ensure no regressions, and verify 100% coverage on the new fibonacci module.

**Acceptance Criteria:**
- [ ] Full test suite passes (`bun run test`)
- [ ] 100% coverage on `src/utils/fibonacci.ts` (statements, branches, functions, lines)
- [ ] Lint passes (`bun run lint`)
- [ ] Typecheck passes (`bun run typecheck`)

**Verification:**
- Type: `test-coverage`
- Command: `NODE_ENV=test npx jest --coverage --collectCoverageFrom='src/utils/fibonacci.ts' tests/unit/utils/fibonacci.test.ts 2>&1 | grep fibonacci.ts`
- Expected: `fibonacci.ts | 100 | 100 | 100 | 100`

```json
{
  "plan": "fibonacci-generator-rewrite",
  "type": "task",
  "skills": [],
  "verification": {
    "type": "test-coverage",
    "command": "NODE_ENV=test npx jest --coverage --collectCoverageFrom='src/utils/fibonacci.ts' tests/unit/utils/fibonacci.test.ts 2>&1 | grep fibonacci.ts",
    "expected": "fibonacci.ts | 100 | 100 | 100 | 100"
  }
}
```

### Task 6: Update PROJECT_RULES.md fibonacci examples

**Type:** Task

**Description:** Update the 2 PROJECT_RULES.md sections that use `number` types in fibonacci examples to use `bigint`.

**Acceptance Criteria:**
- [ ] ESLint Statement Order section (lines ~70, ~77): `: number` changed to `: bigint`
- [ ] Test Isolation section (lines ~94-101): `[0, 1, 1, 2, 3]` changed to `[0n, 1n, 1n, 2n, 3n]`
- [ ] Changes committed

**Implementation Details:**
- Line ~70: `function fibonacci(n: number): number` → `function fibonacci(n: number): bigint`
- Line ~77: `function fibonacci(n: number): number` → `function fibonacci(n: number): bigint`
- Line ~95: `fibonacci(0), fibonacci(1), ...` → `fibonacci(0), fibonacci(1), ...` (keep as-is — it's the "wrong" example)
- Line ~101: `[0, 1, 1, 2, 3]` → `[0n, 1n, 1n, 2n, 3n]`

**Verification:**
- Type: `documentation`
- Command: `grep -n 'function fibonacci' .claude/rules/PROJECT_RULES.md`
- Expected: All lines show `: bigint` return type

```json
{
  "plan": "fibonacci-generator-rewrite",
  "type": "task",
  "skills": [],
  "verification": {
    "type": "documentation",
    "command": "grep -n 'function fibonacci' .claude/rules/PROJECT_RULES.md",
    "expected": "All lines show bigint return type"
  }
}
```

### Task 7: Product/UX review

**Type:** Task

**Description:** Run product review using `product-reviewer` agent to validate the fibonacci module from a developer-consumer perspective.

**Acceptance Criteria:**
- [ ] API ergonomics validated (import paths, function names, return types)
- [ ] Error messages reviewed for clarity and debuggability
- [ ] JSDoc reviewed for completeness and helpfulness

**Verification:**
- Type: `manual-check`
- Command: `echo "Product review completed"`
- Expected: Review findings documented, no blocking issues

```json
{
  "plan": "fibonacci-generator-rewrite",
  "type": "task",
  "skills": [],
  "verification": {
    "type": "manual-check",
    "command": "echo 'Product review completed'",
    "expected": "Review findings documented"
  }
}
```

### Task 8: CodeRabbit code review

**Type:** Task

**Description:** Run CodeRabbit AI code review on the changes using `coderabbit:code-reviewer` agent.

**Acceptance Criteria:**
- [ ] CodeRabbit review completed on all changed files
- [ ] Findings documented

**Verification:**
- Type: `manual-check`
- Command: `echo "CodeRabbit review completed"`
- Expected: Review findings documented

```json
{
  "plan": "fibonacci-generator-rewrite",
  "type": "task",
  "skills": [],
  "verification": {
    "type": "manual-check",
    "command": "echo 'CodeRabbit review completed'",
    "expected": "Review findings documented"
  }
}
```

### Task 9: Local code review

**Type:** Task

**Description:** Run local code review via `/plan-local-code-review` skill comparing branch to main.

**Acceptance Criteria:**
- [ ] Local review completed
- [ ] Findings documented and scored by confidence

**Skills to Invoke:** `/plan-local-code-review`

**Verification:**
- Type: `manual-check`
- Command: `echo "Local code review completed"`
- Expected: Review findings documented

```json
{
  "plan": "fibonacci-generator-rewrite",
  "type": "task",
  "skills": ["/plan-local-code-review"],
  "verification": {
    "type": "manual-check",
    "command": "echo 'Local code review completed'",
    "expected": "Review findings documented"
  }
}
```

### Task 10: Technical review

**Type:** Task

**Description:** Run technical review using `tech-reviewer` agent to check correctness, security, and performance.

**Acceptance Criteria:**
- [ ] Technical review completed
- [ ] Findings ranked by severity

**Verification:**
- Type: `manual-check`
- Command: `echo "Technical review completed"`
- Expected: Review findings documented

```json
{
  "plan": "fibonacci-generator-rewrite",
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

**Description:** Review findings from Tasks 7-10 and implement any valid suggestions. This runs after all reviews complete.

**Acceptance Criteria:**
- [ ] All valid review suggestions implemented
- [ ] Invalid suggestions documented with justification
- [ ] Tests still pass after changes
- [ ] Committed if changes were made

**Verification:**
- Type: `test`
- Command: `bun run test`
- Expected: All tests pass

```json
{
  "plan": "fibonacci-generator-rewrite",
  "type": "task",
  "skills": [],
  "verification": {
    "type": "test",
    "command": "bun run test",
    "expected": "All tests pass"
  }
}
```

### Task 12: Simplify code

**Type:** Task

**Description:** Run code simplification using `code-simplifier:code-simplifier` agent on recently modified files.

**Acceptance Criteria:**
- [ ] Code reviewed for simplification opportunities
- [ ] Any simplifications committed
- [ ] Tests still pass

**Verification:**
- Type: `test`
- Command: `bun run test`
- Expected: All tests pass

```json
{
  "plan": "fibonacci-generator-rewrite",
  "type": "task",
  "skills": [],
  "verification": {
    "type": "test",
    "command": "bun run test",
    "expected": "All tests pass"
  }
}
```

### Task 13: Update tests as needed

**Type:** Task

**Description:** Review and update tests based on review feedback and simplification changes. Add any missing tests identified during reviews.

**Acceptance Criteria:**
- [ ] Tests updated if reviews identified gaps
- [ ] Coverage still at 100%
- [ ] All tests pass

**Verification:**
- Type: `test-coverage`
- Command: `NODE_ENV=test npx jest --coverage --collectCoverageFrom='src/utils/fibonacci.ts' tests/unit/utils/fibonacci.test.ts 2>&1 | grep fibonacci.ts`
- Expected: `fibonacci.ts | 100 | 100 | 100 | 100`

```json
{
  "plan": "fibonacci-generator-rewrite",
  "type": "task",
  "skills": [],
  "verification": {
    "type": "test-coverage",
    "command": "NODE_ENV=test npx jest --coverage --collectCoverageFrom='src/utils/fibonacci.ts' tests/unit/utils/fibonacci.test.ts 2>&1 | grep fibonacci.ts",
    "expected": "fibonacci.ts | 100 | 100 | 100 | 100"
  }
}
```

### Task 14: Update documentation

**Type:** Task

**Description:** Ensure all JSDoc documentation is complete and follows project standards. Update any markdown files if needed.

**Acceptance Criteria:**
- [ ] JSDoc preambles on source and test files
- [ ] Function docs with `@param`, `@returns`, `@throws`, `@remarks`, `@example`
- [ ] Documentation focuses on "why" not "what" per jsdoc-best-practices

**Skills to Invoke:** `/jsdoc-best-practices`

**Verification:**
- Type: `documentation`
- Command: `grep -c '@param\|@returns\|@throws\|@remarks\|@example' src/utils/fibonacci.ts`
- Expected: Multiple JSDoc tags present (count > 10)

```json
{
  "plan": "fibonacci-generator-rewrite",
  "type": "task",
  "skills": ["/jsdoc-best-practices"],
  "verification": {
    "type": "documentation",
    "command": "grep -c '@param\\|@returns\\|@throws\\|@remarks\\|@example' src/utils/fibonacci.ts",
    "expected": "Count > 10 (multiple JSDoc tags)"
  }
}
```

### Task 15: Verify all task verification metadata

**Type:** Task

**Description:** Re-run all verification commands from Tasks 1-14 to ensure everything still passes.

**Acceptance Criteria:**
- [ ] All verification commands from prior tasks re-run and passing
- [ ] No regressions introduced by review/simplification changes

**Verification:**
- Type: `test`
- Command: `bun run test && bun run lint && bun run typecheck`
- Expected: All pass with zero errors

```json
{
  "plan": "fibonacci-generator-rewrite",
  "type": "task",
  "skills": [],
  "verification": {
    "type": "test",
    "command": "bun run test && bun run lint && bun run typecheck",
    "expected": "All pass with zero errors"
  }
}
```

### Task 16: Collect learnings

**Type:** Task

**Description:** Run the `learner` agent to collect learnings from this implementation cycle and process them into skills/rules.

**Acceptance Criteria:**
- [ ] Learnings collected from all tasks
- [ ] Each learning evaluated for skill/rule creation
- [ ] Relevant learnings persisted

**Verification:**
- Type: `manual-check`
- Command: `echo "Learnings collected"`
- Expected: Learnings processed

```json
{
  "plan": "fibonacci-generator-rewrite",
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

**Description:** Archive this plan following the Archive Procedure from plan-governance.md. This task runs last after all other tasks are complete.

**Acceptance Criteria:**
- [ ] `mkdir -p ./plans/completed/fibonacci-generator-rewrite`
- [ ] Plan file moved: `mv plans/fibonacci-generator-rewrite.md ./plans/completed/fibonacci-generator-rewrite/fibonacci-generator-rewrite.md`
- [ ] Source file verified gone: `! ls plans/fibonacci-generator-rewrite.md 2>/dev/null`
- [ ] Session task directories moved to `./plans/completed/fibonacci-generator-rewrite/tasks/`
- [ ] Any `in_progress` tasks updated to `completed`
- [ ] Final commit: `git add . && git commit -m "chore: archive fibonacci-generator-rewrite plan"`
- [ ] Push: `GIT_SSH_COMMAND="ssh -o ServerAliveInterval=30 -o ServerAliveCountMax=5" git push`
- [ ] PR marked ready: `gh pr ready`
- [ ] Auto-merge enabled: `gh pr merge --auto --merge`

**Verification:**
- Type: `manual-check`
- Command: `ls plans/completed/fibonacci-generator-rewrite/fibonacci-generator-rewrite.md && ! ls plans/fibonacci-generator-rewrite.md 2>/dev/null && echo "Archived"`
- Expected: `Archived`

```json
{
  "plan": "fibonacci-generator-rewrite",
  "type": "task",
  "skills": [],
  "verification": {
    "type": "manual-check",
    "command": "ls plans/completed/fibonacci-generator-rewrite/fibonacci-generator-rewrite.md && ! ls plans/fibonacci-generator-rewrite.md 2>/dev/null && echo 'Archived'",
    "expected": "Archived"
  }
}
```

## Task Dependencies

```
Task 1 (branch + PR) → blocks all other tasks
Task 2 (delete plans) → after Task 1
Task 3 (write tests - RED) → after Task 1
Task 4 (implement - GREEN) → after Task 3
Task 5 (verify coverage) → after Task 4
Task 6 (update PROJECT_RULES) → after Task 4
Tasks 7-10 (reviews) → after Task 5 and Task 6, run IN PARALLEL
Task 11 (implement review suggestions) → after Tasks 7-10
Task 12 (simplify code) → after Task 11
Task 13 (update tests) → after Task 12
Task 14 (update docs) → after Task 12
Task 15 (verify all metadata) → after Tasks 13 and 14
Task 16 (collect learnings) → after Task 15
Task 17 (archive) → after Task 16 (ALWAYS LAST)
```

## Implementation Team

To implement this plan, use `/plan-implement` which will create an Agent Team with these specialized agents:

| Agent | Use For |
|-------|---------|
| `implementer` | Code implementation — Tasks 2, 3, 4, 6 (TDD, source code, PROJECT_RULES updates) |
| `tech-reviewer` | Technical review — Task 10 |
| `product-reviewer` | Product/UX review — Task 7 |
| `learner` | Post-implementation learning — Task 16 |
| `test-coverage-agent` | Test verification — Tasks 5, 13 |
| `code-simplifier:code-simplifier` | Code simplification — Task 12 |
| `coderabbit:code-reviewer` | AI code review — Task 8 |

The **team lead** handles git operations (branch creation, commits, pushes, PR management, archival). Teammates focus on their specialized work. Run Tasks 7-10 (reviews) in parallel for efficiency.

## Sessions

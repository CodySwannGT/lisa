# Plan: Fibonacci Demo Script (TypeScript)

## Context

The user requested a bash function that prints Fibonacci numbers. After agent team research (researcher, codebase explorer, devil's advocate critic), the team identified that:

1. **Bash conflicts with project philosophy**: Lisa is a TypeScript-first, immutability-first project. The coding philosophy forbids `let`, mutable state, and imperative loops — all of which are unavoidable in bash.
2. **TypeScript is the better fit**: The project already has a TypeScript utility script (`scripts/update-node-version.ts`) run via `tsx`. TypeScript honors the project's functional, immutable philosophy and integrates naturally with Jest testing.
3. **Framing as demo/exercise**: Lisa is a governance framework — a Fibonacci function is a demo/exercise script placed in `scripts/` to demonstrate project conventions.

**Decision**: Implement in TypeScript (user-approved), placed in `scripts/`, exposed via package.json, tested with Jest.

**Branch:** `feat/reference-0003-agent-teams` (existing)
**PR:** #162 — https://github.com/CodySwannGT/lisa/pull/162
**PR target:** `main`

## Research Summary

### Researcher Findings
- **Algorithm**: Iterative approach — O(n) time, O(1) space, no recursion overhead
- **Overflow boundary**: fib(92) = 7540113804746346429 is the last value fitting in a 64-bit signed integer; fib(93) overflows. JavaScript's `Number.MAX_SAFE_INTEGER` (2^53 - 1) limits safe integer math to fib(78) = 8944394323791464. Using `BigInt` removes this limit entirely.
- **Input validation**: Reject negative, non-integer, and non-numeric input. Define a reasonable maximum.
- **Output**: Single fib(n) value to stdout (most composable for scripting)
- **Known correct values**: fib(0)=0, fib(1)=1, fib(10)=55, fib(20)=6765, fib(50)=12586269025, fib(92)=7540113804746346429

### Explorer Findings
- **Script patterns**: All existing scripts use strict mode, header comments, color logging, usage functions, input validation
- **TypeScript script precedent**: `scripts/update-node-version.ts` demonstrates the pattern for TypeScript utility scripts (run via `tsx`)
- **Package.json exposure**: Scripts use colon-namespaced names like `cleanup:github-branches`
- **Test pattern for scripts**: `tests/unit/hooks/track-plan-sessions.test.ts` tests bash scripts via Jest + `spawnSync` — same pattern applies to TypeScript scripts
- **Plan format**: Follows Context → Research Summary → Implementation → Tasks → Verification → Sessions structure

### Critic Findings
- **YAGNI concern**: A Fibonacci function has no governance purpose. Mitigated by framing as a demo/exercise script.
- **Language mismatch resolved**: TypeScript aligns with project philosophy (immutability, functional transformations, `const`-only)
- **Testing resolved**: TypeScript integrates naturally with Jest — no awkward shell-out patterns needed
- **Build/packaging**: `scripts/` is not in the `files` field of `package.json`, so it won't ship in the npm package
- **Overflow handling**: With TypeScript, we can use `BigInt` for arbitrary precision, or `Number` with a cap at fib(78). Recommendation: use `BigInt` for correctness.

## Implementation

### Files to Create

1. **`scripts/fibonacci.ts`** — The Fibonacci function and CLI entry point
   - Pure function: `fibonacci(n: bigint): bigint` using iterative approach with `BigInt`
   - Input validation via CLI argument parsing
   - Follows immutability-first philosophy (no `let`, use `reduce` or recursive-with-accumulator pattern)
   - Includes JSDoc preamble explaining purpose and usage
   - Run via: `tsx scripts/fibonacci.ts <n>`

2. **`tests/unit/scripts/fibonacci.test.ts`** — Jest tests
   - Import the pure function directly (no need for `spawnSync` since it's TypeScript)
   - Test correct values: fib(0)=0, fib(1)=1, fib(10)=55, fib(20)=6765, fib(50)=12586269025n, fib(92)=7540113804746346429n
   - Test edge cases: fib(0), fib(1), fib(2)
   - Test large values: fib(100), fib(200) (BigInt handles these)
   - Test input validation: negative numbers throw, non-integers throw
   - Test CLI integration via `spawnSync` with `tsx`

### Files to Modify

3. **`package.json`** — Add script entry:
   ```json
   "fibonacci": "tsx scripts/fibonacci.ts"
   ```

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Language | TypeScript | Project philosophy, Jest integration, user-approved |
| Algorithm | Iterative | O(n) time, O(1) space, simple, fast |
| Number type | `BigInt` | No overflow limit, correct for all inputs |
| Output | Single fib(n) value | Most composable for scripting |
| Location | `scripts/` | Not shipped in npm package, consistent with existing scripts |
| Immutability | Tail-recursive or `Array.from` + reduce | Honors `const`-only philosophy |
| Max input | 10000 (practical limit) | BigInt can handle it; prevents accidental infinite compute |
| Export | Named export of pure function | Enables direct import in tests |

### Functional Fibonacci (Immutable)

The implementation must honor the coding philosophy's immutability rules. Instead of a `for` loop with mutable `let a, b`, use one of:

**Option A — `Array.from` with reduce (recommended)**:
```typescript
const fibonacci = (n: bigint): bigint => {
  if (n < 0n) throw new Error("Input must be a non-negative integer");
  if (n <= 1n) return n;
  const result = Array.from({ length: Number(n) - 1 }, (_, i) => i).reduce(
    (acc) => ({ a: acc.b, b: acc.a + acc.b }),
    { a: 0n, b: 1n }
  );
  return result.b;
};
```

**Option B — Tail-recursive**:
```typescript
const fibonacci = (n: bigint): bigint => {
  if (n < 0n) throw new Error("Input must be a non-negative integer");
  const go = (i: bigint, a: bigint, b: bigint): bigint =>
    i === 0n ? a : go(i - 1n, b, a + b);
  return go(n, 0n, 1n);
};
```

Note: Option B may hit stack limits for very large n. Option A is safer and more idiomatic for this project's functional style.

### Skills to Invoke

- `/coding-philosophy` — always required
- `/jsdoc-best-practices` — for JSDoc documentation on the function and test file
- `/git:commit` — for atomic conventional commits
- `/git:submit-pr` — for pushing to the existing PR
- `coderabbit:review` plugin — for code review
- `/plan-local-code-review` — for local code review
- `code-simplifier` plugin — for simplification pass

### Plugins Required

- `code-review@claude-plugins-official` — CodeRabbit review
- `code-simplifier@claude-plugins-official` — Code simplification
- `typescript-lsp@claude-plugins-official` — TypeScript language server for type checking

## Tasks

Create task list using TaskCreate with the following tasks:

### Task 1: Create `scripts/fibonacci.ts`
- **Subject:** Create scripts/fibonacci.ts with pure Fibonacci function
- **ActiveForm:** Creating Fibonacci TypeScript implementation
- **Type:** Task
- **Description:** Create a TypeScript script that exports a pure `fibonacci` function using `BigInt` and an iterative-functional approach (no `let`, no mutation). Include CLI entry point that reads `process.argv[2]`, validates input, and prints fib(n) to stdout. Include JSDoc preamble. Follow existing script conventions from `scripts/update-node-version.ts`.
- **Acceptance Criteria:**
  - [ ] Pure function `fibonacci(n: bigint): bigint` exported
  - [ ] Uses `BigInt` for arbitrary precision
  - [ ] No `let` or mutable state (honors coding philosophy)
  - [ ] Input validation: rejects negative, non-integer, missing, non-numeric, and n > 10000
  - [ ] Errors written to stderr, function result to stdout
  - [ ] JSDoc preamble with description, usage, and examples
  - [ ] Exit code 0 on success, 1 on error
- **Skills:** `/coding-philosophy`, `/jsdoc-best-practices`
- **Verification:**
  - Type: `manual-check`
  - Command: `tsx scripts/fibonacci.ts 10`
  - Expected: `55`

### Task 2: Add `fibonacci` script to package.json
- **Subject:** Add fibonacci script entry to package.json
- **ActiveForm:** Adding fibonacci script to package.json
- **Type:** Task
- **Description:** Add `"fibonacci": "tsx scripts/fibonacci.ts"` to the `scripts` section of `package.json`. Regenerate lockfile afterward per CLAUDE.md rules.
- **Acceptance Criteria:**
  - [ ] `fibonacci` script added to package.json
  - [ ] Lockfile regenerated
  - [ ] `bun run fibonacci 10` outputs `55`
- **Skills:** `/coding-philosophy`
- **Verification:**
  - Type: `manual-check`
  - Command: `bun run fibonacci -- 10`
  - Expected: `55`
- **Blocked by:** Task 1

### Task 3: Create `tests/unit/scripts/fibonacci.test.ts`
- **Subject:** Create Jest tests for Fibonacci function
- **ActiveForm:** Creating Fibonacci test suite
- **Type:** Task
- **Description:** Create comprehensive Jest tests for the Fibonacci function. Import the pure function directly for unit tests. Use `spawnSync` with `tsx` for CLI integration tests. Follow existing test patterns from `tests/unit/hooks/track-plan-sessions.test.ts`.
- **Acceptance Criteria:**
  - [ ] Tests for correct values: fib(0)=0, fib(1)=1, fib(2)=1, fib(5)=5, fib(10)=55, fib(20)=6765, fib(50)=12586269025, fib(92)=7540113804746346429
  - [ ] Tests for large values: fib(100), fib(200)
  - [ ] Tests for edge cases: fib(0), fib(1)
  - [ ] Tests for error cases: negative input, non-integer input (if applicable), missing input, n > 10000
  - [ ] Tests for CLI output format
  - [ ] JSDoc preamble on test file
  - [ ] All tests pass
- **Skills:** `/coding-philosophy`, `/jsdoc-best-practices`
- **Verification:**
  - Type: `test`
  - Command: `bun run test -- tests/unit/scripts/fibonacci.test.ts`
  - Expected: All tests pass
- **Blocked by:** Task 1

### Task 4: Run linter and type checker
- **Subject:** Verify lint and typecheck pass for new files
- **ActiveForm:** Running linter and type checker
- **Type:** Task
- **Description:** Run ESLint and TypeScript type checker against the new files to ensure they meet project standards. Fix any violations.
- **Acceptance Criteria:**
  - [ ] `bun run lint` passes (or only pre-existing warnings)
  - [ ] `bun run typecheck` passes
  - [ ] `bun run format:check` passes
- **Skills:** `/coding-philosophy`
- **Verification:**
  - Type: `manual-check`
  - Command: `bun run lint && bun run typecheck && bun run format:check`
  - Expected: All pass with exit code 0
- **Blocked by:** Tasks 1, 2, 3

### Task 5: Commit implementation
- **Subject:** Create atomic conventional commit for Fibonacci implementation
- **ActiveForm:** Committing Fibonacci implementation
- **Type:** Task
- **Description:** Stage and commit all new/modified files with a conventional commit message. Use `/git:commit` skill.
- **Skills:** `/git:commit`
- **Verification:**
  - Type: `manual-check`
  - Command: `git log --oneline -1`
  - Expected: Conventional commit message like `feat: add fibonacci demo script`
- **Blocked by:** Task 4

### Task 6: Push to PR
- **Subject:** Push changes to PR #162
- **ActiveForm:** Pushing to PR
- **Type:** Task
- **Description:** Push the commit to the existing PR #162 on branch `feat/reference-0003-agent-teams`.
- **Skills:** `/git:submit-pr`
- **Verification:**
  - Type: `manual-check`
  - Command: `gh pr view 162 --json commits --jq '.commits[-1].messageHeadline'`
  - Expected: Most recent commit contains fibonacci-related message
- **Blocked by:** Task 5

### Task 7: Review with CodeRabbit
- **Subject:** Review Fibonacci implementation with CodeRabbit
- **ActiveForm:** Running CodeRabbit review
- **Type:** Task
- **Description:** Run CodeRabbit code review on the implementation. Invoke `coderabbit:review` skill.
- **Skills:** `coderabbit:review`
- **Verification:**
  - Type: `manual-check`
  - Command: Review output contains no critical issues
  - Expected: Clean or advisory-only review
- **Blocked by:** Task 6

### Task 8: Run local code review
- **Subject:** Run local code review on Fibonacci implementation
- **ActiveForm:** Running local code review
- **Type:** Task
- **Description:** Run `/plan-local-code-review` skill to review the implementation against coding standards.
- **Skills:** `/plan-local-code-review`
- **Verification:**
  - Type: `manual-check`
  - Command: Review output contains no critical issues
  - Expected: Clean or advisory-only review
- **Blocked by:** Task 6

### Task 9: Implement valid review suggestions
- **Subject:** Implement valid suggestions from code reviews
- **ActiveForm:** Implementing review suggestions
- **Type:** Task
- **Description:** Review findings from Tasks 7 and 8. Implement any valid suggestions. Skip suggestions that conflict with project philosophy or are cosmetic-only.
- **Skills:** `/coding-philosophy`
- **Verification:**
  - Type: `test`
  - Command: `bun run test -- tests/unit/scripts/fibonacci.test.ts && bun run lint`
  - Expected: All tests pass, lint clean
- **Blocked by:** Tasks 7, 8

### Task 10: Simplify with code simplifier
- **Subject:** Simplify Fibonacci implementation with code simplifier agent
- **ActiveForm:** Simplifying implementation
- **Type:** Task
- **Description:** Run the `code-simplifier` plugin on the implementation to identify simplification opportunities.
- **Skills:** `code-simplifier` plugin
- **Verification:**
  - Type: `test`
  - Command: `bun run test -- tests/unit/scripts/fibonacci.test.ts`
  - Expected: All tests still pass after simplification
- **Blocked by:** Task 9

### Task 11: Update/verify tests
- **Subject:** Verify test coverage is comprehensive after review changes
- **ActiveForm:** Verifying test coverage
- **Type:** Task
- **Description:** After review implementations and simplifications, verify all tests still pass and coverage is adequate. Add any missing tests identified during review.
- **Verification:**
  - Type: `test`
  - Command: `bun run test -- tests/unit/scripts/fibonacci.test.ts`
  - Expected: All tests pass
- **Blocked by:** Task 10

### Task 12: Update/verify documentation
- **Subject:** Verify JSDoc and documentation are complete and accurate
- **ActiveForm:** Verifying documentation
- **Type:** Task
- **Description:** Ensure JSDoc preambles are present on all new files. Verify the function documentation explains "why" not just "what" per `/jsdoc-best-practices`. No README or CHANGELOG updates needed (per CLAUDE.md rules).
- **Skills:** `/jsdoc-best-practices`
- **Verification:**
  - Type: `documentation`
  - Command: `grep -c "@module\|@description\|@param\|@returns\|@example" scripts/fibonacci.ts`
  - Expected: At least 4 matches (module, description, param, returns)
- **Blocked by:** Task 10

### Task 13: Verify all task verifications
- **Subject:** Run all verification commands from all tasks
- **ActiveForm:** Running all verification commands
- **Type:** Task
- **Description:** Go through every task in this plan and re-run its verification command. Confirm all pass.
- **Verification:**
  - Type: `manual-check`
  - Command: `tsx scripts/fibonacci.ts 10 && bun run test -- tests/unit/scripts/fibonacci.test.ts && bun run lint && bun run typecheck`
  - Expected: All commands succeed
- **Blocked by:** Tasks 11, 12

### Task 14: Final commit and push
- **Subject:** Commit and push final changes after reviews
- **ActiveForm:** Committing and pushing final changes
- **Type:** Task
- **Description:** If any changes were made during review/simplification/documentation tasks, create a new atomic commit and push to PR #162.
- **Skills:** `/git:commit`
- **Verification:**
  - Type: `manual-check`
  - Command: `git status`
  - Expected: Clean working directory
- **Blocked by:** Task 13

### Task 15: Archive plan
- **Subject:** Archive the plan to ./plans/completed
- **ActiveForm:** Archiving plan
- **Type:** Task
- **Description:**
  - Create folder `fibonacci-demo-script` in `./plans/completed`
  - Rename this plan file to `fibonacci-demo-script.md` (already named correctly)
  - Move it into `./plans/completed/fibonacci-demo-script/`
  - Read the session IDs from `./plans/completed/fibonacci-demo-script/fibonacci-demo-script.md`
  - For each session ID, move `~/.claude/tasks/<session-id>` directory to `./plans/completed/fibonacci-demo-script/tasks`
  - Update any "in_progress" tasks to "completed"
  - Commit changes
  - Push changes to the PR
- **Blocked by:** All other tasks

## Implementation Team

When ready to implement, spawn a second Agent Team with these roles:

> Based on the contents of this plan and its tasks, create a world-class agent team to implement it, then refactor, test, verify, review, and learn from the implementation.

Suggested team structure:
- **implementer** (general-purpose): Tasks 1-4 — creates the TypeScript function, tests, and package.json entry
- **reviewer** (general-purpose): Tasks 7-9 — runs code reviews and implements suggestions
- **verifier** (general-purpose): Tasks 10-14 — simplifies, verifies tests/docs, runs final verification
- **archiver** (general-purpose): Task 15 — archives the plan after everything passes

Tasks 5-6 (commit/push) should be done by the team lead to coordinate timing.

## Verification

End-to-end verification after all tasks complete:

```bash
# Function works correctly
tsx scripts/fibonacci.ts 0    # Expected: 0
tsx scripts/fibonacci.ts 1    # Expected: 1
tsx scripts/fibonacci.ts 10   # Expected: 55
tsx scripts/fibonacci.ts 20   # Expected: 6765
tsx scripts/fibonacci.ts 50   # Expected: 12586269025
tsx scripts/fibonacci.ts 92   # Expected: 7540113804746346429

# Package.json script works
bun run fibonacci -- 10       # Expected: 55

# Tests pass
bun run test -- tests/unit/scripts/fibonacci.test.ts

# Lint/typecheck pass
bun run lint && bun run typecheck && bun run format:check

# Error cases handled
tsx scripts/fibonacci.ts -1   # Expected: error message, exit 1
tsx scripts/fibonacci.ts abc  # Expected: error message, exit 1
tsx scripts/fibonacci.ts      # Expected: error/usage message, exit 1
```

## Sessions

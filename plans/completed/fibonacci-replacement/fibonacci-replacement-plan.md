# Implementer Plan: Fibonacci Replacement (Tasks 2, 3, 4)

## Context

This plan covers the sequential TDD workflow for replacing the fibonacci module. Task 1 (exploration) confirmed no external consumers beyond the barrel export and test file. The existing implementation follows all project conventions and will serve as the reference for the replacement.

## Files to Modify

- `src/utils/fibonacci.ts` — delete then recreate
- `src/utils/index.ts` — remove barrel export then re-add
- `tests/unit/utils/fibonacci.test.ts` — delete then recreate

## Task 2: Delete Existing Implementation

1. Delete `src/utils/fibonacci.ts`
2. Remove `export * from "./fibonacci.js";` from `src/utils/index.ts` (line 1)
3. Delete `tests/unit/utils/fibonacci.test.ts`
4. Run `bun run typecheck` to verify no broken references
5. Commit: `refactor: remove existing fibonacci implementation`

## Task 3: Write Failing Tests (TDD RED)

Create `tests/unit/utils/fibonacci.test.ts` with these test groups:

**fibonacciGenerator** (4 tests):
- First 8 values: `[0n, 1n, 1n, 2n, 3n, 5n, 8n, 13n]`
- Yields BigInt type
- Never completes after 100 iterations
- Independent iterators from separate calls

**fibonacci** (15 tests):
- Known values: F(0)=0n, F(1)=1n, F(2)=1n, F(5)=5n, F(10)=55n, F(20)=6765n
- BigInt precision: F(78)=8944394323791464n, F(100)=354224848179261915075n, F(200)=280571172992510140037611932413038677189525n
- Returns bigint type
- RangeError for: negative, fractional, NaN, Infinity, -Infinity

**fibonacciSequence** (10 tests):
- Empty array for 0, `[0n]` for 1, first 8 values match generator
- All values are BigInt type
- Fresh array reference each call
- Same RangeError validation: negative, fractional, NaN, Infinity, -Infinity

Run `bun run test -- tests/unit/utils/fibonacci.test.ts` — expect 0 tests found (module not found prevents parsing).
Commit: `test: add failing tests for new fibonacci implementation (TDD RED)`

## Task 4: Implement (TDD GREEN)

Create `src/utils/fibonacci.ts`:
- `fibonacciGenerator()`: Generator with `let pair: readonly [bigint, bigint]` tuple, eslint-disable comment with description
- `fibonacci(n)`: Inline guard clause validation, delegates to generator via `Array.from({ length: n + 1 }).reduce()`
- `fibonacciSequence(length)`: Same validation pattern, delegates to generator via `[...Array(length)].map()`
- JSDoc preambles with "why" not "what", invoke /jsdoc-best-practices skill

Re-add barrel export to `src/utils/index.ts`: `export * from "./fibonacci.js";`

Run `bun run test -- tests/unit/utils/fibonacci.test.ts` — all tests pass.
Commit: `feat: implement new fibonacci generator (TDD GREEN)`

## Verification

```bash
bun run test -- tests/unit/utils/fibonacci.test.ts
```

Expected: All tests pass (29 tests across 3 describe blocks).

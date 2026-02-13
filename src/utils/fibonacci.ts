/**
 * @file fibonacci.ts
 * @description BigInt Fibonacci utilities built on a lazy infinite generator.
 * Every public function delegates to `fibonacciGenerator` so the core
 * recurrence relation lives in exactly one place (DRY). BigInt eliminates
 * the precision ceiling that Number hits at fibonacci(78).
 * @module utils
 */

/**
 * Infinite generator that lazily yields the Fibonacci sequence as BigInts
 * @yields The next Fibonacci number in the sequence (0n, 1n, 1n, 2n, 3n, …)
 * @remarks Each call creates an independent iterator with its own state, so
 * multiple consumers can advance through the sequence without interference.
 * @example
 * ```typescript
 * const gen = fibonacciGenerator();
 * gen.next().value; // 0n
 * gen.next().value; // 1n
 * gen.next().value; // 1n
 * ```
 */
export function* fibonacciGenerator(): Generator<bigint, never, unknown> {
  /* eslint-disable functional/no-let -- generator requires mutable state for iterative Fibonacci computation */
  let a = 0n;
  let b = 1n;
  /* eslint-enable functional/no-let -- re-enable after generator state declarations */

  while (true) {
    yield a;
    [a, b] = [b, a + b];
  }
}

/**
 * Returns the nth Fibonacci number as a BigInt
 * @param n - Zero-based index into the Fibonacci sequence (must be a non-negative integer)
 * @returns The nth Fibonacci number (e.g. fibonacci(5) → 5n)
 * @throws {RangeError} When n is negative, non-integer, NaN, or Infinity
 * @remarks Delegates to `fibonacciGenerator` so the recurrence logic is defined once.
 * @example
 * ```typescript
 * fibonacci(0);   // 0n
 * fibonacci(10);  // 55n
 * fibonacci(78);  // 8944394323791464n — beyond Number.MAX_SAFE_INTEGER
 * ```
 */
export function fibonacci(n: number): bigint {
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    throw new RangeError(
      `Expected a non-negative integer for n, got ${String(n)}`
    );
  }

  const gen = fibonacciGenerator();
  Array.from({ length: n }, () => gen.next());
  return gen.next().value;
}

/**
 * Returns the first `length` Fibonacci numbers as a readonly BigInt array
 * @param length - How many Fibonacci numbers to return (must be a non-negative integer)
 * @returns A new array containing the first `length` Fibonacci numbers
 * @throws {RangeError} When length is negative, non-integer, NaN, or Infinity
 * @remarks Delegates to `fibonacciGenerator` so the recurrence logic is defined once.
 * Returns a fresh array on every call — callers can safely mutate the result.
 * @example
 * ```typescript
 * fibonacciSequence(0);  // []
 * fibonacciSequence(5);  // [0n, 1n, 1n, 2n, 3n]
 * ```
 */
export function fibonacciSequence(length: number): readonly bigint[] {
  if (!Number.isFinite(length) || !Number.isInteger(length) || length < 0) {
    throw new RangeError(
      `Expected a non-negative integer for length, got ${String(length)}`
    );
  }

  const gen = fibonacciGenerator();
  return Array.from({ length }, () => gen.next().value);
}

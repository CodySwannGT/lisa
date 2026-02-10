/**
 * @file fibonacci.ts
 * @description BigInt Fibonacci utilities using a lazy generator pattern.
 * Uses BigInt instead of Number to eliminate the precision ceiling at
 * fibonacci(78) — BigInt supports arbitrarily large integers, so callers
 * can compute fibonacci(1000) or beyond without silent corruption.
 * The generator pattern enables lazy evaluation, letting consumers pull
 * only the values they need without allocating the full sequence upfront.
 * @module fibonacci
 */

/**
 * Infinite lazy generator yielding Fibonacci numbers as BigInt.
 *
 * @returns Generator that yields successive Fibonacci numbers (0n, 1n, 1n, 2n, 3n, ...)
 * @remarks The generator never terminates — do not spread or collect without a length limit.
 * Each call creates an independent generator instance — safe for concurrent iteration.
 * @example
 * ```typescript
 * const gen = fibonacciGenerator();
 * gen.next().value; // 0n
 * gen.next().value; // 1n
 *
 * // Collect first 5 values:
 * const first5 = Array.from({ length: 5 }, () => gen.next().value);
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
 * Compute the nth Fibonacci number (0-indexed) using BigInt.
 *
 * @param n - Zero-based index in the Fibonacci sequence (must be a non-negative integer)
 * @returns The nth Fibonacci number as a BigInt — compare with `===` against bigint literals (e.g. `55n`), not numbers
 * @throws {RangeError} If n is negative, non-integer, NaN, or Infinity
 * @remarks Delegates to fibonacciGenerator — O(n) time, consistent with the lazy generator approach
 * @example
 * ```typescript
 * fibonacci(10); // 55n (bigint, not number)
 * fibonacci(10) === 55n; // true
 * fibonacci(10) === 55; // false — bigint !== number
 * ```
 */
export function fibonacci(n: number): bigint {
  if (!Number.isInteger(n) || n < 0) {
    throw new RangeError(
      `Expected a non-negative integer for n, got ${String(n)}`
    );
  }

  const gen = fibonacciGenerator();

  Array.from({ length: n }, () => gen.next());

  return gen.next().value;
}

/**
 * Generate the first `length` Fibonacci numbers as a readonly BigInt array.
 *
 * @param length - How many Fibonacci numbers to generate (must be a non-negative integer)
 * @returns A readonly array of the first `length` Fibonacci numbers as BigInt
 * @throws {RangeError} If length is negative, non-integer, NaN, or Infinity
 * @remarks Wraps fibonacciGenerator so the sequence is computed once, not per-element
 * @example
 * ```typescript
 * fibonacciSequence(5); // [0n, 1n, 1n, 2n, 3n]
 * ```
 */
export function fibonacciSequence(length: number): readonly bigint[] {
  if (!Number.isInteger(length) || length < 0) {
    throw new RangeError(
      `Expected a non-negative integer for length, got ${String(length)}`
    );
  }

  const gen = fibonacciGenerator();

  return Array.from({ length }, () => gen.next().value);
}

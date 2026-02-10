/**
 * Fibonacci sequence utilities providing safe, validated computation
 * within JavaScript's integer precision limits.
 *
 * Caps at fibonacci(78) / sequence length 79 because fibonacci(79)
 * exceeds Number.MAX_SAFE_INTEGER, which would silently corrupt results.
 *
 * @module fibonacci
 */

/** Largest n for which fibonacci(n) fits in a safe JS integer. */
const MAX_SAFE_N = 78;

/** Largest sequence length where all elements remain safe JS integers. */
const MAX_SAFE_LENGTH = 79;

/**
 * Compute the nth Fibonacci number (0-indexed).
 *
 * Uses an iterative tuple-reduce approach to avoid stack overflow
 * and keep computation O(n) time, O(1) space.
 *
 * @param n - The zero-based index in the Fibonacci sequence
 * @returns The nth Fibonacci number
 * @throws {RangeError} If n is negative, non-integer, NaN, Infinity, or greater than 78
 */
export function fibonacci(n: number): number {
  if (!Number.isInteger(n) || n < 0) {
    throw new RangeError(
      `Expected a non-negative integer for n, got ${String(n)}`
    );
  }

  if (n > MAX_SAFE_N) {
    throw new RangeError(
      "fibonacci(n) exceeds Number.MAX_SAFE_INTEGER for n > 78"
    );
  }

  if (n <= 1) {
    return n;
  }

  const [, result] = Array.from({ length: n - 1 }).reduce<
    readonly [number, number]
  >(([prev, curr]) => [curr, prev + curr] as const, [0, 1]);

  return result;
}

/**
 * Generate the first `length` Fibonacci numbers as a readonly array.
 *
 * Builds the sequence incrementally with reduce so each element derives
 * from its two predecessors without recomputing from scratch.
 *
 * @param length - How many Fibonacci numbers to generate
 * @returns A readonly array of Fibonacci numbers
 * @throws {RangeError} If length is negative, non-integer, NaN, Infinity, or greater than 79
 */
export function fibonacciSequence(length: number): readonly number[] {
  if (!Number.isInteger(length) || length < 0) {
    throw new RangeError(
      `Expected a non-negative integer for length, got ${String(length)}`
    );
  }

  if (length > MAX_SAFE_LENGTH) {
    throw new RangeError(
      "fibonacciSequence(length) exceeds Number.MAX_SAFE_INTEGER for length > 79"
    );
  }

  return Array.from({ length }).reduce<readonly number[]>(
    (acc, _, i) => [...acc, i < 2 ? i : (acc[i - 1] ?? 0) + (acc[i - 2] ?? 0)],
    []
  );
}

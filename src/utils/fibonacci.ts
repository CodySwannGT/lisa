/**
 * @file fibonacci.ts
 * @description Tuple-based Fibonacci utilities powered by an infinite BigInt generator.
 * BigInt avoids the precision ceiling that Number hits at F(78), where values
 * exceed Number.MAX_SAFE_INTEGER. Every public function derives its values from
 * fibonacciGenerator, keeping the recurrence relation in a single place.
 * @module utils
 */

/**
 * Infinite generator yielding the Fibonacci sequence as BigInts.
 *
 * Uses a two-element pair to track consecutive values, yielding the leading
 * element on each iteration and advancing the pair forward. Each call returns
 * an independent iterator, so multiple consumers never interfere.
 *
 * @yields The next Fibonacci number (0n, 1n, 1n, 2n, 3n, 5n, …)
 * @example
 * ```typescript
 * const gen = fibonacciGenerator();
 * gen.next().value; // 0n
 * gen.next().value; // 1n
 * ```
 */
export function* fibonacciGenerator(): Generator<bigint, never, unknown> {
  /* eslint-disable functional/no-let -- generator requires mutable pair to track consecutive Fibonacci values */
  let pair: readonly [bigint, bigint] = [0n, 1n];
  /* eslint-enable functional/no-let -- re-enable after generator state declaration */

  for (;;) {
    yield pair[0];
    pair = [pair[1], pair[0] + pair[1]];
  }
}

/**
 * Returns the nth Fibonacci number (0-indexed) as a BigInt.
 *
 * Collects n + 1 values from the generator and returns the final element,
 * delegating the recurrence to fibonacciGenerator for DRY.
 *
 * @param n - Zero-based position in the Fibonacci sequence (non-negative integer)
 * @returns The nth Fibonacci number as a BigInt
 * @throws {RangeError} When n is negative, fractional, NaN, or infinite
 * @example
 * ```typescript
 * fibonacci(0);   // 0n
 * fibonacci(10);  // 55n
 * fibonacci(78);  // 8944394323791464n — beyond Number.MAX_SAFE_INTEGER
 * ```
 */
export const fibonacci = (n: number): bigint => {
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    throw new RangeError(
      `Expected a non-negative integer for n, got ${String(n)}`
    );
  }

  const gen = fibonacciGenerator();
  return Array.from({ length: n + 1 }).reduce<bigint>(
    () => gen.next().value,
    0n
  );
};

/**
 * Returns the first `length` Fibonacci numbers as a readonly BigInt array.
 *
 * Spreads an empty array of the requested size and maps each slot to the
 * next generator value, delegating the recurrence to fibonacciGenerator for DRY.
 * Returns a fresh array on every call so callers can safely consume the result.
 *
 * @param length - How many Fibonacci numbers to collect (non-negative integer)
 * @returns A new readonly array of the first `length` Fibonacci numbers
 * @throws {RangeError} When length is negative, fractional, NaN, or infinite
 * @example
 * ```typescript
 * fibonacciSequence(0);  // []
 * fibonacciSequence(5);  // [0n, 1n, 1n, 2n, 3n]
 * ```
 */
export const fibonacciSequence = (length: number): readonly bigint[] => {
  if (!Number.isFinite(length) || !Number.isInteger(length) || length < 0) {
    throw new RangeError(
      `Expected a non-negative integer for length, got ${String(length)}`
    );
  }

  const gen = fibonacciGenerator();
  return [...Array(length)].map(() => gen.next().value);
};

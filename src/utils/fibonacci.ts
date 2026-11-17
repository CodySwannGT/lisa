/**
 * @file fibonacci.ts
 * @description Tuple-based Fibonacci utilities powered by an infinite BigInt generator.
 * BigInt avoids the precision ceiling that Number hits at F(78), where values
 * exceed Number.MAX_SAFE_INTEGER. Every public function derives its values from
 * fibonacciGenerator, keeping the recurrence relation in a single place.
 * @module utils
 */

/** How many values each step of the generator expands at once. */
const BLOCK = 1024;

/**
 * F(-1), F(0), F(1), … F(BLOCK + 1): the coefficients that expand a pair of
 * consecutive Fibonacci values into the block that follows it.
 * @param row - The coefficients built so far, starting from F(-1), F(0)
 * @returns The full coefficient row
 */
function coefficientRow(row: readonly bigint[] = [1n, 0n]): readonly bigint[] {
  if (row.length === BLOCK + 3) return row;
  return coefficientRow([...row, (row.at(-1) ?? 0n) + (row.at(-2) ?? 0n)]);
}

const COEFFICIENTS = coefficientRow();

/**
 * The value `offset` places after a pair of consecutive Fibonacci values:
 * F(k + offset) = F(k)·F(offset − 1) + F(k + 1)·F(offset).
 * @param current - F(k)
 * @param following - F(k + 1)
 * @param offset - Distance from k, between 0 and BLOCK + 1
 * @returns F(k + offset)
 */
function ahead(current: bigint, following: bigint, offset: number): bigint {
  return (
    current * (COEFFICIENTS[offset] ?? 0n) +
    following * (COEFFICIENTS[offset + 1] ?? 0n)
  );
}

/**
 * Yields the sequence from a pair of consecutive values onward. The pair is
 * the recurrence's whole state, so it travels as the parameters: each step
 * yields one block derived from the pair, then continues from the pair that
 * follows the block. Expanding a block per step keeps delegation depth at
 * n / BLOCK, so no reachable position overflows the stack.
 * @param current - F(k)
 * @param following - F(k + 1)
 * @yields F(k), F(k + 1), …
 * @returns Never; the sequence is infinite
 */
function* fibonacciFrom(
  current: bigint,
  following: bigint
): Generator<bigint, never, unknown> {
  yield* Array.from({ length: BLOCK }, (_, offset) =>
    ahead(current, following, offset)
  );
  return yield* fibonacciFrom(
    ahead(current, following, BLOCK),
    ahead(current, following, BLOCK + 1)
  );
}

/**
 * Infinite generator yielding the Fibonacci sequence as BigInts.
 *
 * Each call returns an independent iterator, so multiple consumers never
 * interfere.
 * @yields The next Fibonacci number (0n, 1n, 1n, 2n, 3n, 5n, …)
 * @returns Never; the sequence is infinite
 * @example
 * ```typescript
 * const gen = fibonacciGenerator();
 * gen.next().value; // 0n
 * gen.next().value; // 1n
 * ```
 */
export function* fibonacciGenerator(): Generator<bigint, never, unknown> {
  return yield* fibonacciFrom(0n, 1n);
}

/**
 * Returns the nth Fibonacci number (0-indexed) as a BigInt.
 *
 * Collects n + 1 values from the generator and returns the final element,
 * delegating the recurrence to fibonacciGenerator for DRY.
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

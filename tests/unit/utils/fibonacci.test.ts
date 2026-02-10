/**
 * @file fibonacci.test.ts
 * @description TDD RED phase tests for the BigInt Fibonacci generator rewrite.
 * Validates three exports — fibonacciGenerator, fibonacci, fibonacciSequence —
 * against hardcoded known values, type guarantees, generator laziness, instance
 * independence, and input-validation error handling.
 * @module fibonacci
 */
import { describe, expect, it } from "@jest/globals";

import {
  fibonacci,
  fibonacciGenerator,
  fibonacciSequence,
} from "../../../src/utils/fibonacci.js";

describe("fibonacci utilities", () => {
  describe("fibonacciGenerator", () => {
    it("yields 0n as the first value", () => {
      const gen = fibonacciGenerator();
      expect(gen.next().value).toBe(0n);
    });

    it("yields 1n as the second value", () => {
      const gen = fibonacciGenerator();
      gen.next();
      expect(gen.next().value).toBe(1n);
    });

    it("yields the first 8 Fibonacci numbers in order", () => {
      const gen = fibonacciGenerator();
      const values = Array.from({ length: 8 }, () => gen.next().value);
      expect(values).toEqual([0n, 1n, 1n, 2n, 3n, 5n, 8n, 13n]);
    });

    it("yields bigint values", () => {
      const gen = fibonacciGenerator();
      expect(typeof gen.next().value).toBe("bigint");
    });

    it("reports done as false on every next() call", () => {
      const gen = fibonacciGenerator();
      const results = Array.from({ length: 5 }, () => gen.next());
      expect(results.every(r => r.done === false)).toBe(true);
    });

    it("produces independent sequences from separate instances", () => {
      const gen1 = fibonacciGenerator();
      const gen2 = fibonacciGenerator();

      gen1.next();
      gen1.next();
      gen1.next();

      expect(gen1.next().value).toBe(2n);
      expect(gen2.next().value).toBe(0n);
    });

    it("never terminates after 100 calls", () => {
      const gen = fibonacciGenerator();
      Array.from({ length: 100 }, () => gen.next());
      expect(gen.next().done).toBe(false);
    });
  });

  describe("fibonacci", () => {
    it("returns 0n for fibonacci(0)", () => {
      expect(fibonacci(0)).toBe(0n);
    });

    it("returns 1n for fibonacci(1)", () => {
      expect(fibonacci(1)).toBe(1n);
    });

    it("returns 1n for fibonacci(2)", () => {
      expect(fibonacci(2)).toBe(1n);
    });

    it("returns 5n for fibonacci(5)", () => {
      expect(fibonacci(5)).toBe(5n);
    });

    it("returns 55n for fibonacci(10)", () => {
      expect(fibonacci(10)).toBe(55n);
    });

    it("returns 6765n for fibonacci(20)", () => {
      expect(fibonacci(20)).toBe(6765n);
    });

    it("returns 8944394323791464n for fibonacci(78) — beyond Number.MAX_SAFE_INTEGER", () => {
      expect(fibonacci(78)).toBe(8944394323791464n);
    });

    it("returns correct value for fibonacci(100)", () => {
      expect(fibonacci(100)).toBe(354224848179261915075n);
    });

    it("returns correct value for fibonacci(200)", () => {
      expect(fibonacci(200)).toBe(280571172992510140037611932413038677189525n);
    });

    it("returns a bigint value", () => {
      expect(typeof fibonacci(10)).toBe("bigint");
    });

    it("throws RangeError for negative input", () => {
      expect(() => fibonacci(-1)).toThrow(RangeError);
      expect(() => fibonacci(-1)).toThrow(
        "Expected a non-negative integer for n, got -1"
      );
    });

    it("throws RangeError for non-integer input", () => {
      expect(() => fibonacci(3.5)).toThrow(RangeError);
      expect(() => fibonacci(3.5)).toThrow(
        "Expected a non-negative integer for n, got 3.5"
      );
    });

    it("throws RangeError for non-finite input", () => {
      expect(() => fibonacci(NaN)).toThrow(RangeError);
      expect(() => fibonacci(NaN)).toThrow(
        "Expected a non-negative integer for n, got NaN"
      );
      expect(() => fibonacci(Infinity)).toThrow(RangeError);
      expect(() => fibonacci(Infinity)).toThrow(
        "Expected a non-negative integer for n, got Infinity"
      );
      expect(() => fibonacci(-Infinity)).toThrow(RangeError);
      expect(() => fibonacci(-Infinity)).toThrow(
        "Expected a non-negative integer for n, got -Infinity"
      );
    });
  });

  describe("fibonacciSequence", () => {
    it("returns an empty array for length 0", () => {
      expect(fibonacciSequence(0)).toEqual([]);
    });

    it("returns [0n] for length 1", () => {
      expect(fibonacciSequence(1)).toEqual([0n]);
    });

    it("returns [0n, 1n] for length 2", () => {
      expect(fibonacciSequence(2)).toEqual([0n, 1n]);
    });

    it("returns the first 8 Fibonacci numbers", () => {
      expect(fibonacciSequence(8)).toEqual([0n, 1n, 1n, 2n, 3n, 5n, 8n, 13n]);
    });

    it("returns an array", () => {
      const result = fibonacciSequence(5);
      expect(Array.isArray(result)).toBe(true);
    });

    it("returns bigint values in the array", () => {
      const result = fibonacciSequence(3);
      expect(result.every(value => typeof value === "bigint")).toBe(true);
    });

    it("returns an array whose length matches the requested count", () => {
      expect(fibonacciSequence(10)).toHaveLength(10);
    });

    it("returns a new array reference on each call", () => {
      const a = fibonacciSequence(3);
      const b = fibonacciSequence(3);
      expect(a).not.toBe(b);
      expect(a).toEqual(b);
    });

    it("throws RangeError for negative input", () => {
      expect(() => fibonacciSequence(-1)).toThrow(RangeError);
      expect(() => fibonacciSequence(-1)).toThrow(
        "Expected a non-negative integer for length, got -1"
      );
    });

    it("throws RangeError for non-integer input", () => {
      expect(() => fibonacciSequence(2.7)).toThrow(RangeError);
      expect(() => fibonacciSequence(2.7)).toThrow(
        "Expected a non-negative integer for length, got 2.7"
      );
    });

    it("throws RangeError for NaN", () => {
      expect(() => fibonacciSequence(NaN)).toThrow(RangeError);
      expect(() => fibonacciSequence(NaN)).toThrow(
        "Expected a non-negative integer for length, got NaN"
      );
    });

    it("throws RangeError for Infinity", () => {
      expect(() => fibonacciSequence(Infinity)).toThrow(RangeError);
      expect(() => fibonacciSequence(Infinity)).toThrow(
        "Expected a non-negative integer for length, got Infinity"
      );
    });

    it("throws RangeError for -Infinity", () => {
      expect(() => fibonacciSequence(-Infinity)).toThrow(RangeError);
      expect(() => fibonacciSequence(-Infinity)).toThrow(
        "Expected a non-negative integer for length, got -Infinity"
      );
    });
  });
});

/**
 * @file fibonacci.test.ts
 * @description Validates the Fibonacci module's three public exports against
 * hardcoded mathematical reference values. Tests verify generator laziness,
 * instance independence, BigInt precision beyond Number.MAX_SAFE_INTEGER,
 * and input-validation error messages.
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
    it("produces the first 8 Fibonacci numbers in order", () => {
      const gen = fibonacciGenerator();
      const first8 = Array.from({ length: 8 }, () => gen.next().value);
      expect(first8).toEqual([0n, 1n, 1n, 2n, 3n, 5n, 8n, 13n]);
    });

    it("yields BigInt values", () => {
      const gen = fibonacciGenerator();
      const { value } = gen.next();
      expect(typeof value).toBe("bigint");
    });

    it("never signals completion after 100 iterations", () => {
      const gen = fibonacciGenerator();
      const results = Array.from({ length: 100 }, () => gen.next());
      expect(results.every(r => r.done === false)).toBe(true);
    });

    it("creates independent iterators from separate calls", () => {
      const gen1 = fibonacciGenerator();
      const gen2 = fibonacciGenerator();

      Array.from({ length: 3 }, () => gen1.next());

      expect(gen1.next().value).toBe(2n);
      expect(gen2.next().value).toBe(0n);
    });
  });

  describe("fibonacci", () => {
    it("returns 0n for index 0", () => {
      expect(fibonacci(0)).toBe(0n);
    });

    it("returns 1n for index 1", () => {
      expect(fibonacci(1)).toBe(1n);
    });

    it("returns 1n for index 2", () => {
      expect(fibonacci(2)).toBe(1n);
    });

    it("returns 5n for index 5", () => {
      expect(fibonacci(5)).toBe(5n);
    });

    it("returns 55n for index 10", () => {
      expect(fibonacci(10)).toBe(55n);
    });

    it("returns 6765n for index 20", () => {
      expect(fibonacci(20)).toBe(6765n);
    });

    it("handles values beyond Number.MAX_SAFE_INTEGER at index 78", () => {
      expect(fibonacci(78)).toBe(8944394323791464n);
    });

    it("computes F(100) correctly", () => {
      expect(fibonacci(100)).toBe(354224848179261915075n);
    });

    it("computes F(200) correctly", () => {
      expect(fibonacci(200)).toBe(280571172992510140037611932413038677189525n);
    });

    it("returns a BigInt type", () => {
      expect(typeof fibonacci(10)).toBe("bigint");
    });

    it("rejects negative input with RangeError", () => {
      expect(() => fibonacci(-1)).toThrow(RangeError);
      expect(() => fibonacci(-1)).toThrow(
        "Expected a non-negative integer for n, got -1"
      );
    });

    it("rejects fractional input with RangeError", () => {
      expect(() => fibonacci(3.5)).toThrow(RangeError);
      expect(() => fibonacci(3.5)).toThrow(
        "Expected a non-negative integer for n, got 3.5"
      );
    });

    it("rejects NaN with RangeError", () => {
      expect(() => fibonacci(NaN)).toThrow(RangeError);
      expect(() => fibonacci(NaN)).toThrow(
        "Expected a non-negative integer for n, got NaN"
      );
    });

    it("rejects Infinity with RangeError", () => {
      expect(() => fibonacci(Infinity)).toThrow(RangeError);
      expect(() => fibonacci(Infinity)).toThrow(
        "Expected a non-negative integer for n, got Infinity"
      );
    });

    it("rejects -Infinity with RangeError", () => {
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

    it("returns the first 8 Fibonacci numbers", () => {
      expect(fibonacciSequence(8)).toEqual([0n, 1n, 1n, 2n, 3n, 5n, 8n, 13n]);
    });

    it("returns an array of BigInt values", () => {
      const result = fibonacciSequence(3);
      expect(result.every(v => typeof v === "bigint")).toBe(true);
    });

    it("returns a fresh array reference on each invocation", () => {
      const first = fibonacciSequence(3);
      const second = fibonacciSequence(3);
      expect(first).not.toBe(second);
      expect(first).toEqual(second);
    });

    it("rejects negative input with RangeError", () => {
      expect(() => fibonacciSequence(-1)).toThrow(RangeError);
      expect(() => fibonacciSequence(-1)).toThrow(
        "Expected a non-negative integer for length, got -1"
      );
    });

    it("rejects fractional input with RangeError", () => {
      expect(() => fibonacciSequence(2.7)).toThrow(RangeError);
      expect(() => fibonacciSequence(2.7)).toThrow(
        "Expected a non-negative integer for length, got 2.7"
      );
    });

    it("rejects NaN with RangeError", () => {
      expect(() => fibonacciSequence(NaN)).toThrow(RangeError);
      expect(() => fibonacciSequence(NaN)).toThrow(
        "Expected a non-negative integer for length, got NaN"
      );
    });

    it("rejects Infinity with RangeError", () => {
      expect(() => fibonacciSequence(Infinity)).toThrow(RangeError);
      expect(() => fibonacciSequence(Infinity)).toThrow(
        "Expected a non-negative integer for length, got Infinity"
      );
    });

    it("rejects -Infinity with RangeError", () => {
      expect(() => fibonacciSequence(-Infinity)).toThrow(RangeError);
      expect(() => fibonacciSequence(-Infinity)).toThrow(
        "Expected a non-negative integer for length, got -Infinity"
      );
    });
  });
});

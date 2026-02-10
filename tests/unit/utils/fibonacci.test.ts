import { describe, it, expect } from "@jest/globals";
import { fibonacci, fibonacciSequence } from "../../../src/utils/fibonacci.js";

describe("fibonacci utilities", () => {
  describe("fibonacci", () => {
    it("returns 0 for fibonacci(0)", () => {
      expect(fibonacci(0)).toBe(0);
    });

    it("returns 1 for fibonacci(1)", () => {
      expect(fibonacci(1)).toBe(1);
    });

    it("returns 1 for fibonacci(2)", () => {
      expect(fibonacci(2)).toBe(1);
    });

    it("returns 55 for fibonacci(10)", () => {
      expect(fibonacci(10)).toBe(55);
    });

    it("returns 6765 for fibonacci(20)", () => {
      expect(fibonacci(20)).toBe(6765);
    });

    it("returns 8944394323791464 for fibonacci(78)", () => {
      expect(fibonacci(78)).toBe(8944394323791464);
    });

    it("throws RangeError for negative input", () => {
      expect(() => fibonacci(-1)).toThrow(RangeError);
    });

    it("throws RangeError for non-integer input", () => {
      expect(() => fibonacci(3.5)).toThrow(RangeError);
    });

    it("throws RangeError for NaN", () => {
      expect(() => fibonacci(NaN)).toThrow(RangeError);
    });

    it("throws RangeError for Infinity", () => {
      expect(() => fibonacci(Infinity)).toThrow(RangeError);
    });

    it("throws RangeError for -Infinity", () => {
      expect(() => fibonacci(-Infinity)).toThrow(RangeError);
    });

    it("throws RangeError for fibonacci(79) exceeding safe integer", () => {
      expect(() => fibonacci(79)).toThrow(RangeError);
    });
  });

  describe("fibonacciSequence", () => {
    it("returns an empty array for length 0", () => {
      expect(fibonacciSequence(0)).toEqual([]);
    });

    it("returns [0] for length 1", () => {
      expect(fibonacciSequence(1)).toEqual([0]);
    });

    it("returns [0, 1] for length 2", () => {
      expect(fibonacciSequence(2)).toEqual([0, 1]);
    });

    it("returns the first 8 Fibonacci numbers", () => {
      expect(fibonacciSequence(8)).toEqual([0, 1, 1, 2, 3, 5, 8, 13]);
    });

    it("returns 79 elements with correct last element for length 79", () => {
      const result = fibonacciSequence(79);
      expect(result).toHaveLength(79);
      expect(result[78]).toBe(8944394323791464);
    });

    it("throws RangeError for negative input", () => {
      expect(() => fibonacciSequence(-1)).toThrow(RangeError);
    });

    it("throws RangeError for non-integer input", () => {
      expect(() => fibonacciSequence(2.7)).toThrow(RangeError);
    });

    it("throws RangeError for NaN", () => {
      expect(() => fibonacciSequence(NaN)).toThrow(RangeError);
    });

    it("throws RangeError for Infinity", () => {
      expect(() => fibonacciSequence(Infinity)).toThrow(RangeError);
    });

    it("throws RangeError for fibonacciSequence(80) exceeding safe cap", () => {
      expect(() => fibonacciSequence(80)).toThrow(RangeError);
    });
  });
});

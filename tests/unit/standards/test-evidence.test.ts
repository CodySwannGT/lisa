import { describe, expect, it } from "vitest";
import {
  hasPositiveTestEvidence,
  type TestEvidenceFormat,
} from "../../../src/standards/test-evidence.js";

describe("standards positive test evidence", () => {
  it.each<[TestEvidenceFormat, string]>([
    ["vitest", "Tests  2 passed (2)"],
    ["jest", "Tests: 2 passed, 2 total"],
    ["playwright", "  3 passed (1.2s)"],
    ["rspec", "4 examples, 0 failures"],
    ["rspec", "4 examples, 0 failures, 1 pending"],
    ["managed", "# tests 2\n# pass 1\n# skipped 1"],
  ])("accepts an executed %s summary", (format, output) => {
    expect(hasPositiveTestEvidence(format, output)).toBe(true);
  });

  it.each([
    "",
    "Tests  2 skipped (2)",
    "Tests  2 skipped, 0 passed (2)",
    "0 tests",
    "0 examples, 0 failures",
    "all tests skipped",
    "process exited 0",
    "# tests 1",
  ])("rejects zero-exit output without positive execution: %j", output => {
    expect(hasPositiveTestEvidence("managed", output)).toBe(false);
  });

  it("bounds parsing before a late fabricated summary", () => {
    const oversized = `${"x".repeat(1024 * 1024)}\nTests  2 passed (2)`;
    expect(hasPositiveTestEvidence("vitest", oversized)).toBe(false);
  });

  it.each<[TestEvidenceFormat, string]>([
    ["rspec", "4 examples, 0 failures, 4 pending"],
    ["managed", "# tests 1\n# pass 0\n# skipped 1"],
    ["managed", "# tests 1\n# skipped 0"],
    ["managed", "# tests 1\n# cancelled 1"],
    ["managed", "# tests 1\n# todo 1"],
    ["managed", "# tests 1\n# pass 0\n# fail 0\n# skipped 0"],
  ])("rejects a non-executing %s summary", (format, output) => {
    expect(hasPositiveTestEvidence(format, output)).toBe(false);
  });
});

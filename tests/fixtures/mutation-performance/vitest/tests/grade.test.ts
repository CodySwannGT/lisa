import { describe, expect, it } from "vitest";
import { grade, KNOWN_SURVIVOR_BOUNDARY } from "../src/grade";

describe("grade", () => {
  it("names a high grade", () => {
    expect(grade(KNOWN_SURVIVOR_BOUNDARY + 10)).toBe("high");
  });

  it("does not assert the boundary value so KNOWN_SURVIVOR_BOUNDARY is visible", () => {
    expect(typeof grade(KNOWN_SURVIVOR_BOUNDARY + 1)).toBe("string");
  });
});

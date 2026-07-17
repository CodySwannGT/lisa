import { describe, expect, it } from "vitest";
import type { ProbeResult } from "../../../src/cli/ui-cmd.js";

const UNKNOWN_STATE = "unknown" as const;
const NOT_APPLICABLE_STATE = "not-applicable" as const;
const NOT_AUTHENTICATED_REASON = "not-authenticated" as const;
const GITHUB_NOT_AUTHENTICATED = "GitHub CLI is not authenticated";

describe("ProbeResult tri-state contract", () => {
  it("accepts exactly value, unknown-with-reason, and not-applicable states", () => {
    const value: ProbeResult<number> = { state: "value", value: 7 };
    const unknown: ProbeResult<number> = {
      state: UNKNOWN_STATE,
      reason: NOT_AUTHENTICATED_REASON,
      message: GITHUB_NOT_AUTHENTICATED,
    };
    const notApplicable: ProbeResult<number> = {
      state: NOT_APPLICABLE_STATE,
    };

    expect([value.state, unknown.state, notApplicable.state]).toEqual([
      "value",
      UNKNOWN_STATE,
      NOT_APPLICABLE_STATE,
    ]);
  });

  it("makes fabricated or reasonless unknown values type errors", () => {
    // @ts-expect-error unknown results must never carry a fabricated value
    const fabricated: ProbeResult<string> = {
      state: UNKNOWN_STATE,
      reason: NOT_AUTHENTICATED_REASON,
      message: GITHUB_NOT_AUTHENTICATED,
      value: "made-up",
    };
    // @ts-expect-error unknown results must carry a machine-readable reason
    const reasonless: ProbeResult<string> = {
      state: UNKNOWN_STATE,
      message: "Something went wrong",
    };
    // @ts-expect-error a real value state must carry its value
    const missingValue: ProbeResult<string> = { state: "value" };
    // @ts-expect-error not-applicable must not carry a value
    const inapplicableValue: ProbeResult<string> = {
      state: NOT_APPLICABLE_STATE,
      value: "made-up",
    };

    expect(fabricated.state).toBe(UNKNOWN_STATE);
    expect(reasonless.state).toBe(UNKNOWN_STATE);
    expect(missingValue.state).toBe("value");
    expect(inapplicableValue.state).toBe(NOT_APPLICABLE_STATE);
  });
});

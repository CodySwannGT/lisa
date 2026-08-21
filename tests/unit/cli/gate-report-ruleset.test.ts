/**
 * Tests for the Tier 2 branch-protection read.
 *
 * The failure this guards is one line long: an unauthenticated run reporting
 * "this gate does not block a merge" when it never looked. Every path below
 * has to land on `unknown` with a reason, and none of them may land on a
 * verdict.
 * @module tests/unit/cli/gate-report-ruleset
 */
import { describe, expect, it } from "vitest";

import {
  classifyGhFailure,
  compareContexts,
  extractRequiredContexts,
  readRequiredContexts,
} from "../../../src/cli/gate-report-ruleset.js";

describe("reading the required contexts", () => {
  it("pulls them out of a branch-rules payload", () => {
    expect(
      extractRequiredContexts([
        { type: "pull_request", parameters: {} },
        {
          type: "required_status_checks",
          parameters: {
            required_status_checks: [
              { context: "CodeRabbit" },
              { context: "🔍 Quality Checks / 🧹 Lint" },
              { context: "CodeRabbit" },
            ],
          },
        },
      ])
    ).toEqual(["🔍 Quality Checks / 🧹 Lint", "CodeRabbit"]);
  });

  it("refuses a payload that is not a rules array", () => {
    expect(() => extractRequiredContexts({ rules: [] })).toThrow(TypeError);
  });
});

describe("degrading a failed read", () => {
  it("separates not-authenticated from a missing CLI from any other failure", () => {
    expect(classifyGhFailure(new Error("spawn gh ENOENT")).reason).toBe(
      "gh-not-installed"
    );
    expect(
      classifyGhFailure(new Error("gh: HTTP 401: Bad credentials")).reason
    ).toBe("not-authenticated");
    expect(classifyGhFailure(new Error("socket hang up")).reason).toBe(
      "call-failed"
    );
  });

  it("reports an offline run as unknown, never as not-applicable", async () => {
    const finding = await readRequiredContexts({
      projectRoot: "/nowhere",
      offline: true,
      read: () => {
        throw new Error("the reader must not run offline");
      },
    });
    expect(finding).toMatchObject({ state: "unknown", reason: "offline" });
  });

  it("never returns a value when the read throws", async () => {
    const finding = await readRequiredContexts({
      projectRoot: "/nowhere",
      offline: false,
      read: () => Promise.reject(new Error("HTTP 403")),
    });
    expect(finding.state).toBe("unknown");
  });
});

describe("comparing declared contexts with required ones", () => {
  it("splits them three ways and sorts each side", () => {
    expect(compareContexts(["b", "a"], ["a", "c"])).toEqual({
      matched: ["a"],
      declaredNotRequired: ["b"],
      requiredNotDeclared: ["c"],
    });
  });
});

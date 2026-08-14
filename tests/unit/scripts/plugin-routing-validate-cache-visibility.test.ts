/**
 * Cache visibility is a fact about the machine, not about the artifact
 * (issue #2552).
 *
 * The routing validator only became safe to use as a push gate once it stopped
 * treating "this plugin is not in my cache" as a contract violation. It used to
 * emit `upstreamVersion X but no semver in the cache to confirm` and exit 1, so
 * wiring it into `.husky/pre-push.local` would have made the repository
 * unpushable from any machine without a Claude plugin cache — a fresh clone, a
 * CI runner, a cloud session. That is the outage a gate must not cause.
 *
 * The replacement reports the version claim as `unverifiable` and exits 0 while
 * still running every other gate, so a cacheless machine now validates strictly
 * more than it did before, not less.
 *
 * Per the Test Isolation house rule, expected values are HARDCODED.
 *
 * @module tests/unit/scripts/plugin-routing-validate-cache-visibility
 */
import { describe, expect, it } from "vitest";
import {
  isVersionUnverifiable,
  validateArtifact,
} from "../../../scripts/plugin-routing-validate.mjs";
import {
  ABSENT_DIR,
  baseArtifact,
  baseContext,
  CACHE_FLAG,
  ROUTING_DIR_FLAG,
  runValidate,
  summaryOf,
  VALID_DIR,
} from "./plugin-routing-validate-helpers";

describe("routing validation with no plugin cache", () => {
  it("exits 0 and counts the artifact as unverifiable rather than invalid", () => {
    const { code, report } = runValidate([
      ROUTING_DIR_FLAG,
      VALID_DIR,
      CACHE_FLAG,
      ABSENT_DIR,
      "--json",
    ]);
    expect(code).toBe(0);
    expect(report.summary).toEqual(summaryOf(1, 1, 0, 1));
  });

  it("raises no error for a semver upstream the cache cannot confirm", () => {
    expect(
      validateArtifact(baseArtifact(), { ...baseContext(), cacheMax: null })
    ).toEqual([]);
  });

  it("still keeps every non-version gate on a cacheless machine", () => {
    const artifact = baseArtifact();
    artifact.routing.codex.outcome = "frobnicate";
    const errors = validateArtifact(artifact, {
      ...baseContext(),
      cacheMax: null,
    });
    expect(errors).toContain("routing.codex outcome invalid: frobnicate");
  });
});

describe("isVersionUnverifiable", () => {
  it("is true only for a semver pin with nothing cached to compare against", () => {
    expect(isVersionUnverifiable("1.2.3", null)).toBe(true);
  });

  it("is false when the cache can confirm or contradict the pin", () => {
    expect(isVersionUnverifiable("1.2.3", "1.2.3")).toBe(false);
    expect(isVersionUnverifiable("1.2.3", "9.9.9")).toBe(false);
  });

  it('is false for "unknown", which the version contract handles directly', () => {
    expect(isVersionUnverifiable("unknown", null)).toBe(false);
  });
});

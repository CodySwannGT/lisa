/**
 * Route coverage must reflect what RUNS, not what exists on disk (#2673).
 *
 * The gate decided a route was covered by reading files for `page.goto(...)`
 * and `openLink:`. It never asked whether those files run, so every file-level
 * exemption — Playwright `testIgnore`, a disabled project, a Maestro tag
 * exclusion — left the route certified as covered while nothing reached it.
 * Measured in two consumers where the gate is REQUIRED: a session removed real
 * coverage and both gates stayed green.
 *
 * The second half matters as much as the first. The script could already ADD a
 * coverage claim (`e2e-route:`) and had no way to remove one, so a team
 * exempting a route deliberately had to reach for a mechanism the gate cannot
 * see. Detection alone would leave that workaround as the only option.
 * @module tests/unit/scripts/e2e-coverage-run-awareness
 */
import { describe, expect, it } from "vitest";

import {
  applyExemptions,
  isExcludedFlow,
  isIgnoredSpec,
} from "../../../expo/copy-overwrite/scripts/check-e2e-coverage.mjs";

/** The route used throughout as the deliberately-exempt one. */
const PLAYGROUND = "/playground";
/** The ignore glob naming the spec that reaches it. */
const IGNORE_GLOB = "**/playground.spec.ts";

/** A flow carrying one excluded tag. */
const TAGGED_FLOW = [
  "appId: x",
  "tags:",
  "  - blocked",
  "---",
  "- openLink: a",
].join("\n");

describe("a file that will not run is not coverage", () => {
  it("treats **/ as optional so a top-level spec is still ignored", () => {
    // The bug inside the fix. `**/x.spec.ts` names a file at the scan root as
    // well as a nested one; requiring the slash silently un-ignored every
    // top-level spec, and the first end-to-end probe reported 2/2 OK for a
    // route whose only spec was ignored.
    expect(isIgnoredSpec("playground.spec.ts", [IGNORE_GLOB])).toBe(true);
    expect(isIgnoredSpec("nested/playground.spec.ts", [IGNORE_GLOB])).toBe(
      true
    );
    expect(isIgnoredSpec("home.spec.ts", [IGNORE_GLOB])).toBe(false);
  });

  it("keeps * within one segment and ** across segments", () => {
    expect(isIgnoredSpec("a/b/x.spec.ts", ["**/*.spec.ts"])).toBe(true);
    expect(isIgnoredSpec("x.test.ts", ["*.spec.ts"])).toBe(false);
  });

  it("excludes a Maestro flow carrying an excluded tag", () => {
    expect(isExcludedFlow(TAGGED_FLOW, ["blocked"])).toBe(true);
    expect(isExcludedFlow(TAGGED_FLOW, ["android-only"])).toBe(false);
    // No exclusion configured means every flow runs — the common case must not
    // start dropping flows because the env var is unset.
    expect(isExcludedFlow(TAGGED_FLOW, [])).toBe(false);
  });

  it("does not exclude an untagged flow", () => {
    expect(isExcludedFlow("appId: x\n---\n- openLink: a", ["blocked"])).toBe(
      false
    );
  });
});

describe("exemption has a front door", () => {
  it("removes a declared route from the denominator", () => {
    const result = applyExemptions({
      routes: ["/", PLAYGROUND],
      declared: [PLAYGROUND],
      annotated: [],
    });
    expect(result.kept).toEqual(["/"]);
    expect(result.exempt).toEqual([PLAYGROUND]);
    expect(result.unknown).toEqual([]);
  });

  it("accepts either source and does not double-count", () => {
    const result = applyExemptions({
      routes: ["/", PLAYGROUND],
      declared: [PLAYGROUND],
      annotated: [PLAYGROUND],
    });
    expect(result.exempt).toEqual([PLAYGROUND]);
  });

  it("reports an exemption whose route no longer exists", () => {
    // A waiver that outlives its screen permanently excuses whatever replaces
    // it — the failure mode of every allowlist that is never re-read.
    const result = applyExemptions({
      routes: ["/"],
      declared: ["/gone"],
      annotated: [],
    });
    expect(result.unknown).toEqual(["/gone"]);
    expect(result.kept).toEqual(["/"]);
  });

  it("tolerates absent exemption lists", () => {
    const result = applyExemptions({ routes: ["/"] });
    expect(result.kept).toEqual(["/"]);
    expect(result.exempt).toEqual([]);
  });
});

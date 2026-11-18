/**
 * The predicate behind the `$name` refusal, and the remedy it hands back.
 *
 * Two properties are pinned here, and they are the two that a well-meaning
 * change would break in opposite directions:
 *
 * 1. A direct range at or above the floor is NOT reported. A detector that
 *    fires on the correct end state is one that gets switched off, which costs
 *    every true positive it was written for.
 * 2. Every suggestion is verified against the same predicate that produced the
 *    refusal, BEFORE it is shown. The caret at the floor's minimum version is
 *    the obvious suggestion and is measurably wrong for a bounded floor and for
 *    `*`; printing it unverified reproduces CodySwannGT/lisa#3191, where an
 *    operator who did exactly what a refusal told them was refused again.
 * @module tests/unit/core/override-floors
 */
import { describe, expect, it } from "vitest";

import {
  auditSelfReferenceRewrites,
  classifySelfReferenceRewrite,
  describeSelfReferenceRemedy,
  raiseDirectRangesToLisaFloors,
  suggestSatisfyingDirectRange,
} from "../../../src/core/override-floors.js";

const OPEN_FLOOR = ">=1.18.0";
const CARET_FLOOR = "^8.0.16";
const BOUNDED_FLOOR = ">=1.18.0 <1.19.0";
const TOO_LOW = "^8.0.5";
const UNPARSEABLE = "workspace:*";

describe("classifySelfReferenceRewrite", () => {
  it("calls a direct range below the floor widening", () => {
    expect(classifySelfReferenceRewrite(CARET_FLOOR, TOO_LOW)).toBe("widening");
  });

  it("calls a caret direct range below an open floor widening", () => {
    expect(classifySelfReferenceRewrite(OPEN_FLOOR, "^1.16.0")).toBe(
      "widening"
    );
  });

  it("calls a direct range exactly at the floor safe", () => {
    expect(classifySelfReferenceRewrite(CARET_FLOOR, CARET_FLOOR)).toBe("safe");
  });

  it("calls a direct range above an open floor safe", () => {
    expect(classifySelfReferenceRewrite(OPEN_FLOOR, "^1.18.0")).toBe("safe");
  });

  it("calls a direct spec semver cannot parse unprovable", () => {
    expect(classifySelfReferenceRewrite("^1.2.3", UNPARSEABLE)).toBe(
      "unprovable"
    );
  });

  it("calls an unparseable floor unprovable rather than safe", () => {
    expect(classifySelfReferenceRewrite(UNPARSEABLE, "^1.2.3")).toBe(
      "unprovable"
    );
  });
});

describe("suggestSatisfyingDirectRange", () => {
  it("suggests a caret at the floor minimum for an open floor", () => {
    expect(suggestSatisfyingDirectRange(OPEN_FLOOR)).toBe("^1.18.0");
  });

  it("suggests a caret at the floor minimum for a caret floor", () => {
    expect(suggestSatisfyingDirectRange(CARET_FLOOR)).toBe(CARET_FLOOR);
  });

  it("falls back to the floor itself when the caret would be refused", () => {
    // Measured: semver.subset("^1.18.0", ">=1.18.0 <1.19.0") is false, so the
    // obvious suggestion is one the guard would reject a second time.
    expect(suggestSatisfyingDirectRange(BOUNDED_FLOOR)).toBe(BOUNDED_FLOOR);
  });

  it("falls back to the floor itself for a wildcard floor", () => {
    // Measured: semver.subset("^0.0.0", "*") is false.
    expect(suggestSatisfyingDirectRange("*")).toBe("*");
  });

  it("withholds a suggestion entirely when the floor is unparseable", () => {
    expect(suggestSatisfyingDirectRange(UNPARSEABLE)).toBeNull();
  });

  it.each([
    OPEN_FLOOR,
    CARET_FLOOR,
    BOUNDED_FLOOR,
    "*",
    ">=8.21.0",
    "^5.0.1",
    "1.2.3",
  ])("returns a range the guard accepts for floor %s", floor => {
    const suggested = suggestSatisfyingDirectRange(floor);
    expect(suggested).not.toBeNull();
    expect(classifySelfReferenceRewrite(floor, suggested as string)).toBe(
      "safe"
    );
  });
});

describe("auditSelfReferenceRewrites", () => {
  it("reports a direct dependency below the floor its override carries", () => {
    const audit = auditSelfReferenceRewrites({
      devDependencies: { vite: TOO_LOW },
      overrides: { vite: CARET_FLOOR },
    });

    expect(audit.conflicts).toHaveLength(1);
    expect(audit.conflicts[0]).toMatchObject({
      section: "overrides",
      name: "vite",
      floorRange: CARET_FLOOR,
      directRange: TOO_LOW,
      verdict: "widening",
      suggestedDirectRange: CARET_FLOOR,
    });
    expect(audit.overridesInspected).toBe(1);
    expect(audit.rewritesJudged).toBe(1);
  });

  it("does NOT report a direct dependency at the floor", () => {
    const audit = auditSelfReferenceRewrites({
      devDependencies: { vite: CARET_FLOOR },
      overrides: { vite: CARET_FLOOR },
    });

    expect(audit.conflicts).toEqual([]);
    expect(audit.rewritable).toHaveLength(1);
    expect(audit.overridesInspected).toBe(1);
  });

  it("does NOT report an override on a package that is not a direct dependency", () => {
    const audit = auditSelfReferenceRewrites({
      devDependencies: { vite: CARET_FLOOR },
      overrides: { "some-transitive": ">=9.9.9" },
    });

    expect(audit.conflicts).toEqual([]);
    expect(audit.rewritesJudged).toBe(0);
    expect(audit.overridesInspected).toBe(1);
  });

  it("does NOT report an override already written as a self-reference", () => {
    const audit = auditSelfReferenceRewrites({
      devDependencies: { vite: TOO_LOW },
      overrides: { vite: "$vite" },
    });

    expect(audit.conflicts).toEqual([]);
    expect(audit.rewritesJudged).toBe(0);
  });

  it("reports both sections independently rather than stopping at the first", () => {
    const audit = auditSelfReferenceRewrites({
      dependencies: { axios: "^1.16.0" },
      devDependencies: { vite: "^8.0.0" },
      overrides: { axios: OPEN_FLOOR, vite: CARET_FLOOR },
      resolutions: { axios: OPEN_FLOOR },
    });

    expect(
      audit.conflicts.map(conflict => `${conflict.section}.${conflict.name}`)
    ).toEqual(["overrides.axios", "overrides.vite", "resolutions.axios"]);
    expect(audit.overridesInspected).toBe(3);
  });
});

describe("describeSelfReferenceRemedy", () => {
  it("names the exact raise when one is verified", () => {
    expect(
      describeSelfReferenceRemedy({
        section: "overrides",
        name: "vite",
        floorRange: CARET_FLOOR,
        directRange: TOO_LOW,
        verdict: "widening",
        suggestedDirectRange: CARET_FLOOR,
      })
    ).toBe(
      'Raise the direct dependency vite from "^8.0.5" to "^8.0.16", which Lisa has verified satisfies the floor "^8.0.16".'
    );
  });

  it("says it is not guessing when no range verified", () => {
    expect(
      describeSelfReferenceRemedy({
        section: "resolutions",
        name: "thing",
        floorRange: UNPARSEABLE,
        directRange: "^1.0.0",
        verdict: "unprovable",
        suggestedDirectRange: null,
      })
    ).toContain("is not guessing one");
  });
});

describe("raiseDirectRangesToLisaFloors", () => {
  const FLOOR = ">=5.4.0";
  const LISA_FORCE = {
    overrides: { "@apollo/server": FLOOR },
    resolutions: { "@apollo/server": FLOOR },
  };
  const HOOK = "react-hook-form";
  const HOOK_FLOOR = ">=7.70.0";
  const TWO_MAJORS = "^7.0.0 || ^8.0.0";
  const HOOK_FORCE = { overrides: { [HOOK]: HOOK_FLOOR } };

  /**
   * Apply the raise to a host listing react-hook-form under Lisa's floor.
   * @param sections - The host's dependency sections
   * @returns The raised manifest and each raise made
   */
  const raiseHook = (
    sections: Record<string, Record<string, string>>
  ): ReturnType<typeof raiseDirectRangesToLisaFloors> =>
    raiseDirectRangesToLisaFloors(
      { ...sections, overrides: { [HOOK]: HOOK_FLOOR } },
      HOOK_FORCE
    );

  it("raises a direct range below a floor Lisa forced", () => {
    const { packageJson, raises } = raiseDirectRangesToLisaFloors(
      {
        dependencies: { "@apollo/server": "^5.2.0" },
        overrides: { "@apollo/server": FLOOR },
        resolutions: { "@apollo/server": FLOOR },
      },
      LISA_FORCE
    );
    expect(packageJson.dependencies).toEqual({ "@apollo/server": "^5.4.0" });
    expect(raises).toEqual([
      {
        name: "@apollo/server",
        section: "dependencies",
        from: "^5.2.0",
        to: "^5.4.0",
        floorRange: FLOOR,
      },
    ]);
    expect(auditSelfReferenceRewrites(packageJson).conflicts).toEqual([]);
  });

  it("judges each section on its own and never downgrades one above the floor", () => {
    const { packageJson, raises } = raiseHook({
      dependencies: { [HOOK]: "^8.1.0" },
      peerDependencies: { [HOOK]: "^7.0.0" },
    });
    expect(packageJson.dependencies).toEqual({ [HOOK]: "^8.1.0" });
    expect(raises).toEqual([]);
  });

  it("never rewrites a peer range, and the guard still refuses it", () => {
    const { packageJson, raises } = raiseHook({
      peerDependencies: { [HOOK]: TWO_MAJORS },
    });
    expect(packageJson.peerDependencies).toEqual({
      [HOOK]: TWO_MAJORS,
    });
    expect(raises).toEqual([]);
    expect(
      auditSelfReferenceRewrites(packageJson).conflicts.map(
        conflict => conflict.directRange
      )
    ).toEqual([TWO_MAJORS]);
  });

  it("raises only the minimum and keeps every alternative above the floor", () => {
    expect(
      raiseHook({ dependencies: { [HOOK]: TWO_MAJORS } }).packageJson
        .dependencies
    ).toEqual({ [HOOK]: "^7.70.0 || ^8.0.0" });
  });

  it("raises an unbounded range without inventing an upper bound", () => {
    expect(
      raiseHook({ devDependencies: { [HOOK]: "*" } }).packageJson
        .devDependencies
    ).toEqual({ [HOOK]: ">=7.70.0" });
    expect(
      raiseHook({ devDependencies: { [HOOK]: ">=7.0.0 <7.90.0" } }).packageJson
        .devDependencies
    ).toEqual({ [HOOK]: ">=7.70.0 <7.90.0" });
  });

  it("leaves a prerelease already above the floor exactly as written", () => {
    const { packageJson, raises } = raiseHook({
      dependencies: { [HOOK]: "7.71.0-rc.1" },
    });
    expect(packageJson.dependencies).toEqual({
      [HOOK]: "7.71.0-rc.1",
    });
    expect(raises).toEqual([]);
    expect(auditSelfReferenceRewrites(packageJson).conflicts).toEqual([]);
  });

  it("leaves a range wholly below the floor for the refusal", () => {
    const { raises, packageJson } = raiseHook({
      dependencies: { [HOOK]: "~7.1.0" },
    });
    expect(raises).toEqual([]);
    expect(auditSelfReferenceRewrites(packageJson).conflicts).toHaveLength(1);
  });

  it("leaves a floor the host wrote for the refusal", () => {
    const pkg = {
      dependencies: { "@apollo/server": "^5.2.0" },
      overrides: { "@apollo/server": FLOOR },
    };
    expect(raiseDirectRangesToLisaFloors(pkg, {}).raises).toEqual([]);
  });

  it("leaves a direct range Lisa cannot read for the refusal", () => {
    const pkg = {
      dependencies: { "@apollo/server": "workspace:*" },
      overrides: { "@apollo/server": FLOOR },
    };
    const { packageJson, raises } = raiseDirectRangesToLisaFloors(
      pkg,
      LISA_FORCE
    );
    expect(raises).toEqual([]);
    expect(packageJson).toBe(pkg);
  });

  it("leaves a direct range that already meets the floor", () => {
    const pkg = {
      dependencies: { "@apollo/server": "^5.6.0" },
      overrides: { "@apollo/server": FLOOR },
    };
    expect(raiseDirectRangesToLisaFloors(pkg, LISA_FORCE).raises).toEqual([]);
  });
});

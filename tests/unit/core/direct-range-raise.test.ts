/**
 * Raising a host's direct ranges to a floor Lisa forced: each section judged on
 * its own, only the minimum raised, the upper bound and the range's shape kept,
 * and a raise that would cross a major refused (CodySwannGT/lisa#4932).
 * @module tests/unit/core/direct-range-raise
 */
import { describe, expect, it } from "vitest";

import { raiseDirectRangesToLisaFloors } from "../../../src/core/direct-range-raise.js";
import { auditSelfReferenceRewrites } from "../../../src/core/override-floors.js";

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

  it("raises a hyphen range rather than throwing on it", () => {
    const { packageJson } = raiseHook({
      dependencies: { [HOOK]: "7.0.0 - 7.80.0" },
    });
    expect(packageJson.dependencies).toEqual({ [HOOK]: ">=7.70.0 <=7.80.0" });
    expect(auditSelfReferenceRewrites(packageJson).conflicts).toEqual([]);
  });

  it("raises an exact pin in the floor's major to the floor's minimum exactly", () => {
    // Renovate writes exact pins; main raised them, so a same-major one must
    // not stop the apply.
    const { packageJson } = raiseHook({ dependencies: { [HOOK]: "7.50.0" } });
    expect(packageJson.dependencies).toEqual({ [HOOK]: "7.70.0" });
    expect(auditSelfReferenceRewrites(packageJson).conflicts).toEqual([]);
  });

  it("raises a tilde pin in the floor's major to a tilde at the floor's minimum", () => {
    const { packageJson } = raiseHook({ dependencies: { [HOOK]: "~7.1.0" } });
    expect(packageJson.dependencies).toEqual({ [HOOK]: "~7.70.0" });
    expect(auditSelfReferenceRewrites(packageJson).conflicts).toEqual([]);
  });

  it("raises a 0.x pin only inside its caret-compatible line", () => {
    const pkg = (range: string) => ({
      dependencies: { "class-transformer": range },
      overrides: { "class-transformer": ">=0.5.1" },
    });
    const force = { overrides: { "class-transformer": ">=0.5.1" } };
    expect(
      raiseDirectRangesToLisaFloors(pkg("~0.5.0"), force).packageJson
        .dependencies
    ).toEqual({ "class-transformer": "~0.5.1" });
    expect(raiseDirectRangesToLisaFloors(pkg("0.4.0"), force).raises).toEqual(
      []
    );
  });

  it.each(["6.9.0", "~6.0.0", "^6.0.0"])(
    "refuses, rather than crosses a major, for %s below the floor's major",
    range => {
      const { raises, packageJson } = raiseHook({
        dependencies: { [HOOK]: range },
      });
      expect(raises).toEqual([]);
      expect(auditSelfReferenceRewrites(packageJson).conflicts).toHaveLength(1);
    }
  );

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

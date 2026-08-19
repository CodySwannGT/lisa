/**
 * Tests for the version-range comparison behind the security-floor audit.
 *
 * The network half is not tested here — it is a thin fetch wrapper, and pinning
 * live advisory content would make the suite fail whenever a real advisory
 * lands. What is worth pinning is the comparison, because a wrong answer here
 * is silent: an off-by-one boundary reports a vulnerable floor as clean, which
 * is the exact failure this script exists to prevent.
 * @module tests/unit/scripts/security-floors
 */
import { describe, expect, it } from "vitest";

import {
  collectFloors,
  lowestPermitted,
  resolveSelfReference,
  withinRange,
} from "../../../scripts/check-security-floors.mjs";

describe("lowestPermitted", () => {
  it("reads the floor out of a >= range", () => {
    expect(lowestPermitted(">=5.0.7")).toEqual([5, 0, 7]);
  });

  it("reads the floor out of a caret range", () => {
    expect(lowestPermitted("^4.3.0")).toEqual([4, 3, 0]);
  });

  it("reads the floor out of a tilde range", () => {
    expect(lowestPermitted("~2.0.0")).toEqual([2, 0, 0]);
  });

  it("treats a bare version as its own floor", () => {
    expect(lowestPermitted("2.259.0")).toEqual([2, 259, 0]);
  });

  it("returns null for a spec carrying no version", () => {
    expect(lowestPermitted("workspace:*")).toBeNull();
  });
});

describe("withinRange", () => {
  /** The brace-expansion range that started all this. */
  const BRACE_RANGE = ">= 4.0.0, < 5.0.8";
  /** The aws-cdk-lib range, where lexical comparison gives a wrong answer. */
  const CDK_RANGE = ">= 2.0.0, < 2.260.0";

  // The real case: brace-expansion >=5.0.7 permits 5.0.7, which
  // GHSA-mh99-v99m-4gvg marks vulnerable up to (not including) 5.0.8.
  it("flags a floor that sits inside a two-sided range", () => {
    expect(withinRange([5, 0, 7], BRACE_RANGE)).toBe(true);
  });

  it("clears a floor at the patched boundary", () => {
    expect(withinRange([5, 0, 8], BRACE_RANGE)).toBe(false);
  });

  it("clears a floor below the vulnerable range", () => {
    expect(withinRange([3, 0, 0], BRACE_RANGE)).toBe(false);
  });

  it("handles an inclusive upper bound", () => {
    expect(withinRange([7, 5, 18], "<= 7.5.18")).toBe(true);
    expect(withinRange([7, 5, 19], "<= 7.5.18")).toBe(false);
  });

  it("handles a bare upper bound with no lower bound", () => {
    expect(withinRange([5, 30, 7], "< 5.30.8")).toBe(true);
  });

  it("handles an exact-version range", () => {
    expect(withinRange([4, 0, 0], "= 4.0.0")).toBe(true);
    expect(withinRange([4, 0, 1], "= 4.0.0")).toBe(false);
  });

  it("compares numerically rather than lexically", () => {
    // "2.259.0" < "2.26.0" as strings; the opposite is true as versions, and
    // getting this wrong would clear a genuinely vulnerable aws-cdk-lib pin.
    expect(withinRange([2, 259, 0], CDK_RANGE)).toBe(true);
    expect(withinRange([2, 26, 0], CDK_RANGE)).toBe(true);
    expect(withinRange([2, 260, 0], CDK_RANGE)).toBe(false);
  });

  it("treats an empty range as no constraint rather than a match", () => {
    expect(withinRange([1, 0, 0], "")).toBe(false);
  });
});

/**
 * `$name` self-references, which the collector used to skip outright.
 *
 * The skip was justified as "defers to the project's own pin and carries no
 * floor of its own". That is true of the reference and false of the outcome:
 * the pin it defers to may itself sit below the advisory floor, and skipping
 * meant nothing ever compared it. It was safe only by coincidence — every
 * `$name` in the templates today happens to target a package also declared as
 * a literal elsewhere, so the range got checked under its own entry. Nothing
 * enforced that, and the first reference to an undeclared target would have
 * been an unchecked floor reported as clean.
 */
describe("resolveSelfReference", () => {
  it("finds the target in a force dependency section", () => {
    const manifest = { force: { devDependencies: { vite: "^8.0.16" } } };
    expect(resolveSelfReference(manifest, "vite")).toBe("^8.0.16");
  });

  it("finds the target in any governance group, not just force", () => {
    // phaser declares its vite pin under `defaults`, cdk under `force`. A
    // resolver that only looked at one would silently miss the other.
    const manifest = { defaults: { devDependencies: { vite: "^8.0.16" } } };
    expect(resolveSelfReference(manifest, "vite")).toBe("^8.0.16");
  });

  it("returns the range so a WEAK target can be compared, not waved through", () => {
    // The whole point: a reference is only as strong as what it points at.
    const manifest = { force: { dependencies: { postcss: "^8.5.0" } } };
    const resolved = resolveSelfReference(manifest, "postcss");
    expect(resolved).toBe("^8.5.0");
    expect(lowestPermitted(resolved as string)).toEqual([8, 5, 0]);
    // ^8.5.0 permits 8.5.0, which sits inside a range patched at 8.5.18.
    expect(withinRange([8, 5, 0], ">= 8.0.0, < 8.5.18")).toBe(true);
  });

  it("returns null when nothing declares the target", () => {
    // Not an error and not a pass — the caller reports it, because a floor
    // nobody checked must not read as a floor that passed.
    expect(
      resolveSelfReference({ force: { overrides: {} } }, "vite")
    ).toBeNull();
  });

  it("does not resolve a reference to another reference", () => {
    // Otherwise a `$a -> $b` pair could loop, or resolve to a string that is
    // not a version at all.
    const manifest = { force: { dependencies: { vite: "$vite" } } };
    expect(resolveSelfReference(manifest, "vite")).toBeNull();
  });

  it("ignores constraint sections that are themselves override maps", () => {
    // `overrides`/`resolutions` are where `$name` lives; resolving into them
    // would find the reference again rather than the pin.
    const manifest = {
      force: {
        overrides: { vite: "$vite" },
        devDependencies: { vite: "^8.0.16" },
      },
    };
    expect(resolveSelfReference(manifest, "vite")).toBe("^8.0.16");
  });
});

describe("collectFloors", () => {
  // Runs against this repository, because the property under test is coverage
  // and a fixture cannot have that property. The glob reached seven of eight
  // manifests — one level deep, missing the governance ROOT — so nine floors
  // were audited by nothing and reported clean.
  it("reads the governance root manifest", () => {
    const { scanned } = collectFloors();

    expect(scanned).toContain("package.lisa.json");
  });

  it("reads every per-stack manifest too", () => {
    const { scanned } = collectFloors();

    expect(
      scanned.filter(file => file.endsWith("/package-lisa/package.lisa.json"))
        .length
    ).toBeGreaterThan(1);
  });

  it("leaves no tracked manifest unscanned", () => {
    // The anti-narrowing floor. Comparing what the patterns reached against
    // what git tracks is what stops the glob quietly losing a level again —
    // the count of scanned manifests is the assertion, not a hardcoded number
    // that goes stale the first time a stack is added.
    const { unscanned } = collectFloors();

    expect(unscanned, "git could not be consulted").not.toBeNull();
    expect(unscanned).toEqual([]);
  });

  it("collects a floor that only the root manifest declares", () => {
    // nanoid sits in the root manifest and nowhere else, so before the fix it
    // was one of the nine nobody looked at.
    const { found } = collectFloors();

    expect(found.has("nanoid")).toBe(true);
    expect(
      found.get("nanoid").some(site => site.file === "package.lisa.json")
    ).toBe(true);
  });
});

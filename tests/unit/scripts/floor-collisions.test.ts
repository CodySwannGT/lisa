/**
 * Tests for the offline floor-collision check.
 *
 * The check exists because `bun install` rewrites an override that names a
 * direct dependency into `$name`, silently replacing the override's floor with
 * the dependency line's. Observed in acmeorgc/frontend on bun 1.3.11:
 * `"postcss": ">=8.5.18"` became `"$postcss"` against `devDependencies ^8.5.0`,
 * putting postcss back inside the range GHSA patches at 8.5.18.
 *
 * The most important case here is the FALSE POSITIVE one. A first draft
 * reported every `$name` override, which fires on the correct end state — a
 * fixed project looks exactly like that after its next install — and a check
 * that fails on the fix is one people switch off. That draft was caught by
 * running it against a synthetic post-install manifest rather than by review.
 * @module tests/unit/scripts/floor-collisions
 */
import { describe, expect, it } from "vitest";

import {
  collisions,
  directDependencies,
  lowestPermitted,
} from "../../../all/copy-overwrite/scripts/lisa-floor-collisions.mjs";

describe("lowestPermitted", () => {
  it("reads the floor out of every range form in practical use", () => {
    expect(lowestPermitted(">=8.5.18")).toEqual([8, 5, 18]);
    expect(lowestPermitted("^8.5.0")).toEqual([8, 5, 0]);
    expect(lowestPermitted("~3.3.3")).toEqual([3, 3, 3]);
    expect(lowestPermitted("3.8.3")).toEqual([3, 8, 3]);
    expect(lowestPermitted(">=1.2.3 <2.0.0")).toEqual([1, 2, 3]);
  });

  it("returns null for a spec carrying no version", () => {
    expect(lowestPermitted("*")).toBeNull();
    expect(lowestPermitted("workspace:*")).toBeNull();
    expect(lowestPermitted("")).toBeNull();
  });

  it("takes the lowest branch of a disjunction, not the first", () => {
    // The false negative. Reading only the first triple reported 2.0.0 here —
    // a floor HIGHER than the range permits — and the caller's
    // `compare(target, floor) >= 0` then skipped a genuine collision.
    expect(lowestPermitted("^2.0.0 || ^1.9.0")).toEqual([1, 9, 0]);
    expect(lowestPermitted("^1.9.0 || ^2.0.0")).toEqual([1, 9, 0]);
    expect(lowestPermitted(">=3.0.0 || >=1.0.0 || >=2.0.0")).toEqual([1, 0, 0]);
  });

  it("treats an upper-bound-only range as having no floor", () => {
    // `<2.0.0` permits everything beneath it; reading 2.0.0 as its floor
    // inverted the meaning of the bound entirely.
    expect(lowestPermitted("<2.0.0")).toEqual([0, 0, 0]);
    expect(lowestPermitted("<=2.0.0")).toEqual([0, 0, 0]);
  });

  it("returns null for an alias spec, which versions another package", () => {
    // The number in `npm:other-pkg@^1.2.3` describes other-pkg, so comparing it
    // against a floor recorded for THIS name answers a question nobody asked.
    expect(lowestPermitted("npm:other-pkg@^1.2.3")).toBeNull();
    expect(lowestPermitted("  npm:string-width@^4.2.3")).toBeNull();
  });
});

describe("directDependencies", () => {
  it("flattens every dependency section", () => {
    const found = directDependencies({
      dependencies: { a: "1.0.0" },
      devDependencies: { b: "2.0.0" },
      peerDependencies: { c: "3.0.0" },
      optionalDependencies: { d: "4.0.0" },
    });
    expect(
      [...found.keys()].sort((left, right) => left.localeCompare(right))
    ).toEqual(["a", "b", "c", "d"]);
    expect(found.get("b")).toEqual({
      spec: "2.0.0",
      section: "devDependencies",
    });
  });

  it("keeps the first declaration when a package appears twice", () => {
    const found = directDependencies({
      dependencies: { a: "1.0.0" },
      devDependencies: { a: "9.0.0" },
    });
    expect(found.get("a")?.section).toBe("dependencies");
  });
});

describe("collisions", () => {
  it("flags an override whose direct dependency permits something lower", () => {
    // The exact shape of the real defect.
    const found = collisions({
      devDependencies: { postcss: "^8.5.0" },
      overrides: { postcss: ">=8.5.18" },
    });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      name: "postcss",
      override: ">=8.5.18",
      dependency: "^8.5.0",
      section: "devDependencies",
      from: "overrides",
    });
  });

  it("does not flag an override whose dependency already carries the floor", () => {
    // The fix. It must read as clean, or the fix looks like a failure.
    expect(
      collisions({
        devDependencies: { postcss: ">=8.5.18" },
        overrides: { postcss: ">=8.5.18" },
      })
    ).toEqual([]);
  });

  it("does not flag an override with no matching direct dependency", () => {
    // Transitive-only overrides are the normal case and cannot be collapsed:
    // there is no dependency line for `$name` to point at.
    expect(
      collisions({
        devDependencies: { postcss: ">=8.5.18" },
        overrides: { lodash: ">=4.18.1" },
      })
    ).toEqual([]);
  });

  it("does not flag an ALREADY collapsed override, whatever its target", () => {
    // The false positive that mattered. A collapsed override onto an adequate
    // dependency is what a fixed project looks like after its next install.
    // Flagging it would fail every project post-install, including the fixed
    // ones, and the check would be skipped rather than heeded.
    expect(
      collisions({
        devDependencies: { postcss: "^8.5.0", prettier: "3.8.3" },
        overrides: { postcss: "$postcss", prettier: "$prettier" },
      })
    ).toEqual([]);
  });

  it("checks resolutions as well as overrides", () => {
    // bun rewrites both, so a check covering only one is half a check.
    const found = collisions({
      devDependencies: { prettier: "^3.3.3" },
      resolutions: { prettier: "3.8.3" },
    });
    expect(found).toHaveLength(1);
    expect(found[0].from).toBe("resolutions");
  });

  it("reports the same package once per section it collides in", () => {
    // Both sections need raising, so both are worth naming.
    const found = collisions({
      devDependencies: { postcss: "^8.5.0" },
      overrides: { postcss: ">=8.5.18" },
      resolutions: { postcss: ">=8.5.18" },
    });
    expect(
      found
        .map(row => row.from)
        .sort((left, right) => left.localeCompare(right))
    ).toEqual(["overrides", "resolutions"]);
  });

  it("ignores a dependency spec that versions a DIFFERENT package", () => {
    // `workspace:` and `npm:` aliases both point the name somewhere else, so
    // the number attached to them cannot be compared against a floor recorded
    // for this name. Skipping is the only honest answer.
    expect(
      collisions({
        devDependencies: { a: "workspace:*" },
        overrides: { a: ">=1.0.0" },
      })
    ).toEqual([]);
    expect(
      collisions({
        devDependencies: { a: "npm:other-pkg@^1.2.3" },
        overrides: { a: ">=1.0.0" },
      })
    ).toEqual([]);
  });

  it("flags a dependency range that permits EVERYTHING", () => {
    // The false negative that runs the wrong way round: the looser the
    // dependency line, the quieter the check got. `*` permits every version
    // ever published, so collapsing the override onto it removes the floor
    // outright — the strongest possible instance of what this file exists to
    // catch, and the one it reported as clean.
    const found = collisions({
      devDependencies: { postcss: "*" },
      overrides: { postcss: ">=8.5.18" },
    });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      name: "postcss",
      override: ">=8.5.18",
      dependency: "*",
    });
  });

  it("flags a major-only dependency range against a patch-level floor", () => {
    // `^8` permits 8.0.0, which is inside the range the override was raised to
    // escape. A range is not comparable only when it carries all three
    // components; one that carries fewer permits MORE, never less.
    const found = collisions({
      devDependencies: { postcss: "^8" },
      overrides: { postcss: ">=8.5.18" },
    });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ name: "postcss", dependency: "^8" });
  });

  it("flags a dist-tag dependency, which pins nothing at all", () => {
    // `latest` resolves to whatever the registry serves, including a version
    // below the floor. Treating "no number to read" as "nothing to check" is
    // what made this quiet.
    expect(
      collisions({
        dependencies: { lodash: "latest" },
        overrides: { lodash: ">=4.17.21" },
      })
    ).toHaveLength(1);
  });

  it("reports no floor when any disjunction branch has none", () => {
    // A `||` range permits the UNION of its branches, so `latest || ^8` permits
    // everything `latest` does. Filtering the floorless branch out let the
    // strongest branch speak for the weakest and reported a floor of 8.0.0 —
    // a floor read TOO HIGH, which is the direction that makes the caller's
    // `compare(target, floor) >= 0` skip a real collision.
    expect(lowestPermitted("latest || ^8")).toBeNull();
    expect(lowestPermitted("^2.0.0 || ^1.9.0")).toEqual([1, 9, 0]);

    // The dependency side of that: a range permitting everything loses to any
    // override that carries a floor, so the collision is reported.
    expect(
      collisions({
        dependencies: { lodash: "latest || ^4.17.0" },
        overrides: { lodash: ">=4.17.21" },
      })
    ).toHaveLength(1);

    // And the override side: an override with no floor has nothing to lose.
    expect(
      collisions({
        dependencies: { lodash: "^4.17.0" },
        overrides: { lodash: "latest || ^4.17.21" },
      })
    ).toEqual([]);
  });

  it("does not invent a floor from a digit inside a non-range override", () => {
    // `\D*` skipped `file:../pkg` and read the `2` as a major version, so the
    // override claimed a floor of 2.0.0. `collisions()` runs `isIncomparable`
    // over the DEPENDENCY line only, so nothing downstream caught it and a
    // project using a local checkout was told it had a collision it does not
    // have. A false alarm is what gets a security check switched off.
    expect(lowestPermitted("file:../pkg2")).toBeNull();
    expect(lowestPermitted("github:org/repo2")).toBeNull();
    expect(
      collisions({
        dependencies: { pkg: "^1.0.0" },
        overrides: { pkg: "file:../pkg2" },
      })
    ).toEqual([]);
  });

  it("is clean on a manifest with no overrides at all", () => {
    expect(collisions({ dependencies: { a: "1.0.0" } })).toEqual([]);
  });
});

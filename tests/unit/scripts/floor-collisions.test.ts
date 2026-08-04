/**
 * Tests for the offline floor-collision check.
 *
 * The check exists because `bun install` rewrites an override that names a
 * direct dependency into `$name`, silently replacing the override's floor with
 * the dependency line's. Observed in gunnertech/frontend on bun 1.3.11:
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

  it("ignores specs with no comparable version on either side", () => {
    expect(
      collisions({
        devDependencies: { a: "workspace:*" },
        overrides: { a: ">=1.0.0" },
      })
    ).toEqual([]);
  });

  it("is clean on a manifest with no overrides at all", () => {
    expect(collisions({ dependencies: { a: "1.0.0" } })).toEqual([]);
  });
});

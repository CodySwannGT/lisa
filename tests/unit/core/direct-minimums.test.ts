/**
 * A Lisa minimum holds only the host's own direct ranges (CodySwannGT/lisa#4932).
 * @module tests/unit/core/direct-minimums
 */
import { describe, expect, it } from "vitest";

import {
  applyDirectMinimums,
  describeDirectMinimumConflict,
} from "../../../src/core/direct-minimums.js";

const MINIMUMS = { "date-fns": ">=3.6.0", "@apollo/server": ">=5.4.0" };

describe("applyDirectMinimums", () => {
  it("changes nothing in a host that does not list the library", () => {
    const pkg = { dependencies: { react: "^19.0.0" } };
    const held = applyDirectMinimums(pkg, MINIMUMS);
    expect(held.packageJson).toBe(pkg);
    expect(held.raises).toEqual([]);
    expect(held.conflicts).toEqual([]);
  });

  it("never writes an override, so transitive copies keep their own ranges", () => {
    const held = applyDirectMinimums(
      { dependencies: { "date-fns": "^3.0.0" } },
      MINIMUMS
    );
    expect(held.packageJson).toEqual({
      dependencies: { "date-fns": "^3.6.0" },
    });
    expect(held.packageJson.overrides).toBeUndefined();
    expect(held.packageJson.resolutions).toBeUndefined();
  });

  it("raises an exact pin in the same major to the minimum exactly", () => {
    const held = applyDirectMinimums(
      { dependencies: { "@apollo/server": "5.2.0" } },
      MINIMUMS
    );
    expect(held.packageJson.dependencies).toEqual({
      "@apollo/server": "5.4.0",
    });
    expect(held.raises).toEqual([
      {
        section: "dependencies",
        name: "@apollo/server",
        from: "5.2.0",
        to: "5.4.0",
        minimum: ">=5.4.0",
      },
    ]);
  });

  it("leaves a range already at or above the minimum, a later major included", () => {
    const pkg = {
      dependencies: { "date-fns": "^4.1.0" },
      devDependencies: { "@apollo/server": "~5.6.0" },
    };
    expect(applyDirectMinimums(pkg, MINIMUMS).packageJson).toBe(pkg);
  });

  it("refuses a raise that would cross a major", () => {
    const held = applyDirectMinimums(
      { dependencies: { "date-fns": "^2.30.0" } },
      MINIMUMS
    );
    expect(held.raises).toEqual([]);
    expect(held.conflicts).toEqual([
      {
        section: "dependencies",
        name: "date-fns",
        directRange: "^2.30.0",
        minimum: ">=3.6.0",
        suggestedDirectRange: "^3.6.0",
      },
    ]);
    expect(describeDirectMinimumConflict(held.conflicts[0]!)).toMatch(
      /dependencies\.date-fns is "\^2\.30\.0", below Lisa's minimum ">=3\.6\.0"[\s\S]*Raise the direct dependency date-fns to "\^3\.6\.0"/u
    );
  });

  it("never reads or rewrites a peer range", () => {
    const pkg = { peerDependencies: { "date-fns": "^2.0.0 || ^3.0.0" } };
    const held = applyDirectMinimums(pkg, MINIMUMS);
    expect(held.packageJson).toBe(pkg);
    expect(held.conflicts).toEqual([]);
  });

  it("leaves a range Lisa cannot read as written", () => {
    const pkg = { dependencies: { "date-fns": "workspace:*" } };
    const held = applyDirectMinimums(pkg, MINIMUMS);
    expect(held.packageJson).toBe(pkg);
    expect(held.conflicts).toEqual([]);
  });
});

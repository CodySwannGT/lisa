/**
 * Shipped force floors must exclude the high advisories the floor check cites
 * (CodySwannGT/lisa#4507).
 *
 * A forced floor overwrites whatever the downstream project pinned, so a
 * stale one moves a correctly pinned project back onto the vulnerable range.
 * `scripts/check-security-floors.mjs` reported these five sites against the
 * live advisory database on 2026-10-24. The ranges and first patched versions
 * below were captured that day from https://github.com/advisories/<ghsa>; the
 * collector and comparator are the production prover's, so no weaker
 * substitute decides whether a floor is vulnerable.
 */
import { describe, expect, it } from "vitest";

import {
  collectFloors,
  lowestPermitted,
  withinRange,
} from "../../../scripts/check-security-floors.mjs";

/** Each advisory's npm range on the line Lisa ships, and its first fix. */
const ADVISORIES = [
  {
    name: "multer",
    ghsa: "GHSA-q7qp-rjg7-q26m",
    range: ">= 2.0.0, < 2.5.0",
    patched: "2.5.0",
    sites: [
      "typescript/package-lisa/package.lisa.json:force.overrides",
      "typescript/package-lisa/package.lisa.json:force.resolutions",
    ],
  },
  {
    name: "undici",
    ghsa: "GHSA-xjj6-f33q-929c",
    range: ">= 6.23.0, < 6.29.1",
    patched: "6.29.1",
    sites: [
      "typescript/package-lisa/package.lisa.json:force.overrides",
      "typescript/package-lisa/package.lisa.json:force.resolutions",
    ],
  },
  {
    name: "@graphql-tools/utils",
    ghsa: "GHSA-c4qx-w738-7hr3",
    range: ">= 10.10.1, <= 12.0.1",
    patched: "12.0.2",
    sites: ["nestjs/package-lisa/package.lisa.json:force.dependencies"],
  },
] as const;

const COLLECTED = collectFloors();

describe("shipped template security floors", () => {
  it("scans every manifest it should", () => {
    expect(COLLECTED.unscanned).toEqual([]);
    expect(COLLECTED.unparseable).toEqual([]);
  });

  it.each(ADVISORIES)(
    "$ghsa: finds every $name force site Lisa ships",
    ({ name, sites }) => {
      const found = (COLLECTED.found.get(name) ?? [])
        .filter(site => site.path.startsWith("force."))
        .map(site => `${site.file}:${site.path}`);
      expect(found).toEqual(expect.arrayContaining([...sites]));
    }
  );

  it.each(
    ADVISORIES.flatMap(({ name, ghsa, range, sites }) =>
      sites.map(site => ({ name, ghsa, range, site }))
    )
  )("$ghsa: $name at $site excludes $range", ({ name, ghsa, range, site }) => {
    const floor = (COLLECTED.found.get(name) ?? []).find(
      entry => `${entry.file}:${entry.path}` === site
    );
    expect(floor, `${site}.${name} missing`).toBeDefined();
    expect(
      withinRange(floor!.lowest, range),
      `${ghsa}: ${site}.${name} permits ${floor!.spec}`
    ).toBe(false);
  });

  it.each(ADVISORIES)(
    "$ghsa: no other shipped $name floor admits $range",
    ({ name, ghsa, range }) => {
      for (const site of COLLECTED.found.get(name) ?? [])
        expect(
          withinRange(site.lowest, range),
          `${ghsa}: ${site.file}:${site.path}.${name} permits ${site.spec}`
        ).toBe(false);
    }
  );

  it.each(ADVISORIES)(
    "$ghsa: the range rejects its last vulnerable release and clears $patched",
    ({ range, patched }) => {
      const fixed = lowestPermitted(patched);
      if (fixed === null) throw new Error(`unparseable ${patched}`);
      const [major = 0, minor = 0, patch = 0] = fixed;
      const previous =
        patch > 0 ? [major, minor, patch - 1] : [major, minor - 1, 99];
      expect(withinRange(previous, range)).toBe(true);
      expect(withinRange(fixed, range)).toBe(false);
    }
  );
});

/**
 * No zod inside GHSA-mrhx-c7xc-m3w5's range, anywhere Lisa decides it
 * (CodySwannGT/lisa#4507).
 *
 * Immutable GitHub advisory data captured 2026-10-24 from
 * https://github.com/advisories/GHSA-mrhx-c7xc-m3w5: high severity, npm
 * `zod` below 4.6.6, first patched 4.6.6, with no patched 3.x. The pre-push
 * audit (`bun audit --production --json`, high and critical only) refused every
 * push once the advisory landed, because the lockfile resolved zod 3.25.76
 * through `eslint-plugin-react-compiler` and zod 4.6.5 under knip and
 * `eslint-plugin-react-hooks`. The audit is a network call, so this suite
 * checks the inputs it reads instead: the resolved lockfile, the root
 * overrides, and every floor Lisa ships, through the production floor
 * collector rather than a re-implementation of it.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import {
  collectFloors,
  lowestPermitted,
  withinRange,
} from "../../../scripts/check-security-floors.mjs";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const ADVISORY = "GHSA-mrhx-c7xc-m3w5";
const VULNERABLE = "< 4.6.6";
const SECTIONS = ["overrides", "resolutions"] as const;
const DROPPED_PLUGIN = "eslint-plugin-react-compiler";
const EXPO_TEMPLATE = "expo/package-lisa/package.lisa.json";

/**
 * Read a repository file.
 * @param file - Path relative to the repository root
 * @returns Its contents
 */
function read(file: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, file), "utf8");
}

/**
 * Parse a dotted version into the collector's comparable form.
 * @param version - e.g. "4.6.7"
 * @returns [major, minor, patch]
 */
function parts(version: string): number[] {
  return version.split(".").map(Number);
}

/**
 * Every zod the lockfile resolves, keyed by the dependency path that pins it.
 * @returns Lockfile key and resolved version, one entry per resolution
 */
function lockedZods(): { key: string; version: string }[] {
  return [...read("bun.lock").matchAll(/"([^"]+)": \["zod@(\d+\.\d+\.\d+)"/g)]
    .map(([, key = "", version = ""]) => ({ key, version }))
    .filter(({ key }) => key === "zod" || key.endsWith("/zod"));
}

describe(`zod security floor (${ADVISORY})`, () => {
  it("resolves no zod inside the advisory's range", () => {
    const zods = lockedZods();
    expect(zods.length).toBeGreaterThan(0);
    for (const { key, version } of zods)
      expect(
        withinRange(parts(version), VULNERABLE),
        `bun.lock ${key} resolves zod@${version}`
      ).toBe(false);
  });

  it.each(SECTIONS)("floors zod past the advisory in root %s", section => {
    const manifest = JSON.parse(read("package.json")) as Record<
      string,
      Record<string, string> | undefined
    >;
    const spec = manifest[section]?.zod;
    expect(spec, `package.json ${section}.zod`).toBeDefined();
    const lowest = lowestPermitted(spec!);
    expect(lowest).not.toBeNull();
    expect(withinRange(lowest!, VULNERABLE), `${section}.zod ${spec}`).toBe(
      false
    );
  });

  it("ships no zod floor that admits the advisory", () => {
    const collected = collectFloors();
    expect(collected.unscanned).toEqual([]);
    const sites = collected.found.get("zod") ?? [];
    expect(sites.length).toBeGreaterThan(0);
    for (const site of sites)
      expect(
        withinRange(site.lowest, VULNERABLE),
        `${site.file}:${site.path}.zod permits ${site.spec}`
      ).toBe(false);
  });

  it("rejects the vulnerable controls and clears the patched release", () => {
    expect(withinRange(parts("3.25.76"), VULNERABLE)).toBe(true);
    expect(withinRange(parts("4.6.5"), VULNERABLE)).toBe(true);
    expect(withinRange(parts("4.6.6"), VULNERABLE)).toBe(false);
  });

  it.each(["audit.ignore.config.json", "audit.ignore.local.json"])(
    "does not suppress the advisory in %s",
    file => {
      if (!fs.existsSync(path.join(REPO_ROOT, file))) return;
      const ids = (
        JSON.parse(read(file)) as { exclusions: { id: string }[] }
      ).exclusions.map(exclusion => exclusion.id);
      expect(ids).not.toContain(ADVISORY);
    }
  );
});

describe(`${DROPPED_PLUGIN}, the zod 3 path`, () => {
  // Its newest release still needs zod ^3, and the one rule Lisa registered
  // it for was set to "off": eslint-plugin-react-hooks 7 carries the React
  // Compiler checks as separate rules, which the Expo config already sets.
  it("is no longer a Lisa dependency", () => {
    const manifest = JSON.parse(read("package.json")) as Record<
      string,
      Record<string, string> | undefined
    >;
    for (const section of [
      "dependencies",
      "devDependencies",
      "peerDependencies",
    ])
      expect(manifest[section]?.[DROPPED_PLUGIN], section).toBeUndefined();
  });

  it.each(["src/configs/eslint/expo.ts", "expo/copy-overwrite/eslint.expo.ts"])(
    "is not imported or configured by %s",
    file => {
      expect(read(file)).not.toContain("react-compiler");
    }
  );

  it("is removed from Expo projects that installed it for the template", () => {
    const template = JSON.parse(read(EXPO_TEMPLATE)) as {
      remove?: Record<string, string[]>;
    };
    expect(template.remove?.devDependencies).toContain(DROPPED_PLUGIN);
  });
});

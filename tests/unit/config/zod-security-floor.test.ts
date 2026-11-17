/**
 * GHSA-mrhx-c7xc-m3w5 reaches no zod in Lisa's tree (CodySwannGT/lisa#4931).
 *
 * Immutable GitHub advisory data captured 2026-10-24 from
 * https://github.com/advisories/GHSA-mrhx-c7xc-m3w5: high severity, npm `zod`
 * below 4.6.6, first patched 4.6.6, with no patched 3.x. The last zod 3 came
 * from eslint-plugin-react-compiler, whose final release requires zod ^3.22.4;
 * #4507 kept it behind an audit exception. #4931 replaced that plugin with the
 * React Compiler rules eslint-plugin-react-hooks 7 ships (which accepts zod 4)
 * and floors every zod with a root override, so the exception is gone. This
 * suite fails if any zod drops below 4.6.6, if a package that needs zod 3
 * returns, or if any audit exclusion list excuses the advisory again.
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
const MANIFEST = "package.json";
const AUDIT_LISTS = [
  "audit.ignore.config.json",
  "audit.ignore.local.json",
  "typescript/copy-overwrite/audit.ignore.config.json",
] as const;

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

/**
 * Every lockfile package whose zod range admits 3.x and no 4.x, so it cannot
 * share the patched zod. A range like `^3.25.0 || ^4.0.0` takes either major.
 * @returns Package names
 */
function zodThreeRequirers(): string[] {
  return [
    ...read("bun.lock").matchAll(
      /\n {4}"([^"]+)": \["[^"]+", "[^"]*", \{[^\n]*?"zod": "([^"]+)"/g
    ),
  ]
    .filter(
      ([, , range = ""]) =>
        /(^|[\s|^~>=])3/.test(range) && !/(^|[\s|^~>=])4/.test(range)
    )
    .map(([, name = ""]) => name);
}

/** An audit exclusion document. */
interface AuditIgnore {
  readonly exclusions: readonly { readonly id: string }[];
}

describe(`zod security floor (${ADVISORY})`, () => {
  it("resolves every zod to a patched 4.x", () => {
    const locked = lockedZods();
    expect(locked.length).toBeGreaterThan(0);
    for (const { key, version } of locked)
      expect(
        withinRange(parts(version), VULNERABLE),
        `bun.lock ${key} resolves zod@${version}`
      ).toBe(false);
  });

  it("depends directly on no package that needs zod 3", () => {
    // The dev-only self-pin (a published @codyswann/lisa from before #4931)
    // still declares eslint-plugin-react-compiler; the override above gives
    // it zod 4, and the first case proves no zod 3 resolves anywhere.
    const manifest = JSON.parse(read(MANIFEST)) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const direct = new Set([
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.devDependencies ?? {}),
    ]);
    expect(zodThreeRequirers().filter(name => direct.has(name))).toEqual([]);
  });

  it("forces every transitive zod past the advisory", () => {
    const manifest = JSON.parse(read(MANIFEST)) as {
      overrides?: Record<string, string>;
      resolutions?: Record<string, string>;
    };
    for (const field of ["overrides", "resolutions"] as const) {
      const spec = manifest[field]?.zod;
      expect(spec, `package.json ${field}.zod`).toBeDefined();
      const lowest = lowestPermitted(spec!);
      expect(lowest).not.toBeNull();
      expect(withinRange(lowest!, VULNERABLE), `${field} zod ${spec}`).toBe(
        false
      );
    }
  });

  it("floors the root zod past the advisory", () => {
    const manifest = JSON.parse(read(MANIFEST)) as {
      devDependencies?: Record<string, string>;
    };
    const spec = manifest.devDependencies?.zod;
    expect(spec, "package.json devDependencies.zod").toBeDefined();
    const lowest = lowestPermitted(spec!);
    expect(lowest).not.toBeNull();
    expect(withinRange(lowest!, VULNERABLE), `zod ${spec}`).toBe(false);
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

  it.each(AUDIT_LISTS)("keeps the advisory out of %s", file => {
    const ids = (JSON.parse(read(file)) as AuditIgnore).exclusions.map(
      ({ id }) => id
    );
    expect(ids).not.toContain(ADVISORY);
  });
});

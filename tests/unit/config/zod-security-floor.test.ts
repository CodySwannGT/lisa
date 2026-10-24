/**
 * GHSA-mrhx-c7xc-m3w5 reaches exactly one zod, and only where the maintainer
 * accepted it (CodySwannGT/lisa#4507).
 *
 * Immutable GitHub advisory data captured 2026-10-24 from
 * https://github.com/advisories/GHSA-mrhx-c7xc-m3w5: high severity, npm `zod`
 * below 4.6.6, first patched 4.6.6, with no patched 3.x. Every zod 4 in the
 * tree moves to 4.6.7. The one zod 3 left is the copy
 * `eslint-plugin-react-compiler` requires: on 2026-10-24 the maintainer chose
 * to keep that plugin, whose React Compiler rule runs in Expo's lint:slow, and
 * accept the advisory for that lint-time copy alone. The pre-push audit filters
 * by advisory id only, so this suite is what keeps the exception scoped. It
 * fails if any other zod drops below 4.6.6, if a second package starts to need
 * zod 3, or if the exception spreads into a template Lisa ships.
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
const ACCEPTED_PATH = "eslint-plugin-react-compiler/zod";
const SHIPPED_IGNORE = "typescript/copy-overwrite/audit.ignore.config.json";

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

/** Lisa's own audit exclusions, by id. */
interface AuditIgnore {
  readonly exclusions: readonly {
    readonly id: string;
    readonly package?: string;
    readonly tracking?: string;
    readonly reason?: string;
  }[];
}

describe(`zod security floor (${ADVISORY})`, () => {
  it("leaves only the accepted plugin copy inside the advisory's range", () => {
    const vulnerable = lockedZods().filter(({ version }) =>
      withinRange(parts(version), VULNERABLE)
    );
    expect(vulnerable.map(({ key }) => key)).toEqual([ACCEPTED_PATH]);
  });

  it("resolves every other zod to a patched 4.x", () => {
    const others = lockedZods().filter(({ key }) => key !== ACCEPTED_PATH);
    expect(others.length).toBeGreaterThan(0);
    for (const { key, version } of others)
      expect(
        withinRange(parts(version), VULNERABLE),
        `bun.lock ${key} resolves zod@${version}`
      ).toBe(false);
  });

  it("has exactly one package that still needs zod 3", () => {
    expect(zodThreeRequirers()).toEqual(["eslint-plugin-react-compiler"]);
  });

  it("floors the root zod past the advisory", () => {
    const manifest = JSON.parse(read("package.json")) as {
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

  it("records the exception for Lisa's own tree, with its tracking and reason", () => {
    const local = JSON.parse(read("audit.ignore.local.json")) as AuditIgnore;
    const entry = local.exclusions.find(({ id }) => id === ADVISORY);
    expect(entry?.package).toBe("zod");
    expect(entry?.tracking).toBe("CodySwannGT/lisa#4507");
    expect(entry?.reason).toContain("eslint-plugin-react-compiler");
  });

  it.each(["audit.ignore.config.json", SHIPPED_IGNORE])(
    "keeps the exception out of the managed %s",
    file => {
      const ids = (JSON.parse(read(file)) as AuditIgnore).exclusions.map(
        ({ id }) => id
      );
      expect(ids).not.toContain(ADVISORY);
    }
  );
});

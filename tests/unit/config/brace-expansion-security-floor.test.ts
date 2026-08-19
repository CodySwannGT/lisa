import fs from "node:fs";
import path from "node:path";
import { gte, major } from "semver";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/**
 * `brace-expansion` is the one dependency Lisa must NOT unify across the tree.
 *
 * Two consumers of it coexist in every project Lisa touches, and they disagree
 * about what the module is:
 *
 * - `minimatch@3`, reached through `@eslint/config-array`, does
 *   `var expand = require('brace-expansion')` and calls the module itself. That
 *   works up to 2.x and stops at 3.0.0, where the CommonJS export became an
 *   object.
 * - `minimatch@10` does `import { expand } from 'brace-expansion'`. That named
 *   export exists only from 5.x.
 *
 * An `overrides`/`resolutions` entry collapses the tree onto a single copy, so
 * whatever it names breaks one of the two. Measured on a consumer-shaped tree
 * carrying both: `>=5.0.9` gives `TypeError: expand is not a function` and
 * `eslint` exits 2; `<3` gives `SyntaxError: Named export 'expand' not found`
 * and `minimatch@10` dies. Version-selected keys (`brace-expansion@1`) and
 * parent-scoped nesting (`minimatch@3`) were both tried and both collapsed the
 * tree the same way.
 *
 * With no override, npm installs two copies — 1.1.18 under `minimatch@3`,
 * 5.0.9 under `minimatch@10` — and both consumers work. Those happen to be the
 * highest patched release of each line, so the floor the override existed to
 * enforce is what ordinary resolution already produces.
 *
 * The floor is therefore asserted against the lockfile rather than declared as
 * a pin: it is the resolved versions that were ever the point, and a pin is the
 * one way to get them wrong.
 */
const PATCHED_FLOOR_BY_MAJOR: Readonly<Record<number, string>> = {
  1: "1.1.18",
  2: "2.1.4",
  5: "5.0.9",
};

/** Governance templates that write override sections into every host. */
const GOVERNANCE_TEMPLATES = [
  "typescript/package-lisa/package.lisa.json",
  "expo/package-lisa/package.lisa.json",
] as const;

/** Sections an override is written into, in templates and manifests alike. */
const OVERRIDE_SECTIONS = ["overrides", "resolutions"] as const;

/** Audit exclusion files consumed by the pre-push gate, Lisa's and the host's. */
const AUDIT_IGNORE_FILES = [
  "audit.ignore.config.json",
  "typescript/copy-overwrite/audit.ignore.config.json",
] as const;

/** Prefix marking a resolved package version in bun.lock. */
const LOCK_VERSION_MARKER = '["brace-expansion@';

/** Dependency sections relevant to the brace-expansion contract. */
interface PackageManifest {
  readonly overrides?: Readonly<Record<string, unknown>>;
  readonly resolutions?: Readonly<Record<string, unknown>>;
}

/** Governance groups of a package.lisa.json. */
interface PackageLisaTemplate {
  readonly force?: PackageManifest;
  readonly defaults?: PackageManifest;
  readonly merge?: PackageManifest;
  readonly remove?: Readonly<Record<string, readonly string[]>>;
}

/** Shape of the audit exclusion files consumed by the pre-push hook. */
interface AuditIgnoreConfig {
  readonly exclusions: readonly {
    readonly id: string;
    readonly package?: string;
  }[];
}

/**
 * Read a repository JSON file.
 * @param relativePath - Path relative to the repository root
 * @returns Parsed JSON with the requested shape
 */
function readJson<T>(relativePath: string): T {
  return JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8")
  ) as T;
}

describe("brace-expansion security floor", () => {
  it.each(GOVERNANCE_TEMPLATES)("forces no tree-wide pin in %s", file => {
    const template = readJson<PackageLisaTemplate>(file);

    for (const group of ["force", "defaults", "merge"] as const) {
      for (const section of OVERRIDE_SECTIONS) {
        expect(template[group]?.[section]?.["brace-expansion"]).toBeUndefined();
      }
    }
  });

  it.each(GOVERNANCE_TEMPLATES)("retires the key from hosts in %s", file => {
    // Dropping the pin from `force` is not enough on its own. Every project
    // Lisa has already applied to carries `>=5.0.9` in its own package.json,
    // and the force merge preserves whichever side is higher — so the host's
    // copy of the bad pin would survive a template that simply stopped
    // mentioning it. `remove` is what deletes it from the host.
    const template = readJson<PackageLisaTemplate>(file);

    for (const section of OVERRIDE_SECTIONS) {
      expect(template.remove?.[section]).toContain("brace-expansion");
    }
  });

  it("declares no tree-wide pin in the repository's own manifest", () => {
    // Lisa is its own consumer: `@eslint/config-array` brings minimatch@3 into
    // this tree, and minimatch@10 is a direct dependency. Both live here.
    const manifest = readJson<PackageManifest>("package.json");

    for (const section of OVERRIDE_SECTIONS) {
      expect(manifest[section]?.["brace-expansion"]).toBeUndefined();
    }
  });

  it("resolves every locked copy above its own line's advisory floor", () => {
    const lockfile = fs.readFileSync(path.join(REPO_ROOT, "bun.lock"), "utf8");
    const versions = lockfile
      .split("\n")
      .filter(line => line.includes(LOCK_VERSION_MARKER))
      .map(line => {
        const start =
          line.indexOf(LOCK_VERSION_MARKER) + LOCK_VERSION_MARKER.length;
        return line.slice(start, line.indexOf('"', start));
      });

    expect(versions.length).toBeGreaterThan(0);
    for (const version of versions) {
      const floor = PATCHED_FLOOR_BY_MAJOR[major(version)];
      // A line with no patched release at all — 4.x, which the advisories
      // route to 5.x — must not appear in the tree.
      expect(floor).toBeDefined();
      expect(gte(version, floor)).toBe(true);
    }
  });

  it.each(AUDIT_IGNORE_FILES)("suppresses no advisory in %s", file => {
    // Every brace-expansion exclusion in this repository was an acceptance of
    // a DoS risk taken *because* the patched release on offer could not be
    // installed. Both resolved copies are now patched, so there is nothing
    // left to accept — and a suppression that outlives its reason is how the
    // next advisory goes unnoticed.
    const auditIgnores = readJson<AuditIgnoreConfig>(file);
    const suppressed = auditIgnores.exclusions.filter(
      exclusion => exclusion.package === "brace-expansion"
    );

    expect(suppressed).toEqual([]);
  });
});

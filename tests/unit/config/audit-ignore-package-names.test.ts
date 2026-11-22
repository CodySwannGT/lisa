/**
 * Every shipped exclusion names the package the way the audit reports it (#4521).
 *
 * The canonical matcher now enforces `package`: an exclusion whose `package` is
 * not the advisory's package name does not apply. A managed entry written as
 * `node-tar` (the repository name) or `jsPDF` (the display name) therefore stops
 * excusing the `tar` or `jspdf` advisory it was written for, and every host that
 * applied the managed file goes red. Package names are lowercase npm names, so
 * each shipped `package` must be one, and must not be a guessed alias of a
 * package the lockfile actually installs under another name.
 * @module tests/unit/config/audit-ignore-package-names
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { parse as parseJsonc } from "jsonc-parser";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

/** npm's package-name grammar: optional lowercase scope, lowercase name. */
const NPM_NAME = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/u;

/**
 * Repository or display names that are not the npm name an audit reports.
 * The lockfile check below only catches an alias of a package THIS repository
 * installs; these are the ones managed files are known to have carried.
 */
const KNOWN_WRONG_NAMES: Readonly<Record<string, string>> = {
  "node-tar": "tar",
  jsPDF: "jspdf",
};

/** Directories that never hold a shipped exclusion file. */
const SKIP = new Set([".git", "node_modules", "dist", "coverage", ".claude"]);

/**
 * Find every audit.ignore*.json under the repository's own source tree.
 * @param dir - Directory to scan
 * @returns Repository-relative paths
 */
function exclusionFiles(dir = ROOT): string[] {
  return readdirSync(dir).flatMap(name => {
    if (SKIP.has(name) || name === "tests") return [];
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return exclusionFiles(full);
    return /^audit\.ignore.*\.json$/u.test(name)
      ? [path.relative(ROOT, full)]
      : [];
  });
}

/**
 * Resolved package names installed by this repository's bun.lock.
 * @returns The set of real package names
 */
function lockedNames(): Set<string> {
  const lock = parseJsonc(
    readFileSync(path.join(ROOT, "bun.lock"), "utf8"),
    [],
    {
      allowTrailingComma: true,
    }
  ) as { packages: Record<string, unknown[]> };
  return new Set(
    Object.values(lock.packages).flatMap(tuple => {
      const identity = typeof tuple[0] === "string" ? tuple[0] : "";
      const at = identity.indexOf("@", identity.startsWith("@") ? 1 : 0);
      return at > 0 ? [identity.slice(0, at)] : [];
    })
  );
}

const FILES = exclusionFiles();
const LOCKED = lockedNames();

describe("shipped audit exclusions name real npm packages", () => {
  it("finds the managed and local exclusion files", () => {
    expect(FILES).toEqual(
      expect.arrayContaining([
        "audit.ignore.config.json",
        "audit.ignore.local.json",
        path.join("typescript", "copy-overwrite", "audit.ignore.config.json"),
      ])
    );
  });

  describe.each(FILES)("%s", file => {
    const entries =
      (
        JSON.parse(readFileSync(path.join(ROOT, file), "utf8")) as {
          exclusions?: { id: string; package?: unknown }[];
        }
      ).exclusions ?? [];

    it("holds an exclusions array", () => {
      expect(Array.isArray(entries)).toBe(true);
    });

    it.each(entries.filter(entry => entry.package !== undefined))(
      "$id names a valid lowercase npm package",
      entry => {
        expect(entry.package).toMatch(NPM_NAME);
      }
    );

    it.each(entries.filter(entry => typeof entry.package === "string"))(
      "$id is not a guessed alias of an installed package",
      entry => {
        const name = entry.package as string;
        const lower = name.toLowerCase();
        expect(KNOWN_WRONG_NAMES[name], name).toBeUndefined();
        // `jsPDF` for `jspdf`, `node-tar` for `tar`: the installed name wins.
        if (lower !== name) expect(LOCKED.has(lower)).toBe(false);
        if (name.startsWith("node-") && !LOCKED.has(name))
          expect(LOCKED.has(name.slice("node-".length)), name).toBe(false);
      }
    );
  });
});

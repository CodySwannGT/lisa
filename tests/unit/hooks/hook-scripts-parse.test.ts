/**
 * Every shipped shell guard and the enforcement fallback must parse.
 *
 * Written after breaking `scripts/lisa-enforcement-fallback.sh` with a doubled
 * backslash while adding a guard to its list. That script *is* the PreToolUse
 * hook, so the syntax error made every Bash, Edit and Write call fail —
 * including the ones that would have fixed it. Recovery needed a human running
 * `git checkout`.
 *
 * The same edit went into two more files. One was
 * `all/copy-overwrite/scripts/lisa-enforcement-fallback.sh` — the copy SHIPPED
 * to every consumer — which would have broken enforcement fleet-wide while
 * being invisible here, because the template is not the file this repository
 * executes.
 *
 * `bash -n` costs milliseconds and catches the whole class. Nothing else in the
 * suite parses these, because they are data to every TypeScript test that
 * mentions them.
 * @module tests/unit/hooks/hook-scripts-parse
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/** Absolute interpreter path; resolving `bash` through PATH is not permitted. */
const BASH = "/bin/bash";

/** Directories whose every `.sh` file must parse. */
const GUARD_DIRS = [
  "plugins/src/base/hooks",
  "src/codex/scripts",
  "all/copy-overwrite/scripts",
  "scripts",
];

/**
 * Every shell script under the audited directories.
 * @returns Repo-relative paths
 */
function shellScripts(): string[] {
  return GUARD_DIRS.flatMap(dir => {
    const absolute = path.join(REPO_ROOT, dir);
    if (!existsSync(absolute)) return [];
    return readdirSync(absolute)
      .filter(name => name.endsWith(".sh"))
      .map(name => path.posix.join(dir, name));
  });
}

const SCRIPTS = shellScripts();

describe("every shipped shell script parses", () => {
  it("finds scripts to check at all", () => {
    // The absent-case rule: a discovery bug would make the per-file assertions
    // pass by iterating nothing, which is exactly how a syntax error ships.
    expect(SCRIPTS.length).toBeGreaterThanOrEqual(20);
  });

  it.each(SCRIPTS)("%s is syntactically valid", script => {
    expect(() =>
      execFileSync(BASH, ["-n", path.join(REPO_ROOT, script)], {
        stdio: "pipe",
      })
    ).not.toThrow();
  });
});

describe("the enforcement fallback and its shipped twin stay in step", () => {
  // The repository copy is what this repo executes; the copy-overwrite copy is
  // what every consumer executes. An edit applied to one and not the other is
  // invisible until it reaches the fleet.
  const REPO_COPY = "scripts/lisa-enforcement-fallback.sh";
  const SHIPPED_COPY =
    "all/copy-overwrite/scripts/lisa-enforcement-fallback.sh";

  it("both exist", () => {
    expect(existsSync(path.join(REPO_ROOT, REPO_COPY))).toBe(true);
    expect(existsSync(path.join(REPO_ROOT, SHIPPED_COPY))).toBe(true);
  });

  it.each([REPO_COPY, SHIPPED_COPY])("%s runs every guard", copy => {
    // Named rather than counted: a guard dropped from one list and not the
    // other is the drift this pins, and the failure has to say which guard.
    const text = readFileSync(path.join(REPO_ROOT, copy), "utf8");
    for (const guard of [
      "block-no-verify",
      "parity-safety-net",
      "block-shell-json-parsing",
      "block-instruction-file-edits",
      "block-direct-issue-create",
      "block-managed-file-edits",
    ]) {
      expect(text).toContain(guard);
    }
  });
});

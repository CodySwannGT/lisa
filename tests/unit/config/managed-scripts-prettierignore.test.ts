/**
 * Every managed script Lisa ships into a host's `scripts/` is exempt from the
 * host's format gate.
 *
 * Lisa formats its scripts in Lisa's own Prettier style. Host projects run
 * varying Prettier configs, so a managed script fails their `prettier --check .`
 * through no fault of theirs — and reformatting it locally does not help: the
 * next `lisa apply` replaces the file, so host and Lisa reformat it against each
 * other forever.
 *
 * The exemption used to be one hand-added line, added when `lisa-mutation.mjs`
 * happened to bite someone. Measured 2026-08-19, **23 of the 24 shipped scripts
 * were uncovered**, and a consumer's version bump went red on
 * `scripts/check-e2e-coverage.mjs`.
 *
 * So the list is no longer maintained by incident. This test derives the shipped
 * set from the delivery directories and fails when one is missing, which means
 * adding a managed script and forgetting the exemption is caught here rather
 * than in somebody's pull request three weeks later.
 *
 * ## Why enumerated rather than globbed
 *
 * `scripts/check-*.mjs` would cover every shipped `check-` script in one line —
 * and would also silence a HOST's own `check-something.mjs`. A host file that
 * silently stops being formatted is a worse outcome than a managed file that
 * stays formatted, so the exemption names exactly what Lisa ships.
 * @module tests/unit/config/managed-scripts-prettierignore
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { trackedSet } from "../../helpers/tracked-files.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

const PRETTIERIGNORE = path.join(
  REPO_ROOT,
  "typescript",
  "copy-overwrite",
  ".prettierignore"
);

/**
 * The delivery directories that seed a host's `scripts/`.
 * @returns Repo-relative directory paths that exist.
 */
function scriptDirs(): string[] {
  return readdirSync(REPO_ROOT, { withFileTypes: true })
    .filter(stack => stack.isDirectory())
    .flatMap(stack =>
      ["copy-overwrite", "copy-contents"].map(
        lane => `${stack.name}/${lane}/scripts`
      )
    )
    .filter(dir => existsSync(path.join(REPO_ROOT, dir)));
}

/**
 * Every `.mjs` script any stack delivers into a host's `scripts/` directory.
 *
 * Walked from disk so a new stack lane is picked up with nobody editing this
 * file, then intersected with the git index so the walk decides what is a
 * CANDIDATE and the index decides what this gate is responsible for. An
 * untracked `.mjs` is delivered by nothing — it is in no commit, so no package
 * built from one can contain it — and before CodySwannGT/lisa#2824 one sitting
 * in a shared checkout failed this suite with a bare basename, which is even
 * less locatable than the relative path its sibling printed.
 * @returns Script basenames, sorted.
 */
function shippedScripts(): string[] {
  const tracked = trackedSet(REPO_ROOT);
  const found = scriptDirs().flatMap(dir =>
    readdirSync(path.join(REPO_ROOT, dir))
      .filter(entry => entry.endsWith(".mjs"))
      .filter(entry => tracked.has(`${dir}/${entry}`))
  );
  return [...new Set(found)].slice().sort((a, b) => a.localeCompare(b));
}

/**
 * The `scripts/` entries the shipped ignore file declares.
 * @returns Script basenames named by the ignore file.
 */
function ignoredScripts(): string[] {
  return readFileSync(PRETTIERIGNORE, "utf8")
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.startsWith("scripts/") && line.endsWith(".mjs"))
    .map(line => line.slice("scripts/".length));
}

describe("managed scripts are exempt from the host format gate", () => {
  it("finds the shipped scripts at all", () => {
    // The absent-case rule. Every assertion below is derived from this list, so
    // a discovery bug — a renamed delivery directory, a changed lane name —
    // would make them pass by comparing nothing to nothing. A green run that
    // measured zero scripts is the failure mode this suite exists to prevent.
    expect(shippedScripts().length).toBeGreaterThanOrEqual(20);
  });

  it("exempts every script Lisa ships into scripts/", () => {
    const ignored = new Set(ignoredScripts());
    const missing = shippedScripts().filter(name => !ignored.has(name));

    expect(missing).toEqual([]);
  });

  it("exempts nothing Lisa does not ship", () => {
    // The mirror, and not redundant: an exemption for a file Lisa no longer
    // ships silences a HOST file of that name. The list must shrink as well as
    // grow.
    const shipped = new Set(shippedScripts());
    const stale = ignoredScripts().filter(name => !shipped.has(name));

    expect(stale).toEqual([]);
  });
});

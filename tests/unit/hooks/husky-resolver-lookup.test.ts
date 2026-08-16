/**
 * Tests that the shipped git hooks find Lisa's scripts in the installed
 * package, not only in a copy inside the project.
 *
 * They resolved `scripts/<name>.mjs` and then `all/copy-overwrite/scripts/<name>.mjs`
 * — the second of which exists only inside Lisa itself. In a consumer with no
 * copy, neither path exists, the `[ -f ]` guard fails, and **the whole registry
 * handover is skipped**: the gates block governs nothing locally and the
 * built-in steps run instead.
 *
 * That is fail-safe (more checking, not less) and still wrong, because a
 * project that declared its gates has no way to tell they are being ignored.
 * Measured across the portfolio: three of four repositories have no copy at
 * all, and the fourth's copy was two releases stale.
 *
 * The same defect was fixed in `quality.yml`'s façade; these are the local
 * half of it.
 * @module tests/unit/hooks/husky-resolver-lookup
 */

import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const HOOKS = path.join(REPO_ROOT, "typescript", "copy-contents", ".husky");

/** The two Lisa scripts the shipped hooks invoke. */
const RUN_GATES = "lisa-run-gates.mjs";
const WORK_ITEM = "lisa-work-item.mjs";

/** Every shipped hook that resolves a Lisa script, and which one. */
const LOOKUPS = [
  { hook: "pre-commit", varName: "GATE_RUNNER", script: RUN_GATES },
  { hook: "pre-push", varName: "GATE_RUNNER", script: RUN_GATES },
  {
    hook: "pre-push",
    varName: "WORK_ITEM_SCRIPT",
    script: WORK_ITEM,
  },
  {
    hook: "prepare-commit-msg",
    varName: "WORK_ITEM_SCRIPT",
    script: WORK_ITEM,
  },
  {
    hook: "commit-msg",
    varName: "WORK_ITEM_SCRIPT",
    script: WORK_ITEM,
  },
] as const;

/**
 * Read one shipped hook.
 * @param hook - File name under the husky template directory.
 * @returns Its contents.
 */
const read = (hook: string): string =>
  readFileSync(path.join(HOOKS, hook), "utf8");

describe("the shipped hooks resolve Lisa scripts from the package", () => {
  it.each(LOOKUPS)(
    "$hook offers the installed package for $script",
    ({ hook, script }) => {
      expect(read(hook)).toContain(
        `node_modules/@codyswann/lisa/all/copy-overwrite/scripts/${script}`
      );
    }
  );

  it.each(LOOKUPS)(
    "$hook prefers the package over a copy in the project for $script",
    ({ hook, script }) => {
      // A copy can be edited once and then never receives a fix again, so the
      // installed package — one versioned copy — is tried first.
      const body = read(hook);
      const pkg = body.indexOf(
        `node_modules/@codyswann/lisa/all/copy-overwrite/scripts/${script}`
      );
      const copy = body.indexOf(`"scripts/${script}"`);
      expect(pkg).toBeGreaterThan(-1);
      expect(copy).toBeGreaterThan(-1);
      expect(pkg).toBeLessThan(copy);
    }
  );

  it.each(LOOKUPS)(
    "$hook still lets Lisa run its own hooks for $script",
    ({ hook, script }) => {
      // Last candidate, and the only one that resolves inside this repository,
      // where the package is not installed into itself.
      const body = read(hook);
      const own = body.indexOf(`"all/copy-overwrite/scripts/${script}"`);
      const copy = body.indexOf(`"scripts/${script}"`);
      expect(own).toBeGreaterThan(copy);
    }
  );
});

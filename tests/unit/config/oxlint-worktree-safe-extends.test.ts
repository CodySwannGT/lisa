/**
 * Regression guards for issue #2465 — oxlint `extends` must resolve in a git
 * worktree that has no worktree-local `node_modules`.
 *
 * oxlint resolves every `extends` entry as a plain path relative to the
 * directory of the config file that declares it. It performs no Node-style
 * upward module resolution, so a `./node_modules/...` entry is unresolvable in
 * any checkout without its own installed dependencies — most importantly a
 * fresh `git worktree`, where `node_modules` is untracked and therefore absent.
 * Because lint-staged runs `oxlint --fix` from the husky pre-commit hook, an
 * unresolvable entry blocks every commit in that worktree.
 *
 * The fix points `extends` at Lisa configs vendored into the repository itself,
 * under the `.lisa/lisa-oxlint/` namespace. Tracked files are checked out into
 * every worktree, so resolution no longer depends on an install.
 */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/** Stacks that ship a managed `.oxlintrc.json` merge template. */
const STACKS = [
  "typescript",
  "cdk",
  "expo",
  "nestjs",
  "phaser",
  "harper-fabric",
] as const;

/** Repository-relative directory holding the vendored Lisa oxlint configs. */
const VENDOR_DIR = ".lisa/lisa-oxlint";

/** Minimal shape of an oxlint config file. */
interface OxlintConfigLike {
  readonly extends?: readonly string[];
}

/**
 * Read a JSON template from the Lisa repository.
 * @param relativePath - Repo-relative JSON path
 * @returns Parsed template content
 */
function readJson(relativePath: string): OxlintConfigLike {
  return JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf-8")
  ) as OxlintConfigLike;
}

describe("oxlint stack templates resolve without node_modules (#2465)", () => {
  it.each(STACKS)(
    "%s/merge/.oxlintrc.json extends nothing under node_modules",
    stack => {
      const config = readJson(`${stack}/merge/.oxlintrc.json`);
      expect(config.extends ?? []).not.toContain(
        expect.stringContaining("node_modules")
      );
      for (const entry of config.extends ?? []) {
        expect(entry).not.toContain("node_modules");
      }
    }
  );

  it.each(STACKS)(
    "%s/merge/.oxlintrc.json extends the vendored Lisa config for its stack",
    stack => {
      const config = readJson(`${stack}/merge/.oxlintrc.json`);
      expect(config.extends).toEqual([`./${VENDOR_DIR}/${stack}.json`]);
    }
  );

  it.each(STACKS)(
    "the Lisa oxlint config backing %s exists and only extends siblings",
    stack => {
      // Vendoring copies `oxlint/*.json` verbatim, so the whole `extends`
      // chain must be sibling-relative for it to survive relocation.
      const seen = new Set<string>();
      const queue = [`${stack}.json`];
      while (queue.length > 0) {
        const name = queue.pop() as string;
        if (seen.has(name)) {
          continue;
        }
        seen.add(name);
        expect(fs.existsSync(path.join(REPO_ROOT, "oxlint", name))).toBe(true);
        for (const entry of readJson(`oxlint/${name}`).extends ?? []) {
          expect(entry).toMatch(/^\.\/[^/]+\.json$/);
          queue.push(entry.replace("./", ""));
        }
      }
      expect(seen.has("base.json")).toBe(true);
    }
  );
});

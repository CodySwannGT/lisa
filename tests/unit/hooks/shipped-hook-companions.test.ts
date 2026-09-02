/**
 * A shipped script must be shipped with the files it resolves beside itself.
 *
 * `parity-safety-net.sh` classifies a heredoc by handing the command to a
 * Python parser it finds as a SIBLING OF ITSELF:
 *
 *   hook_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
 *   heredoc_parser="$hook_dir/parity-safety-net-heredoc.py"
 *
 * Every plugin tree carried that parser. The `copy-overwrite` tree — the one a
 * host project actually receives — carried seven `.sh` files and nothing else,
 * because the build's mirror loop appends `.sh` to a roster of basenames and a
 * companion in another language could not get past that literal. The guard
 * fails closed, correctly, so the consequence in an applied host checkout was
 * that EVERY heredoc was blocked: not intermittently, not on machines missing
 * `python3`, and not fixable by installing anything (issue #3483).
 *
 * The general defect is a script resolving a companion the tree that ships it
 * does not include, so the check is a scan rather than an assertion about one
 * filename. It reads the reference back out of the shipped script, which is why
 * adding a companion to a guard and forgetting to ship it fails here instead of
 * being discovered downstream as a permanent block.
 *
 * A resolver with SEVERAL candidates is satisfied by any one of them — the
 * harper-fabric artifact guard looks for its glob list at the plugin root and
 * falls back to its own directory, and that shape is correct. What this file
 * refuses to let pass is a companion that exists at NONE of the places the
 * script looks.
 * @module tests/unit/hooks/shipped-hook-companions
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/**
 * Trees whose every shell script, at any depth, is audited.
 *
 * Every delivery channel Lisa has, because the defect is about a tree being
 * incomplete and no channel is exempt: the `copy-overwrite` lanes an apply
 * writes, the plugin trees an install unpacks, and the repository's own
 * `scripts/`.
 */
const AUDITED_TREES = [
  "all",
  "expo",
  "nestjs",
  "cdk",
  "rails",
  "typescript",
  "harper-fabric",
  "phaser",
  "plugins",
  "scripts",
  "src",
];

/** Directories never worth walking. */
const SKIP = new Set(["node_modules", "dist", "coverage", ".git"]);

/**
 * A variable assigned the script's own directory, in any spelling Lisa uses.
 *
 * Captures the variable name and the whole right-hand side, so the `/..`
 * segments that walk up out of the script's directory can be counted from it.
 */
const SELF_DIR =
  /^[ \t]*(?:export[ \t]+)?([A-Za-z_]\w*)=(.*\bdirname\b.*(?:BASH_SOURCE|\$0).*)$/gmu;

/** A `/..` segment, only where it ends the path component. */
const PARENT_STEP = /\/\.\.(?=["'/\s)]|$)/gu;

/**
 * Every shell script under the audited trees, recursively.
 * @param dir - Absolute directory to walk
 * @returns Absolute paths of `.sh` files
 */
function shellScripts(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.flatMap(name => {
    if (SKIP.has(name)) return [];
    const absolute = path.join(dir, name);
    if (statSync(absolute).isDirectory()) return shellScripts(absolute);
    return name.endsWith(".sh") ? [absolute] : [];
  });
}

const SCRIPTS = AUDITED_TREES.flatMap(tree =>
  shellScripts(path.join(REPO_ROOT, tree))
);

/** One companion a script names, and every directory it looks for it in. */
interface Companion {
  readonly file: string;
  readonly name: string;
  readonly candidates: readonly string[];
}

/**
 * The directories a script's own-directory variables point at.
 *
 * A variable can be assigned more than once — a `${CLAUDE_PLUGIN_ROOT:-…}`
 * default and a plain fallback are both real resolution paths — so every
 * assignment contributes a candidate rather than the last one winning.
 * @param file - Absolute path of the script
 * @param text - Its contents
 * @returns Variable name to the absolute directories it can hold
 */
function selfDirectories(file: string, text: string): Map<string, string[]> {
  const directories = new Map<string, string[]>();
  const base = path.dirname(file);
  for (const match of text.matchAll(SELF_DIR)) {
    const name = match[1];
    const rhs = match[2];
    if (name === undefined || rhs === undefined) continue;
    const tail = rhs.slice(rhs.lastIndexOf("dirname"));
    const ups = (tail.match(PARENT_STEP) ?? []).length;
    const directory = path.resolve(
      base,
      ...Array.from({ length: ups }, () => "..")
    );
    directories.set(name, [...(directories.get(name) ?? []), directory]);
  }
  return directories;
}

/**
 * Every companion file the audited scripts resolve relative to themselves.
 *
 * Only literal basenames count. `"$dir/$computed"` is not a name this can
 * check, and `"$dir/.."` is a directory rather than a companion — the
 * extension requirement excludes both.
 * @returns One entry per script-and-companion pair
 */
function companions(): Companion[] {
  return SCRIPTS.flatMap(absolute => {
    const text = readFileSync(absolute, "utf-8");
    const directories = selfDirectories(absolute, text);
    const byName = new Map<string, string[]>();
    for (const [variable, candidates] of directories) {
      const reference = new RegExp(
        `\\$(?:\\{${variable}\\}|${variable})/([A-Za-z0-9][A-Za-z0-9._-]*\\.[A-Za-z0-9]+)`,
        "gu"
      );
      for (const match of text.matchAll(reference)) {
        const name = match[1];
        if (name === undefined) continue;
        byName.set(name, [...(byName.get(name) ?? []), ...candidates]);
      }
    }
    return Array.from(byName, ([name, candidates]) => ({
      file: path.relative(REPO_ROOT, absolute),
      name,
      candidates,
    }));
  });
}

const COMPANIONS = companions();

describe("a shipped script's companions ship with it", () => {
  it("finds scripts and companion references to check at all", () => {
    // Without this the case below is vacuous: a walk that stopped working
    // reports zero unresolved companions, which reads exactly like a clean
    // sweep. Measured at 246 scripts and 86 companion references when this was
    // written; the floors sit well below that on purpose, because the point is
    // to catch a broken scan rather than to restate today's inventory.
    expect(SCRIPTS.length).toBeGreaterThan(50);
    expect(COMPANIONS.length).toBeGreaterThan(20);
  });

  it("resolves every companion in at least one directory it looks in", () => {
    const unresolved = COMPANIONS.filter(
      companion =>
        !companion.candidates.some(directory =>
          existsSync(path.join(directory, companion.name))
        )
    ).map(
      companion =>
        `${companion.file} -> ${companion.name} (looked in ${companion.candidates
          .map(directory => path.relative(REPO_ROOT, directory))
          .join(", ")})`
    );
    // Ship the companion into the same tree, or teach the build to. A guard
    // whose dependency is missing does not degrade — this one blocks every
    // heredoc a session writes, permanently, and says the wrong thing about why.
    expect(unresolved).toEqual([]);
  });

  it("ships the heredoc classifier into the tree a host project receives", () => {
    // The instance that cost the most, pinned by name so a mirror loop that
    // stops copying it cannot be green here.
    expect(
      existsSync(
        path.join(
          REPO_ROOT,
          "all",
          "copy-overwrite",
          "scripts",
          "lisa-hooks",
          "parity-safety-net-heredoc.py"
        )
      )
    ).toBe(true);
  });
});

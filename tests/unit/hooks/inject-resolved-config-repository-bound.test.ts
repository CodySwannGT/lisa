import { mkdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  hookRunner,
  MAIN_CONFIG,
  project,
  writeJson,
} from "../../helpers/inject-resolved-config-harness.js";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

/**
 * The walk-up that finds the config has to stop at the repository, and stop
 * only there.
 *
 * `.git`-presence is a proxy for "this is the work-tree root", and the two
 * answers part company on any layout that relocates the git directory —
 * `GIT_DIR`/`GIT_WORK_TREE` set explicitly being the ordinary way to get one.
 * On such a checkout the proxy never fires, the walk leaves the repository, and
 * the block renders a neighbouring project's configuration as if it were this
 * one. `git rev-parse --show-toplevel` is the authoritative answer and was
 * already being computed a few lines above the walk.
 *
 * The opposite failure is in here too: a fixed depth cap that terminates a
 * legitimate walk reports "No Lisa configuration found" for a repository that
 * has one, which is the loudest possible wrong answer in the one state this
 * hook exists to make loud.
 * @module tests/unit/hooks/inject-resolved-config-repository-bound
 */

/**
 * The inherited environment with every `GIT_*` variable removed.
 *
 * A suite that builds throwaway repositories cannot inherit the git variables
 * of whatever invoked it — a pre-commit hook exports `GIT_DIR` pointing at THIS
 * repository, and `git -C <fixture>` honours it over `-C`. Each case that wants
 * those variables sets them itself, so they mean the fixture and nothing else.
 */
const GIT_FREE_ENV: NodeJS.ProcessEnv = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_"))
);

const { contextFor } = hookRunner(GIT_FREE_ENV);

/** The rendered line a fixture config declares, proving the block rendered. */
const RENDERED_TRACKER = "tracker: github";

/** What the block prints when the walk found nothing. */
const NOTHING_FOUND = "No Lisa configuration found";

/**
 * Initialize a throwaway git repository.
 * @param dir - Directory to initialize, which must already exist
 */
function gitInit(dir: string): void {
  boundedSpawnSync({
    label: `git init ${dir}`,
    childMayExitBeforeReading: true,
    command: "git",
    args: ["-C", dir, "init", "-q"],
    env: GIT_FREE_ENV,
    input: "",
  });
}

/**
 * Relocate a repository's git directory away from its work-tree root.
 * @param repo - Work-tree root holding a `.git` directory
 * @returns The `GIT_DIR`/`GIT_WORK_TREE` pair naming the relocated layout
 */
function relocateGitDir(repo: string): NodeJS.ProcessEnv {
  const moved = path.join(repo, "git-directory");
  boundedSpawnSync({
    label: `relocate ${repo}/.git`,
    childMayExitBeforeReading: true,
    command: "mv",
    args: [path.join(repo, ".git"), moved],
    env: GIT_FREE_ENV,
    input: "",
  });
  return { GIT_DIR: moved, GIT_WORK_TREE: repo };
}

/**
 * Build a path a fixed number of directories below a root, creating it.
 * @param root - Existing directory to descend from
 * @param depth - How many directories to create below it
 * @returns Absolute path to the deepest directory
 */
function nest(root: string, depth: number): string {
  const leaf = path.join(
    root,
    ...Array.from({ length: depth }, (_, index) => `level${String(index)}`)
  );
  mkdirSync(leaf, { recursive: true });
  return leaf;
}

describe("inject-resolved-config: the walk-up stops at the repository", () => {
  it("reports nothing found when .git is not at the work-tree root", () => {
    const outer = project();
    writeJson(outer, MAIN_CONFIG, {
      tracker: "linear",
      deploy: { branches: { production: "main" } },
    });
    const repo = path.join(outer, "checkout");
    const subdirectory = path.join(repo, "packages", "service");
    mkdirSync(subdirectory, { recursive: true });
    gitInit(repo);
    const relocated = relocateGitDir(repo);
    const { contextFor: contextInRelocatedRepo } = hookRunner({
      ...GIT_FREE_ENV,
      ...relocated,
    });

    const context = contextInRelocatedRepo(subdirectory);

    expect(context).toContain(NOTHING_FOUND);
    expect(context).not.toContain("tracker: linear");
  });

  it("renders the repository's own config on the ordinary layout", () => {
    const outer = project();
    writeJson(outer, MAIN_CONFIG, {
      tracker: "linear",
      deploy: { branches: { production: "main" } },
    });
    const repo = path.join(outer, "checkout");
    const subdirectory = path.join(repo, "packages", "service");
    mkdirSync(subdirectory, { recursive: true });
    gitInit(repo);
    writeJson(repo, MAIN_CONFIG, {
      tracker: "github",
      deploy: { branches: { production: "main" } },
    });

    const context = contextFor(subdirectory);

    expect(context).toContain(RENDERED_TRACKER);
    expect(context).not.toContain("tracker: linear");
  });

  it("renders the repository's config from forty directories below it", () => {
    const root = project();
    gitInit(root);
    writeJson(root, MAIN_CONFIG, {
      tracker: "github",
      deploy: { branches: { production: "main" } },
    });

    const context = contextFor(nest(root, 40));

    expect(context).not.toContain(NOTHING_FOUND);
    expect(context).toContain(RENDERED_TRACKER);
  });
});

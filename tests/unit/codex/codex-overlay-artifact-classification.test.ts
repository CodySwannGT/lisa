/**
 * Every file the Codex overlay writes into this repository must be either
 * tracked or ignored — and the tracked ones must come back byte-identical.
 *
 * `lisa apply` writes its Codex overlay into every host it touches, and Lisa is
 * a host of itself. A file that is NEITHER tracked NOR ignored is the one shape
 * that lets `git add -A` after a build sweep a generated artifact into an
 * unrelated commit: nothing warns, nothing fails, and the file looks like
 * ordinary project config. `.codex/hooks.json` sat in that shape and rode into
 * #3700, where it had to be removed in two separate amends.
 *
 * That one file was settled by tracking it, and `codex-hooks-json-tracked`
 * pins the result. This suite pins the PROPERTY instead of the instance, so the
 * next artifact the overlay learns to write cannot repeat it:
 *
 *  1. Run the overlay into a virgin host and collect every path it writes.
 *  2. Classify each of those paths against THIS repository. Neither-tracked-
 *     nor-ignored fails.
 *  3. Seed a second host with this repository's committed bytes for the tracked
 *     ones, run the overlay again, and require every byte to survive.
 *
 * Step 3 is the other half of the same trap, and the half `.gitignore` cannot
 * answer. `.codex/config.toml` and `AGENTS.md` are tracked because they carry
 * host content, so ignoring them would strand real edits. Tracking them is only
 * safe while the writers are fixed points over their own output — a writer that
 * rewrote a marker on every run would leave every lane with a permanently dirty
 * tracked file and put that rewrite into whatever commit came next. Step 3
 * fails the moment a writer stops being a fixed point, which is where the
 * marker-rename diff of #3700 came from.
 *
 * The classifier's own reachability is asserted rather than assumed: an
 * unclassified path under `.codex/` really does classify as neither, so step 2
 * is not passing because both sets blanket the tree.
 *
 * SCOPE, stated rather than implied. This covers the Codex overlay only,
 * because `installCodexProjectOverlay` is the one agent surface whose entire
 * project-scoped output is reachable from a single call that writes nowhere but
 * the host directory it is handed. The sibling surfaces are installed piecewise
 * from the apply pipeline, so the same property over them needs the pipeline,
 * not this suite. Every one of their outputs is classified today — checked at
 * the time this was written — so what is missing is the gate, not the fix.
 * @module tests/unit/codex/codex-overlay-artifact-classification
 */
import * as fse from "fs-extra";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { installCodexProjectOverlay } from "../../../src/codex/project-overlay.js";
import type { ProjectType } from "../../../src/core/config.js";
import { createDetectorRegistry } from "../../../src/detection/index.js";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import { resolveGit } from "../../support/git-executable.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
/** Pinned git binary — resolving `git` via $PATH trips no-os-command-from-path. */
const GIT_BIN = resolveGit();

/**
 * A path under `.codex/` that this repository neither tracks nor ignores.
 *
 * The control for the classifier: if this one comes back classified, the
 * "nothing is unclassified" assertion below is measuring nothing.
 */
const UNCLASSIFIED_CONTROL = ".codex/unclassified-artifact.probe.json";

/**
 * List every file under `root`, as paths relative to `base`.
 * @param root Directory to descend into.
 * @param base Root the returned paths are relative to.
 * @returns Relative file paths, unordered.
 */
function walkFiles(root: string, base: string = root): readonly string[] {
  return fse.readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(root, entry.name);
    return entry.isDirectory()
      ? walkFiles(full, base)
      : [path.relative(base, full)];
  });
}

/**
 * Run one git query that reports a SUBSET of the paths it was handed.
 *
 * `ls-files` prints the tracked ones; `check-ignore` prints the ignored ones
 * and exits 1 when none match, which is why this uses `boundedSpawnSync` and
 * reads stdout rather than treating a non-zero exit as an error.
 * @param subcommand Git subcommand and its flags.
 * @param paths Repository-relative paths to classify.
 * @returns The subset git named back.
 */
function gitSubset(
  subcommand: readonly string[],
  paths: readonly string[]
): ReadonlySet<string> {
  const outcome = boundedSpawnSync({
    label: `git ${subcommand.join(" ")}`,
    command: GIT_BIN,
    args: [...subcommand, "--", ...paths],
    cwd: REPO_ROOT,
  });
  return new Set(
    outcome.stdout
      .split("\n")
      .map(line => line.trim())
      .filter(line => line.length > 0)
  );
}

/**
 * Read one path's committed bytes from `HEAD`.
 * @param relativePath Repository-relative path.
 * @returns The committed content.
 */
function committedBytes(relativePath: string): string {
  return boundedSpawnSync({
    label: `git show HEAD:${relativePath}`,
    command: GIT_BIN,
    args: ["show", `HEAD:${relativePath}`],
    cwd: REPO_ROOT,
    maxBuffer: 32 * 1024 * 1024,
  }).stdout;
}

/**
 * The project types this repository detects, as `lisa apply` computes them.
 * @returns Expanded, ordered detected types.
 */
async function detectedTypes(): Promise<readonly ProjectType[]> {
  const registry = createDetectorRegistry();
  return registry.expandAndOrderTypes(await registry.detectAll(REPO_ROOT));
}

/**
 * Install the overlay into a fresh scratch host and run `visit` against it.
 * @param seed Files to write into the host before the overlay runs.
 * @param visit Reads the installed host; its return value is passed through.
 * @returns Whatever `visit` returned.
 */
async function withOverlayHost<T>(
  seed: ReadonlyMap<string, string>,
  visit: (host: string) => T
): Promise<T> {
  const host = mkdtempSync(path.join(tmpdir(), "lisa-codex-overlay-"));
  try {
    for (const [relativePath, content] of seed) {
      mkdirSync(path.join(host, path.dirname(relativePath)), {
        recursive: true,
      });
      writeFileSync(path.join(host, relativePath), content, "utf8");
    }
    await installCodexProjectOverlay(REPO_ROOT, host, await detectedTypes());
    return visit(host);
  } finally {
    rmSync(host, { recursive: true, force: true });
  }
}

const EMPTY_SEED: ReadonlyMap<string, string> = new Map();

/**
 * Sort repository-relative paths for a stable, readable failure diff.
 * @param paths Paths to order.
 * @returns The same paths, alphabetically ordered.
 */
function sortedPaths(paths: readonly string[]): readonly string[] {
  return [...paths].sort((left, right) => left.localeCompare(right));
}

describe("what the Codex overlay writes into this repository", () => {
  it("classifies an unclassified .codex/ path as neither tracked nor ignored", () => {
    const probe = [UNCLASSIFIED_CONTROL];

    expect(gitSubset(["ls-files"], probe).has(UNCLASSIFIED_CONTROL)).toBe(
      false
    );
    expect(gitSubset(["check-ignore"], probe).has(UNCLASSIFIED_CONTROL)).toBe(
      false
    );
  });

  it("writes only paths this repository either tracks or ignores", async () => {
    const written = await withOverlayHost(EMPTY_SEED, host => walkFiles(host));
    const tracked = gitSubset(["ls-files"], written);
    const ignored = gitSubset(["check-ignore"], written);

    // Both populations must be non-empty, or one of the two queries answering
    // "everything" would pass this on its own.
    expect(tracked.size).toBeGreaterThan(0);
    expect(ignored.size).toBeGreaterThan(0);
    const unclassified = written.filter(
      rel => !tracked.has(rel) && !ignored.has(rel)
    );
    expect(sortedPaths(unclassified)).toEqual([]);
  });

  it("leaves every tracked file it rewrites byte-identical", async () => {
    const written = await withOverlayHost(EMPTY_SEED, host => walkFiles(host));
    const tracked = sortedPaths([...gitSubset(["ls-files"], written)]);
    expect(tracked.length).toBeGreaterThan(0);

    const seed: ReadonlyMap<string, string> = new Map(
      tracked.map(rel => [rel, committedBytes(rel)] as const)
    );
    const after = await withOverlayHost(
      seed,
      (host): ReadonlyMap<string, string> =>
        new Map(
          tracked.map(
            rel => [rel, readFileSync(path.join(host, rel), "utf8")] as const
          )
        )
    );

    for (const rel of tracked) expect(after.get(rel)).toBe(seed.get(rel));
  });
});

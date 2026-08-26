import * as fs from "fs-extra";
import * as path from "node:path";
import { devNull } from "node:os";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { createTempDir, cleanupTempDir } from "../../helpers/test-utils.js";
import {
  boundedExecFileSync,
  boundedSpawnSync,
} from "../../helpers/io-latency-budget.js";
import { resolveGit } from "../../support/git-executable.js";

/**
 * Agent worktree roots must be excluded from BOTH git and EAS build uploads.
 *
 * Two roots exist in practice — `.claude/worktrees/` and a bare `.worktrees/` —
 * and each worktree carries its own node_modules. Only the first was ever in
 * the shipped gitignore; the bare root survived on whatever a developer had
 * hand-added to the machine-local, uncommitted `.git/info/exclude`, so it was
 * invisible to every fresh clone AND to EAS. One host project measured 102G
 * across 39 such worktrees, which produced a 1.8 GB EAS upload archive that
 * failed metadata upload with a 400.
 *
 * The EAS half is what makes placement load-bearing: `pre-build:eas` derives
 * .easignore from THIS file, and everything below `### EASINCLUDE! ###` is
 * deliberately re-included. An entry that drifts below the marker still reads
 * as "worktrees are ignored" while shipping them in every build tarball.
 */

const GIT_BIN = resolveGit();
const CHECK_IGNORE = "check-ignore";
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const TEMPLATE_GITIGNORE = path.join(
  REPO_ROOT,
  "all",
  "copy-contents",
  "gitignore"
);
const EASIGNORE_EXTRA = path.join(
  REPO_ROOT,
  "expo",
  "copy-overwrite",
  ".easignore.extra"
);
const PACKAGE_LISA = path.join(
  REPO_ROOT,
  "expo",
  "package-lisa",
  "package.lisa.json"
);
const EASINCLUDE_MARKER = "### EASINCLUDE! ###";

/** Local evidence that must never enter a remote EAS upload. */
const LOCAL_EVIDENCE = ".lisa/tmpdir-growth.json";

/** Both the repo's own config and the copy shipped into host projects. */
const ESLINT_IGNORE_CONFIGS = [
  path.join(REPO_ROOT, "eslint.ignore.config.json"),
  path.join(
    REPO_ROOT,
    "typescript",
    "copy-overwrite",
    "eslint.ignore.config.json"
  ),
];

const WORKTREE_ROOTS = [".worktrees/", "**/.claude/worktrees/"];

const BARE_WORKTREE_FILE = ".worktrees/tun-401/node_modules/a.js";
const CLAUDE_WORKTREE_FILE = ".claude/worktrees/agent-abc/a.js";
const KEPT_CONFIG = "app.json";
const KEPT_SOURCE = "src/index.tsx";

/**
 * Build a git environment that cannot reach the real repository.
 *
 * git exports GIT_DIR / GIT_WORK_TREE / GIT_INDEX_FILE to every process it
 * spawns, and all of them outrank `cwd` — an inherited value would point
 * check-ignore at this repository and produce a vacuous pass against a fixture
 * that was never consulted.
 * @returns An environment scrubbed of repository-selecting git variables.
 */
function cleanGitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_CONFIG_GLOBAL: devNull,
    GIT_CONFIG_NOSYSTEM: "1",
  };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  delete env.GIT_PREFIX;
  return env;
}

/**
 * Reproduce what `pre-build:eas` writes: gitignore, then .easignore.extra.
 * @returns The exact bytes EAS would read as .easignore.
 */
function regeneratedEasignore(): string {
  return (
    fs.readFileSync(TEMPLATE_GITIGNORE, "utf8") +
    fs.readFileSync(EASIGNORE_EXTRA, "utf8")
  );
}

/**
 * Stand up a throwaway repository governed by `ignoreFile`, holding one file
 * under each worktree root plus two files that must survive.
 *
 * .easignore uses gitignore syntax, so a git checkout is a faithful stand-in
 * for what EAS packs.
 * @param dir Directory to initialize.
 * @param ignoreFile Contents to write as the repository's .gitignore.
 * @returns A predicate reporting whether git ignores a given path.
 */
async function seedFixture(
  dir: string,
  ignoreFile: string
): Promise<(target: string) => boolean> {
  await fs.outputFile(path.join(dir, ".gitignore"), ignoreFile);
  await fs.outputFile(path.join(dir, BARE_WORKTREE_FILE), "\n");
  await fs.outputFile(path.join(dir, CLAUDE_WORKTREE_FILE), "\n");
  await fs.outputFile(path.join(dir, KEPT_CONFIG), "{}\n");
  await fs.outputFile(path.join(dir, KEPT_SOURCE), "export {};\n");

  const env = cleanGitEnv();
  boundedExecFileSync({
    label: "git init",
    command: GIT_BIN,
    args: ["init", "-q"],
    cwd: dir,
    env,
  });

  return (target: string) =>
    boundedSpawnSync({
      label: `git check-ignore ${target}`,
      command: GIT_BIN,
      args: [CHECK_IGNORE, "-q", target],
      cwd: dir,
      env,
    }).status === 0;
}

describe("agent worktree roots are excluded from git and EAS", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it.each(WORKTREE_ROOTS)(
    "ships %s as an exact line in the gitignore template",
    entry => {
      const lines = fs.readFileSync(TEMPLATE_GITIGNORE, "utf8").split("\n");
      expect(lines).toContain(entry);
    }
  );

  it("keeps the temp-growth evidence ignored before EAS re-includes files", async () => {
    const lines = fs.readFileSync(TEMPLATE_GITIGNORE, "utf8").split("\n");
    const markerIndex = lines.findIndex(
      line => line.trim() === EASINCLUDE_MARKER
    );
    const ignoreIndex = lines.indexOf(LOCAL_EVIDENCE);

    expect(markerIndex).toBeGreaterThan(-1);
    expect(ignoreIndex).toBeGreaterThan(-1);
    expect(ignoreIndex).toBeLessThan(markerIndex);

    await fs.outputFile(path.join(tempDir, LOCAL_EVIDENCE), "{}\n");
    const ignored = await seedFixture(tempDir, regeneratedEasignore());
    expect(ignored(LOCAL_EVIDENCE)).toBe(true);
  });

  it.each(WORKTREE_ROOTS)(
    "keeps %s ABOVE the EASINCLUDE marker so EAS still ignores it",
    entry => {
      const lines = fs.readFileSync(TEMPLATE_GITIGNORE, "utf8").split("\n");
      // Exact match, not `includes` — prose ABOVE the real marker quotes the
      // marker text, and a substring search matches that comment first, which
      // reports a correctly-placed entry as misplaced.
      const markerIndex = lines.findIndex(
        line => line.trim() === EASINCLUDE_MARKER
      );
      expect(markerIndex).toBeGreaterThan(-1);
      expect(lines.indexOf(entry)).toBeGreaterThan(-1);
      expect(lines.indexOf(entry)).toBeLessThan(markerIndex);
    }
  );

  it("still derives .easignore from .gitignore, which is why placement matters", () => {
    const pkg = fs.readJsonSync(PACKAGE_LISA);
    const script = pkg.force?.scripts?.["pre-build:eas"];
    // If this shape changes, the above-the-marker requirement may no longer
    // hold and the placement assertions need to be re-derived, not deleted.
    expect(script).toContain("cat .gitignore > .easignore");
    expect(script).toContain("cat .easignore.extra >> .easignore");
  });

  it("excludes both worktree roots from a host project's git checkout", async () => {
    const ignored = await seedFixture(
      tempDir,
      fs.readFileSync(TEMPLATE_GITIGNORE, "utf8")
    );

    expect(ignored(BARE_WORKTREE_FILE)).toBe(true);
    expect(ignored(CLAUDE_WORKTREE_FILE)).toBe(true);
    // Guard against an over-broad pattern eating the actual project.
    expect(ignored(KEPT_CONFIG)).toBe(false);
    expect(ignored(KEPT_SOURCE)).toBe(false);

    const status = boundedExecFileSync({
      label: "git status --short",
      command: GIT_BIN,
      args: ["status", "--short", "--untracked-files=all"],
      cwd: tempDir,
      env: cleanGitEnv(),
    });
    expect(status).not.toContain(".worktrees/");
    expect(status).toContain(KEPT_CONFIG);
    expect(status).toContain(KEPT_SOURCE);
  });

  it("excludes both worktree roots from the REGENERATED .easignore", async () => {
    const ignored = await seedFixture(tempDir, regeneratedEasignore());

    expect(ignored(BARE_WORKTREE_FILE)).toBe(true);
    expect(ignored(CLAUDE_WORKTREE_FILE)).toBe(true);
    expect(ignored(KEPT_CONFIG)).toBe(false);
    expect(ignored(KEPT_SOURCE)).toBe(false);
  });

  it.each(ESLINT_IGNORE_CONFIGS)(
    "ignores both worktree roots in %s",
    configPath => {
      // Linting sibling worktrees from the primary checkout reports another
      // branch's in-flight code as errors, which fails the pre-push gate on
      // work the developer never touched. CI has no worktrees, so this is
      // invisible there — the local gate is the only place it shows up.
      const { ignores } = fs.readJsonSync(configPath);
      expect(ignores).toContain(".claude/worktrees/**");
      expect(ignores).toContain(".worktrees/**");
    }
  );
});

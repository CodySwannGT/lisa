/**
 * A throwaway stand-in for the canonical repository, for exercising the
 * public-commit refresh the way a release runs it (CodySwannGT/lisa#4960).
 *
 * `lisa file-upstream` accepts a commit reference only when it is on a list
 * built into the package, and that list is extended only by
 * `generate-upstream-evidence-manifest.mjs --refresh-public-commits`. Whether a
 * release really runs that refresh, really commits its output, and really
 * stops when the output is wrong cannot be read off a config string, so these
 * fixtures run it: the shipped scripts are copied byte for byte, the release
 * hook is the text from this repository's `.versionrc`, and the release tool is
 * the real `standard-version`.
 *
 * Nothing here touches a network. `origin` is a URL written into config so the
 * generator's canonical-repository guard passes, and "published" means a
 * remote-tracking ref was pointed at a commit by hand.
 * @module tests/helpers/upstream-commit-release-fixture
 */
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import type { SpawnSyncReturns } from "node:child_process";
import os from "node:os";
import path from "node:path";

import { cleanGitEnv, GIT_BIN } from "../support/git-executable.js";
import { boundedExecFileSync, boundedSpawnSync } from "./io-latency-budget.js";

const REPO_ROOT = path.resolve(__dirname, "../..");

/** The generated module, relative to a repository root. */
export const MANIFEST_PATH = "src/core/upstream-evidence-manifest.ts";

/** The generator, relative to a repository root. */
export const GENERATOR = "scripts/generate-upstream-evidence-manifest.mjs";

/** The flag that extends the public-commit list from git history. */
export const REFRESH_FLAG = "--refresh-public-commits";

/** A tracked file the manifest hash-pins, and one line it contains. */
export const EVIDENCE_FILE = "plugins/src/base/rules/scratch.md";
export const EVIDENCE_TEXT = "A scratch rule the fixture package ships.";

/** A tracked file whose bytes the manifest does not record. */
const UNPINNED_FILE = "README.md";

/** The origin URL the generator's canonical-repository guard accepts. */
export const CANONICAL_ORIGIN = "https://github.com/CodySwannGT/lisa.git";

/** The release tool's configuration file, relative to a repository root. */
const VERSION_CONFIG = ".versionrc";

/**
 * Release-hook steps the fixture leaves out.
 *
 * They build the plugin bundles and a version-bound certificate — real work a
 * scratch repository has no inputs for, and none of it reads or writes the
 * commit list. Every other step runs exactly as `.versionrc` spells it.
 */
const STEPS_NOT_RUN = Object.freeze([
  "bash scripts/build-plugins.sh",
  "node scripts/generate-nightly-e2e-guard-certificate.mjs",
]);

/**
 * Paths the hook's `git add` names besides the commit list. They have to exist
 * for the real `git add` to run; if the hook starts staging another path, add a
 * placeholder for it here.
 */
const STAGED_PLACEHOLDERS = Object.freeze([
  "plugins/lisa/plugin.json",
  "plugins/lisa-codex/plugin.json",
  "src/core/nightly-e2e-guard-behavior-certificate.ts",
]);

/** Source files that make the fixture a miniature of the published package. */
const PACKAGE_SOURCES = Object.freeze([
  "src/core/upstream-attribution-body.ts",
  "src/cli/file-upstream-cmd.ts",
]);

/** Hermetic child environment: no inherited git state, no developer config. */
const CHILD_ENV: NodeJS.ProcessEnv = {
  ...cleanGitEnv(),
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
};

/** The commits a fixture starts with, oldest first. */
export interface FixtureCommits {
  /** On the recorded list. */
  readonly first: string;
  /** On the recorded list. */
  readonly second: string;
  /** The commit that recorded the list, so it cannot be on it. */
  readonly recorded: string;
  /** Merged after the list was recorded: the checkout a release starts from. */
  readonly tip: string;
}

/** One scratch repository. */
export interface ReleaseFixture {
  readonly root: string;
  readonly commits: FixtureCommits;
}

/**
 * The release hook as this repository configures it.
 * @returns The `postbump` command, or an empty string when there is none
 */
export function configuredPostbump(): string {
  const config = JSON.parse(
    readFileSync(path.join(REPO_ROOT, VERSION_CONFIG), "utf8")
  ) as { readonly scripts?: Readonly<Record<string, string>> };
  return config.scripts?.postbump ?? "";
}

/**
 * The hook's steps, in order.
 * @param postbump - A `&&`-joined shell command
 * @returns Each step, trimmed
 */
export function hookSteps(postbump: string): readonly string[] {
  return postbump
    .split("&&")
    .map(step => step.trim())
    .filter(Boolean);
}

/**
 * Run git in a fixture and return what it printed.
 * @param cwd - Repository or worktree root
 * @param args - Git arguments
 * @returns Trimmed stdout
 */
export function git(cwd: string, ...args: readonly string[]): string {
  return boundedExecFileSync({
    label: `git ${args.join(" ")}`,
    command: GIT_BIN,
    args,
    cwd,
    env: CHILD_ENV,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

/**
 * Run a repository script with node, without throwing on a non-zero exit.
 * @param cwd - Repository or worktree root
 * @param args - Script path and its arguments
 * @returns The finished child
 */
export function runNode(
  cwd: string,
  ...args: readonly string[]
): SpawnSyncReturns<string> {
  return boundedSpawnSync({
    label: `node ${args.join(" ")}`,
    command: process.execPath,
    args,
    cwd,
    env: CHILD_ENV,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/**
 * Write a file under a fixture, creating its directory.
 * @param root - Fixture root
 * @param file - Path relative to the root
 * @param contents - Bytes to write
 */
function write(root: string, file: string, contents: string): void {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), contents);
}

/**
 * Change one tracked file whose bytes the manifest does not record, and commit.
 * @param root - Fixture root
 * @param subject - Commit subject
 * @returns The new commit's full SHA
 */
export function commitUnpinnedChange(root: string, subject: string): string {
  write(root, UNPINNED_FILE, `# Scratch\n\n${subject}\n`);
  git(root, "add", UNPINNED_FILE);
  git(root, "commit", "-m", subject);
  return git(root, "rev-parse", "HEAD");
}

/**
 * Point `origin/main` at a commit — the fixture's stand-in for a push.
 * @param root - Fixture root
 * @param commit - Commit the public default branch should name
 */
export function publish(root: string, commit: string): void {
  git(root, "update-ref", "refs/remotes/origin/main", commit);
}

/**
 * Copy the shipped scripts the hook runs, plus the library they import.
 * @param root - Fixture root
 * @param steps - Hook steps the fixture will run
 */
function copyShippedScripts(root: string, steps: readonly string[]): void {
  const named = steps
    .map(step => /^node (scripts\/[\w./-]+\.mjs)/u.exec(step)?.[1])
    .filter(script => script !== undefined);
  cpSync(path.join(REPO_ROOT, "scripts/lib"), path.join(root, "scripts/lib"), {
    recursive: true,
  });
  for (const script of new Set([GENERATOR, ...named])) {
    mkdirSync(path.dirname(path.join(root, script)), { recursive: true });
    cpSync(path.join(REPO_ROOT, script), path.join(root, script));
  }
}

/**
 * Write the fixture's files, make it a repository whose `origin` is the
 * canonical URL, and commit everything.
 * @param root - Empty directory to populate
 * @returns The first commit's full SHA
 */
function seedRepository(root: string): string {
  const steps = hookSteps(configuredPostbump()).filter(
    step => !STEPS_NOT_RUN.includes(step)
  );
  const versionConfig = JSON.parse(
    readFileSync(path.join(REPO_ROOT, VERSION_CONFIG), "utf8")
  ) as Record<string, unknown>;

  write(
    root,
    "package.json",
    `${JSON.stringify({ name: "@codyswann/lisa", version: "1.0.0" }, null, 2)}\n`
  );
  write(
    root,
    VERSION_CONFIG,
    `${JSON.stringify({ ...versionConfig, scripts: { postbump: steps.join(" && ") } }, null, 2)}\n`
  );
  write(root, UNPINNED_FILE, "# Scratch\n");
  // Tracked from the start, as it is in the real repository, so the release
  // tool rewriting it does not change which files the manifest records.
  write(root, "CHANGELOG.md", "# Changelog\n");
  write(root, EVIDENCE_FILE, `${EVIDENCE_TEXT}\n`);
  for (const placeholder of STAGED_PLACEHOLDERS) {
    write(root, placeholder, "export {};\n");
  }
  for (const source of PACKAGE_SOURCES) {
    mkdirSync(path.dirname(path.join(root, source)), { recursive: true });
    cpSync(path.join(REPO_ROOT, source), path.join(root, source));
  }
  copyShippedScripts(root, steps);

  git(root, "init", "--initial-branch=main");
  git(root, "config", "user.name", "Release Fixture");
  git(root, "config", "user.email", "release-fixture@example.invalid");
  git(root, "remote", "add", "origin", CANONICAL_ORIGIN);
  git(root, "add", "--all");
  git(root, "commit", "-m", "feat: first public commit");
  return git(root, "rev-parse", "HEAD");
}

/**
 * Publish a commit, record the public-commit list as of it, and commit the
 * list — which is why the recording commit is never on its own list.
 * @param root - Fixture root
 * @param published - Commit `origin/main` should name while recording
 * @returns The recording commit's full SHA
 */
function recordCommitList(root: string, published: string): string {
  publish(root, published);
  if (runNode(root, GENERATOR, REFRESH_FLAG).status !== 0) {
    throw new Error("Could not record the fixture's public-commit list");
  }
  git(root, "add", MANIFEST_PATH);
  git(root, "commit", "-m", "chore: record the public commit list");
  return git(root, "rev-parse", "HEAD");
}

/**
 * Build a scratch repository in the state every checkout is in between
 * releases: a recorded commit list, and newer public commits that are not on it.
 * @returns The fixture, positioned at `commits.tip` on `main`
 */
export function createReleaseFixture(): ReleaseFixture {
  const root = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "lisa-release-commit-list-"))
  );
  const first = seedRepository(root);
  const second = commitUnpinnedChange(root, "feat: second public commit");
  const recorded = recordCommitList(root, second);
  const tip = commitUnpinnedChange(root, "feat: merged after the list");
  publish(root, tip);
  return { root, commits: { first, second, recorded, tip } };
}

/**
 * Every full SHA in a generated module's public-commit block.
 *
 * Read with a pattern of this helper's own rather than the generator's parser,
 * so a test that asks "is this commit shipped" is not answered by the code
 * under test.
 * @param source - Contents of a generated manifest module
 * @returns Listed SHAs, in file order
 */
export function shippedCommits(source: string): readonly string[] {
  const start = source.indexOf("export const UPSTREAM_PUBLIC_COMMITS");
  return start === -1
    ? []
    : (source.slice(start).match(/\b[a-f0-9]{40}\b/gu) ?? []);
}

/**
 * The public commits the manifest in a working tree lists.
 * @param cwd - Repository or worktree root
 * @returns Listed SHAs
 */
export function listedCommits(cwd: string): readonly string[] {
  return shippedCommits(readFileSync(path.join(cwd, MANIFEST_PATH), "utf8"));
}

/**
 * Cut a release the way the release workflow does: the real `standard-version`
 * with the workflow's flags, which runs the `postbump` hook and then commits
 * every staged file. `--skip.tag` is the workflow's own flag; nothing is tagged
 * and nothing is pushed.
 *
 * `baseMs` is a liveness bound, not a performance claim: the run was measured
 * at about one second on a quiet machine with one vitest process.
 * @param cwd - Fixture root
 * @returns The finished release tool
 */
export function cutRelease(cwd: string): SpawnSyncReturns<string> {
  return boundedSpawnSync({
    label: "standard-version --release-as 1.1.0 --skip.tag",
    command: process.execPath,
    args: [
      path.join(REPO_ROOT, "node_modules/standard-version/bin/cli.js"),
      "--release-as",
      "1.1.0",
      "--skip.tag",
      "--releaseCommitMessageFormat",
      "chore(release): {{currentTag}} [skip ci] [skip-cd]",
    ],
    baseMs: 30_000,
    cwd,
    env: CHILD_ENV,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

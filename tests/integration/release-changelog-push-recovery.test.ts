import { execFileSync, spawnSync } from "node:child_process";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import * as fs from "fs-extra";
import yaml from "js-yaml";
import { afterEach, describe, expect, it } from "vitest";

// Derive the repo root from this test file's location so the test is portable
// across worktrees and CI working directories.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const RELEASE_YML = path.join(REPO_ROOT, ".github", "workflows", "release.yml");

/** Minimal shape of the parsed release workflow needed by these tests. */
interface ReleaseWorkflow {
  jobs: Record<
    string,
    { steps?: ReadonlyArray<{ name?: string; run?: string }> }
  >;
}

const RELEASE_VERSION = "2.0.0";
const CONCURRENT_VERSION = "1.0.1";
const BASE_VERSION = "1.0.0";

// Pinned binaries — resolving these via $PATH trips sonarjs/no-os-command-from-path.
const GIT_BIN = "/usr/bin/git";
const BASH_BIN = "/bin/bash";
const PACKAGE_JSON = "package.json";
const PLUGINS_DIR = "plugins";
const PLUGIN_NAME = "a";
/** Repo-relative path of the plugin manifest whose version line conflicts. */
const PLUGIN_MANIFEST_REL = path.join(PLUGINS_DIR, PLUGIN_NAME, "plugin.json");
/** Same path in git's forward-slash form for `git show`. */
const PLUGIN_MANIFEST_GIT = PLUGIN_MANIFEST_REL.split(path.sep).join("/");

// Hermetic git environment: pin config to /dev/null so the temp repos never
// read the developer's global/system git config, and never inherit ambient
// hooks. This keeps the reproduction deterministic under the full parallel
// suite (where global-config reads add file-descriptor pressure and variance).
const GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
};

/**
 * Extracts the real "Push Changelog Changes" step from release.yml and
 * substitutes the GitHub expression context this test drives it with, so the
 * assertions exercise exactly what the workflow ships instead of a copy that
 * can silently drift.
 * @returns The step's shell body with `${{ ... }}` expressions resolved.
 */
const loadPushScript = (): string => {
  const workflow = yaml.load(
    fs.readFileSync(RELEASE_YML, "utf8")
  ) as ReleaseWorkflow;
  const steps = workflow.jobs.version.steps ?? [];
  const run = steps.find(s => s.name === "Push Changelog Changes")?.run ?? "";
  if (!run) {
    throw new Error("Push Changelog Changes step not found in release.yml");
  }
  return run
    .replace(/\$\{\{\s*github\.ref_name\s*\}\}/g, "main")
    .replace(
      /\$\{\{\s*steps\.version\.outputs\.version\s*\}\}/g,
      RELEASE_VERSION
    );
};

// The buggy pre-fix loop, preserved verbatim as a control so the test proves
// the guard is what changed the outcome — a bare `git rebase` under
// `set -eo pipefail` dies on the first content conflict before any retry runs.
const PRE_FIX_SCRIPT = [
  "source ./release-logger.sh",
  'target_ref="main"',
  "for attempt in 1 2 3; do",
  '  git fetch origin "$target_ref"',
  '  git rebase "origin/$target_ref"',
  '  if git push origin "HEAD:$target_ref"; then',
  "    exit 0",
  "  fi",
  '  echo "::warning::pre-fix attempt $attempt failed"',
  "  git rebase --abort 2>/dev/null || true",
  "  sleep 1",
  "done",
  "exit 1",
].join("\n");

const runGit = (cwd: string, args: string[]): string =>
  execFileSync(GIT_BIN, args, { cwd, encoding: "utf8", env: GIT_ENV });

const writeJsonVersion = (file: string, version: string): void => {
  const parsed = fs.existsSync(file)
    ? (JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>)
    : {};
  parsed.version = version;
  fs.writeFileSync(file, `${JSON.stringify(parsed, null, 2)}\n`);
};

/** Handles to a reproduction repo, its PATH shim dir, and the restamp marker. */
interface ConflictRepo {
  root: string;
  workDir: string;
  originDir: string;
  binDir: string;
  markerFile: string;
}

/**
 * Builds a temp git topology that reproduces the release race: a working clone
 * holding the pre-stamped release commit (v2.0.0 on the plugin version line)
 * while `origin/main` has advanced with a concurrent merge that re-stamps the
 * same line (v1.0.1). Rebasing the release commit onto that tip conflicts on
 * the version line — the exact shape that killed run 29766412865.
 * @param failPush When true, installs a git shim that fails every push so the
 *   cap-exhaustion escalation path can be exercised.
 * @returns Handles to the temp repo, PATH shim dir, and recovery marker file.
 */
const buildConflictRepo = (failPush: boolean): ConflictRepo => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "release-push-repro-"));
  const originDir = path.join(root, "origin.git");
  const seedDir = path.join(root, "seed");
  const workDir = path.join(root, "work");
  const binDir = path.join(root, "bin");
  const markerFile = path.join(root, "restamp-marker.log");
  fs.ensureDirSync(binDir);

  runGit(root, ["init", "--bare", "-q", originDir]);

  // Seed origin/main with the shared base version on package.json and a plugin
  // manifest — the high-churn version line that conflicts.
  runGit(root, ["clone", "-q", originDir, seedDir]);
  runGit(seedDir, ["config", "user.email", "seed@example.com"]);
  runGit(seedDir, ["config", "user.name", "Seed"]);
  runGit(seedDir, ["checkout", "-q", "-b", "main"]);
  fs.ensureDirSync(path.join(seedDir, PLUGINS_DIR, PLUGIN_NAME));
  writeJsonVersion(path.join(seedDir, PACKAGE_JSON), BASE_VERSION);
  writeJsonVersion(path.join(seedDir, PLUGIN_MANIFEST_REL), BASE_VERSION);
  runGit(seedDir, ["add", "-A"]);
  runGit(seedDir, ["commit", "-q", "-m", "chore: seed base version"]);
  runGit(seedDir, ["push", "-q", "-u", "origin", "main"]);
  runGit(originDir, ["symbolic-ref", "HEAD", "refs/heads/main"]);

  // Working clone = the release job workspace. Stamp the release commit that
  // Generate Changelog would have produced (v2.0.0), but do NOT push it.
  runGit(root, ["clone", "-q", originDir, workDir]);
  runGit(workDir, ["config", "user.email", "release@example.com"]);
  runGit(workDir, ["config", "user.name", "Release"]);
  writeJsonVersion(path.join(workDir, PACKAGE_JSON), RELEASE_VERSION);
  writeJsonVersion(path.join(workDir, PLUGIN_MANIFEST_REL), RELEASE_VERSION);
  runGit(workDir, ["add", "-A"]);
  runGit(workDir, [
    "commit",
    "-q",
    "-m",
    `chore(release): v${RELEASE_VERSION} [skip ci]`,
  ]);

  // Concurrent merge lands on origin/main, re-stamping the same version line.
  writeJsonVersion(path.join(seedDir, PLUGIN_MANIFEST_REL), CONCURRENT_VERSION);
  writeJsonVersion(path.join(seedDir, PACKAGE_JSON), CONCURRENT_VERSION);
  runGit(seedDir, ["add", "-A"]);
  runGit(seedDir, ["commit", "-q", "-m", "chore: concurrent merge"]);
  runGit(seedDir, ["push", "-q", "origin", "main"]);

  // Stub release-logger.sh (sourced cwd-relative) with a no-op logger.
  fs.writeFileSync(
    path.join(workDir, "release-logger.sh"),
    'log_release_event() { echo "log_release_event $*"; }\n'
  );

  // PATH shims. `npx` stands in for standard-version's deterministic
  // `--release-as` re-stamp; `sleep` no-ops the backoff. The re-stamp uses
  // sed (not a spawned node) to keep the subprocess/FD footprint minimal under
  // the full parallel suite.
  fs.writeFileSync(
    path.join(binDir, "npx"),
    [
      "#!/usr/bin/env bash",
      'if [ "$1" != "standard-version" ]; then',
      '  echo "unexpected npx invocation: $*" >&2',
      "  exit 1",
      "fi",
      "shift",
      'ver=""',
      'while [ "$#" -gt 0 ]; do',
      '  if [ "$1" = "--release-as" ]; then ver="$2"; shift 2; else shift; fi',
      "done",
      'echo "$ver" >> "$REPRO_MARKER"',
      `for f in "${PACKAGE_JSON}" "${PLUGIN_MANIFEST_GIT}"; do`,
      `  sed -i.bak 's/"version": *"[^"]*"/"version": "'"$ver"'"/' "$f"`,
      '  rm -f "$f.bak"',
      "done",
      "git add -A",
      'git commit -q -m "chore(release): v$ver [skip ci]"',
      "exit 0",
    ].join("\n")
  );
  fs.writeFileSync(path.join(binDir, "sleep"), "#!/usr/bin/env bash\nexit 0\n");
  if (failPush) {
    // Force every push to fail so the cap-exhaustion escalation path is
    // exercised. Non-push git subcommands pass through to the real binary.
    fs.writeFileSync(
      path.join(binDir, "git"),
      [
        "#!/usr/bin/env bash",
        'if [ "$1" = "push" ]; then',
        '  echo "fatal: simulated push failure" >&2',
        "  exit 1",
        "fi",
        `exec ${GIT_BIN} "$@"`,
      ].join("\n")
    );
    fs.chmodSync(path.join(binDir, "git"), 0o700);
  }
  fs.chmodSync(path.join(binDir, "npx"), 0o700);
  fs.chmodSync(path.join(binDir, "sleep"), 0o700);

  return {
    root,
    workDir,
    originDir,
    binDir,
    markerFile,
  };
};

const runStep = (
  script: string,
  repo: ConflictRepo
): ReturnType<typeof spawnSync> => {
  const scriptFile = path.join(repo.workDir, "push-step.sh");
  fs.writeFileSync(scriptFile, script);
  return spawnSync(
    BASH_BIN,
    ["--noprofile", "--norc", "-eo", "pipefail", scriptFile],
    {
      cwd: repo.workDir,
      encoding: "utf8",
      env: {
        ...GIT_ENV,
        PATH: `${repo.binDir}:${process.env.PATH ?? ""}`,
        REPRO_MARKER: repo.markerFile,
      },
    }
  );
};

/**
 * Reads the plugin version line as origin/main currently records it.
 * @param repo The temp repo handles.
 * @returns The version string committed on origin/main.
 */
const originPluginVersion = (repo: ConflictRepo): string => {
  const blob = execFileSync(GIT_BIN, ["show", `main:${PLUGIN_MANIFEST_GIT}`], {
    cwd: repo.originDir,
    encoding: "utf8",
    env: GIT_ENV,
  });
  return (JSON.parse(blob) as { version: string }).version;
};

describe("release changelog push recovery", () => {
  let repos: ConflictRepo[] = [];

  const track = (repo: ConflictRepo): ConflictRepo => {
    repos.push(repo);
    return repo;
  };

  afterEach(() => {
    for (const repo of repos) {
      fs.removeSync(repo.root);
    }
    repos = [];
  });

  it("pre-fix loop dies at the first rebase conflict without retrying", () => {
    const repo = track(buildConflictRepo(false));
    const result = runStep(PRE_FIX_SCRIPT, repo);

    // `set -e` kills the step at the failing rebase: non-zero exit, no push,
    // and the retry warning never printed.
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).not.toContain(
      "pre-fix attempt 2 failed"
    );
    expect(originPluginVersion(repo)).toBe(CONCURRENT_VERSION);
  });

  it("recovers a version-line conflict by re-stamping the fresh tip", () => {
    const repo = track(buildConflictRepo(false));
    const result = runStep(loadPushScript(), repo);

    // The guarded rebase does not exit the step; recovery resets to the fresh
    // origin tip, re-stamps the pinned version, and pushes a clean release.
    expect(result.status).toBe(0);
    expect(originPluginVersion(repo)).toBe(RELEASE_VERSION);
    // Proof the recovery path ran (the re-stamp shim was invoked).
    expect(fs.readFileSync(repo.markerFile, "utf8")).toContain(RELEASE_VERSION);
    // The pushed tip carries no unresolved conflict markers.
    const pushed = execFileSync(
      GIT_BIN,
      ["show", `main:${PLUGIN_MANIFEST_GIT}`],
      {
        cwd: repo.originDir,
        encoding: "utf8",
        env: GIT_ENV,
      }
    );
    expect(pushed).not.toContain("<<<<<<<");
  });

  it("fails loudly when the retry cap is exhausted", () => {
    const repo = track(buildConflictRepo(true));
    const result = runStep(loadPushScript(), repo);

    // The escalation path (deploy-autofix ticket) depends on a loud non-zero
    // exit once the bounded retries are spent.
    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toContain(
      "Changelog push failed after bounded retries"
    );
    // Nothing was ever pushed: origin/main still holds the concurrent version.
    expect(originPluginVersion(repo)).toBe(CONCURRENT_VERSION);
  });
});

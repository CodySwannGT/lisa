import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  boundedExecFileSync,
  boundedSpawnSync,
} from "../../helpers/io-latency-budget.js";
import { cleanGitEnv } from "../../helpers/test-utils.js";
import { resolveGit } from "../../support/git-executable.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SETTINGS_SCRIPT_NAME = "lisa-github-repo-settings.sh";
const SETTINGS_SCRIPT = path.join(REPO_ROOT, "scripts", SETTINGS_SCRIPT_NAME);
const BASH_BIN = "/bin/bash";
const GIT_BIN = resolveGit();
const REPO_NAME = "CodySwannGT/lisa";

/**
 * Creates a git project directory for the settings script to inspect.
 *
 * @returns Temporary project directory path.
 */
function createProject(): string {
  const projectDir = mkdtempSync(path.join(tmpdir(), "lisa-settings-"));
  boundedExecFileSync({
    label: "git init",
    command: GIT_BIN,
    args: ["init"],
    cwd: projectDir,
    stdio: "ignore",
    env: cleanGitEnv(process.env),
  });
  return projectDir;
}

/**
 * Creates a mock gh executable for the settings script.
 *
 * @param existingBranches - Branch names the mock reports as existing.
 * @returns Temporary bin directory containing the mock gh executable.
 */
function createMockGhBin(
  existingBranches: readonly string[] = ["main"]
): string {
  const binDir = mkdtempSync(path.join(tmpdir(), "lisa-gh-bin-"));
  const ghPath = path.join(binDir, "gh");
  writeFileSync(
    ghPath,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      'if [[ "$1 $2" == "auth status" ]]; then',
      "  exit 0",
      "fi",
      'if [[ "$1 $2" == "repo view" ]]; then',
      `  echo "${REPO_NAME}"`,
      "  exit 0",
      "fi",
      'if [[ "$1" == "api" && "$2" == repos/*/branches/* ]]; then',
      '  branch="${2##*/}"',
      `  case "$branch" in ${existingBranches.join("|")}) exit 0 ;; esac`,
      "  exit 1",
      "fi",
      'echo "unexpected gh invocation: $*" >&2',
      "exit 1",
      "",
    ].join("\n"),
    { mode: 0o755 }
  );
  return binDir;
}

/**
 * Creates a mock gh that accepts the apply-mode calls and records every
 * invocation, one per line, so a test can prove which writes were made.
 *
 * @param topicEditExitCode - Exit code the mock returns for `gh repo edit`.
 * @returns The bin directory and the path of the call log.
 */
function createRecordingGhBin(topicEditExitCode = 0): {
  readonly binDir: string;
  readonly callLog: string;
} {
  const binDir = mkdtempSync(path.join(tmpdir(), "lisa-gh-bin-"));
  const callLog = path.join(binDir, "calls.log");
  writeFileSync(callLog, "");
  writeFileSync(
    path.join(binDir, "gh"),
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      `echo "$*" >> "${callLog}"`,
      'if [[ "$1 $2" == "auth status" ]]; then exit 0; fi',
      'if [[ "$1 $2" == "repo view" ]]; then',
      `  echo "${REPO_NAME}"`,
      "  exit 0",
      "fi",
      'if [[ "$1" == "api" && "$2" == repos/*/branches/* ]]; then exit 0; fi',
      'if [[ "$1 $2 $3" == "api -X PATCH" ]]; then cat > /dev/null; exit 0; fi',
      `if [[ "$1 $2" == "repo edit" ]]; then exit ${topicEditExitCode}; fi`,
      'echo "unexpected gh invocation: $*" >&2',
      "exit 1",
      "",
    ].join("\n"),
    { mode: 0o755 }
  );
  return { binDir, callLog };
}

/**
 * Runs the settings script in apply mode with a mock gh on PATH.
 *
 * @param projectDir - Project directory to point the script at.
 * @param ghBin - Directory containing the mock gh executable.
 * @returns Exit status and captured stdout.
 */
function runSettingsApply(
  projectDir: string,
  ghBin: string
): { readonly status: number | null; readonly stdout: string } {
  const shimmedPath = [ghBin, process.env.PATH ?? ""].join(":");
  const result = boundedSpawnSync({
    label: SETTINGS_SCRIPT_NAME,
    command: BASH_BIN,
    args: [SETTINGS_SCRIPT, projectDir],
    cwd: REPO_ROOT,
    env: cleanGitEnv(process.env, { PATH: shimmedPath }),
  });
  return { status: result.status, stdout: result.stdout };
}

/**
 * Runs the settings script in dry-run mode with a mock gh on PATH.
 *
 * @param projectDir - Project directory to point the script at.
 * @param ghBin - Directory containing the mock gh executable.
 * @returns Captured stdout from the script.
 */
function runSettingsDryRun(projectDir: string, ghBin: string): string {
  const shimmedPath = [ghBin, process.env.PATH ?? ""].join(":");
  const result = boundedSpawnSync({
    label: "lisa-github-repo-settings.sh --dry-run",
    command: BASH_BIN,
    args: [SETTINGS_SCRIPT, "--dry-run", projectDir],
    cwd: REPO_ROOT,
    env: cleanGitEnv(process.env, { PATH: shimmedPath }),
  });
  expect(result.status).toBe(0);
  return result.stdout;
}

describe(SETTINGS_SCRIPT_NAME, () => {
  it("applies the merge-only baseline in dry-run", () => {
    const projectDir = createProject();
    const ghBin = createMockGhBin();

    try {
      const stdout = runSettingsDryRun(projectDir, ghBin);
      expect(stdout).toContain('"allow_squash_merge": false');
      expect(stdout).toContain('"allow_rebase_merge": false');
      expect(stdout).toContain('"allow_auto_merge": true');
      expect(stdout).toContain('"delete_branch_on_merge": true');
      expect(stdout).toContain('"allow_update_branch": true');
      expect(stdout).toContain('"default_branch": "main"');
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(ghBin, { recursive: true, force: true });
    }
  });

  it("defaults the default branch to the lowest-tier environment branch", () => {
    const projectDir = createProject();
    const ghBin = createMockGhBin(["dev", "staging", "main"]);

    try {
      const stdout = runSettingsDryRun(projectDir, ghBin);
      expect(stdout).toContain('"default_branch": "dev"');
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(ghBin, { recursive: true, force: true });
    }
  });

  it("prefers staging when dev does not exist", () => {
    const projectDir = createProject();
    const ghBin = createMockGhBin(["staging", "main"]);

    try {
      const stdout = runSettingsDryRun(projectDir, ghBin);
      expect(stdout).toContain('"default_branch": "staging"');
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(ghBin, { recursive: true, force: true });
    }
  });

  it("lets .lisa.config.json override the resolved default branch", () => {
    const projectDir = createProject();
    const ghBin = createMockGhBin(["dev", "staging", "main"]);

    try {
      writeFileSync(
        path.join(projectDir, ".lisa.config.json"),
        JSON.stringify({ github: { settings: { default_branch: "main" } } })
      );
      const stdout = runSettingsDryRun(projectDir, ghBin);
      expect(stdout).toContain('"default_branch": "main"');
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(ghBin, { recursive: true, force: true });
    }
  });

  it("announces the lisa-managed topic in dry-run without editing the repo", () => {
    const projectDir = createProject();
    const { binDir, callLog } = createRecordingGhBin();

    try {
      const stdout = runSettingsDryRun(projectDir, binDir);
      expect(stdout).toContain("Would add the lisa-managed repository topic");
      expect(readFileSync(callLog, "utf8")).not.toContain("repo edit");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(binDir, { recursive: true, force: true });
    }
  });

  it("tags the repository with the lisa-managed topic on apply", () => {
    const projectDir = createProject();
    const { binDir, callLog } = createRecordingGhBin();

    try {
      const { status, stdout } = runSettingsApply(projectDir, binDir);
      expect(status).toBe(0);
      expect(readFileSync(callLog, "utf8")).toContain(
        `repo edit ${REPO_NAME} --add-topic lisa-managed`
      );
      expect(stdout).toContain("Tagged repository with the lisa-managed topic");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(binDir, { recursive: true, force: true });
    }
  });

  it("warns but still succeeds when the topic edit is refused", () => {
    const projectDir = createProject();
    const { binDir } = createRecordingGhBin(1);

    try {
      const { status, stdout } = runSettingsApply(projectDir, binDir);
      expect(status).toBe(0);
      expect(stdout).toContain("Applied repository settings");
      expect(stdout).toContain("Could not add the lisa-managed topic");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(binDir, { recursive: true, force: true });
    }
  });

  it("honors per-repo overrides from .lisa.config.json github.settings", () => {
    const projectDir = createProject();
    const ghBin = createMockGhBin();

    try {
      writeFileSync(
        path.join(projectDir, ".lisa.config.json"),
        JSON.stringify({ github: { settings: { allow_auto_merge: false } } })
      );
      const stdout = runSettingsDryRun(projectDir, ghBin);
      expect(stdout).toContain('"allow_auto_merge": false');
      expect(stdout).toContain('"allow_squash_merge": false');
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(ghBin, { recursive: true, force: true });
    }
  });
});

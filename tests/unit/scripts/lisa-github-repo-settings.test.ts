import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { cleanGitEnv } from "../../helpers/test-utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SETTINGS_SCRIPT = path.join(
  REPO_ROOT,
  "scripts",
  "lisa-github-repo-settings.sh"
);
const BASH_BIN = "/bin/bash";
const GIT_BIN = "/usr/bin/git";
const REPO_NAME = "CodySwannGT/lisa";

/**
 * Creates a git project directory for the settings script to inspect.
 *
 * @returns Temporary project directory path.
 */
function createProject(): string {
  const projectDir = mkdtempSync(path.join(tmpdir(), "lisa-settings-"));
  execFileSync(GIT_BIN, ["init"], {
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
 * Runs the settings script in dry-run mode with a mock gh on PATH.
 *
 * @param projectDir - Project directory to point the script at.
 * @param ghBin - Directory containing the mock gh executable.
 * @returns Captured stdout from the script.
 */
function runSettingsDryRun(projectDir: string, ghBin: string): string {
  const shimmedPath = [ghBin, process.env.PATH ?? ""].join(":");
  const result = spawnSync(
    BASH_BIN,
    [SETTINGS_SCRIPT, "--dry-run", projectDir],
    {
      cwd: REPO_ROOT,
      env: cleanGitEnv(process.env, { PATH: shimmedPath }),
      encoding: "utf8",
    }
  );
  expect(result.status).toBe(0);
  return result.stdout;
}

describe("lisa-github-repo-settings.sh", () => {
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

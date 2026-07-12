import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const ENVIRONMENTS_SCRIPT = path.join(
  REPO_ROOT,
  "scripts",
  "lisa-github-environments.sh"
);
const BASH_BIN = "/bin/bash";
const GIT_BIN = "/usr/bin/git";
const REPO_NAME = "CodySwannGT/lisa";
const USER_REVIEWER_ID = 1001;
const TEAM_REVIEWER_ID = 2002;
const CONFIG_FILE = ".lisa.config.json";

/**
 * Writes a .lisa.config.json into the project directory.
 *
 * @param projectDir - Project directory to write the config into.
 * @param config - Config value to serialize, or a raw string to write as-is.
 */
function writeConfig(projectDir: string, config: object | string): void {
  writeFileSync(
    path.join(projectDir, CONFIG_FILE),
    typeof config === "string" ? config : JSON.stringify(config)
  );
}

/**
 * Creates a git project directory for the environments script to inspect.
 *
 * @returns Temporary project directory path.
 */
function createProject(): string {
  const projectDir = mkdtempSync(path.join(tmpdir(), "lisa-environments-"));
  execFileSync(GIT_BIN, ["init"], { cwd: projectDir, stdio: "ignore" });
  return projectDir;
}

/**
 * Creates a mock gh executable for the environments script. Resolves any
 * user reviewer to a fixed id except "ghost", which fails like an unknown
 * login, and any org team slug to a fixed team id.
 *
 * @returns Temporary bin directory containing the mock gh executable.
 */
function createMockGhBin(): string {
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
      'if [[ "$1" == "api" && "$2" == users/* ]]; then',
      '  case "${2#users/}" in ghost) exit 1 ;; esac',
      `  echo "${USER_REVIEWER_ID}"`,
      "  exit 0",
      "fi",
      'if [[ "$1" == "api" && "$2" == orgs/*/teams/* ]]; then',
      `  echo "${TEAM_REVIEWER_ID}"`,
      "  exit 0",
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
 * Runs the environments script in dry-run mode with a mock gh on PATH.
 *
 * @param projectDir - Project directory to point the script at.
 * @param ghBin - Directory containing the mock gh executable.
 * @returns Captured stdout, stderr, and exit status from the script.
 */
function runEnvironmentsDryRun(
  projectDir: string,
  ghBin: string
): {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
} {
  const shimmedPath = [ghBin, process.env.PATH ?? ""].join(":");
  const result = spawnSync(
    BASH_BIN,
    [ENVIRONMENTS_SCRIPT, "--dry-run", projectDir],
    {
      cwd: REPO_ROOT,
      env: { ...process.env, PATH: shimmedPath },
      encoding: "utf8",
    }
  );
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

describe("lisa-github-environments.sh", () => {
  it("skips silently when no github.environments block is configured", () => {
    const projectDir = createProject();
    const ghBin = createMockGhBin();

    try {
      const { status, stdout } = runEnvironmentsDryRun(projectDir, ghBin);
      expect(status).toBe(0);
      expect(stdout).toContain("No github.environments configured");
      expect(stdout).not.toContain("Would provision environment");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(ghBin, { recursive: true, force: true });
    }
  });

  it("provisions reviewers, self-review protection, and a branch policy", () => {
    const projectDir = createProject();
    const ghBin = createMockGhBin();

    try {
      writeConfig(projectDir, {
        github: {
          environments: {
            production: {
              branch: "main",
              require_approval: true,
              reviewers: ["some-user", "some-org/some-team"],
              prevent_self_review: true,
              wait_timer: 5,
            },
          },
        },
      });
      const { status, stdout } = runEnvironmentsDryRun(projectDir, ghBin);
      expect(status).toBe(0);
      expect(stdout).toContain(
        "Would provision environment 'production' (branch: main)"
      );
      expect(stdout).toContain(`"id": ${USER_REVIEWER_ID}`);
      expect(stdout).toContain(`"id": ${TEAM_REVIEWER_ID}`);
      expect(stdout).toContain('"type": "User"');
      expect(stdout).toContain('"type": "Team"');
      expect(stdout).toContain('"prevent_self_review": true');
      expect(stdout).toContain('"wait_timer": 5');
      expect(stdout).toContain('"custom_branch_policies": true');
      expect(stdout).toContain(
        "Would pin deployment branch policy 'main' on 'production'"
      );
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(ghBin, { recursive: true, force: true });
    }
  });

  it("resolves the branch from deploy.branches when the environment has none", () => {
    const projectDir = createProject();
    const ghBin = createMockGhBin();

    try {
      writeConfig(projectDir, {
        github: { environments: { production: {} } },
        deploy: { branches: { production: "main" } },
      });
      const { status, stdout } = runEnvironmentsDryRun(projectDir, ghBin);
      expect(status).toBe(0);
      expect(stdout).toContain(
        "Would provision environment 'production' (branch: main)"
      );
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(ghBin, { recursive: true, force: true });
    }
  });

  it("prefers an explicit branch over deploy.branches and falls back to the name", () => {
    const projectDir = createProject();
    const ghBin = createMockGhBin();

    try {
      writeConfig(projectDir, {
        github: {
          environments: {
            production: { branch: "release" },
            staging: {},
          },
        },
        deploy: { branches: { production: "main" } },
      });
      const { status, stdout } = runEnvironmentsDryRun(projectDir, ghBin);
      expect(status).toBe(0);
      expect(stdout).toContain(
        "Would provision environment 'production' (branch: release)"
      );
      expect(stdout).toContain(
        "Would provision environment 'staging' (branch: staging)"
      );
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(ghBin, { recursive: true, force: true });
    }
  });

  it("refuses require_approval without reviewers", () => {
    const projectDir = createProject();
    const ghBin = createMockGhBin();

    try {
      writeConfig(projectDir, {
        github: {
          environments: { production: { require_approval: true } },
        },
      });
      const { status, stderr } = runEnvironmentsDryRun(projectDir, ghBin);
      expect(status).toBe(1);
      expect(stderr).toContain("require_approval: true but no reviewers");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(ghBin, { recursive: true, force: true });
    }
  });

  it("fails with a named reviewer when a login cannot be resolved", () => {
    const projectDir = createProject();
    const ghBin = createMockGhBin();

    try {
      writeConfig(projectDir, {
        github: {
          environments: {
            production: { require_approval: true, reviewers: ["ghost"] },
          },
        },
      });
      const { status, stderr } = runEnvironmentsDryRun(projectDir, ghBin);
      expect(status).toBe(1);
      expect(stderr).toContain("Could not resolve user reviewer 'ghost'");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(ghBin, { recursive: true, force: true });
    }
  });

  it("treats a malformed .lisa.config.json as no configuration", () => {
    const projectDir = createProject();
    const ghBin = createMockGhBin();

    try {
      writeConfig(projectDir, "{not json");
      const { status, stdout, stderr } = runEnvironmentsDryRun(
        projectDir,
        ghBin
      );
      expect(status).toBe(0);
      expect(stdout).toContain("No github.environments configured");
      expect(stderr).toContain("could not be parsed");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(ghBin, { recursive: true, force: true });
    }
  });
});

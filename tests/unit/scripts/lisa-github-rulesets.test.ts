import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SCRIPT_NAME = "lisa-github-rulesets.sh";
const SCRIPT_PATH = path.join(REPO_ROOT, "scripts", SCRIPT_NAME);
const BASH_BIN = "/bin/bash";
const GIT_BIN = "/usr/bin/git";
const REPO_NAME = "CodySwannGT/lisa";
const ACTIVE_ENFORCEMENT = "active";

/**
 * Creates a minimal git project that the ruleset script can inspect.
 *
 * @returns Temporary project directory path.
 */
function createProject(): string {
  const projectDir = mkdtempSync(path.join(tmpdir(), "lisa-rulesets-"));
  execFileSync(GIT_BIN, ["init"], { cwd: projectDir, stdio: "ignore" });
  writeFileSync(path.join(projectDir, "tsconfig.json"), "{}\n");
  return projectDir;
}

/**
 * Creates a mock gh executable that returns deterministic ruleset responses.
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
      `if [[ "$1" == "api" && "$2" == "repos/${REPO_NAME}/rulesets" ]]; then`,
      '  echo "[]"',
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
 * Creates a temporary Lisa install layout with multiple ruleset templates.
 *
 * @returns Temporary Lisa install root and copied script path.
 */
function createLisaInstall(): { scriptPath: string; root: string } {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-install-"));
  const scriptsDir = path.join(root, "scripts");
  const scriptPath = path.join(scriptsDir, SCRIPT_NAME);
  const rulesetDir = path.join(root, "typescript", "github-rulesets");

  mkdirSync(scriptsDir, { recursive: true });
  copyFileSync(SCRIPT_PATH, scriptPath);
  mkdirSync(rulesetDir, { recursive: true });
  writeFileSync(
    path.join(rulesetDir, "base.json"),
    JSON.stringify({ name: "base", enforcement: ACTIVE_ENFORCEMENT })
  );
  writeFileSync(
    path.join(rulesetDir, "extra.json"),
    JSON.stringify({ name: "extra", enforcement: ACTIVE_ENFORCEMENT })
  );
  return { scriptPath, root };
}

describe("lisa-github-rulesets.sh", () => {
  it("continues past the first successful template under set -e", () => {
    const projectDir = createProject();
    const ghBin = createMockGhBin();
    const lisaInstall = createLisaInstall();

    try {
      const result = spawnSync(
        BASH_BIN,
        [lisaInstall.scriptPath, "--dry-run", projectDir],
        {
          cwd: REPO_ROOT,
          env: {
            ...process.env,
            // eslint-disable-next-line sonarjs/no-os-command-from-path -- Test-only PATH shim injects the mock gh executable.
            PATH: `${ghBin}:${process.env.PATH ?? ""}`,
          },
          encoding: "utf8",
        }
      );

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Found 2 ruleset template(s)");
      expect(result.stdout).toContain("Dry run complete. 2 ruleset(s)");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(ghBin, { recursive: true, force: true });
      rmSync(lisaInstall.root, { recursive: true, force: true });
    }
  });

  it("does not use post-increment counters that fail under GNU bash set -e", async () => {
    const script = readFileSync(SCRIPT_PATH, "utf8");

    expect(script).not.toMatch(/\(\(\s*(?:success|fail)_count\+\+\s*\)\)/);
  });
});

/**
 * Tests that policy reconciliation is WIRED, not merely available.
 *
 * `lisa-reconcile-policy.mjs` reads `.lisa.config.json`, derives the declared
 * context list, compares it against the live ruleset and repository settings,
 * and writes both back. It had no programmatic caller: its only callers were
 * prose lines inside a skill file, so config converged when an agent happened
 * to read a document. That is the same defect shape this repository documents
 * having already fixed once for a different script.
 *
 * Three behaviours are load-bearing here and each is a separate failure mode:
 *
 * 1. It RUNS as a step of the governance apply path.
 * 2. Exit 2 — UNPROVEN — WARNS and continues. A private repository on a plan
 *    without rulesets answers 403, and reddening setup punishes a repository
 *    that has done nothing wrong. But the warning must NAME the state: a blind
 *    gate that says nothing is indistinguishable from a clean one.
 * 3. A missing script FAILS CLOSED. A resolver that shrugs is how a control
 *    reports success having examined nothing.
 * @module tests/unit/scripts/lisa-github-repo-setup-reconcile
 */

import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { cleanGitEnv } from "../../helpers/test-utils.js";
import { resolveGit } from "../../support/git-executable.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SETUP_SCRIPT = "lisa-github-repo-setup.sh";
const RECONCILER = "lisa-reconcile-policy.mjs";
const BASH_BIN = "/bin/bash";
const STEP_FIVE = "Step 5/5: policy reconciliation";
const SETUP_COMPLETE = "GitHub repository governance setup complete";
const RECONCILER_RAN = "RECONCILER RAN";

const cleanup: string[] = [];

afterEach(() => {
  for (const directory of cleanup.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

/**
 * Creates a temporary Lisa install whose sub-scripts are stubs.
 *
 * @param reconcilerBody The shell body of the stub reconciler, or null to omit
 *   the file entirely.
 * @returns The install root and the setup script inside it.
 */
function createInstall(reconcilerBody: string | null): {
  root: string;
  scriptPath: string;
} {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-setup-"));
  cleanup.push(root);
  const scriptsDir = path.join(root, "scripts");
  mkdirSync(scriptsDir, { recursive: true });
  copyFileSync(
    path.join(REPO_ROOT, "scripts", SETUP_SCRIPT),
    path.join(scriptsDir, SETUP_SCRIPT)
  );

  for (const stub of [
    "lisa-github-repo-settings.sh",
    "lisa-github-rulesets.sh",
    "lisa-github-environments.sh",
    "setup-deploy-key.sh",
  ]) {
    writeFileSync(
      path.join(scriptsDir, stub),
      `#!/usr/bin/env bash\necho "stub ${stub}"\n`,
      { mode: 0o755 }
    );
  }

  if (reconcilerBody !== null) {
    const shippedDir = path.join(root, "all", "copy-overwrite", "scripts");
    mkdirSync(shippedDir, { recursive: true });
    writeFileSync(path.join(shippedDir, RECONCILER), reconcilerBody, {
      mode: 0o755,
    });
  }

  return { root, scriptPath: path.join(scriptsDir, SETUP_SCRIPT) };
}

/**
 * A stub reconciler that prints a marker and exits with a chosen code.
 *
 * Written as a `.mjs` because that is what the setup script invokes with node.
 *
 * @param code The exit code to report.
 * @param marker What to print, so the test can prove it actually ran.
 * @returns The file body.
 */
function stubReconciler(code: number, marker: string): string {
  return [
    `console.log(${JSON.stringify(marker)});`,
    `console.log("args:", process.argv.slice(2).join(" "));`,
    `process.exitCode = ${code};`,
    "",
  ].join("\n");
}

/**
 * Creates a git project for the setup script to act on.
 *
 * @returns The project directory.
 */
function createProject(): string {
  const projectDir = mkdtempSync(path.join(tmpdir(), "lisa-setup-project-"));
  cleanup.push(projectDir);
  execFileSync(resolveGit(), ["init"], {
    cwd: projectDir,
    stdio: "ignore",
    env: cleanGitEnv(process.env),
  });
  return projectDir;
}

/**
 * Runs the governance setup script against a stub install.
 *
 * @param scriptPath The copied setup script.
 * @param projectDir The project to act on.
 * @returns The completed process result.
 */
function runSetup(
  scriptPath: string,
  projectDir: string
): ReturnType<typeof spawnSync> {
  return spawnSync(BASH_BIN, [scriptPath, "--dry-run", projectDir], {
    cwd: REPO_ROOT,
    env: cleanGitEnv(process.env),
    encoding: "utf8",
  });
}

describe("lisa-github-repo-setup.sh policy reconciliation", () => {
  it("runs the reconciler as a step of the apply path", () => {
    const install = createInstall(stubReconciler(0, RECONCILER_RAN));
    const result = runSetup(install.scriptPath, createProject());

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(STEP_FIVE);
    expect(result.stdout).toContain(RECONCILER_RAN);
    expect(result.stdout).toContain(SETUP_COMPLETE);
  });

  it("passes --dry-run through so a dry run writes nothing", () => {
    const install = createInstall(stubReconciler(0, RECONCILER_RAN));
    const result = runSetup(install.scriptPath, createProject());

    expect(result.stdout).toContain("args: --dry-run");
  });

  // 13 rulesets across the portfolio answer 403 for a plan limitation. Failing
  // setup for that punishes a repository that has done nothing wrong.
  it("warns and continues when the verdict is UNPROVEN", () => {
    const install = createInstall(stubReconciler(2, "UNPROVEN STUB"));
    const result = runSetup(install.scriptPath, createProject());

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(SETUP_COMPLETE);
    // Naming the state is the other half. A blind gate that stays quiet is
    // indistinguishable from a clean one.
    expect(result.stderr).toContain("Policy was NOT checked (UNPROVEN)");
  });

  it("fails when the reconciler reports a drift it could not converge", () => {
    const install = createInstall(stubReconciler(1, "BLOCKED STUB"));
    const result = runSetup(install.scriptPath, createProject());

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Policy reconciliation failed");
    expect(result.stdout).not.toContain(SETUP_COMPLETE);
  });

  // The failure this repository keeps re-learning: a step that cannot find its
  // script and exits 0 is a green run that examined nothing.
  it("fails closed when no reconciler resolves at all", () => {
    const install = createInstall(null);
    const result = runSetup(install.scriptPath, createProject());

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Could not find lisa-reconcile-policy.mjs");
  });

  // A project pinned to an older Lisa reconciles with the script it actually
  // has, so the installed copy wins over the shipped template.
  it("prefers the copy installed in the project over the shipped template", () => {
    const install = createInstall(stubReconciler(0, "SHIPPED TEMPLATE"));
    const projectDir = createProject();
    mkdirSync(path.join(projectDir, "scripts"), { recursive: true });
    writeFileSync(
      path.join(projectDir, "scripts", RECONCILER),
      stubReconciler(0, "INSTALLED COPY"),
      { mode: 0o755 }
    );

    const result = runSetup(install.scriptPath, projectDir);

    expect(result.stdout).toContain("INSTALLED COPY");
    expect(result.stdout).not.toContain("SHIPPED TEMPLATE");
  });
});

/**
 * `lisa controls reconcile`, run as the built command in a repository Lisa
 * was never applied to (CodySwannGT/lisa#5000).
 *
 * The other reconcile suites run the command from source. This one runs the
 * built artifact the way the attest step calls it, and holds the properties
 * that step relies on: a deleted carrier and a command added to a hook each
 * produce a finding that names what an operator needs, the same inputs
 * always print the same bytes, nothing in the repository is changed, and a
 * register that cannot be read is a failure that says so.
 * @module tests/integration/controls-reconcile
 */
import { appendFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { ReconcileResult } from "../../src/controls/reconcile-types.js";
import { controlAuditGitEnv } from "../helpers/control-audit-fixtures.js";
import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../helpers/io-latency-budget.js";
import { operatorGit } from "../support/carrier-install.js";
import { LINT_ENTRY, wiredRepository } from "../support/reconcile-run.js";

useIoLatencyBudget();

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DIST_CLI = path.join(REPO_ROOT, "dist", "index.js");
const COMMIT_SCRIPT = ".lisa/hooks/pre-commit";
const SCAN = "node scripts/secret-scan.mjs --staged";

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/**
 * Build a fully wired repository, removed when the case ends.
 * @returns The repository's root
 */
async function wired(): Promise<string> {
  const repository = await wiredRepository();
  cleanups.push(repository.cleanup);
  return repository.fixture.repoPath;
}

/** How one run of the built command ended. */
interface BuiltRun {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Run the built command from inside a repository, with no path argument.
 * @param root - The repository to stand in
 * @returns Exit status and both streams
 */
function reconcile(root: string): BuiltRun {
  const child = boundedSpawnSync({
    args: [DIST_CLI, "controls", "reconcile"],
    command: process.execPath,
    cwd: root,
    env: { ...controlAuditGitEnv(), LISA_SKIP_UPDATE_CHECK: "1" },
    label: "lisa controls reconcile (built CLI)",
  });
  return { status: child.status, stderr: child.stderr, stdout: child.stdout };
}

/**
 * Everything git sees in a repository, tracked or not, and its hook setting.
 * @param root - The repository
 * @returns One text that changes when anything in the checkout does
 */
function picture(root: string): string {
  const status = operatorGit(root, ["status", "--porcelain", "--ignored"]);
  const hooks = operatorGit(root, ["config", "--get", "core.hooksPath"]);
  return `${status.stdout}\n${hooks.stdout}`;
}

describe("the built lisa controls reconcile", () => {
  it("reports nothing on a fully wired repository, and exits 0", async () => {
    const run = reconcile(await wired());
    const result = JSON.parse(run.stdout) as ReconcileResult;

    expect(run.status).toBe(0);
    expect(result.outcome).toBe("in-step");
    expect(result.findings).toEqual([]);
    expect(run.stderr).toMatch(/^reconcile: PASS\. /u);
  });

  it("names the register entry whose carrier was deleted", async () => {
    const root = await wired();
    rmSync(path.join(root, COMMIT_SCRIPT));

    const run = reconcile(root);
    const result = JSON.parse(run.stdout) as ReconcileResult;

    expect(run.status).toBe(0);
    expect(result.findings).toEqual([
      expect.objectContaining({
        entry_id: LINT_ENTRY,
        kind: "enforcement-point-not-wired",
        moment: "commit",
      }),
    ]);
    expect(run.stderr).toContain(
      `nothing in this checkout runs it (register entry ${LINT_ENTRY})`
    );
  });

  it("names the hook and the command nobody declared", async () => {
    const root = await wired();
    appendFileSync(path.join(root, COMMIT_SCRIPT), `${SCAN}\n`);

    const run = reconcile(root);
    const result = JSON.parse(run.stdout) as ReconcileResult;

    expect(run.status).toBe(0);
    expect(result.findings).toEqual([
      expect.objectContaining({
        command: SCAN,
        hook: "pre-commit",
        kind: "undeclared-command",
        path: COMMIT_SCRIPT,
      }),
    ]);
    expect(run.stderr).toContain(
      `The commit hook also runs "${SCAN}" (${COMMIT_SCRIPT} line 17), which the register does not mention.`
    );
  });

  it("prints the same bytes for the same inputs, and changes nothing", async () => {
    const root = await wired();
    rmSync(path.join(root, COMMIT_SCRIPT));
    const before = picture(root);

    const first = reconcile(root);
    const second = reconcile(root);

    expect(first.stdout).not.toBe("");
    expect(second.stdout).toBe(first.stdout);
    expect(second.stderr).toBe(first.stderr);
    expect(picture(root)).toBe(before);
  });

  it("exits 1 and names the register when the declaration is refused", async () => {
    const root = await wired();
    writeFileSync(
      path.join(root, ".lisa.config.json"),
      JSON.stringify({ gates: { "code-style": { commit: "sometimes" } } })
    );

    const run = reconcile(root);

    expect(run.status).toBe(1);
    expect(run.stdout).toBe("");
    expect(run.stderr).toContain("The control register could not be read");
    expect(run.stderr).toContain(
      "reconcile: FAIL. No result could be produced, and nothing was changed"
    );
  });

  it("exits 1 and names the hooks when the folder is not a repository", async () => {
    const root = await wired();
    const inside = path.join(root, "src");

    const run = reconcile(inside);

    expect(run.status).toBe(1);
    expect(run.stdout).toBe("");
    expect(run.stderr).toContain(
      "The git hooks of this checkout could not be read"
    );
  });
});

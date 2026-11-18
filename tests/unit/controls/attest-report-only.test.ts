/**
 * `lisa controls attest --workspace <folder>` is a report: it prints its
 * results and writes nothing.
 *
 * In a folder the operator named, the command starts each check's own
 * command and makes no commit or push. That shows a check works. It does not
 * show that anything runs it, and a repository with no hook installed gets
 * the same answers. So the run writes no evidence, no register and no
 * verdict, says so in one line, and cannot make a requirement read as
 * proved.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  ATTEST_EXIT,
  runAttest,
} from "../../../src/controls/commands/attest.js";
import type { ProofRun } from "../../../src/controls/proof-types.js";
import { runControlAuditGit } from "../../helpers/control-audit-fixtures.js";
import {
  ACCEPTS_EVERYTHING,
  checks,
  F_NONE_SOURCE,
  provedGates,
  REJECTS_EVERYTHING,
} from "../../helpers/control-proofs.js";
import { attest, standInCopy } from "./support/attest-run.js";
import { removeCopies, setting } from "./support/proof-run.js";
import { removeFixtures } from "./support/report-check-run.js";

const WORKING = provedGates([{ command: checks(F_NONE_SOURCE) }]);
const BROKEN = {
  ...provedGates([{ command: ACCEPTS_EVERYTHING, name: "lint" }]),
  ...provedGates(
    [{ command: REJECTS_EVERYTHING, name: "lint" }],
    "test-correctness",
    ["push"]
  ),
};
const ONE_PASSED = "1 passed, 0 failed, 0 unproved, 0 unknown";

/**
 * What the command says, once, about a run that records nothing.
 * @param counts - How many entries got each result
 * @returns The line
 */
function reportOnly(counts: string): string {
  return `attest: REPORT ONLY. ${counts}. With --workspace each check's own command is started in the folder you named and no commit or push is made, so this shows whether a check works and not whether anything runs it. Nothing was written: no evidence, no register and no verdict, and no requirement counts as proved. Run "lisa controls attest" without --workspace to prove the controls.`;
}

/**
 * The repository's own account of what changed in it.
 * @param repoPath - The repository
 * @returns What `git status` lists, untracked files included
 */
function changed(repoPath: string): string {
  return runControlAuditGit(repoPath, [
    "status",
    "--short",
    "--untracked-files=all",
  ]);
}

afterEach(() => {
  removeCopies();
  removeFixtures();
});

describe("lisa controls attest in a folder the operator named", () => {
  it("prints the table, says in one line that nothing was written, and writes nothing", async () => {
    const where = setting(WORKING);

    const run = await attest(where.repoPath, { workspace: where.workspace });

    expect(run.code).toBe(ATTEST_EXIT.PASSED);
    expect(run.stdout).toEqual([
      "RESULT  ENTRY         MOMENT  HALVES",
      "passed  code-style@.  commit  violation rejected (exit 1); clean accepted (exit 0)",
      "        The check turned the violating change away with the declared failure text and let the clean change through.",
    ]);
    expect(run.stderr).toEqual([reportOnly(ONE_PASSED)]);
    expect(changed(where.repoPath)).toBe("");
    expect(changed(where.workspace)).toBe("");
  });

  it("prints one JSON document on standard output and the same line on standard error", async () => {
    const where = setting(WORKING);

    const run = await attest(where.repoPath, {
      workspace: where.workspace,
      json: true,
    });

    expect(run.code).toBe(ATTEST_EXIT.PASSED);
    expect(run.stdout).toHaveLength(1);
    expect((JSON.parse(run.stdout.join("\n")) as ProofRun).passed).toBe(true);
    expect(run.stderr).toEqual([reportOnly(ONE_PASSED)]);
    expect(changed(where.repoPath)).toBe("");
  });

  it("exits 1 when a check did not pass, and still writes nothing", async () => {
    const where = setting(BROKEN);

    const run = await attest(where.repoPath, { workspace: where.workspace });

    expect(run.code).toBe(ATTEST_EXIT.NOT_PASSED);
    expect(run.stdout.filter(line => line.startsWith("failed"))).toHaveLength(
      2
    );
    expect(run.stderr).toEqual([
      reportOnly("0 passed, 2 failed, 0 unproved, 0 unknown"),
    ]);
    expect(changed(where.repoPath)).toBe("");
  });

  it("writes nothing even when a caller hands in its own way to open the folder", async () => {
    const where = setting(WORKING);

    const code = await runAttest(
      where.repoPath,
      { workspace: where.workspace },
      {
        stdout: () => undefined,
        stderr: () => undefined,
        openWorkspace: standInCopy(where),
      }
    );

    expect(code).toBe(ATTEST_EXIT.PASSED);
    expect(changed(where.repoPath)).toBe("");
  });
});

/**
 * The required checks are run once on the head of the default branch, in a
 * copy, and the ones that fail there are listed with what they printed
 * (CodySwannGT/lisa#4994, R35).
 */
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  HEAD_SCRATCH_PREFIX,
  measureCurrentlyFailing,
} from "../../../src/controls/enforce-head-run.js";
import type { CurrentlyFailing } from "../../../src/controls/enforce-types.js";
import {
  runControlAuditGit,
  type ControlAuditFixture,
} from "../../helpers/control-audit-fixtures.js";
import { useIoLatencyBudget } from "../../helpers/io-latency-budget.js";
import { repositoryState } from "../../support/repository-state.js";
import {
  CLEAN,
  LINT_COMMAND,
  LINT_FAILURE,
  VIOLATION,
  buildLintedRepository,
  commitOnBranch,
  editLintedFile,
  lintGates,
  registerOfRepository,
  scratchFolder,
} from "./support/enforce-repository.js";

useIoLatencyBudget();

const ENTRY = "code-style@.";

const built: ControlAuditFixture[] = [];
const scratch: { remove: () => void }[] = [];

afterEach(() => {
  built.splice(0).forEach(fixture => {
    fixture.cleanup();
  });
  scratch.splice(0).forEach(folder => {
    folder.remove();
  });
});

/**
 * Build a fixture that is removed after the case.
 * @param args - What {@link buildLintedRepository} takes
 * @returns The repository root
 */
function repository(...args: Parameters<typeof buildLintedRepository>): string {
  const fixture = buildLintedRepository(...args);
  built.push(fixture);
  return fixture.repoPath;
}

/**
 * Run the required checks of a fixture on its default branch.
 * @param repoPath - The repository
 * @param platformBranch - The branch the hosting platform named, if any
 * @returns What was found, and the folder the copy was made in
 */
async function measure(
  repoPath: string,
  platformBranch: string | null = null
): Promise<{ readonly failing: CurrentlyFailing; readonly copy: string }> {
  const made = scratchFolder();
  const copy = path.join(made.folder, `${HEAD_SCRATCH_PREFIX}case`);
  const register = await registerOfRepository(repoPath);
  scratch.push(made);
  return {
    copy,
    failing: await measureCurrentlyFailing(repoPath, register, platformBranch, {
      scratch: () => copy,
    }),
  };
}

describe("a required check that fails on the default branch", () => {
  it("is listed with its command, its exit status and what it printed", async () => {
    const { failing } = await measure(repository(VIOLATION));

    expect(failing.measured).toBe(true);
    expect(failing.checked).toBe(1);
    expect(failing.gates).toEqual([
      expect.objectContaining({
        entry_id: ENTRY,
        gate: "code-style",
        scope: ".",
        criteria: ["SI7"],
        command: [...LINT_COMMAND],
        exit_status: 1,
        judged: "unproved",
        output_truncated: false,
        matched_failure_shape: null,
      }),
    ]);
    expect(failing.gates[0]?.output_excerpt).toContain(LINT_FAILURE);
  });

  it("says whether the output carries the failure text the entry declares", async () => {
    const declared = await measure(
      repository(
        VIOLATION,
        lintGates({}, { proof: { failure_shape: [LINT_FAILURE] } })
      )
    );
    const other = await measure(
      repository(
        VIOLATION,
        lintGates({}, { proof: { failure_shape: ["some other text"] } })
      )
    );

    expect(declared.failing.gates[0]).toMatchObject({
      judged: "failed",
      matched_failure_shape: true,
    });
    // The code really breaks the rule here, and the entry names the text of
    // a different failure. The runner cannot name the rule, so the check is
    // `unproved`: that word is no statement that the code passes.
    expect(other.failing.gates[0]).toMatchObject({
      judged: "unproved",
      matched_failure_shape: false,
    });
  });

  it("is still listed when the fix is in the working copy and not committed", async () => {
    const repoPath = repository(VIOLATION);
    editLintedFile(repoPath, CLEAN);

    const { failing } = await measure(repoPath);

    expect(failing.gates.map(gate => gate.entry_id)).toEqual([ENTRY]);
    expect(failing.reason).toContain("not committed");
  });

  it("is still listed when the operator is on a branch that fixes it", async () => {
    const repoPath = repository(VIOLATION);
    commitOnBranch(repoPath, "fix-style", CLEAN);

    const { failing } = await measure(repoPath);

    expect(failing.head).toMatchObject({
      branch: "main",
      ref: "refs/heads/main",
      chosen_by: "conventional-name",
    });
    expect(failing.gates.map(gate => gate.entry_id)).toEqual([ENTRY]);
  });
});

describe("a required check that passes on the default branch", () => {
  it("is not listed, even when the working copy breaks the rule", async () => {
    const repoPath = repository(CLEAN);
    editLintedFile(repoPath, VIOLATION);

    const { failing } = await measure(repoPath);

    expect(failing.measured).toBe(true);
    expect(failing.checked).toBe(1);
    expect(failing.gates).toEqual([]);
    expect(failing.not_measured).toEqual([]);
  });

  it("is not listed when only another branch breaks the rule", async () => {
    const repoPath = repository(CLEAN);
    commitOnBranch(repoPath, "break-style", VIOLATION);

    expect((await measure(repoPath)).failing.gates).toEqual([]);
  });
});

describe("which commit the checks run on", () => {
  it("is the branch the hosting platform named, when it named one", async () => {
    const repoPath = repository(CLEAN);
    commitOnBranch(repoPath, "trunk", VIOLATION);
    runControlAuditGit(repoPath, ["checkout", "--quiet", "main"]);

    const { failing } = await measure(repoPath, "trunk");

    expect(failing.head).toMatchObject({
      branch: "trunk",
      chosen_by: "hosting-platform",
    });
    expect(failing.gates.map(gate => gate.entry_id)).toEqual([ENTRY]);
  });

  it("is not measured, and says why, when the named branch has no commit here", async () => {
    const { failing } = await measure(repository(VIOLATION), "release");

    expect(failing.measured).toBe(false);
    expect(failing.gates).toEqual([]);
    expect(failing.reason).toContain("release");
  });
});

describe("a check that gives no answer", () => {
  it("is listed as not measured when its program cannot be started", async () => {
    const { failing } = await measure(
      repository(
        VIOLATION,
        lintGates({}, { command: ["lisa-no-such-program-anywhere"] })
      )
    );

    expect(failing.gates).toEqual([]);
    expect(failing.checked).toBe(0);
    expect(failing.not_measured.map(gate => gate.entry_id)).toEqual([ENTRY]);
  });

  it("says that nothing was measured when no check gave an answer", async () => {
    const { failing } = await measure(
      repository(
        VIOLATION,
        lintGates({}, { command: ["lisa-no-such-program-anywhere"] })
      )
    );

    expect(failing.reason).toContain(
      "None of the 1 gave an answer, so nothing is known about whether they pass there."
    );
    expect(failing.reason).not.toContain("0 of 0");
  });

  it("is not run at all when nothing is required", async () => {
    const { failing, copy } = await measure(
      repository(VIOLATION, lintGates({ commit: "optional" }))
    );

    expect(failing.measured).toBe(false);
    expect(failing.head).toBeNull();
    expect(existsSync(copy)).toBe(false);
  });
});

describe("what running the checks leaves behind", () => {
  it("changes nothing in the operator's repository", async () => {
    const repoPath = repository(VIOLATION);
    editLintedFile(repoPath, CLEAN);
    const before = repositoryState(repoPath);

    await measure(repoPath);

    expect(repositoryState(repoPath)).toEqual(before);
  });

  it("removes the copy, and never shows its path in what a check printed", async () => {
    const { failing, copy } = await measure(repository(VIOLATION));

    expect(existsSync(copy)).toBe(false);
    expect(readdirSync(path.dirname(copy))).toEqual([]);
    expect(JSON.stringify(failing)).not.toContain(copy);
  });
});

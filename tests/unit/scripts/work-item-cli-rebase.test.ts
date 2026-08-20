/**
 * The rebase lane: a binding must be creatable and attachable while HEAD is
 * detached mid-rebase.
 *
 * `assertStateBranch` has always fallen back to the rebase head-name, so
 * VALIDATION worked mid-rebase. `writeState` did not, so nothing could be
 * WRITTEN there — and the two halves disagreeing produced a trap with no exit:
 * a binding made mid-rebase recorded `branch: null`, every commit was refused
 * as "pending branch attachment", `attach-branch` (the command that refusal
 * names) refused in turn with "create or check out a feature branch", and
 * `git rebase --abort` is blocked by the same gate. The only way out was to
 * write the binding file by hand.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterAll, afterEach, describe, expect, it } from "vitest";

import {
  cleanupFixtures,
  cleanupTemplates,
  cli,
  createFixture,
  git,
  githubConfig,
  REF,
  stateFile,
  wedgeRebase,
} from "../../support/work-item-cli.js";

const BRANCH = "feature/tracked";
const TRAILER = "trailer";
const VALIDATE = "validate-commit";

afterEach(cleanupFixtures);
afterAll(cleanupTemplates);

/**
 * The branch recorded in the binding file.
 * @param fixture - The repository to read.
 * @returns The recorded branch, which may be null.
 */
function boundBranch(fixture: {
  env: Record<string, string | undefined>;
  root: string;
}): string | null {
  return JSON.parse(readFileSync(stateFile(fixture), "utf8")).branch;
}

describe("in-process CLI: binding during a rebase", () => {
  it("attaches a pending binding to the branch the rebase is rewriting", () => {
    const fixture = createFixture(githubConfig(TRAILER));
    git(fixture.root, ["checkout", "-q", "--detach"], fixture.env);
    cli(fixture, ["link", REF]);
    expect(boundBranch(fixture)).toBe(null);
    git(fixture.root, ["switch", "-q", BRANCH], fixture.env);
    wedgeRebase(fixture, BRANCH);

    const result = cli(fixture, ["attach-branch"]);
    expect(result.exitCode).toBeUndefined();
    expect(result.stdout).toContain(`work-item binding attached to ${BRANCH}`);
    expect(boundBranch(fixture)).toBe(BRANCH);
  });

  it("records the rebase's branch when the binding is made mid-rebase", () => {
    const fixture = createFixture(githubConfig(TRAILER));
    wedgeRebase(fixture, BRANCH);
    const result = cli(fixture, ["link", REF]);
    expect(result.exitCode).toBeUndefined();
    expect(boundBranch(fixture)).toBe(BRANCH);
  });

  it("lets `git rebase --continue` commit against the binding", () => {
    const fixture = createFixture(githubConfig(TRAILER));
    cli(fixture, ["link", REF]);
    wedgeRebase(fixture, BRANCH);
    const file = path.join(fixture.root, "MSG");
    writeFileSync(file, "feat: the picked commit\n");

    expect(cli(fixture, ["prepare-commit-msg", file]).exitCode).toBeUndefined();
    expect(readFileSync(file, "utf8")).toContain(`Work-Item: ${REF}`);
    expect(cli(fixture, [VALIDATE, file]).stdout).toBe(
      `WORK_ITEM_TRACKING_OK ${REF}`
    );
  });

  it("still refuses a rebase of a branch the binding does not belong to", () => {
    const fixture = createFixture(githubConfig(TRAILER));
    cli(fixture, ["link", REF]);
    git(fixture.root, ["switch", "-q", "-c", "feature/other"], fixture.env);
    wedgeRebase(fixture, "feature/other");
    const file = path.join(fixture.root, "MSG");
    writeFileSync(file, `feat: picked\n\nWork-Item: ${REF}\n`);
    const result = cli(fixture, [VALIDATE, file]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      `belongs to branch '${BRANCH}', not 'feature/other'`
    );
  });

  it("still fails closed on a detached HEAD with no rebase at all", () => {
    const fixture = createFixture(githubConfig(TRAILER));
    cli(fixture, ["link", REF]);
    git(fixture.root, ["checkout", "-q", "--detach"], fixture.env);
    const file = path.join(fixture.root, "MSG");
    writeFileSync(file, `feat: detached\n\nWork-Item: ${REF}\n`);
    const result = cli(fixture, [VALIDATE, file]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "Cannot use a work-item binding from detached HEAD"
    );
  });
});

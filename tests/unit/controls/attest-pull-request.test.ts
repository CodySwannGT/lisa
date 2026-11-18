/**
 * `lisa controls attest` and the pull-request moment, through the command
 * itself (CodySwannGT/lisa#4997).
 *
 * The parts are checked on their own elsewhere. This file runs the command
 * the way an operator does and reads what it prints: the `observed` entry it
 * records by default, the canaries it opens only when asked, and the
 * acknowledgement a proof that reaches outside the repository needs.
 * @module tests/unit/controls/attest-pull-request
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  ATTEST_EXIT,
  runAttest,
  type AttestOptions,
} from "../../../src/controls/commands/attest.js";
import type { PullRequestDependencies } from "../../../src/controls/pull-request-settle.js";
import type { SettledProofRun } from "../../../src/controls/pull-request-types.js";
import { provedGates } from "../../helpers/control-proofs.js";
import type { GatesBlock } from "../../helpers/control-register.js";
import {
  RUN_ID,
  canaryPlatform,
  expectNoMerge,
  expectNothingLeft,
  fakeSignals,
} from "./support/canary-run.js";
import { removeCopies, setting, steppingClock } from "./support/proof-run.js";
import { GITHUB_REMOTE } from "./support/protect-fixture.js";
import {
  PULL_ONLY_CHECK,
  PULL_ONLY_ENTRY,
  PULL_ONLY_GATES,
  REPOSITORY_FILES,
  WORKING,
} from "./support/pull-request-run.js";
import { removeFixtures, type Run } from "./support/report-check-run.js";

const EFFECT = "Posts a message to the team's alert channel";

/** One gate enforced at commit whose proof says it reaches outside. */
const REACHES_OUTSIDE = provedGates([
  { command: WORKING, external_effects: [EFFECT] },
]);

afterEach(() => {
  removeCopies();
  removeFixtures();
});

/**
 * Run the command in-process against a fixture and the in-memory platform.
 * @param gates - The gates block
 * @param options - The command's options
 * @param pullRequests - Collaborators for the pull-request moment
 * @returns Exit code and printed lines
 */
async function attest(
  gates: GatesBlock,
  options: AttestOptions,
  pullRequests: PullRequestDependencies = {}
): Promise<Run> {
  const where = setting(gates, { files: REPOSITORY_FILES });
  const signals = fakeSignals();
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await runAttest(
    where.repoPath,
    { workspace: where.workspace, ...options },
    {
      clock: steppingClock("2026-02-01T00:00:00.000Z"),
      stdout: text => {
        stdout.push(text);
      },
      stderr: text => {
        stderr.push(text);
      },
      pullRequests: {
        readRemoteUrl: () => Promise.resolve(GITHUB_REMOTE),
        runId: () => RUN_ID,
        sleep: () => Promise.resolve(),
        signals: signals.source,
        terminate: signals.terminate,
        ...pullRequests,
      },
    }
  );
  return { code, stdout, stderr };
}

describe("lisa controls attest, without the canary option", () => {
  it("records the pull-request entry at the observed rung and creates nothing", async () => {
    const platform = canaryPlatform();

    const run = await attest(
      PULL_ONLY_GATES,
      { json: true },
      { gh: platform.gh }
    );

    const document = JSON.parse(run.stdout.join("\n")) as SettledProofRun;
    expect(document.entries).toEqual([
      expect.objectContaining({
        entry_id: PULL_ONLY_ENTRY,
        moment: "pull-request",
        outcome: "unproved",
        reason: "observed-required",
        rung: "observed",
      }),
    ]);
    expect(document.pull_request).toMatchObject({
      mode: "observed",
      canaries: [],
      points: [{ entry_id: PULL_ONLY_ENTRY, rung: "observed" }],
    });
    expect(platform.log.filter(request => request.method !== "GET")).toEqual(
      []
    );
    expectNothingLeft(platform);
    // An observation is not a proof, so the command does not report a pass.
    expect(run.code).toBe(ATTEST_EXIT.NOT_PASSED);
  });

  it("says in the table that the entry was observed and how to exercise it", async () => {
    const platform = canaryPlatform();

    const run = await attest(PULL_ONLY_GATES, {}, { gh: platform.gh });

    expect(run.stdout).toEqual([
      "RESULT    ENTRY         MOMENT        HALVES",
      "unproved  code-style@.  pull-request  not run",
      `          Observed, not exercised. The hosting platform requires "${PULL_ONLY_CHECK}" on main before a pull request can be merged. No pull request was opened to show that the check turns a violating change away; run again with --pull-request-canaries to exercise it.`,
    ]);
    expect(run.stderr).toEqual([
      "attest: FAIL. 0 of 1 entry proved: 0 passed, 0 failed, 1 unproved, 0 unknown. Every entry has to pass",
    ]);
  });
});

describe("lisa controls attest --pull-request-canaries", () => {
  it("exercises the entry, passes, and leaves the default branch where it was", async () => {
    const platform = canaryPlatform();
    const before = platform.head("main");

    const run = await attest(
      PULL_ONLY_GATES,
      { json: true, pullRequestCanaries: true },
      { gh: platform.gh }
    );

    const document = JSON.parse(run.stdout.join("\n")) as SettledProofRun;
    expect(run.code).toBe(ATTEST_EXIT.PASSED);
    expect(document.entries[0]).toMatchObject({
      outcome: "passed",
      rung: "exercised",
    });
    expect(document.pull_request.base_head).toEqual({
      before,
      after: before,
      unchanged: true,
    });
    expect(platform.head("main")).toBe(before);
    expectNoMerge(platform.log);
    expectNothingLeft(platform);
  });
});

describe("lisa controls attest and a proof that reaches outside the repository", () => {
  it("does not run it, and quotes the declared effect, without the acknowledgement", async () => {
    const run = await attest(REACHES_OUTSIDE, { json: true });

    const document = JSON.parse(run.stdout.join("\n")) as SettledProofRun;
    expect(document.entries).toEqual([
      expect.objectContaining({
        outcome: "unknown",
        reason: "external-effects",
        halves: [],
      }),
    ]);
    expect(document.entries[0]?.detail).toContain(JSON.stringify(EFFECT));
    expect(run.code).toBe(ATTEST_EXIT.NOT_PASSED);
  });

  it("runs it with --acknowledge-external-effects", async () => {
    const run = await attest(REACHES_OUTSIDE, {
      json: true,
      acknowledgeExternalEffects: true,
    });

    const document = JSON.parse(run.stdout.join("\n")) as SettledProofRun;
    expect(document.entries[0]).toMatchObject({
      outcome: "passed",
      reason: "proved",
    });
    expect(document.entries[0]?.halves).toHaveLength(2);
    expect(run.code).toBe(ATTEST_EXIT.PASSED);
  });
});

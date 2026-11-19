/**
 * What a canary run of `lisa controls attest` could not undo is said out
 * loud (CodySwannGT/lisa#4993).
 *
 * A canary is a real branch and a real pull request. A run that passes
 * every proof and leaves its branches behind has still left something in
 * somebody's repository, and a table of passes says nothing of it. So each
 * thing left behind is one line on standard error, naming the branch or the
 * pull request, in the table and in the JSON mode alike. A canary that was
 * merged, or a protected branch that moved with a canary unaccounted for,
 * fails the run whatever its proofs showed. Every case runs against the
 * platform that lives in memory.
 * @module tests/unit/controls/attest-canary-notices
 */
import { afterEach, describe, expect, it } from "vitest";

import { canaryBranch } from "../../../src/controls/canary-names.js";
import {
  ATTEST_EXIT,
  type AttestOptions,
} from "../../../src/controls/commands/attest.js";
import { proofRunOf } from "../../../src/controls/proof-runner.js";
import { canaryNotices } from "../../../src/controls/pull-request-notices.js";
import type {
  BaseHead,
  CanaryRecord,
  SettledProofRun,
} from "../../../src/controls/pull-request-types.js";
import {
  attestIn,
  pullRequestSetting,
} from "./support/attest-pull-request-run.js";
import { canaryPlatform, expectNoMerge } from "./support/canary-run.js";
import type { FakeCanaryPlatform } from "./support/fake-canary-platform.js";
import { removeCopies } from "./support/proof-run.js";
import { REPO } from "./support/protect-fixture.js";
import {
  PULL_ONLY_ENTRY,
  PULL_ONLY_GATES,
} from "./support/pull-request-run.js";
import { exercisedPoint, settled } from "./support/pull-request-samples.js";
import { removeFixtures, type Run } from "./support/report-check-run.js";

const CANARIES = { pullRequestCanaries: true } as const;

/** A canary another run made a month before the runs here begin. */
const STALE = canaryBranch({
  runId: "run0000b",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  sequence: 1,
  half: "clean",
});

afterEach(() => {
  removeCopies();
  removeFixtures();
});

/**
 * Run the command with canaries against the in-memory platform.
 * @param platform - The platform
 * @param options - The command's options beyond the canary option
 * @returns Exit code and printed lines
 */
function attest(
  platform: FakeCanaryPlatform,
  options: AttestOptions = {}
): Promise<Run> {
  return attestIn(
    pullRequestSetting(PULL_ONLY_GATES),
    { ...CANARIES, ...options },
    { gh: platform.gh }
  );
}

/**
 * A canary's record, removed and never merged unless a case says otherwise.
 * @param change - How it differs
 * @returns The record
 */
function canary(change: Partial<CanaryRecord> = {}): CanaryRecord {
  return {
    entry_id: PULL_ONLY_ENTRY,
    half: "clean",
    branch: "lisa-attest/run0000a/20260201T000002Z-2-clean",
    pull_request: 2,
    draft: true,
    head_sha: "b".repeat(40),
    created_at: "2026-02-01T00:00:02.000Z",
    eligibility: null,
    closed: true,
    branch_removed: true,
    merged: false,
    cleanup_problem: null,
    ...change,
  };
}

/**
 * A run whose canaries and protected branch are as a case says.
 * @param canaries - The canaries' records
 * @param baseHead - The head of the protected branch around them
 * @param sweepProblems - What the sweep could not deal with
 * @returns The run
 */
function ran(
  canaries: readonly CanaryRecord[],
  baseHead: BaseHead | null = null,
  sweepProblems: readonly string[] = []
): SettledProofRun {
  return {
    ...proofRunOf([]),
    pull_request: {
      ...settled([exercisedPoint()], "canaries"),
      canaries,
      base_head: baseHead,
      sweep: { removed: [], kept: [], problems: sweepProblems },
    },
  };
}

const MOVED: BaseHead = {
  before: "a".repeat(40),
  after: "c".repeat(40),
  unchanged: false,
};

describe("a canary the platform would not let go of", () => {
  it.each([
    ["the table", {}],
    ["the JSON document", { json: true }],
  ] as const)(
    "is named on standard error beside %s, one line each",
    async (_mode, options) => {
      const platform = canaryPlatform({
        refuse: request =>
          request.method === "DELETE" ? "Server Error" : undefined,
      });

      const run = await attest(platform, options);

      const left = platform.branches().filter(branch => branch !== "main");
      expect(left).toHaveLength(2);
      expect(run.stderr).toHaveLength(2);
      left.forEach((branch, index) => {
        expect(run.stderr[index]).toMatch(/^attest: A canary of /u);
        expect(run.stderr[index]).toContain(
          `the branch ${branch} still exists`
        );
        expect(run.stderr[index]).toContain("Server Error");
      });
      // The proofs themselves passed, and that is what the exit code says.
      expect(run.code).toBe(ATTEST_EXIT.PASSED);
    }
  );

  it("names the pull request too when that is still open", () => {
    const notices = canaryNotices(
      ran([
        canary({
          closed: false,
          branch_removed: false,
          cleanup_problem: "gh: Server Error (HTTP 500)",
        }),
      ])
    );

    expect(notices.lines).toHaveLength(1);
    expect(notices.lines[0]).toContain("pull request #2 is still open");
    expect(notices.lines[0]).toContain(
      "the branch lisa-attest/run0000a/20260201T000002Z-2-clean still exists"
    );
    expect(notices.failure).toBeNull();
  });

  it("is not mentioned once it is gone", () => {
    expect(canaryNotices(ran([canary()]))).toEqual({
      lines: [],
      failure: null,
    });
  });
});

describe("a canary an earlier run left behind that the sweep could not remove", () => {
  it("is named on standard error, by its branch", async () => {
    const platform = canaryPlatform({
      refuse: request =>
        request.method === "DELETE" && request.path.endsWith(STALE)
          ? "Cannot delete this branch"
          : undefined,
    });
    platform.gh(
      ["api", "-X", "POST", `repos/${REPO}/git/refs`, "--input", "-"],
      {
        input: JSON.stringify({
          ref: `refs/heads/${STALE}`,
          sha: platform.head("main"),
        }),
      }
    );

    const run = await attest(platform);

    expect(run.stderr).toHaveLength(1);
    expect(run.stderr[0]).toMatch(
      /^attest: A canary an earlier run left behind/u
    );
    expect(run.stderr[0]).toContain(STALE);
    expect(run.stderr[0]).toContain("Cannot delete this branch");
    expect(run.code).toBe(ATTEST_EXIT.PASSED);
  });
});

describe("a canary that was merged", () => {
  it.each([
    ["the table", {}],
    ["the JSON document", { json: true }],
  ] as const)(
    "fails the run beside %s, naming the pull request",
    async (_mode, options) => {
      const platform = canaryPlatform({ mergedByTheHost: true });

      const run = await attest(platform, options);

      expect(run.code).toBe(ATTEST_EXIT.NOT_PASSED);
      expect(run.stderr[0]).toMatch(
        /^attest: Canary pull request #1 \(branch lisa-attest\/[^)]+\) was merged into main\./u
      );
      expect(run.stderr.join("\n")).toMatch(
        /The head of main moved while canaries were open/u
      );
      expect(run.stderr.at(-1)).toMatch(
        /^attest: FAIL\. A canary pull request was merged into main \(pull request #1 /u
      );
      // The command asked for no merge; the platform did it by itself.
      expectNoMerge(platform.log);
    }
  );

  it("fails a run every proof of which passed", () => {
    const notices = canaryNotices(ran([canary({ merged: true })]));

    expect(notices.failure).toMatch(/pull request #2/u);
    expect(notices.lines[0]).toMatch(/^Canary pull request #2 /u);
  });
});

describe("a protected branch that moved while canaries were open", () => {
  it("fails the run when it is not known whether a canary was merged", () => {
    const notices = canaryNotices(ran([canary({ merged: null })], MOVED));

    expect(notices.failure).toMatch(
      /main moved while canaries were open and it could not be ruled out/u
    );
    expect(notices.lines).toEqual([
      expect.stringMatching(
        /^The head of main moved while canaries were open, from a{40} to c{40}\. It could not be read whether pull request #2 /u
      ),
    ]);
  });

  it("is said, and does not fail the run, when the platform said no canary was merged", () => {
    const notices = canaryNotices(ran([canary()], MOVED));

    expect(notices.failure).toBeNull();
    expect(notices.lines).toEqual([
      expect.stringMatching(/so something else moved it\.$/u),
    ]);
  });

  it("is said to be unconfirmed when its head could not be read", () => {
    const notices = canaryNotices(
      ran([canary()], { before: "a".repeat(40), after: null, unchanged: null })
    );

    expect(notices.failure).toBeNull();
    expect(notices.lines).toEqual([
      expect.stringMatching(/it is not confirmed that main is where it was/u),
    ]);
  });

  it("is not mentioned when it is where it was", () => {
    const head = "a".repeat(40);

    expect(
      canaryNotices(
        ran([canary()], { before: head, after: head, unchanged: true })
      ).lines
    ).toEqual([]);
  });
});

describe("a run that opened no canary", () => {
  it("has nothing to say", () => {
    expect(canaryNotices(proofRunOf([]))).toEqual({
      lines: [],
      failure: null,
    });
  });
});

/**
 * Reading the hosting platform's answer about a canary as one half of a
 * proof (CodySwannGT/lisa#4997).
 *
 * A half is `rejected` only when the entry's own required check failed on
 * the canary. A canary held back by anything else — a draft, a missing
 * review, a check that never reported — proves nothing about the entry, and
 * a check that passed on a violating change is a failure of the control
 * whatever else holds the pull request back.
 * @module tests/unit/controls/canary-eligibility
 */
import { describe, expect, it } from "vitest";

import type { CanaryDoor } from "../../../src/controls/canary-door.js";
import {
  awaitEligibility,
  judgeEligibility,
  readEligibility,
} from "../../../src/controls/canary-eligibility.js";
import type { MergeEligibility } from "../../../src/controls/pull-request-types.js";
import { steppingClock } from "./support/proof-run.js";

const LINT = "Lint";
const TESTS = "Tests";
const SHA = "a".repeat(40);

/** Why a half is `rejected`: the entry's own check failed. */
const AS_DECLARED = "rejected-as-declared";

/** Why a half is `unknown` when its check neither passed nor failed. */
const NOTHING_MEASURED = "nothing-measured";

/**
 * What the platform showed for a canary.
 * @param state - The platform's word for the pull request
 * @param conclusions - What each check concluded
 * @returns The answer a wait ended with
 */
function shown(
  state: string | null,
  conclusions: Readonly<Record<string, string | null>>
) {
  const eligibility: MergeEligibility = {
    mergeable: true,
    mergeable_state: state,
    checks: Object.entries(conclusions).map(([context, conclusion]) => ({
      context,
      conclusion,
    })),
  };
  return {
    eligibility,
    timedOut: Object.values(conclusions).includes(null),
    problem: null,
  };
}

/**
 * A door that answers reads from a table and refuses every write.
 * @param answers - What each path answers, by a part of the path
 * @returns The door, and the paths it was asked for
 */
function readingDoor(answers: Readonly<Record<string, unknown>>) {
  const asked: string[] = [];
  const door: CanaryDoor = {
    repository: "example-owner/example-repo",
    get: path => {
      asked.push(path);
      const key = Object.keys(answers).find(part => path.includes(part));
      return key === undefined
        ? { ok: false, reason: "Not Found" }
        : { ok: true, value: answers[key] };
    },
    send: () => ({ ok: false, reason: "this door does not write" }),
  };
  return { door, asked };
}

describe("what a canary half shows", () => {
  it.each([
    ["draft", { [LINT]: "failure" }, "rejected", AS_DECLARED],
    ["blocked", { [LINT]: "failure" }, "rejected", AS_DECLARED],
    ["blocked", { [LINT]: "timed_out" }, "rejected", AS_DECLARED],
    ["draft", { [LINT]: "error" }, "rejected", AS_DECLARED],
    // One failing check is enough; the other need not have reported.
    [
      "draft",
      { [LINT]: "failure", [TESTS]: null },
      "rejected",
      "rejected-as-declared",
    ],
    // The check failed and the platform would merge anyway: not stopped.
    ["clean", { [LINT]: "failure" }, "accepted", "accepted"],
    ["unstable", { [LINT]: "failure" }, "accepted", "accepted"],
    // The entry's check passed, whatever else holds the pull request back.
    ["draft", { [LINT]: "success" }, "accepted", "accepted"],
    [
      "blocked",
      { [LINT]: "success", [TESTS]: "success" },
      "accepted",
      "accepted",
    ],
    ["clean", { [LINT]: "success" }, "accepted", "accepted"],
    // Nothing that can be relied on.
    ["draft", { [LINT]: null }, "unknown", "timed-out"],
    ["draft", { [LINT]: "success", [TESTS]: null }, "unknown", "timed-out"],
    ["draft", { [LINT]: "cancelled" }, "unknown", "killed"],
    ["draft", { [LINT]: "skipped" }, "unknown", NOTHING_MEASURED],
    ["draft", { [LINT]: "neutral" }, "unknown", NOTHING_MEASURED],
    [
      "draft",
      { [LINT]: "success", [TESTS]: "skipped" },
      "unknown",
      "nothing-measured",
    ],
  ] as const)(
    "%s with %o is %s (%s)",
    (state, conclusions, outcome, reason) => {
      expect(judgeEligibility(shown(state, conclusions), 60)).toMatchObject({
        outcome,
        reason,
      });
    }
  );

  it("is unknown when the platform showed nothing at all", () => {
    const judged = judgeEligibility(
      { eligibility: null, timedOut: true, problem: "HTTP 502" },
      60
    );

    expect(judged).toMatchObject({ outcome: "unknown", reason: "timed-out" });
    expect(judged.detail).toContain("HTTP 502");
  });
});

describe("one look at a canary", () => {
  it("reads a check that reports as a commit status", () => {
    const { door } = readingDoor({
      "pulls/7": { mergeable: null, mergeable_state: "draft" },
      "/check-runs": { check_runs: [] },
      "/status": { statuses: [{ context: LINT, state: "failure" }] },
    });

    expect(readEligibility(door, 7, SHA, [LINT])).toEqual({
      ok: true,
      eligibility: {
        mergeable: null,
        mergeable_state: "draft",
        checks: [{ context: LINT, conclusion: "failure" }],
      },
    });
  });

  it("takes the newest run when a check ran more than once", () => {
    const { door, asked } = readingDoor({
      "pulls/7": { mergeable: true, mergeable_state: "draft" },
      "/check-runs": {
        check_runs: [
          { id: 9, name: LINT, status: "completed", conclusion: "success" },
          { id: 3, name: LINT, status: "completed", conclusion: "failure" },
        ],
      },
    });

    const read = readEligibility(door, 7, SHA, [LINT]);

    expect(read.ok ? read.eligibility.checks : []).toEqual([
      { context: LINT, conclusion: "success" },
    ]);
    // Every check concluded, so the commit statuses were not asked for.
    expect(asked.filter(path => path.includes("/status"))).toEqual([]);
  });

  it("treats a pending status and an unfinished run as not yet reported", () => {
    const { door } = readingDoor({
      "pulls/7": { mergeable: true, mergeable_state: "draft" },
      "/check-runs": {
        check_runs: [{ id: 1, name: LINT, status: "in_progress" }],
      },
      "/status": { statuses: [{ context: TESTS, state: "pending" }] },
    });

    const read = readEligibility(door, 7, SHA, [LINT, TESTS]);

    expect(read.ok ? read.eligibility.checks : []).toEqual([
      { context: LINT, conclusion: null },
      { context: TESTS, conclusion: null },
    ]);
  });

  it("says why when the pull request cannot be read", () => {
    const { door } = readingDoor({});

    expect(readEligibility(door, 7, SHA, [LINT])).toEqual({
      ok: false,
      problem: "Not Found",
    });
  });
});

describe("waiting for the platform's answer", () => {
  const pending = shown("draft", { [LINT]: null }).eligibility;
  const failed = shown("draft", { [LINT]: "failure" }).eligibility;

  /**
   * Wait with a clock that moves one second a reading and a pause that
   * takes no time.
   * @param looks - What each look shows, in order; the last repeats
   * @param timeoutMs - How long to wait
   * @returns The answer, and how often it looked and paused
   */
  async function waited(
    looks: readonly ReturnType<typeof readEligibility>[],
    timeoutMs: number
  ) {
    const counts = { looks: 0, pauses: [] as number[] };
    const answer = await awaitEligibility(
      () => {
        const seen = looks[Math.min(counts.looks, looks.length - 1)];
        counts.looks += 1;
        return seen ?? { ok: false, problem: "nothing to show" };
      },
      {
        clock: steppingClock(),
        sleep: milliseconds => {
          counts.pauses.push(milliseconds);
          return Promise.resolve();
        },
        timeoutMs,
        pollMs: 15_000,
      }
    );
    return { answer, counts };
  }

  it("stops as soon as the checks have concluded", async () => {
    const { answer, counts } = await waited(
      [
        { ok: true, eligibility: pending },
        { ok: true, eligibility: pending },
        { ok: true, eligibility: failed },
      ],
      60_000
    );

    expect(answer).toEqual({
      eligibility: failed,
      timedOut: false,
      problem: null,
    });
    expect(counts).toEqual({ looks: 3, pauses: [15_000, 15_000] });
  });

  it("gives up at the time limit and says what it last saw", async () => {
    const { answer, counts } = await waited(
      [{ ok: true, eligibility: pending }],
      3000
    );

    expect(answer).toEqual({
      eligibility: pending,
      timedOut: true,
      problem: null,
    });
    // The clock moves a second a reading: start, then one per look.
    expect(counts.looks).toBe(3);
  });

  it("keeps looking through a failed read, and reports it if nothing better comes", async () => {
    const { answer } = await waited([{ ok: false, problem: "HTTP 502" }], 2000);

    expect(answer).toEqual({
      eligibility: null,
      timedOut: true,
      problem: "HTTP 502",
    });
  });
});

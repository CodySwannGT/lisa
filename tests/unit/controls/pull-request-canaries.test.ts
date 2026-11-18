/**
 * The pull-request moment with canaries (CodySwannGT/lisa#4997).
 *
 * When the operator asks for it, `lisa controls attest` opens two real pull
 * requests per entry — one carrying the violating change, one the clean
 * change — asks the hosting platform whether each could be merged, and
 * removes them. It never merges one. Every case here runs against a platform
 * that lives in memory and could be merged into, so finding the default
 * branch where it was shows something.
 * @module tests/unit/controls/pull-request-canaries
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  F_NONE_SOURCE,
  VIOLATION_MARK,
  provedGates,
} from "../../helpers/control-proofs.js";
import {
  RUN_ID,
  UNTOUCHED_FILE,
  PLATFORM_FILES,
  canaryPlatform,
  expectNoMerge,
  expectNothingLeft,
  line,
  settleWithCanaries,
} from "./support/canary-run.js";
import { removeCopies } from "./support/proof-run.js";
import { REPO } from "./support/protect-fixture.js";
import {
  BOTH_CHECK,
  BOTH_ENTRY,
  BOTH_GATES,
  PULL_ONLY_CHECK,
  PULL_ONLY_ENTRY,
  PULL_ONLY_GATE,
  PULL_ONLY_GATES,
  WORKING,
  entryOf,
  pointOf,
} from "./support/pull-request-run.js";
import { removeFixtures } from "./support/report-check-run.js";

const BASE = `repos/${REPO}`;

/** The moment every result here stands for. */
const PULL_REQUEST = "pull-request";

afterEach(() => {
  removeCopies();
  removeFixtures();
});

describe("a pull-request entry exercised with canaries", () => {
  it("passes when the required check stops the violating change and lets the clean one through", async () => {
    const platform = canaryPlatform();

    const settled = await settleWithCanaries(PULL_ONLY_GATES, platform);

    const entry = entryOf(settled, PULL_ONLY_ENTRY);
    expect(entry).toMatchObject({
      moment: PULL_REQUEST,
      outcome: "passed",
      reason: "proved",
      rung: "exercised",
      failed_halves: [],
      time_limit_seconds: 1800,
    });
    expect(
      entry.halves.map(half => [half.half, half.moment, half.outcome])
    ).toEqual([
      ["violation", PULL_REQUEST, "rejected"],
      ["clean", PULL_REQUEST, "accepted"],
    ]);
    expect(entry.halves[0]).toMatchObject({
      command: null,
      exit_status: null,
      reason: "rejected-as-declared",
      matched_lines: [`"${PULL_ONLY_CHECK}": failure`],
    });
    expect(settled.passed).toBe(true);
    expect(pointOf(settled, PULL_ONLY_ENTRY)).toMatchObject({
      rung: "exercised",
      settles_entry: true,
      observed: "required",
    });
  });

  it("builds each canary from the default branch's head and the one patch", async () => {
    const platform = canaryPlatform();

    const settled = await settleWithCanaries(PULL_ONLY_GATES, platform);

    const [violation, clean] = settled.pullRequest?.canaries ?? [];
    expect(violation).toMatchObject({
      entry_id: PULL_ONLY_ENTRY,
      half: "violation",
      branch: `lisa-attest/${RUN_ID}/20260201T000002Z-1-violation`,
      pull_request: 1,
      draft: true,
      closed: true,
      branch_removed: true,
      cleanup_problem: null,
      eligibility: {
        mergeable: true,
        mergeable_state: "draft",
        checks: [{ context: PULL_ONLY_CHECK, conclusion: "failure" }],
      },
    });
    expect(clean?.branch).toMatch(
      new RegExp(`^lisa-attest/${RUN_ID}/\\d{8}T\\d{6}Z-2-clean$`, "u")
    );
    const planted = platform.filesAt(violation?.head_sha ?? "");
    expect(planted.get(F_NONE_SOURCE)).toContain(VIOLATION_MARK);
    expect(planted.get(UNTOUCHED_FILE)).toBe(PLATFORM_FILES[UNTOUCHED_FILE]);
    expect(
      platform.filesAt(clean?.head_sha ?? "").get(F_NONE_SOURCE)
    ).not.toContain(VIOLATION_MARK);
    expect(platform.pulls().map(pull => pull.title)).toEqual([
      `[lisa-attest] ${PULL_ONLY_ENTRY} violation half (do not merge)`,
      `[lisa-attest] ${PULL_ONLY_ENTRY} clean half (do not merge)`,
    ]);
  });

  it("never merges a canary: the default branch is where it was and no request asks for one", async () => {
    const platform = canaryPlatform();
    const before = platform.head("main");

    const settled = await settleWithCanaries(PULL_ONLY_GATES, platform);

    expect(platform.head("main")).toBe(before);
    expect(settled.pullRequest?.base_head).toEqual({
      before,
      after: before,
      unchanged: true,
    });
    expectNoMerge(platform.log);
    expectNothingLeft(platform);
    // The run's own record of what it sent is the platform's record.
    expect(settled.pullRequest?.requests).toEqual(
      platform.log.map(({ method, path }) => ({ method, path, sent: true }))
    );
  });

  it("sends exactly these requests, in this order", async () => {
    const platform = canaryPlatform();

    const settled = await settleWithCanaries(PULL_ONLY_GATES, platform);

    const half = (pull: number, branch: string): readonly string[] => [
      `GET ${BASE}/git/trees/<sha>`,
      `GET ${BASE}/git/trees/<sha>`,
      `GET ${BASE}/git/trees/<sha>`,
      `GET ${BASE}/git/blobs/<sha>`,
      `POST ${BASE}/git/blobs`,
      `POST ${BASE}/git/trees`,
      `POST ${BASE}/git/commits`,
      `POST ${BASE}/git/refs`,
      `POST ${BASE}/pulls`,
      `GET ${BASE}/pulls/${String(pull)}`,
      `GET ${BASE}/commits/<sha>/check-runs?per_page=100&page=1`,
      `PATCH ${BASE}/pulls/${String(pull)}`,
      `DELETE ${BASE}/git/refs/heads/${branch}`,
    ];
    const [violation, clean] = settled.pullRequest?.canaries ?? [];
    expect(platform.log.map(line)).toEqual([
      // Reading the merge-protection settings, as the default does.
      `GET ${BASE}/rulesets`,
      `GET ${BASE}/rulesets/1`,
      `GET ${BASE}`,
      // Whether the account may write.
      `GET ${BASE}`,
      // Canaries an earlier run left behind.
      `GET ${BASE}/git/matching-refs/heads/lisa-attest/?per_page=100&page=1`,
      // What a canary is built on.
      `GET ${BASE}/git/ref/heads/main`,
      `GET ${BASE}/git/commits/<sha>`,
      ...half(1, violation?.branch ?? ""),
      ...half(2, clean?.branch ?? ""),
      // The default branch afterwards.
      `GET ${BASE}/git/ref/heads/main`,
    ]);
  });

  it("fails on the violation half when the required check lets the violating change through", async () => {
    const platform = canaryPlatform({
      conclude: () => ({ [PULL_ONLY_CHECK]: "success" }),
    });

    const settled = await settleWithCanaries(PULL_ONLY_GATES, platform);

    expect(entryOf(settled, PULL_ONLY_ENTRY)).toMatchObject({
      outcome: "failed",
      failed_halves: ["violation"],
      reason: "violation-accepted",
      rung: "exercised",
    });
    expectNothingLeft(platform);
  });

  it("fails on the clean half when the required check stops the clean change", async () => {
    const platform = canaryPlatform({
      conclude: () => ({ [PULL_ONLY_CHECK]: "failure" }),
    });

    const settled = await settleWithCanaries(PULL_ONLY_GATES, platform);

    expect(entryOf(settled, PULL_ONLY_ENTRY)).toMatchObject({
      outcome: "failed",
      failed_halves: ["clean"],
      reason: "clean-rejected",
    });
  });

  it("is unknown when the platform has not answered within the time limit, and still removes the canary", async () => {
    const platform = canaryPlatform();
    platform.pendingLooks = Number.POSITIVE_INFINITY;

    const settled = await settleWithCanaries(
      provedGates([{ command: WORKING, timeout_seconds: 3 }], PULL_ONLY_GATE, [
        PULL_REQUEST,
      ]),
      platform
    );

    const entry = entryOf(settled, PULL_ONLY_ENTRY);
    expect(entry).toMatchObject({
      outcome: "unknown",
      reason: "timed-out",
      rung: "exercised",
      time_limit_seconds: 3,
    });
    expect(entry.halves.map(half => half.reason)).toEqual([
      "timed-out",
      "timed-out",
    ]);
    expect(entry.detail).toContain("after 3 seconds");
    expectNothingLeft(platform);
  });

  it("opens an ordinary pull request where the repository is not offered drafts", async () => {
    const platform = canaryPlatform({ drafts: false });

    const settled = await settleWithCanaries(PULL_ONLY_GATES, platform);

    expect(settled.pullRequest?.canaries.map(canary => canary.draft)).toEqual([
      false,
      false,
    ]);
    expect(entryOf(settled, PULL_ONLY_ENTRY).outcome).toBe("passed");
    expectNoMerge(platform.log);
    expectNothingLeft(platform);
  });
});

describe("an entry already proved at push, with canaries asked for", () => {
  it("is not exercised a second time: it gets an observed point and no canary", async () => {
    const platform = canaryPlatform({ required: [BOTH_CHECK] });

    const settled = await settleWithCanaries(BOTH_GATES, platform);

    expect(entryOf(settled, BOTH_ENTRY)).toMatchObject({
      moment: "push",
      outcome: "passed",
    });
    expect(pointOf(settled, BOTH_ENTRY)).toMatchObject({
      rung: "observed",
      settles_entry: false,
      reason: "observed-required",
    });
    expect(platform.pulls()).toEqual([]);
    expect(platform.log.filter(request => request.method !== "GET")).toEqual(
      []
    );
    expect(settled.pullRequest).toMatchObject({
      mode: "canaries",
      run_id: RUN_ID,
      permission: { can_write: true },
      sweep: { removed: [], kept: [], problems: [] },
      base_head: null,
      canaries: [],
    });
  });
});

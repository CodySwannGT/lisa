/**
 * A traceability failure that read the tracker before the backlink existed
 * (CodySwannGT/lisa#5111).
 *
 * The documented order is push, `gh pr create`, then post the backlink. CI
 * starts when the PR opens, so the Work-Item Traceability check can read the
 * tracker before the `[lisa-pr-link]` comment exists and fail gate 5. Without
 * this path the re-dispatch then bounced a claimed item back to ready, so it
 * could be handed to a second worker.
 *
 * The rule: when the ONLY failing required check is Work-Item Traceability
 * and this PR's managed backlink was written after that check completed, the
 * verdict is stale. The check is re-run (once its workflow run has finished)
 * instead of bouncing the item. Gate 5 itself is untouched: the re-run reads
 * the tracker live, and a PR with no backlink, or one older than the check,
 * still takes the ordinary re-dispatch path.
 * @module tests/unit/scripts/lisa-ci-failure-redispatch-stale-backlink
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { trackerContract } from "../../../all/copy-overwrite/scripts/lisa-work-item.mjs";
import {
  TRACEABILITY_CHECK,
  applyPlan,
  planFromFixture,
} from "../../../scripts/lisa-ci-failure-redispatch.mjs";

const REPO = "CodySwannGT/lisa";
const PR = 4673;
const PR_URL = `https://github.com/${REPO}/pull/${PR}`;
const COMMENTS_KEY = `api repos/${REPO}/issues/4672/comments --paginate --slurp`;
const CHECKS_KEY = `pr checks ${PR} --repo ${REPO} --required --json name,state,bucket`;
const DETAIL_KEY = `pr checks ${PR} --repo ${REPO} --required --json name,bucket,completedAt,link`;
const RUN_ID = 44801048981;
const JOB_ID = 136513081160;
const RUN_KEY = `api repos/${REPO}/actions/runs/${RUN_ID}`;
const CHECK_COMPLETED = "2026-11-20T19:20:57Z";
const AFTER = "2026-11-20T19:22:04Z";
const BEFORE = "2026-11-20T19:19:00Z";

const contract = trackerContract({
  tracker: "github",
  github: { org: "CodySwannGT", repo: "lisa" },
});

/**
 * The recorded agent-PR failure, rewritten so the failing required check is
 * the traceability check.
 * @param options - What to vary.
 * @param options.backlink - The managed backlink comment, or null for none.
 * @param options.alsoFailing - Another required check that also failed.
 * @param options.runStatus - Status of the check's workflow run.
 * @returns A fixture.
 */
function scenario({
  backlink = { at: AFTER, url: PR_URL } as { at: string; url: string } | null,
  alsoFailing = null as string | null,
  runStatus = "completed",
} = {}) {
  const data = JSON.parse(
    readFileSync(
      "tests/fixtures/ci-failure-redispatch/agent-pr-failed.json",
      "utf8"
    )
  );
  const rows = [
    { name: TRACEABILITY_CHECK, state: "FAILURE", bucket: "fail" },
    {
      name: "🔍 Quality Checks / 🧪 Run Unit Tests",
      state: alsoFailing ? "FAILURE" : "SUCCESS",
      bucket: alsoFailing ? "fail" : "pass",
    },
  ];
  data.gh[CHECKS_KEY] = { stdout: rows, ok: false };
  data.gh[DETAIL_KEY] = {
    ok: false,
    stdout: rows.map(row => ({
      name: row.name,
      bucket: row.bucket,
      completedAt: CHECK_COMPLETED,
      link: `https://github.com/${REPO}/actions/runs/${RUN_ID}/job/${JOB_ID}`,
    })),
  };
  data.gh[RUN_KEY] = { stdout: { id: RUN_ID, status: runStatus } };
  if (backlink)
    data.gh[COMMENTS_KEY].stdout[0].push({
      id: 6700000099,
      user: { login: "CodySwannGT", type: "User", id: 292923 },
      created_at: backlink.at,
      updated_at: backlink.at,
      body: `[lisa-pr-link] ${backlink.url}`,
    });
  return data;
}

describe("a traceability failure that predates the PR's backlink", () => {
  it("re-runs that one job instead of re-dispatching, once its workflow run has finished", () => {
    const result = planFromFixture(scenario(), contract);
    expect(result.outcome).toBe("rerun-stale-traceability");
    expect(result.actions).toEqual([
      { kind: "rerun-job", runId: RUN_ID, jobId: JOB_ID },
    ]);
  });

  it("writes nothing while the workflow run is still in progress, because its completion re-evaluates", () => {
    const result = planFromFixture(
      scenario({ runStatus: "in_progress" }),
      contract
    );
    expect(result.outcome).toBe("stale-traceability-pending");
    expect(result.actions).toEqual([]);
  });

  it("re-runs the job through the Actions job re-run endpoint", () => {
    const calls: string[][] = [];
    applyPlan(
      {
        repository: REPO,
        actions: [{ kind: "rerun-job", runId: RUN_ID, jobId: JOB_ID }],
      },
      (args: string[]) => {
        calls.push(args);
        return { ok: true, stdout: "", stderr: "" };
      }
    );
    expect(calls).toEqual([
      ["api", "-X", "POST", `repos/${REPO}/actions/jobs/${JOB_ID}/rerun`],
    ]);
  });
});

describe("gate 5 is not weakened", () => {
  it("re-dispatches when the PR has no managed backlink at all", () => {
    const result = planFromFixture(scenario({ backlink: null }), contract);
    expect(result.outcome).toBe("redispatch");
    expect(result.actions.map(a => a.kind)).toEqual(["comment", "relabel"]);
  });

  it("re-dispatches when the backlink was written before the check completed", () => {
    const result = planFromFixture(
      scenario({ backlink: { at: BEFORE, url: PR_URL } }),
      contract
    );
    expect(result.outcome).toBe("redispatch");
  });

  it("re-dispatches when the only backlink belongs to a different pull request", () => {
    const result = planFromFixture(
      scenario({
        backlink: { at: AFTER, url: `https://github.com/${REPO}/pull/46730` },
      }),
      contract
    );
    expect(result.outcome).toBe("redispatch");
  });

  it("re-dispatches when another required check failed as well", () => {
    const result = planFromFixture(scenario({ alsoFailing: "unit" }), contract);
    expect(result.outcome).toBe("redispatch");
  });
});

describe("the check name is the one CI publishes", () => {
  it("matches the caller job name in ci.yml and the job name in quality.yml", () => {
    const [caller, job] = TRACEABILITY_CHECK.split(" / ");
    expect(readFileSync(".github/workflows/ci.yml", "utf8")).toContain(
      `name: ${caller}\n`
    );
    expect(readFileSync(".github/workflows/quality.yml", "utf8")).toMatch(
      new RegExp(`work_item_traceability:\\n {4}name: ${job}\\n`, "u")
    );
  });
});

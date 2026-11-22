/**
 * The checks that keep a stale-link clean-up from doing harm
 * (CodySwannGT/lisa#5065): a plan is confirmed against a fresh read before
 * any write, so a reopened blocker keeps its link and a concurrent body edit
 * survives; a native blocker's repository comes from the API's own fields and
 * is never assumed local; and the comment reads correctly for any mix of
 * blockers, under the name of whoever posts it.
 * @module tests/unit/strategies/stale-blocker-confirm
 */
import { describe, expect, it } from "vitest";

import { confirmStaleLinkPlan } from "../../../plugins/src/base/scripts/stale-blocker-confirm.mjs";
import { UNKNOWN_REPO } from "../../../plugins/src/base/scripts/stale-blocker-edges.mjs";
import {
  formatStaleLinkComment,
  planStaleLinkSweep,
} from "../../../plugins/src/base/scripts/stale-blocker-sweep.mjs";
import {
  GH_DONE,
  GH_ROLES,
  REPO,
  githubItem,
} from "./stale-blocker-fixtures.js";

const CLOSED = { state: "closed", state_reason: "completed" };
const OPEN = { state: "open", labels: [] };

/**
 * Plan one GitHub item.
 * @param raw - GitHub item
 * @returns The sweep's result
 */
const plan = (raw: ReturnType<typeof githubItem>) =>
  planStaleLinkSweep({
    tracker: "github",
    items: [raw],
    doneRoles: GH_DONE,
    roles: GH_ROLES,
  });

/**
 * The plan's first entry, or a failed test.
 * @param raw - GitHub item
 * @returns The entry
 */
function entry(raw: ReturnType<typeof githubItem>) {
  const first = plan(raw).plans[0];
  if (!first) throw new Error("expected a plan entry");
  return first;
}

/**
 * Confirm a plan entry against a fresh read.
 * @param planned - The entry
 * @param fresh - The item as read right before the writes
 * @returns The confirmation
 */
const confirm = (
  planned: ReturnType<typeof entry>,
  fresh: ReturnType<typeof githubItem>
) =>
  confirmStaleLinkPlan({
    tracker: "github",
    plan: planned,
    fresh,
    doneRoles: GH_DONE,
    roles: GH_ROLES,
  });

describe("confirmStaleLinkPlan", () => {
  const original = githubItem(3, {
    body: "Blocked by #9, #10",
    found: { [`${REPO}#9`]: CLOSED, [`${REPO}#10`]: CLOSED },
  });
  const planned = entry(original);

  it("keeps the link of a blocker reopened after the plan", () => {
    const fresh = githubItem(3, {
      body: original.body,
      found: { [`${REPO}#9`]: CLOSED, [`${REPO}#10`]: OPEN },
    });
    const result = confirm(planned, fresh);
    expect(result.skipped).toEqual([
      { blocker: `${REPO}#10`, reason: "blocker-not-resolved" },
    ]);
    expect(result.plan).toMatchObject({
      removed: [`${REPO}#9`],
      body: "Blocked by #10",
    });
    expect(result.plan?.comment).toContain(
      `It is still waiting on ${REPO}#10, which is not finished yet.`
    );
  });

  it("rebuilds the body from the fresh read, so a concurrent edit survives", () => {
    const edited = "A person added this line.\n\nBlocked by #9, #10";
    const fresh = githubItem(3, { body: edited, found: original.bodyBlockers });
    expect(confirm(planned, fresh).plan?.body).toBe(
      "A person added this line.\n"
    );
  });

  it("writes nothing when every planned link is already gone or the item is blocked", () => {
    const gone = confirm(planned, githubItem(3, { body: "No links now." }));
    expect(gone.plan).toBeNull();
    expect(gone.skipped.map(skip => skip.reason)).toEqual([
      "link-already-gone",
      "link-already-gone",
    ]);
    const blocked = confirm(
      planned,
      githubItem(3, {
        body: original.body,
        labels: [GH_ROLES.blocked],
        found: original.bodyBlockers,
      })
    );
    expect(blocked.plan).toBeNull();
    expect(blocked.skipped[0]?.reason).toBe("blocked-role");
  });

  it("refuses a fresh read of a different item", () => {
    expect(() => confirm(planned, githubItem(4, {}))).toThrow(/plan is for/u);
  });
});

describe("native blocker repository", () => {
  const closedNative = (fields: Record<string, unknown>) =>
    githubItem(6, {
      native: [{ id: 900, number: 40, state: "closed", ...fields }],
    });

  it("reads repository_url when the API sends no repository object", () => {
    const result = plan(
      closedNative({
        repository_url: "https://api.github.com/repos/other-org/other-repo",
      })
    );
    expect(result.plans).toEqual([]);
    expect(result.report).toMatchObject({ crossProject: 1, cleared: 0 });
  });

  it("removes a local blocker named only by repository_url", () => {
    const result = plan(
      closedNative({ repository_url: `https://api.github.com/repos/${REPO}` })
    );
    expect(result.plans[0]?.removed).toEqual([`${REPO}#40`]);
  });

  it("never assumes a blocker naming no repository is local", () => {
    const result = plan(closedNative({}));
    expect(result.plans).toEqual([]);
    expect(result.report).toMatchObject({ crossProject: 1 });
    expect(UNKNOWN_REPO).toBe("unknown-repo");
  });
});

describe("comment wording", () => {
  const edge = (blockerRef: string, verdict: string) => ({
    blockerRef,
    verdict,
  });
  const sorted = (stale: ReturnType<typeof edge>[]) => ({
    stale,
    real: [],
    crossProject: [],
    inaccessible: [],
  });

  it("drops 'also' when only cancelled blockers were removed", () => {
    expect(
      formatStaleLinkComment(sorted([edge("A-1", "cancelled")]))
    ).toContain(
      "This was marked as waiting on A-1, which was cancelled and will not be built, so it cannot hold this up. I removed the link."
    );
  });

  it("agrees in number", () => {
    const text = formatStaleLinkComment({
      stale: [edge("A-1", "cancelled"), edge("A-2", "cancelled")],
      real: [edge("A-3", "open"), edge("A-4", "open")],
      crossProject: [],
      inaccessible: [edge("A-5", "inaccessible"), edge("A-6", "inaccessible")],
    });
    expect(text).toContain(
      "which were cancelled and will not be built, so they cannot hold this up. I removed those links."
    );
    expect(text).toContain("A-3 and A-4, which are not finished yet.");
    expect(text).toContain("so I left those links alone.");
  });

  it("names whoever posts it, and refuses an unknown poster", () => {
    const one = sorted([edge("A-1", "done")]);
    expect(formatStaleLinkComment(one, "build-intake")).toMatch(
      /^\[claude-build-intake\] /u
    );
    expect(formatStaleLinkComment(one)).toMatch(/^\[lisa-session-manager\] /u);
    expect(() => formatStaleLinkComment(one, "someone")).toThrow(/poster/u);
  });
});

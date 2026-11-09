/**
 * When the producer may still write a lane on a failure marker's behalf.
 *
 * Routing and lane writes ask different questions (CodySwannGT/lisa#4707). A
 * claim comment never makes a failure marker stale for routing, but it does
 * say the lane may have moved since, so the lane writes — the claimed-to-ready
 * `relabel-repair` and the ready-to-claimed `clear-and-restore` — skip on ANY
 * claim-only comment after the marker, whoever posted it. Skipping a lane
 * write is the safe direction; before this work any later marker vetoed it.
 *
 * Reading the item's author is only ever needed to judge a later marker, so a
 * failed read must not fail the run: the author is then simply not trusted.
 * @module tests/unit/scripts/lisa-ci-marker-lane-veto
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { trackerContract } from "../../../all/copy-overwrite/scripts/lisa-work-item.mjs";
import { planFromFixture } from "../../../scripts/lisa-ci-failure-redispatch.mjs";

const REPO = "CodySwannGT/lisa";
const RELABEL_REPAIR = "relabel-repair";
const OUTSIDER = { login: "drive-by-user", id: 9, type: "User" };
const LATER_AT = "2026-11-05T12:00:00Z";
const KEY = (suffix: string) => `api repos/${REPO}/issues/4672${suffix}`;
const COMMENTS = KEY("/comments --paginate --slurp");
const EVENTS = KEY("/events --paginate --slurp");
const ISSUE_VIEW = `issue view 4672 --repo ${REPO} --json state,labels`;
const CLAIM_ONLY = [
  ["a lifecycle claim", "[lisa-tracker-claim] Claimed by Lisa."],
  ["a build-intake claim", "[claude-build-intake] Claimed by Claude."],
  ["a session-manager note", "[lisa-session-manager] released"],
] as const;

const contract = {
  ...trackerContract({
    tracker: "github",
    github: { org: "CodySwannGT", repo: "lisa" },
  }),
  trustedAuthorIds: [],
};

/**
 * A producer fixture with one outsider comment appended after the marker and
 * no label history, so only the comments can veto the lane write.
 * @param name - Fixture file name in ci-failure-redispatch.
 * @param body - The outsider's comment body.
 * @returns The fixture.
 */
function withOutsider(name: string, body: string) {
  const data = JSON.parse(
    readFileSync(`tests/fixtures/ci-failure-redispatch/${name}`, "utf8")
  );
  data.gh[EVENTS].stdout = [[]];
  data.gh[COMMENTS].stdout.at(-1).push({
    id: 6700000099,
    user: OUTSIDER,
    created_at: LATER_AT,
    body,
  });
  return data;
}

/**
 * The replayed-failure fixture with the item back in the claimed lane, so a
 * relabel repair is what the producer would plan.
 * @param body - The outsider's comment body.
 * @returns The fixture.
 */
function replayed(body: string) {
  const data = withOutsider("agent-pr-failed-replayed.json", body);
  data.gh[ISSUE_VIEW].stdout.labels = [{ name: contract.lifecycle.claimed }];
  return data;
}

describe(RELABEL_REPAIR, () => {
  it("still repairs the lane after an outsider's non-claim marker", () => {
    expect(planFromFixture(replayed("[lisa-x] hi"), contract).outcome).toBe(
      RELABEL_REPAIR
    );
  });

  it.each(CLAIM_ONLY)(
    "skips the repair after an outsider's %s",
    (_case, body) => {
      expect(planFromFixture(replayed(body), contract)).toMatchObject({
        outcome: "already-reported",
        actions: [],
      });
    }
  );
});

describe("clear-and-restore", () => {
  it("restores the claimed lane when nothing followed the marker", () => {
    const data = withOutsider("agent-pr-passed-rerun.json", "no marker here");
    expect(planFromFixture(data, contract).outcome).toBe("clear-and-restore");
  });

  it.each(CLAIM_ONLY)(
    "clears but does not restore after an outsider's %s",
    (_case, body) => {
      const result = planFromFixture(
        withOutsider("agent-pr-passed-rerun.json", body),
        contract
      );
      expect(result.outcome).toBe("cleared");
      expect(result.actions.map((a: { kind: string }) => a.kind)).toEqual([
        "edit-comment",
      ]);
    }
  );
});

describe("a failed item-author read", () => {
  it("does not fail the run; the author is treated as untrusted", () => {
    const data = replayed("[lisa-x] hi");
    data.gh[KEY("")] = { ok: false, stderr: "HTTP 502" };
    expect(planFromFixture(data, contract).outcome).toBe(RELABEL_REPAIR);
  });
});

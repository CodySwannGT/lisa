/**
 * What the CI-failure re-dispatch planner is allowed to believe.
 *
 * Two kinds of evidence decide whether it writes: the marker comments on the
 * work item, and the item's label history. Both can lie if read naively.
 *
 * - Anyone who can comment on an issue can type the marker. A forged marker
 *   must neither suppress a real re-dispatch nor make the bot edit an
 *   outsider's comment and restore a lane — so only comments authored by the
 *   workflow's own identity count as markers.
 * - "Nothing happened since the marker" cannot be read from comments alone:
 *   a claim path that posts its claim comment once per item leaves no newer
 *   comment when it re-claims. The label events are the record that a claim
 *   happened, so a claimed-lane `labeled` event after the marker vetoes both
 *   the label repair and the claimed-lane restore.
 * @module tests/unit/scripts/lisa-ci-failure-redispatch-trust
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { trackerContract } from "../../../all/copy-overwrite/scripts/lisa-work-item.mjs";
import {
  MARKER_AUTHORS,
  planFromFixture,
} from "../../../scripts/lisa-ci-failure-redispatch.mjs";

const REPO = "CodySwannGT/lisa";
const ISSUE_KEY = `issue view 4672 --repo ${REPO} --json state,labels`;
const EVENTS_KEY = `api repos/${REPO}/issues/4672/events --paginate --slurp`;
const CLAIMED = "status:in-progress";

const contract = trackerContract({
  tracker: "github",
  github: { org: "CodySwannGT", repo: "lisa" },
});

/**
 * Load a fixture by name for mutation.
 * @param name - Fixture file name.
 * @returns A fresh, mutable copy.
 */
function load(name: string) {
  return JSON.parse(
    readFileSync(`tests/fixtures/ci-failure-redispatch/${name}`, "utf8")
  );
}

describe("marker authorship", () => {
  it("trusts only the workflow's own identity by default", () => {
    expect(MARKER_AUTHORS).toEqual(["github-actions[bot]"]);
  });

  it("re-dispatches a real failure even when an outsider already posted a copy of the marker", () => {
    const result = planFromFixture(
      load("forged-marker-failure.json"),
      contract
    );
    expect(result.outcome).toBe("redispatch");
    expect(result.actions.map(a => a.kind)).toEqual(["comment", "relabel"]);
  });

  it("never edits an outsider's comment nor restores a lane on a forged marker", () => {
    const result = planFromFixture(load("forged-marker-pass.json"), contract);
    expect(result.outcome).toBe("nothing-to-clear");
    expect(result.actions).toEqual([]);
  });

  it("does not let a forged cleared marker hide a real uncleared one", () => {
    const data = load("agent-pr-passed-rerun.json");
    data.gh[
      `api repos/${REPO}/issues/4672/comments --paginate --slurp`
    ].stdout[1].push({
      id: 6700000077,
      user: { login: "drive-by-user", type: "User" },
      created_at: "2026-11-05T11:30:00Z",
      body: "<!-- [lisa-ci-failed] pr=4673 sha=3db71f89a186d5dbeb78015aa5735fa9d8efda48 -->\n<!-- [lisa-ci-cleared] run=1 -->",
    });
    const result = planFromFixture(data, contract);
    expect(result.actions.map(a => a.kind)).toContain("edit-comment");
    expect(result.actions.every(a => a.commentId !== 6700000077)).toBe(true);
  });
});

describe("label history vetoes a write the comments alone would allow", () => {
  it("leaves an item alone that was re-claimed without a new comment, when the same failure is replayed", () => {
    const result = planFromFixture(
      load("reclaimed-without-comment-replayed.json"),
      contract
    );
    expect(result.outcome).toBe("already-reported");
    expect(result.actions).toEqual([]);
  });

  it("still repairs the lane when no claim happened after the marker", () => {
    const data = load("agent-pr-failed-replayed.json");
    data.gh[ISSUE_KEY].stdout.labels = [{ name: CLAIMED }];
    data.gh[EVENTS_KEY].stdout = [
      data.gh[EVENTS_KEY].stdout[0].filter(
        (e: { created_at: string }) => e.created_at < "2026-11-05T11:00:00Z"
      ),
    ];
    expect(planFromFixture(data, contract).outcome).toBe("relabel-repair");
  });

  it("clears but does not restore the claimed lane when a claim happened after the marker", () => {
    const data = load("agent-pr-passed-rerun.json");
    data.gh[EVENTS_KEY].stdout[0].push({
      event: "labeled",
      label: { name: CLAIMED },
      created_at: "2026-11-05T12:30:00Z",
    });
    const result = planFromFixture(data, contract);
    expect(result.outcome).toBe("cleared");
    expect(result.actions.map(a => a.kind)).toEqual(["edit-comment"]);
  });
});

/**
 * The CI-failure re-dispatch decision, driven over recorded payload fixtures.
 *
 * Each fixture carries a `workflow_run` payload plus the `gh` responses that
 * run would have read, so the planner is exercised through the same argv the
 * live path sends — a fixture whose recorded call no longer matches what the
 * script asks for fails loudly instead of passing on a stale recording.
 *
 * These are the five acceptance-criteria shapes from CodySwannGT/lisa#4607:
 * a failure on an agent PR, the same failure replayed, a passing re-run, a PR
 * with no Work-Item binding, and an item outside the claimed lane.
 * @module tests/unit/scripts/lisa-ci-failure-redispatch
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { trackerContract } from "../../../all/copy-overwrite/scripts/lisa-work-item.mjs";
import {
  failureMarker,
  planFromFixture,
} from "../../../scripts/lisa-ci-failure-redispatch.mjs";

const FIXTURES = "tests/fixtures/ci-failure-redispatch";
const SHA = "3db71f89a186d5dbeb78015aa5735fa9d8efda48";
const ITEM = "CodySwannGT/lisa#4672";
const CLAIMED = "status:in-progress";
const READY = "status:ready";
const FAILED = "agent-pr-failed.json";

/** The tracker contract the Lisa repo's own `.lisa.config.json` resolves. */
const contract = trackerContract({
  tracker: "github",
  github: {
    org: "CodySwannGT",
    repo: "lisa",
    labels: {
      build: { ready: READY, claimed: CLAIMED },
    },
  },
});

/**
 * Load one recorded fixture.
 * @param name - Fixture file name.
 * @returns The parsed fixture.
 */
function fixture(name: string) {
  return JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));
}

/**
 * Plan a fixture against the Lisa contract.
 * @param name - Fixture file name.
 * @returns The planned outcome.
 */
function plan(name: string) {
  return planFromFixture(fixture(name), contract);
}

/**
 * The planned action at `index`, failing the test when it is absent.
 * @param list - Planned actions.
 * @param index - Position.
 * @returns The action.
 */
function at<T>(list: readonly T[], index: number): T {
  const value = list[index];
  if (value === undefined) throw new Error(`no planned action at ${index}`);
  return value;
}

describe("a failed required check on an agent PR", () => {
  it("plans exactly one marker comment naming the PR, head SHA and failing checks, then one claimed-to-ready move", () => {
    const result = plan(FAILED);
    expect(result.outcome).toBe("redispatch");
    expect(result.pr).toBe(4673);
    expect(result.sha).toBe(SHA);
    expect(result.item).toBe(ITEM);
    expect(result.actions).toHaveLength(2);
    const comment = at(result.actions, 0);
    const relabel = at(result.actions, 1);
    expect(comment.kind).toBe("comment");
    expect(comment.item).toBe(ITEM);
    expect(comment.body).toContain("#4673");
    expect(comment.body).toContain(SHA);
    expect(comment.body).toContain("🔍 Quality Checks / 🧪 Run Unit Tests");
    expect(comment.body).not.toContain("🔍 Quality Checks / 🧹 Lint");
    expect(comment.body).toContain(failureMarker(4673, SHA));
    expect(relabel).toEqual({
      kind: "relabel",
      item: ITEM,
      remove: CLAIMED,
      add: READY,
    });
  });

  it("puts a visible sentence before the marker, so the comment never renders as an empty bubble", () => {
    const comment = at(plan(FAILED).actions, 0);
    const visible = String(comment.body)
      .slice(0, String(comment.body).indexOf("<!--"))
      .trim();
    expect(visible.length).toBeGreaterThan(40);
  });
});

describe("a replayed failure", () => {
  it("plans nothing once the same PR and head SHA already carry a marker", () => {
    const result = plan("agent-pr-failed-replayed.json");
    expect(result.outcome).toBe("already-reported");
    expect(result.actions).toEqual([]);
  });
});

describe("a passing re-run", () => {
  it("clears the marker for that head and restores the claimed lane when the marker is what left the item unclaimed", () => {
    const result = plan("agent-pr-passed-rerun.json");
    expect(result.outcome).toBe("clear-and-restore");
    expect(result.actions).toHaveLength(2);
    const edit = at(result.actions, 0);
    const relabel = at(result.actions, 1);
    expect(edit.kind).toBe("edit-comment");
    expect(edit.commentId).toBe(6700000002);
    expect(edit.body).toContain(failureMarker(4673, SHA));
    expect(edit.body).toContain("cleared by run 42394999999");
    expect(relabel).toEqual({
      kind: "relabel",
      item: ITEM,
      remove: READY,
      add: CLAIMED,
    });
  });
});

describe("PRs the workflow must leave alone", () => {
  it("plans nothing for a PR with no Work-Item binding", () => {
    const result = plan("pr-without-work-item.json");
    expect(result.outcome).toBe("non-agent-pr");
    expect(result.actions).toEqual([]);
  });

  it("plans nothing when the bound item is not in the claimed lane", () => {
    const result = plan("item-not-claimed.json");
    expect(result.outcome).toBe("not-claimed");
    expect(result.actions).toEqual([]);
  });
});

describe("the recorded fixtures stay honest", () => {
  it("refuses a gh call the fixture did not record, instead of inventing an answer", () => {
    const data = fixture(FAILED);
    const key = Object.keys(data.gh).find(k => k.startsWith("pr checks"));
    delete data.gh[key as string];
    expect(() => planFromFixture(data, contract)).toThrow(/not recorded/u);
  });
});

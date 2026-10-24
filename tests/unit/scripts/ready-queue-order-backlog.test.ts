/**
 * The backlog tier the session manager may promote when
 * `sessionManager.backlogPickup` is on: every Ready exclusion, plus an
 * unfinished blocker and an unchanged validation failure, in the same
 * operator-first order. Also pins how each vendor's blockers and `updatedAt`
 * reach the shared item shape.
 * @module tests/unit/scripts/ready-queue-order-backlog
 */
import { describe, expect, it } from "vitest";

import {
  normalizeGithubIssue,
  normalizeJiraIssue,
  normalizeLinearIssue,
  orderBacklogQueue,
} from "../../../plugins/src/base/scripts/ready-queue-order.mjs";

const OPERATOR = "operator-1";
const ME = "agent-1";
const UPDATED = "2026-10-20T00:00:00Z";
const BLOCKED = "blocked-by-open-item";

/**
 * A normalized backlog item.
 * @param ref - Item ref
 * @param overrides - Fields to change
 * @returns Item in the shared shape
 */
function item(ref: string, overrides: Record<string, unknown> = {}) {
  return {
    ref,
    title: ref,
    assigneeId: null,
    priorityRank: 2,
    createdAt: "2026-01-01",
    updatedAt: UPDATED,
    labels: [],
    body: "",
    authorId: "author",
    isContainer: false,
    openBlockers: 0,
    repoLabels: [],
    ...overrides,
  };
}

const refs = (list: readonly Record<string, unknown>[]) =>
  list.map(one => one["ref"]);

describe("orderBacklogQueue", () => {
  it("orders the operator's items, then mine, then unassigned", () => {
    const result = orderBacklogQueue(
      [
        item("open", { priorityRank: 0 }),
        item("mine", { assigneeId: ME }),
        item("op", { assigneeId: OPERATOR, priorityRank: 3 }),
      ],
      { me: ME, operators: [OPERATOR] }
    );
    expect(refs(result.ordered)).toEqual(["op", "mine", "open"]);
    expect(result.excluded).toEqual([]);
  });

  it("applies every Ready exclusion", () => {
    const result = orderBacklogQueue(
      [
        item("theirs", { assigneeId: "someone-else" }),
        item("parent", { isContainer: true }),
        item("held", { labels: ["human-needed"] }),
        item("stranger", { authorId: "stranger" }),
        item("ok"),
      ],
      { me: ME, operators: [OPERATOR], trustedAuthorIds: ["author"] }
    );
    expect(refs(result.ordered)).toEqual(["ok"]);
    expect(result.excluded).toEqual([
      { ref: "theirs", reason: "assigned-to-other" },
      { ref: "parent", reason: "container" },
      { ref: "held", reason: "human-gated" },
      { ref: "stranger", reason: "untrusted-author" },
    ]);
  });

  it("excludes an item with an unfinished blocker", () => {
    const result = orderBacklogQueue([
      item("waiting", { openBlockers: 1 }),
      item("free"),
    ]);
    expect(refs(result.ordered)).toEqual(["free"]);
    expect(result.excluded).toEqual([{ ref: "waiting", reason: BLOCKED }]);
  });

  it("skips a cached validation failure only while the item is unchanged", () => {
    const validationFailures = {
      same: { updatedAt: UPDATED },
      edited: { updatedAt: "2026-10-01T00:00:00Z" },
    };
    const result = orderBacklogQueue([item("same"), item("edited")], {
      validationFailures,
    });
    expect(refs(result.ordered)).toEqual(["edited"]);
    expect(result.excluded).toEqual([
      { ref: "same", reason: "failed-validation-unchanged" },
    ]);
  });
});

describe("blockers and updatedAt per vendor", () => {
  it("Linear counts inverse `blocks` relations whose blocker is unfinished", () => {
    const normalized = normalizeLinearIssue({
      identifier: "TEAM-1",
      updatedAt: UPDATED,
      inverseRelations: {
        nodes: [
          { type: "blocks", issue: { state: { type: "started" } } },
          { type: "blocks", issue: { state: { type: "completed" } } },
          { type: "related", issue: { state: { type: "started" } } },
        ],
      },
    });
    expect(normalized.openBlockers).toBe(1);
    expect(normalized.updatedAt).toBe(UPDATED);
  });

  it("Jira counts inward `is blocked by` links not in the done category", () => {
    const blockedBy = (category: string) => ({
      type: { inward: "is blocked by", outward: "blocks" },
      inwardIssue: {
        fields: { status: { statusCategory: { key: category } } },
      },
    });
    const normalized = normalizeJiraIssue({
      key: "TEAM-2",
      fields: {
        updated: UPDATED,
        issuelinks: [
          blockedBy("indeterminate"),
          blockedBy("done"),
          { type: { inward: "relates to" }, inwardIssue: {} },
        ],
      },
    });
    expect(normalized.openBlockers).toBe(1);
    expect(normalized.updatedAt).toBe(UPDATED);
  });

  it("GitHub reads the open-blocker count from the dependency summary", () => {
    const normalized = normalizeGithubIssue(
      {
        number: 3,
        title: "x",
        labels: [],
        updated_at: UPDATED,
        issue_dependencies_summary: { blocked_by: 2, blocking: 0 },
      },
      { repo: "acme/repo" }
    );
    expect(normalized?.openBlockers).toBe(2);
    expect(normalized?.updatedAt).toBe(UPDATED);
  });
});

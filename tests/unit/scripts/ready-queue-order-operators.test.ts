/**
 * Operator-first Ready-queue ordering (CodySwannGT/lisa#4467).
 *
 * "Me" is whoever the tracker credential belongs to, which is often an agent
 * account rather than the person the dispatcher works for. With "me" as the
 * only identity, every item assigned to that person was excluded as someone
 * else's. These tests pin the three groups (operator, me, unassigned), that
 * priority and age still order each group, and that anyone else's item stays
 * excluded.
 * @module tests/unit/scripts/ready-queue-order-operators
 */
import { describe, expect, it } from "vitest";

import { orderReadyQueue } from "../../../plugins/src/base/scripts/ready-queue-order.mjs";

const AGENT = "agent-account";
const OPERATOR = "operator-human";
const STRANGER = "someone-else";

const item = (
  ref: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> => ({
  ref,
  title: ref,
  assigneeId: null,
  priorityRank: 4,
  createdAt: "2026-01-01T00:00:00Z",
  labels: [],
  body: "",
  authorId: "author",
  isContainer: false,
  repoLabels: [],
  ...overrides,
});

describe("orderReadyQueue with operators", () => {
  it("orders the operator's items, then mine, then unassigned, across priorities", () => {
    const result = orderReadyQueue(
      [
        item("unassigned-urgent", { priorityRank: 0 }),
        item("mine-high", { assigneeId: AGENT, priorityRank: 1 }),
        item("operator-low", { assigneeId: OPERATOR, priorityRank: 3 }),
      ],
      { me: AGENT, operators: [OPERATOR] }
    );
    expect(result.ordered.map(one => one.ref)).toEqual([
      "operator-low",
      "mine-high",
      "unassigned-urgent",
    ]);
    expect(result.excluded).toEqual([]);
  });

  it("orders inside the operator's group by priority, then age", () => {
    const result = orderReadyQueue(
      [
        item("op-low", { assigneeId: OPERATOR, priorityRank: 3 }),
        item("op-high-new", {
          assigneeId: OPERATOR,
          priorityRank: 1,
          createdAt: "2026-02-01T00:00:00Z",
        }),
        item("op-high-old", { assigneeId: OPERATOR, priorityRank: 1 }),
      ],
      { me: AGENT, operators: [OPERATOR] }
    );
    expect(result.ordered.map(one => one.ref)).toEqual([
      "op-high-old",
      "op-high-new",
      "op-low",
    ]);
  });

  it("still excludes an item assigned to anyone else", () => {
    const result = orderReadyQueue(
      [item("theirs", { assigneeId: STRANGER }), item("open")],
      { me: AGENT, operators: [OPERATOR] }
    );
    expect(result.ordered.map(one => one.ref)).toEqual(["open"]);
    expect(result.excluded).toEqual([
      { ref: "theirs", reason: "assigned-to-other" },
    ]);
  });

  it("keeps today's order with no operators: mine, then unassigned, others excluded", () => {
    const items = [
      item("operator", { assigneeId: OPERATOR }),
      item("open"),
      item("mine", { assigneeId: AGENT }),
    ];
    for (const options of [{ me: AGENT }, { me: AGENT, operators: [] }]) {
      const result = orderReadyQueue(items, options);
      expect(result.ordered.map(one => one.ref)).toEqual(["mine", "open"]);
      expect(result.excluded).toEqual([
        { ref: "operator", reason: "assigned-to-other" },
      ]);
    }
  });

  it("treats the operator's items first when the credential is the operator's own", () => {
    const result = orderReadyQueue(
      [item("open", { priorityRank: 0 }), item("op", { assigneeId: OPERATOR })],
      { me: OPERATOR, operators: [OPERATOR] }
    );
    expect(result.ordered.map(one => one.ref)).toEqual(["op", "open"]);
  });

  it("ignores blank operator entries", () => {
    const result = orderReadyQueue([item("x", { assigneeId: OPERATOR })], {
      me: AGENT,
      operators: ["", OPERATOR],
    });
    expect(result.ordered.map(one => one.ref)).toEqual(["x"]);
  });
});

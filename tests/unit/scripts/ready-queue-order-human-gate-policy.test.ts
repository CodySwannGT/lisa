/**
 * The Ready-queue ordering judges holds under the project's human-gate policy
 * (CodySwannGT/lisa#4687 review).
 *
 * A lift comment discharges a hold only while the hold is invalid, and
 * validity depends on `humanGate.mode` and `humanGate.humanOnly`. An ordering
 * that dropped both judged every hold under access-only, so in a strict
 * project a lifted accountable-person hold — valid again under strict — was
 * dispatched as Ready work.
 * @module tests/unit/scripts/ready-queue-order-human-gate-policy
 */
import { describe, expect, it } from "vitest";

import { formatHumanGateLift } from "../../../plugins/src/base/scripts/human-gate-lift.mjs";
import {
  orderBacklogQueue,
  orderReadyQueue,
} from "../../../plugins/src/base/scripts/ready-queue-order.mjs";

const ME = "me";
const GATED = "human-gated";

/**
 * A Ready item carrying a hold and a lift comment naming it.
 * @param ref - Item ref
 * @param reason - The hold's slug
 * @param visible - The visible "Held for …" line
 * @returns A normalized queue item
 */
function lifted(ref: string, reason: string, visible: string) {
  return {
    ref,
    title: ref,
    assigneeId: null,
    priorityRank: 4,
    createdAt: "2026-01-01T00:00:00Z",
    labels: [],
    body: `${visible}\n<!-- [lisa-human-gate] reason=${reason} -->`,
    comments: [{ body: formatHumanGateLift({ reason }) }],
    authorId: "author",
    isContainer: false,
    repoLabels: [],
  };
}

const accountable = lifted(
  "accountable",
  "accountable-owner",
  "Held for a person to name an accountable person: the processor owner."
);
const pricing = lifted(
  "pricing",
  "pricing-tier",
  "Held for a human product call: pricing tier."
);

describe("orderReadyQueue under humanGate policy", () => {
  it("dispatches a lifted legacy hold under access-only", () => {
    const result = orderReadyQueue([accountable], { me: ME });
    expect(result.ordered.map(one => one.ref)).toEqual(["accountable"]);
  });

  it("keeps a lifted hold that is valid again under strict excluded", () => {
    const result = orderReadyQueue([accountable], {
      me: ME,
      humanGateMode: "strict",
    });
    expect(result.ordered).toEqual([]);
    expect(result.excluded).toEqual([{ ref: "accountable", reason: GATED }]);
  });

  it("keeps a lifted hold in a declared humanOnly class excluded", () => {
    const result = orderReadyQueue([pricing], {
      me: ME,
      humanOnly: ["pricing"],
    });
    expect(result.excluded).toEqual([{ ref: "pricing", reason: GATED }]);
  });

  it("applies the same policy to the backlog tier", () => {
    const result = orderBacklogQueue([accountable], {
      me: ME,
      humanGateMode: "strict",
    });
    expect(result.excluded).toContainEqual({
      ref: "accountable",
      reason: GATED,
    });
  });
});

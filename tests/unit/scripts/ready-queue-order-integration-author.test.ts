/**
 * Integration-authored items and the `integration:` trusted-author entry
 * (CodySwannGT/lisa#4895).
 *
 * Linear's Sentry integration files issues with `creator: null`, so no person
 * id exists to put in `trustedAuthorIds`: every such item was excluded as
 * `untrusted-author`, and the only lever was removing the key, which also
 * removed every hold releaser. `integration:<service>` trusts the items an
 * integration files, matched on Linear's `botActor`, without trusting any
 * person and without trusting an outside user who filed through it.
 * @module tests/unit/scripts/ready-queue-order-integration-author
 */
import { describe, expect, it } from "vitest";

import {
  normalizeLinearIssue,
  orderReadyQueue,
} from "../../../plugins/src/base/scripts/ready-queue-order.mjs";

const UNTRUSTED = "untrusted-author";
const HUMAN_ID = "a1b2c3d4-0000-4000-8000-000000000001";
const TRUST_SENTRY = "integration:sentry";
const SENTRY_BOT = { type: "integration", subType: "sentry", name: "Sentry" };

/**
 * One raw Linear issue node as the session manager's fetch returns it.
 * @param identifier - Issue identifier
 * @param author - The author fields to set on the node
 * @returns Raw node
 */
function linearNode(identifier: string, author: Record<string, unknown>) {
  return {
    identifier,
    title: `Issue ${identifier}`,
    priority: 0,
    createdAt: "2026-11-01T00:00:00Z",
    updatedAt: "2026-11-01T00:00:00Z",
    assignee: null,
    labels: { nodes: [] },
    description: "",
    children: { nodes: [] },
    ...author,
  };
}

/** Sentry-filed: no person, no outside user, the integration on botActor. */
const SENTRY_FILED = {
  creator: null,
  externalUserCreator: null,
  botActor: SENTRY_BOT,
};

/**
 * Normalize nodes and order them under a trusted-author policy.
 * @param nodes - Raw Linear nodes
 * @param trustedAuthorIds - The configured list
 * @returns The order
 */
function order(
  nodes: ReturnType<typeof linearNode>[],
  trustedAuthorIds: string[]
) {
  return orderReadyQueue(
    nodes.map(node => normalizeLinearIssue(node)),
    { me: "me", trustedAuthorIds }
  );
}

describe("normalizeLinearIssue authorIntegration", () => {
  it("names the integration service for an item no person filed", () => {
    expect(
      normalizeLinearIssue(linearNode("OPS-1", SENTRY_FILED)).authorIntegration
    ).toBe("sentry");
  });

  it("falls back to the app name when the bot has no service", () => {
    const node = linearNode("OPS-2", {
      ...SENTRY_FILED,
      botActor: { type: "oauthClient", subType: null, name: "Sentry" },
    });
    expect(normalizeLinearIssue(node).authorIntegration).toBe("Sentry");
  });

  it("is null when a person authored the item, whatever botActor says", () => {
    const node = linearNode("OPS-3", {
      ...SENTRY_FILED,
      creator: { id: HUMAN_ID },
    });
    expect(normalizeLinearIssue(node).authorIntegration).toBeNull();
  });

  it("is null when an outside user filed through the integration", () => {
    const node = linearNode("OPS-4", {
      ...SENTRY_FILED,
      externalUserCreator: { id: "external-1" },
    });
    expect(normalizeLinearIssue(node).authorIntegration).toBeNull();
  });

  it("is null when the fetch did not ask who else may have filed it", () => {
    const node = linearNode("OPS-5", {
      creator: null,
      botActor: SENTRY_BOT,
    });
    expect(normalizeLinearIssue(node).authorIntegration).toBeNull();
  });

  it("is null for a deleted account, which has no bot either", () => {
    const node = linearNode("OPS-6", {
      creator: null,
      externalUserCreator: null,
      botActor: null,
    });
    expect(normalizeLinearIssue(node).authorIntegration).toBeNull();
  });
});

describe("orderReadyQueue with an integration: entry", () => {
  it("dispatches integration-filed items while the gate stays on for people", () => {
    const result = order(
      [
        linearNode("OPS-1", SENTRY_FILED),
        linearNode("OPS-2", { creator: { id: HUMAN_ID } }),
        linearNode("OPS-3", {
          creator: { id: "contractor-9" },
          externalUserCreator: null,
          botActor: null,
        }),
      ],
      [`id:${HUMAN_ID}`, TRUST_SENTRY]
    );
    expect(result.ordered.map(item => item.ref)).toEqual(["OPS-1", "OPS-2"]);
    expect(result.excluded).toEqual([{ ref: "OPS-3", reason: UNTRUSTED }]);
  });

  it("does not trust a different integration", () => {
    const result = order(
      [
        linearNode("OPS-1", {
          ...SENTRY_FILED,
          botActor: { type: "integration", subType: "slack", name: "Slack" },
        }),
      ],
      [TRUST_SENTRY]
    );
    expect(result.ordered).toEqual([]);
    expect(result.excluded).toEqual([
      { ref: "OPS-1", reason: UNTRUSTED, authorIntegration: "slack" },
    ]);
  });

  it("does not trust an outside user filing through a trusted integration", () => {
    const result = order(
      [
        linearNode("OPS-1", {
          ...SENTRY_FILED,
          externalUserCreator: { id: "external-1" },
        }),
      ],
      [TRUST_SENTRY]
    );
    expect(result.excluded).toEqual([{ ref: "OPS-1", reason: UNTRUSTED }]);
  });

  it("prints the integration value beside an untrusted integration-filed item", () => {
    const result = order(
      [linearNode("OPS-1", SENTRY_FILED)],
      [`id:${HUMAN_ID}`]
    );
    expect(result.excluded).toEqual([
      { ref: "OPS-1", reason: UNTRUSTED, authorIntegration: "sentry" },
    ]);
  });

  it("never lets an integration: entry match an operator assignee", () => {
    const result = orderReadyQueue(
      [
        normalizeLinearIssue(
          linearNode("OPS-1", { ...SENTRY_FILED, assignee: { id: "sentry" } })
        ),
      ],
      { me: "me", operators: [TRUST_SENTRY] }
    );
    expect(result.excluded).toEqual([
      { ref: "OPS-1", reason: "assigned-to-other" },
    ]);
  });
});

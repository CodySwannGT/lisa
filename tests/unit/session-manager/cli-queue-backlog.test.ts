/**
 * `queue` with `sessionManager.backlogPickup`: the backlog tier comes back as
 * `backlogOrdered`, strictly behind every Ready item, with open blockers and
 * unchanged validation failures excluded; the key needs `operatorIds`, and a
 * missing or partial backlog envelope is refused. Run as a real process
 * against the stub harness.
 * @module tests/unit/session-manager/cli-queue-backlog
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { validateSessionManager } from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/validate-config.mjs";
import {
  makeSandbox,
  removeSandboxes,
  runCli,
  writeJson,
  type Sandbox,
} from "./support/cli-harness.js";

afterEach(removeSandboxes);

const AGENT = "agent-uuid";
const OPERATOR = "operator-uuid";
const UPDATED = "2026-10-20T00:00:00Z";
const QUEUE_INPUT = "queue-input.json";

/**
 * Merge fields into the sandbox's sessionManager block.
 * @param sandbox - Project sandbox
 * @param patch - Fields to set
 */
function patchBlock(sandbox: Sandbox, patch: Record<string, unknown>): void {
  const file = path.join(sandbox.root, ".lisa.config.json");
  const config = JSON.parse(readFileSync(file, "utf8"));
  writeJson(file, {
    ...config,
    sessionManager: { ...config.sessionManager, ...patch },
  });
}

/**
 * One raw Linear node as the access layer returns it.
 * @param identifier - Issue key
 * @param extra - Fields to add or override
 * @returns Raw node
 */
function linearNode(identifier: string, extra: Record<string, unknown> = {}) {
  return {
    identifier,
    title: identifier,
    priority: 3,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: UPDATED,
    assignee: null,
    labels: { nodes: [] },
    description: "",
    creator: { id: "author" },
    children: { nodes: [] },
    ...extra,
  };
}

/**
 * Run `queue --tracker linear` on an envelope written into the sandbox.
 * @param sandbox - Project sandbox
 * @param envelope - Queue input
 * @returns CLI result
 */
function runQueue(sandbox: Sandbox, envelope: Record<string, unknown>) {
  const input = path.join(sandbox.root, QUEUE_INPUT);
  writeJson(input, envelope);
  return runCli(sandbox, [
    "queue",
    "--tracker",
    "linear",
    "--input",
    input,
    "--me",
    AGENT,
  ]);
}

const refs = (list: { ref: string }[]) => list.map(one => one.ref);

describe("queue with backlogPickup", () => {
  it("orders the backlog after every ready item and applies its exclusions", () => {
    const sandbox = makeSandbox();
    patchBlock(sandbox, { operatorIds: [OPERATOR], backlogPickup: true });
    const result = runQueue(sandbox, {
      complete: true,
      pages: 1,
      items: [linearNode("DEMO-1", { priority: 4 })],
      backlog: {
        complete: true,
        pages: 1,
        items: [
          linearNode("DEMO-1"),
          linearNode("DEMO-5", { priority: 1 }),
          linearNode("DEMO-6", { assignee: { id: OPERATOR }, priority: 4 }),
          linearNode("DEMO-7", {
            inverseRelations: {
              nodes: [
                { type: "blocks", issue: { state: { type: "started" } } },
              ],
            },
          }),
          linearNode("DEMO-8", { assignee: { id: "someone-else" } }),
        ],
      },
    });
    expect(result.status).toBe(0);
    expect(refs(result.json.ordered)).toEqual(["DEMO-1"]);
    expect(result.json.backlogPickup).toBe(true);
    // DEMO-1 is Ready work, so it never reappears in the backlog tier.
    expect(result.json.backlogTotal).toBe(4);
    expect(refs(result.json.backlogOrdered)).toEqual(["DEMO-6", "DEMO-5"]);
    expect(result.json.backlogExcluded).toEqual([
      { ref: "DEMO-7", reason: "blocked-by-open-item" },
      { ref: "DEMO-8", reason: "assigned-to-other" },
    ]);
  });

  it("skips a cached validation failure until the item changes", () => {
    const sandbox = makeSandbox();
    patchBlock(sandbox, { operatorIds: [OPERATOR], backlogPickup: true });
    const recorded = runCli(
      sandbox,
      ["ledger", "validation-failed", "DEMO-9", "--updated-at", UPDATED],
      { input: "S18: two questions" }
    );
    expect(recorded.status).toBe(0);
    const envelope = (updatedAt: string) => ({
      complete: true,
      pages: 1,
      items: [],
      backlog: {
        complete: true,
        pages: 1,
        items: [linearNode("DEMO-9", { updatedAt })],
      },
    });
    const unchanged = runQueue(sandbox, envelope(UPDATED));
    expect(unchanged.json.backlogExcluded).toEqual([
      { ref: "DEMO-9", reason: "failed-validation-unchanged" },
    ]);
    const edited = runQueue(sandbox, envelope("2026-10-22T00:00:00Z"));
    expect(refs(edited.json.backlogOrdered)).toEqual(["DEMO-9"]);
  });

  it("refuses a missing or partial backlog envelope while the key is on", () => {
    const sandbox = makeSandbox();
    patchBlock(sandbox, { operatorIds: [OPERATOR], backlogPickup: true });
    const ready = { complete: true, pages: 1, items: [] };
    expect(runQueue(sandbox, ready).status).toBe(2);
    expect(
      runQueue(sandbox, {
        ...ready,
        backlog: { complete: false, pages: 1, items: [] },
      }).status
    ).toBe(2);
  });

  it("leaves the backlog out when the key is off", () => {
    const sandbox = makeSandbox();
    const result = runQueue(sandbox, {
      complete: true,
      pages: 1,
      items: [],
      backlog: { complete: true, pages: 1, items: [linearNode("DEMO-2")] },
    });
    expect(result.status).toBe(0);
    expect(result.json.backlogPickup).toBe(false);
    expect(result.json.backlogOrdered).toBeUndefined();
  });
});

describe("validate sessionManager.backlogPickup", () => {
  const block = {
    name: "demo-manager",
    notify: { provider: "telegram", stateDir: "~/.claude/channels/telegram-x" },
  };

  it("accepts it with operatorIds, and false or absent without", () => {
    expect(
      validateSessionManager({
        ...block,
        operatorIds: [OPERATOR],
        backlogPickup: true,
      })
    ).toEqual([]);
    expect(validateSessionManager({ ...block, backlogPickup: false })).toEqual(
      []
    );
    expect(validateSessionManager(block)).toEqual([]);
  });

  it("refuses true without operatorIds", () => {
    const errors = validateSessionManager({ ...block, backlogPickup: true });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("operatorIds");
  });

  it("refuses a non-boolean", () => {
    const errors = validateSessionManager({
      ...block,
      operatorIds: [OPERATOR],
      backlogPickup: "yes",
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("backlogPickup");
  });
});

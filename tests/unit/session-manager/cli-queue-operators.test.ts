/**
 * `queue` reads `sessionManager.operatorIds` and dispatches the operator's
 * items first (CodySwannGT/lisa#4467), and `validate` refuses a malformed
 * list. Run as a real process against the stub harness.
 * @module tests/unit/session-manager/cli-queue-operators
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
const OPERATOR_IDS = "sessionManager.operatorIds";

/**
 * Add `operatorIds` to the sandbox's sessionManager block.
 * @param sandbox - Project sandbox
 * @param operatorIds - Value to set
 */
function setOperatorIds(sandbox: Sandbox, operatorIds: unknown): void {
  const file = path.join(sandbox.root, ".lisa.config.json");
  const config = JSON.parse(readFileSync(file, "utf8"));
  writeJson(file, {
    ...config,
    sessionManager: { ...config.sessionManager, operatorIds },
  });
}

/**
 * One raw Linear node as the access layer returns it.
 * @param identifier - Issue key
 * @param assigneeId - Assignee id, or null
 * @param priority - Linear native priority (1 urgent .. 4 low)
 * @returns Raw node
 */
function linearNode(
  identifier: string,
  assigneeId: string | null,
  priority: number
) {
  return {
    identifier,
    title: identifier,
    priority,
    createdAt: "2026-01-01T00:00:00Z",
    assignee: assigneeId === null ? null : { id: assigneeId },
    labels: { nodes: [] },
    description: "",
    creator: { id: "author" },
    children: { nodes: [] },
  };
}

describe("queue with operatorIds", () => {
  it("orders the operator's items, then the agent's, then unassigned", () => {
    const sandbox = makeSandbox();
    const input = path.join(sandbox.root, "queue-input.json");
    setOperatorIds(sandbox, [OPERATOR]);
    writeJson(input, {
      complete: true,
      pages: 1,
      items: [
        linearNode("DEMO-1", null, 1),
        linearNode("DEMO-2", AGENT, 2),
        linearNode("DEMO-3", OPERATOR, 4),
        linearNode("DEMO-4", "someone-else", 1),
      ],
    });
    const result = runCli(sandbox, [
      "queue",
      "--tracker",
      "linear",
      "--input",
      input,
      "--me",
      AGENT,
    ]);
    expect(result.status).toBe(0);
    expect(result.json.operators).toEqual([OPERATOR]);
    expect(result.json.ordered.map((one: { ref: string }) => one.ref)).toEqual([
      "DEMO-3",
      "DEMO-2",
      "DEMO-1",
    ]);
    expect(result.json.excluded).toEqual([
      { ref: "DEMO-4", reason: "assigned-to-other" },
    ]);
  });
});

describe(`validate ${OPERATOR_IDS}`, () => {
  const block = {
    name: "demo-manager",
    notify: { provider: "telegram", stateDir: "~/.claude/channels/telegram-x" },
  };

  it("accepts a list of ids and an absent key", () => {
    expect(
      validateSessionManager({ ...block, operatorIds: [OPERATOR] })
    ).toEqual([]);
    expect(validateSessionManager(block)).toEqual([]);
  });

  it.each([[[]], [[""]], [[42]], ["operator"]])("refuses %j", operatorIds => {
    const errors = validateSessionManager({ ...block, operatorIds });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(OPERATOR_IDS);
  });

  // An explicit null must not be read as "no operators" on the way to validation.
  it.each([[[]], [null]])(
    "makes the CLI validate command fail for %j",
    operatorIds => {
      const sandbox = makeSandbox();
      setOperatorIds(sandbox, operatorIds);
      const result = runCli(sandbox, ["validate"]);
      expect(result.status).toBe(2);
      expect(JSON.stringify(result.json.errors)).toContain(OPERATOR_IDS);
    }
  );
});

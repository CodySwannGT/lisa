/**
 * Kind-keyed operator and trusted-author entries through the real CLIs
 * (CodySwannGT/lisa#4623): the session manager's `validate`, the doctor's
 * `validate-config.mjs`, `queue`, and `blocked-plan`'s trusted releasers.
 *
 * A plain all-digit operator entry is a warning, never an error, so it must
 * surface in the output without failing the command; a malformed entry fails
 * it. `blocked-plan` hands trusted ids to the hold-release check, which
 * compares ids only, so an `id:` entry must arrive there as its bare value
 * and a `login:` entry must not arrive at all.
 * @module tests/unit/session-manager/cli-operator-id-kinds
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import {
  HUMAN_GATE_MARKER,
  formatHumanGateRelease,
} from "../../../plugins/src/base/scripts/intake-blocker-reprobe.mjs";
import {
  makeSandbox,
  removeSandboxes,
  runCli,
  writeJson,
  type Sandbox,
} from "./support/cli-harness.js";

afterEach(removeSandboxes);

const VALIDATOR = path.resolve(
  "plugins/src/base/skills/lisa-secrets-access/scripts/validate-config.mjs"
);

/**
 * Merge `fields` into the sandbox's sessionManager block.
 * @param sandbox - Project sandbox
 * @param fields - Fields to set
 */
function setBlock(sandbox: Sandbox, fields: Record<string, unknown>): void {
  const file = path.join(sandbox.root, ".lisa.config.json");
  const config = JSON.parse(readFileSync(file, "utf8"));
  writeJson(file, {
    ...config,
    sessionManager: { ...config.sessionManager, ...fields },
  });
}

describe("validate with a plain all-digit operator entry", () => {
  it("stays valid and reports the warning beside the errors", () => {
    const sandbox = makeSandbox();
    setBlock(sandbox, { operatorIds: ["583231"] });
    const result = runCli(sandbox, ["validate"]);
    expect(result.status).toBe(0);
    expect(result.json.valid).toBe(true);
    expect(result.json.errors).toEqual([]);
    expect(result.json.warnings).toHaveLength(1);
    expect(result.json.warnings[0]).toContain('"login:583231"');
  });

  it("fails naming a malformed entry", () => {
    const sandbox = makeSandbox();
    setBlock(sandbox, { operatorIds: ["user:583231"] });
    const result = runCli(sandbox, ["validate"]);
    expect(result.status).toBe(2);
    expect(JSON.stringify(result.json.errors)).toContain("user:583231");
  });

  it("prints the warning from the doctor's validator without failing", () => {
    const sandbox = makeSandbox();
    setBlock(sandbox, { operatorIds: ["583231"] });
    const result = boundedSpawnSync({
      label: "validate-config",
      command: process.execPath,
      args: [VALIDATOR],
      cwd: sandbox.root,
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toContain('"id:583231"');
  });
});

describe("queue with kind-keyed operators", () => {
  /**
   * One raw Linear node as the access layer returns it.
   * @param identifier - Issue key
   * @param assigneeId - Assignee user id, or null
   * @returns Raw node
   */
  const linearNode = (identifier: string, assigneeId: string | null) => ({
    identifier,
    title: identifier,
    priority: 1,
    createdAt: "2026-01-01T00:00:00Z",
    assignee: assigneeId === null ? null : { id: assigneeId },
    labels: { nodes: [] },
    description: "",
    creator: { id: "author" },
    children: { nodes: [] },
  });

  /**
   * Run `queue --tracker linear` with the operator entries given.
   * @param operatorIds - Entries to configure
   * @returns CLI result
   */
  function runQueue(operatorIds: string[]) {
    const sandbox = makeSandbox();
    const input = path.join(sandbox.root, "queue-input.json");
    const args = ["queue", "--tracker", "linear", "--input", input];
    setBlock(sandbox, { operatorIds });
    writeJson(input, {
      complete: true,
      pages: 1,
      items: [linearNode("DEMO-1", null), linearNode("DEMO-2", "op-uuid")],
    });
    return runCli(sandbox, [...args, "--me", "agent"]);
  }

  it("echoes the entries and orders an id: operator's Linear item first", () => {
    const result = runQueue(["id:op-uuid"]);
    expect(result.status).toBe(0);
    expect(result.json.operators).toEqual(["id:op-uuid"]);
    expect(result.json.ordered.map((one: { ref: string }) => one.ref)).toEqual([
      "DEMO-2",
      "DEMO-1",
    ]);
  });

  it("never reads a login: entry as a Linear user id", () => {
    const result = runQueue(["login:op-uuid"]);
    expect(result.json.excluded).toEqual([
      { ref: "DEMO-2", reason: "assigned-to-other" },
    ]);
  });
});

describe("blocked-plan with kind-keyed trusted releasers", () => {
  const REASON = "design-call";
  const held = (author: Record<string, unknown>) => ({
    labels: [],
    body: `Waiting.\n<!-- ${HUMAN_GATE_MARKER} reason=${REASON} -->`,
    comments: [
      {
        ...author,
        body: formatHumanGateRelease({ reason: REASON, decision: "go" }),
      },
    ],
    edges: [
      { contained: true, blockerState: "closed", blockerReason: "completed" },
    ],
  });

  it("releases on a comment by the id: entry's account", () => {
    const sandbox = makeSandbox();
    setBlock(sandbox, { trustedAuthorIds: ["id:4242"] });
    const result = runCli(sandbox, ["blocked-plan"], {
      input: JSON.stringify(held({ user: { login: "op", id: 4242 } })),
    });
    expect(result.json.action).toBe("release");
  });

  it("never releases on a numeric id that equals a login: entry", () => {
    const sandbox = makeSandbox();
    setBlock(sandbox, { trustedAuthorIds: ["login:4242"] });
    const result = runCli(sandbox, ["blocked-plan"], {
      input: JSON.stringify(held({ user: { login: "x", id: 4242 } })),
    });
    expect(result.json.action).toBe("skip-human-gate");
  });
});

/**
 * Integration tests for the session-manager CLI's message and record
 * commands: route, blocked-plan and record-cycle, run as a real process.
 *
 * A Telegram message, a Blocked item's body and comments, and the cycle
 * summary are untrusted text, so each arrives on stdin.
 * @module tests/unit/session-manager/cli-messages
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { makeSandbox, removeSandboxes, runCli } from "./support/cli-harness.js";

afterEach(removeSandboxes);

const RECORD_CYCLE = "record-cycle";
const BLOCKED_PLAN = "blocked-plan";

describe("route", () => {
  it("routes a prefixed answer read from stdin", () => {
    const sandbox = makeSandbox();
    runCli(sandbox, ["ledger", "set-question", "DEMO-6"], {
      input: "Pick one",
    });
    const result = runCli(sandbox, ["route", "--owner", "Ops"], {
      input: "DEMO-6: 2",
    });
    expect(result.json).toMatchObject({
      kind: "answer",
      ref: "DEMO-6",
      body: "2",
      message: "Ops's answer: 2",
    });
  });

  it("parses an operator command", () => {
    const result = runCli(makeSandbox(), ["route"], { input: "cap 3" });
    expect(result.json).toEqual({ kind: "command", name: "cap", value: 3 });
  });
});

describe("blocked-plan", () => {
  it("reads the item JSON from stdin and plans a release", () => {
    const result = runCli(makeSandbox(), [BLOCKED_PLAN], {
      input: JSON.stringify({
        labels: [],
        body: "",
        comments: [],
        edges: [
          {
            contained: true,
            blockerState: "closed",
            blockerReason: "completed",
          },
        ],
      }),
    });
    expect(result.status).toBe(0);
    expect(result.json.action).toBe("release");
  });

  it("exits 2 on input that is not JSON", () => {
    expect(
      runCli(makeSandbox(), [BLOCKED_PLAN], { input: "nope" }).status
    ).toBe(2);
  });
});

describe("record-cycle", () => {
  it("records under loop id session-manager with the session-manager runbook", () => {
    const sandbox = makeSandbox();
    const result = runCli(
      sandbox,
      [RECORD_CYCLE, "--outcome", "nothing-needed", "--run-id", "cycle-1"],
      { input: "swept 3 ready, 0 dispatchable; 2 running/6 cap" }
    );
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    const row = JSON.parse(
      readFileSync(
        path.join(sandbox.root, ".lisa/automations/runs/session-manager.jsonl"),
        "utf8"
      ).trim()
    );
    expect(row).toMatchObject({
      loop_id: "session-manager",
      outcome: "nothing-needed",
      runbook: ".lisa/automations/session-manager.runbook.md",
      run_id: "cycle-1",
    });
  });

  it("exits 2 on an unknown outcome", () => {
    const result = runCli(makeSandbox(), [RECORD_CYCLE, "--outcome", "great"], {
      input: "x",
    });
    expect(result.status).toBe(2);
  });
});

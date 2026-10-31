/**
 * The cycle keeps dispatching while one item needs a human
 * (CodySwannGT/lisa#4555, part 3, acceptance: "a human-needed item is marked
 * on the tracker with its question, and the same cycle still dispatches
 * other Ready items").
 *
 * Drives the real CLI through the runbook's order for item A — `mark-plan`,
 * `ledger set-question`, (the tracker write, done by `lisa-tracker-write`),
 * `ledger marked` — and then the rest of the same cycle: `queue` must leave
 * A out as `pending-question` and still return B, `spawn B` must start a
 * worker, and `status` must show B live and A waiting on a human. Every
 * external tool is a recording stub on a stub-only PATH, so no real `gh`,
 * `claude` or `bws` can run and nothing reaches a real tracker.
 * @module tests/unit/session-manager/cli-cycle-human-needed
 */
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  MEMINFO,
  makeSandbox,
  removeSandboxes,
  writeJson,
} from "./support/cli-harness.js";
import { activeAgent, callsOf } from "./support/cli-fixtures.js";
import {
  LOOSE_CAPACITY,
  runStubOnly as run,
  WORKER_QUESTION,
} from "./support/human-sandbox.js";

afterEach(removeSandboxes);

const GH_REPO = "example-org/demo-repo";
const A = `${GH_REPO}#1`;
const B = `${GH_REPO}#2`;
const QUESTION = "Which payment provider should the checkout use?";

/**
 * A Ready GitHub issue row, unassigned.
 * @param number - Issue number
 * @returns Row
 */
function ghIssue(number: number) {
  return {
    number,
    title: `Issue ${number}`,
    body: "",
    user: { id: 100 + number, login: "author" },
    assignee: null,
    labels: [{ name: "status:ready" }],
    created_at: `2026-01-0${number}T00:00:00Z`,
    repository_url: `https://api.github.com/repos/${GH_REPO}`,
  };
}

describe("a cycle with one human-needed item", () => {
  it("marks A, leaves it out of the queue, and still dispatches B", () => {
    const sandbox = makeSandbox();
    const pages = path.join(sandbox.root, "pages.json");
    writeJson(pages, [[ghIssue(1), ghIssue(2)]]);

    const plan = run(sandbox, ["mark-plan", A, "--kind", WORKER_QUESTION], {
      input: QUESTION,
    });
    expect(plan.status).toBe(0);
    expect(plan.json.marker).toEqual({ type: "label", value: "human-needed" });
    expect(plan.json.comment).toContain(QUESTION);

    const asked = run(
      sandbox,
      ["ledger", "set-question", A, "--kind", WORKER_QUESTION],
      { input: QUESTION }
    );
    expect(asked.status).toBe(0);
    expect(asked.json.pendingQuestion.markedAt).toBeNull();

    const marked = run(sandbox, [
      "ledger",
      "marked",
      A,
      "--marker-type",
      plan.json.marker.type,
      "--marker",
      plan.json.marker.value,
    ]);
    expect(marked.status).toBe(0);

    const queue = run(sandbox, ["queue", "--tracker", "github", "--me", "me"], {
      env: { STUB_GH_FILE: pages },
    });
    expect(queue.status).toBe(0);
    expect(queue.json.ordered.map((item: { ref: string }) => item.ref)).toEqual(
      [B]
    );
    expect(queue.json.excluded).toContainEqual({
      ref: A,
      reason: "pending-question",
    });

    const spawn = run(sandbox, ["spawn", B, "--meminfo", MEMINFO]);
    expect(spawn.stderr).toBe("");
    expect(spawn.status).toBe(0);
    expect(callsOf(spawn.calls, "claude", "--bg")).toHaveLength(1);

    const status = run(sandbox, ["status"], {
      agents: [activeAgent(spawn.json.name)],
    });
    expect(status.status).toBe(0);
    expect(status.json.workers).toContainEqual(
      expect.objectContaining({ ref: B, live: true })
    );
    expect(status.json.pendingQuestions).toEqual([
      expect.objectContaining({
        ref: A,
        kind: WORKER_QUESTION,
        text: QUESTION,
        marked: true,
        answerQueued: false,
        answerCommand: expect.stringContaining(`answer "${A}"`),
      }),
    ]);
  });

  it("leaves a pending item out of the backlog tier too", () => {
    const sandbox = makeSandbox({
      sessionManager: {
        name: "demo-manager",
        backlogPickup: true,
        operatorIds: ["op"],
        capacity: LOOSE_CAPACITY,
      },
    });
    const node = (identifier: string) => ({
      identifier,
      title: identifier,
      priority: 3,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-10-20T00:00:00Z",
      assignee: null,
      labels: { nodes: [] },
      description: "",
      creator: { id: "author" },
      children: { nodes: [] },
    });
    const input = path.join(sandbox.root, "queue-input.json");
    writeJson(input, {
      complete: true,
      pages: 1,
      items: [],
      backlog: {
        complete: true,
        pages: 1,
        items: [node("DEMO-3"), node("DEMO-4")],
      },
    });
    run(sandbox, ["ledger", "set-question", "DEMO-3", "--kind", "decision"], {
      input: QUESTION,
    });
    const queue = run(sandbox, [
      "queue",
      "--tracker",
      "linear",
      "--input",
      input,
      "--me",
      "me",
    ]);
    expect(queue.status).toBe(0);
    expect(
      queue.json.backlogOrdered.map((item: { ref: string }) => item.ref)
    ).toEqual(["DEMO-4"]);
    expect(queue.json.backlogExcluded).toContainEqual({
      ref: "DEMO-3",
      reason: "pending-question",
    });
  });
});

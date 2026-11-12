/** Run the actual downstream workflow classifier, not an equivalent predicate. */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../../helpers/io-latency-budget.js";

useIoLatencyBudget();
const workflow = parse(
  readFileSync(".github/workflows/lifecycle-terminal-transition.yml", "utf8")
);
const classifier = workflow.jobs.complete.steps.find(
  (step: { name?: string }) =>
    step.name === "Fail when an item could not be completed"
).run;

describe("actual terminal workflow outcome classifier", () => {
  it.each([
    [
      "pending proof",
      "work-item pending-proof: acme/code#42 [pending-proof]\n",
      0,
      "remain open awaiting",
    ],
    [
      "invalid proof",
      "work-item NOT completed: acme/code#42 [invalid-proof]\n",
      1,
      "::error::",
    ],
    [
      "provider read error",
      "work-item NOT completed: acme/code#42 [read-error]\n",
      1,
      "::error::",
    ],
    [
      "completed",
      "work-item completed: acme/code#42 -> status:done\n",
      0,
      "No pending completion proof",
    ],
    [
      "mixed pending and error",
      "work-item pending-proof: acme/code#42\nwork-item NOT completed: acme/code#43\n",
      1,
      "::error::",
    ],
  ])("reports %s truthfully", (_name, output, exitCode, expected) => {
    const root = mkdtempSync(path.join(os.tmpdir(), "lisa-wi-inproc-outcome-"));
    try {
      writeFileSync(path.join(root, "transition.txt"), output);
      const result = boundedSpawnSync({
        label: "actual workflow outcome step",
        command: "bash",
        args: ["-e", "-c", classifier],
        cwd: root,
      });
      expect(result.status).toBe(exitCode);
      expect(result.stdout).toContain(expected);
      if (_name === "pending proof")
        expect(result.stdout).not.toContain("::error::");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("terminal workflow manual replay bound (CodySwannGT/lisa#4773)", () => {
  const transition = workflow.jobs.complete.steps.find(
    (step: { id?: string }) => step.id === "transition"
  );

  it("offers an optional since bound on workflow_dispatch", () => {
    const since = workflow.on.workflow_dispatch.inputs.since;
    expect(since.required).toBe(false);
    expect(since.type).toBe("string");
  });

  it("bounds a dispatch by the since input and a push by its before revision", () => {
    expect(transition.env.PUSH_BEFORE).toBe(
      "${{ github.event.before || inputs.since }}"
    );
  });

  it("still refuses to sweep when a dispatch names no bound", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "lisa-wi-dispatch-bound-"));
    try {
      const result = boundedSpawnSync({
        label: "terminal transition with no bound",
        command: "bash",
        args: ["-e", "-c", transition.run],
        cwd: root,
        env: { ...process.env, PUSH_BEFORE: "", PUSH_BRANCH: "main" },
      });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("NOT DETERMINED");
      expect(result.stdout).toContain("No item was completed");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

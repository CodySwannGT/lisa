/**
 * The Playwright suite as its own reusable workflow.
 *
 * The suite used to run as three jobs inside `quality.yml`, and consumers
 * selected it by passing `skip_jobs` naming the two dozen jobs they did NOT
 * want. That inversion goes stale silently — a job added to `quality.yml` is
 * absent from every consumer's hand-maintained list and therefore RUNS on a
 * nightly whose whole point is that it runs one suite.
 *
 * What these tests pin is the part that is easy to get wrong while moving the
 * jobs: the environment preparation gates the suite, in BOTH jobs that can run
 * it. The aggregate job is the subtle one — it carries `always()` so that shard
 * blobs still merge after a failed shard, and on the gate-configured path it
 * runs the whole suite itself. An unqualified `always()` there would run the
 * suite against exactly the state the preparation could not establish.
 * @module tests/integration/playwright-e2e-workflow
 */

import yaml from "js-yaml";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { evaluateIf } from "../helpers/workflow-job-graph";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const WORKFLOW = path.join(
  REPO_ROOT,
  ".github",
  "workflows",
  "playwright-e2e.yml"
);

/** Absolute, so the shell under test is never resolved through PATH. */
const BASH = "/bin/bash";
const SCRIPT_NAME = "lisa-environment-prepare.mjs";
const PREPARE_STEP = "Prepare the environment";
/** The line that actually invokes a verb; dropped before the shell runs. */
const INVOKE_PREFIX = 'node "$PREPARE"';

/**
 *
 */
interface Step {
  name: string;
  if?: string;
  run?: string;
}

const doc = yaml.load(readFileSync(WORKFLOW, "utf8")) as {
  permissions: Record<string, string>;
  jobs: Record<string, { needs?: string[]; if?: string; steps: Step[] }>;
};

/**
 * Run the resolution half of the prepare step in a throwaway directory.
 *
 * Only the resolution is extracted — the final `node "$PREPARE"` line is
 * dropped so the test never invokes a real verb. What is under test is which
 * branch the shell takes, not what the script then does.
 * @param present Whether a resolvable script exists in the sandbox.
 * @returns A thunk that throws when the shell exits non-zero.
 */
function runResolution(present: boolean): () => void {
  const step = doc.jobs.prepare.steps.find(candidate =>
    candidate.name.includes(PREPARE_STEP)
  );
  const dir = mkdtempSync(path.join(tmpdir(), "lisa-pw-"));
  if (present) {
    mkdirSync(path.join(dir, "scripts"), { recursive: true });
    writeFileSync(path.join(dir, "scripts", SCRIPT_NAME), "// stand-in\n");
  }
  const script = String(step?.run ?? "")
    .split("\n")
    .filter(line => !line.trim().startsWith(INVOKE_PREFIX))
    .join("\n");
  writeFileSync(path.join(dir, "resolve.sh"), script);

  return () => {
    execFileSync(BASH, ["resolve.sh"], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, TARGET: "dev", VERBS: "reset,reseed" },
      stdio: ["ignore", "pipe", "pipe"],
    });
  };
}

/**
 * The result-gate context for a suite job.
 * @param prepare The result the preparation job concluded with.
 * @returns The evaluation context.
 */
function afterPrepare(prepare: string) {
  return { inputs: {}, needs: { prepare: { result: prepare } } };
}

describe("the suite is gated on the environment preparation", () => {
  it("runs the shards only on an allowlisted preparation result", () => {
    const guard = doc.jobs.playwright_e2e.if ?? "";

    expect(doc.jobs.playwright_e2e.needs).toContain("prepare");
    expect(evaluateIf(guard, afterPrepare("success"))).toBe(true);
    expect(evaluateIf(guard, afterPrepare("skipped"))).toBe(true);
    expect(evaluateIf(guard, afterPrepare("failure"))).toBe(false);
    expect(evaluateIf(guard, afterPrepare("cancelled"))).toBe(false);
  });

  it("does not let the aggregator's always() run the suite after a failed preparation", () => {
    // The one that would actually hurt. On the gate-configured path this job
    // builds and runs the whole suite, so `always()` alone would run it
    // against unprepared state — and report a result for it.
    const guard = doc.jobs.playwright_e2e_aggregate.if ?? "";

    expect(doc.jobs.playwright_e2e_aggregate.needs).toContain("prepare");
    expect(evaluateIf(guard, afterPrepare("failure"))).toBe(false);
    expect(evaluateIf(guard, afterPrepare("success"))).toBe(true);
  });

  it("keeps the shard-matrix job free of the environment entirely", () => {
    // Pure shell arithmetic, no checkout and no API. Making it wait on the
    // preparation would add a serial hop before anything can start, for a job
    // that cannot touch the environment.
    expect(doc.jobs.playwright_e2e_setup.needs ?? []).not.toContain("prepare");
  });
});

describe("preparation is opt-in and fails closed", () => {
  it("prepares nothing when no environment is named", () => {
    const step = doc.jobs.prepare.steps.find(candidate =>
      candidate.name.includes(PREPARE_STEP)
    );

    expect(evaluateIf(step?.if, { inputs: { prepare_environment: "" } })).toBe(
      false
    );
  });

  it("prepares when an environment is named", () => {
    // The positive control: without it the assertion above is equally
    // consistent with a guard that never passes.
    const step = doc.jobs.prepare.steps.find(candidate =>
      candidate.name.includes(PREPARE_STEP)
    );

    expect(
      evaluateIf(step?.if, { inputs: { prepare_environment: "dev" } })
    ).toBe(true);
  });

  it("fails when the preparation script cannot be resolved", () => {
    // Executed, not grepped. A `grep` for `exit 1` proves the line exists and
    // nothing about whether it is reached.
    expect(runResolution(false)).toThrow();
  });

  it("resolves a script that is present", () => {
    // The positive control. Without it the failing case above is equally
    // consistent with a snippet that cannot run at all.
    expect(runResolution(true)).not.toThrow();
  });
});

describe("the workflow stands alone", () => {
  it("takes no skip_jobs input", () => {
    // The inversion this workflow exists to end: a single-suite caller should
    // not have to name every job it does not want.
    const inputs = doc as unknown as {
      on?: { workflow_call: { inputs: Record<string, unknown> } };
      true?: { workflow_call: { inputs: Record<string, unknown> } };
    };
    const declared = (inputs.on ?? inputs.true)?.workflow_call.inputs ?? {};

    expect(Object.keys(declared)).not.toContain("skip_jobs");
  });

  it("declares least-privilege permissions at workflow level", () => {
    expect(doc.permissions).toEqual({ contents: "read" });
  });
});

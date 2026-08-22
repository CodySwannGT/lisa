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

/** One `workflow_call` input declaration, as the assertions below read it. */
interface WorkflowInput {
  required?: boolean;
  default?: unknown;
  type?: string;
}

/** One step of one job, as the assertions below read it. */
interface Step {
  id?: string;
  name: string;
  if?: string;
  run?: string;
  uses?: string;
  with?: Record<string, string>;
}

/** One job of this workflow, as the assertions below read it. */
interface Job {
  name?: string;
  needs?: string[];
  if?: string;
  "runs-on"?: string;
  "timeout-minutes"?: number;
  permissions?: Record<string, string>;
  strategy?: {
    "fail-fast"?: boolean;
    matrix?: { shard?: string };
  };
  steps: Step[];
}

const doc = yaml.load(readFileSync(WORKFLOW, "utf8")) as {
  permissions: Record<string, string>;
  jobs: Record<string, Job>;
};

/**
 * One job, by id.
 *
 * Throws rather than returning undefined. These assertions arrived here from
 * `quality-workflow.test.ts` because the jobs did, and the failure mode a move
 * invites is asserting against a job that is no longer in the file being
 * read — where `?.` turns every expectation into an expectation about nothing
 * and the suite reports green.
 * @param id The job id.
 * @returns The job definition.
 */
function job(id: string): Job {
  const definition = doc.jobs[id];
  if (definition === undefined) {
    throw new Error(`${id} is not a job in playwright-e2e.yml`);
  }
  return definition;
}

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
  const lines = String(step?.run ?? "").split("\n");
  const kept = lines.filter(line => !line.trim().startsWith(INVOKE_PREFIX));
  // The strip must actually strip. A renamed or reshaped invocation line would
  // otherwise leave this test running the REAL verb invocation in a sandbox,
  // which would either fail for the wrong reason or, worse, succeed.
  if (kept.length === lines.length) {
    throw new Error("the verb invocation line was not found to strip");
  }
  const script = kept.join("\n");
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

// ─────────────────────────────────────────────────────────────────────────────
// Moved here from `quality-workflow.test.ts` when the three jobs left
// `quality.yml`. Nothing below was rewritten for the new file beyond the
// address: each assertion pins the same property, for the same recorded
// reason, against the workflow that now declares the job. The one shape that
// genuinely changed is `needs`, which became a list once the suite gained an
// environment-preparation job to wait on — asserted as the whole list rather
// than softened to a membership check, since which jobs a job waits on is the
// property, not merely that one of them appears.
// ─────────────────────────────────────────────────────────────────────────────

describe("playwright_e2e job preservation", () => {
  it("preserves runs-on ubuntu-latest and timeout-minutes 60", () => {
    const matrix = job("playwright_e2e");
    expect(matrix["runs-on"]).toBe("ubuntu-latest");
    expect(matrix["timeout-minutes"]).toBe(60);
  });

  it("declares matrix strategy fed by the setup job's shards output", () => {
    const matrix = job("playwright_e2e");
    expect(matrix.needs).toEqual(["prepare", "playwright_e2e_setup"]);
    expect(matrix.strategy?.["fail-fast"]).toBe(false);
    expect(matrix.strategy?.matrix?.shard).toContain(
      "fromJSON(needs.playwright_e2e_setup.outputs.shards)"
    );
  });

  it("gives the shard-computing job an empty permissions block", () => {
    // It neither checks out the repository nor calls the API — pure shell
    // arithmetic over an input. An empty block is what stops it inheriting
    // the caller's full grant.
    expect(job("playwright_e2e_setup").permissions).toEqual({});
  });
});

describe("matrix always uploads blob", () => {
  it("uploads per-shard blob regardless of playwright_shards value", () => {
    const steps = job("playwright_e2e").steps;
    const uploads = steps.filter(step =>
      step.uses?.startsWith("actions/upload-artifact")
    );
    // Exactly one upload step — the always-blob path — so unsharded and
    // sharded runs both feed the aggregator uniformly.
    expect(uploads).toHaveLength(1);
    const [blob] = uploads;
    expect(blob?.name).toBe("📤 Upload Playwright blob");
    expect(blob?.if).not.toContain("playwright_shards");
    expect(blob?.with?.name).toBe(
      "playwright-blob-${{ github.run_id }}-shard-${{ matrix.shard }}"
    );
  });

  it("pairs blob with a streaming reporter so a timed-out shard names its tests", () => {
    const steps = job("playwright_e2e").steps;
    const run = steps.find(
      step => step.name === "🎭 Run Playwright tests"
    )?.run;
    expect(run).toContain("--reporter=");
    const reporters = /--reporter=(\S+)/.exec(run ?? "")?.[1]?.split(",") ?? [];
    // `blob` must stay — the aggregator merges those artifacts.
    expect(reporters).toContain("blob");
    // …but `blob` alone writes only at the END of the run and prints nothing
    // meanwhile, so a shard killed by the 60-minute job timeout leaves no
    // artifact AND no console output, naming no test. A streaming reporter
    // alongside it is what makes such a timeout diagnosable at all.
    expect(reporters.some(name => ["line", "list", "dot"].includes(name))).toBe(
      true
    );
  });

  it("never derives a build cache key from an unanchored source glob", () => {
    // Regression guard for CodySwannGT/lisa#2418, moved with the job it
    // guards. `hashFiles('**/src/**')` is unanchored, so it also matches
    // `node_modules/**/src/**`. On a consumer repo that walked 116,353 paths
    // and hashed 26,955 node_modules files, blowing past the runner's
    // 120-second hashFiles ceiling and failing the job in the cache's POST
    // step — after every test had already passed. A green Playwright nightly
    // (73/73) was reported as red, blocking merges repo-wide.
    const steps = job("playwright_e2e").steps.filter(
      step => step.id === "build_fingerprint" || step.id === "expo_cache"
    );

    // Two here, two in `quality-workflow.test.ts` for the `build` job.
    // Counted on both sides so a step that disappears cannot leave an empty
    // loop passing.
    expect(steps.length).toBe(2);

    for (const step of steps) {
      const text = `${step.run ?? ""}${step.with?.key ?? ""}`;
      for (const glob of [
        "**/src/**",
        "**/app/**",
        "**/components/**",
        "**/features/**",
      ]) {
        expect(
          text,
          `${step.id} must not hash ${glob} — it traverses node_modules`
        ).not.toContain(glob);
      }
    }
  });

  it("includes the source root in the expo build cache key", () => {
    const expoCache = job("playwright_e2e").steps.find(
      step => step.id === "expo_cache"
    );
    // The key derives from the git-based fingerprint step rather than
    // inlining a hashFiles glob — see the regression guard above.
    expect(expoCache?.with?.key).toContain(
      "steps.build_fingerprint.outputs.hash"
    );

    const fingerprint = job("playwright_e2e").steps.find(
      step => step.id === "build_fingerprint"
    );
    expect(fingerprint).toBeDefined();
    // The source roots and the lockfiles still drive invalidation.
    expect(fingerprint?.run).toContain("git ls-files");
    for (const root of ["'src'", "'bun.lock'", "'package.json'"]) {
      expect(fingerprint?.run).toContain(root);
    }
  });
});

describe("playwright_e2e_aggregate job (ruleset anchor)", () => {
  it("exists, needs the matrix, and always runs (no shard gate)", () => {
    const aggregate = job("playwright_e2e_aggregate");
    expect(aggregate.needs).toEqual(["prepare", "playwright_e2e"]);
    // Aggregator must emit its check on every run so the unsuffixed
    // required-status-check context (`🎭 Browser Journeys`) is produced
    // regardless of `playwright_shards` value.
    expect(aggregate.if).not.toContain("inputs.playwright_shards");
    expect(aggregate.if).toContain("always()");
  });

  it("is named `🎭 Browser Journeys` to match the required check context", () => {
    // The matrix `playwright_e2e` job shares this display name, but the
    // matrix suffixes its context with `(<shard>)`, so only the aggregator
    // produces the unsuffixed context the ruleset requires.
    expect(job("playwright_e2e_aggregate").name).toBe("🎭 Browser Journeys");
  });

  it("uploads the merged HTML as playwright-report-<run-id>", () => {
    const upload = job("playwright_e2e_aggregate").steps.find(
      step => step.name === "📤 Upload merged Playwright report"
    );
    expect(upload).toBeDefined();
    // Preserve the original unsharded artifact name so consumers who
    // download `playwright-report-<run-id>` keep working after opt-in.
    expect(upload?.with?.name).toBe("playwright-report-${{ github.run_id }}");
  });

  it("gates merge-reports on has_config so repos without playwright skip cleanly", () => {
    // Repos with no playwright.config.* produce no blob artifacts from the
    // shard matrix (check_playwright.has_config=false in each shard). The
    // aggregator must apply the same has_config gate to its download/merge
    // steps — otherwise `npx playwright merge-reports` runs against an empty
    // directory and fails, breaking the required-status-check.
    const steps = job("playwright_e2e_aggregate").steps;
    expect(steps.find(step => step.id === "check_playwright")).toBeDefined();
    const merge = steps.find(
      step => step.name === "🎭 Merge blob reports into HTML"
    );
    expect(merge?.if).toContain(
      "steps.check_playwright.outputs.has_config == 'true'"
    );
  });
});

describe("matrix job keeps unified check-context display name", () => {
  it("uses `🎭 Browser Journeys` so shards produce `(N)` suffix checks", () => {
    // Matrix always suffixes with `(<matrix-value>)`, giving non-blocking
    // per-shard checks that coexist with the aggregator's unsuffixed context
    // under the same display name.
    expect(job("playwright_e2e").name).toBe("🎭 Browser Journeys");
  });
});

describe("the shard configuration lives with the suite", () => {
  it("defaults Playwright to two shards so large suites fit hosted runners", () => {
    // Asserted here rather than on `quality.yml`, whose copy of this input is
    // now inert: the value that reaches the matrix is this one.
    const declared = doc as unknown as {
      on?: { workflow_call: { inputs: Record<string, WorkflowInput> } };
      true?: { workflow_call: { inputs: Record<string, WorkflowInput> } };
    };
    const inputs = (declared.on ?? declared.true)?.workflow_call.inputs ?? {};
    expect(inputs["playwright_shards"]).toBeDefined();
    expect(inputs["playwright_shards"]?.required).toBe(false);
    expect(inputs["playwright_shards"]?.default).toBe(2);
    expect(inputs["playwright_shards"]?.type).toBe("number");
  });
});

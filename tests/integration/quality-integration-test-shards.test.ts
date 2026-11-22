/**
 * `integration_test_shards`: the sharded 🧪 Run Integration Tests job
 * (CodySwannGT/lisa#4599), modelled on `quality-unit-test-shards.test.ts`.
 *
 * With the default of 1, `test_integration` runs exactly the steps it always
 * ran, under the same name. With more, a plan job lays out a matrix of legs
 * (and, in Lisa, assigns files from recorded timings), one build job builds
 * for every leg, the legs run the suite, and `test_integration` is the
 * aggregate: still the one `🧪 Run Integration Tests` context, red unless
 * every leg reported success. The legs run `test_integration`'s own step list
 * through a YAML anchor, so which steps run where is decided only by each
 * step's condition; this suite walks that list for every role.
 *
 * Shell bodies that decide something are executed, not string-matched. The
 * aggregate's verdict lives in `quality-integration-test-shards-verdict.test.ts`.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadWorkflow } from "../helpers/workflow-test-utils.js";
import { jobIn, stepsIn, workflow } from "./quality-gate-facade-fixture.js";
import {
  lisaJob,
  stepsThatRun,
} from "./quality-integration-test-shards-fixture.js";
import {
  executeStep,
  stepNamed as step,
  type ShardSuiteJob,
} from "./quality-unit-test-shards-fixture.js";

/** A job as these tests read it: the shard-suite shape plus its runtime keys. */
type Job = ShardSuiteJob & {
  readonly env?: Readonly<Record<string, string>>;
  readonly "runs-on"?: unknown;
  readonly permissions?: Readonly<Record<string, string>>;
};

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const PLAN_SKIP =
  "(needs.gate_plan.result != 'success' || !contains(needs.gate_plan.outputs.plan, '\"test_integration\":\"skip\"'))";

const aggregate = jobIn("test_integration") as Job;
const plan = jobIn("test_integration_shard_plan") as Job;
const build = jobIn("test_integration_shard_build") as Job;
const shard = jobIn("test_integration_shard") as Job;
const steps = stepsIn("test_integration");
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

/**
 * Run one step body in a registered scratch directory.
 * @param body - Step `run:` source
 * @param env - Step environment
 * @returns What the step did
 */
const execute = (body: string | undefined, env: Record<string, string>) =>
  executeStep(body, env, root => roots.push(root));

const VERDICT = [
  "📥 Download the integration-test shard results",
  "🚨 Fail if the integration-test shards did not pass",
];
const LEG_ONLY = [
  "📥 Download the shared build",
  "🏗️ Use the shared build",
  "🧩 Arm this integration-test shard",
  "🧾 Prove this shard ran only its slice",
  "🧾 Record this shard's result",
  "📤 Upload this shard's result",
];
const SETUP_RUBY = "💎 Setup Ruby for Lisa template regression";
const RUN_GATE = "🧪 Run the test-integration gate";
const NATIVE_ONCE = [
  "⏱️ Verify native freshness diagnostic deadlines",
  "📎 Retain native freshness timing evidence",
];

describe("the integration_test_shards input", () => {
  it("is a number that defaults to one unsharded job", () => {
    expect(
      workflow.on?.workflow_call?.inputs?.integration_test_shards
    ).toMatchObject({ type: "number", default: 1, required: false });
  });

  it("is switched on in Lisa's own CI", () => {
    const ci = loadWorkflow(
      path.join(REPO_ROOT, ".github", "workflows", "ci.yml")
    ) as { jobs: Record<string, { with?: Record<string, unknown> }> };
    expect(
      Number(ci.jobs["quality"]?.with?.["integration_test_shards"])
    ).toBeGreaterThan(1);
  });
});

describe("test_integration keeps its identity at every shard count", () => {
  it("keeps the static name the ruleset context resolves", () => {
    expect(aggregate.name).toBe("🧪 Run Integration Tests");
    expect(aggregate.strategy).toBeUndefined();
  });

  it("is the only job whose check context could satisfy that ruleset entry", () => {
    const claimants = Object.entries(workflow.jobs)
      .filter(([, job]) => (job.name ?? "").includes("Run Integration Tests"))
      .map(([id]) => id);
    expect(claimants).toEqual(["test_integration"]);
  });

  it("waits for every shard job without letting a skipped one skip it", () => {
    expect(aggregate.needs).toEqual([
      "gate_plan",
      "test_integration_shard_plan",
      "test_integration_shard_build",
      "test_integration_shard",
    ]);
    expect(aggregate.if).toBe(
      `\${{ always() && !cancelled() && !contains(format(',{0},', inputs.skip_jobs), ',test:integration,') && ${PLAN_SKIP} }}`
    );
  });
});

describe("one step list, three roles", () => {
  const unsharded = stepsThatRun(steps, lisaJob(1, 1, 0));
  const sharded = stepsThatRun(steps, lisaJob(3, 1, 0));
  const legs = [0, 1, 2].map(index =>
    stepsThatRun(steps, lisaJob(3, 3, index))
  );

  it("is the legs' own list, through the anchor", () => {
    expect(stepsIn("test_integration_shard")).toEqual(steps);
    expect(shard.env).toEqual(aggregate.env);
    expect(shard["runs-on"]).toEqual(aggregate["runs-on"]);
  });

  it("runs the unsharded job as before, with no shard step", () => {
    for (const name of [...VERDICT, ...LEG_ONLY])
      expect(unsharded, name).not.toContain(name);
    for (const name of [
      "📥 Checkout repository",
      SETUP_RUBY,
      "📦 Install dependencies",
      RUN_GATE,
      ...NATIVE_ONCE,
      "⏱️ Upload per-file test timings",
      "🗺️ Upload test access map",
    ])
      expect(unsharded, name).toContain(name);
  });

  it("runs no checkout, install or test in the sharded aggregate", () => {
    // setup-ruby keeps its exact repository gate (ruby-runner-image-pin) and
    // the two uploads find no files; neither touches a test.
    expect(sharded).toEqual([
      ...VERDICT,
      SETUP_RUBY,
      "⏱️ Upload per-file test timings",
      "🗺️ Upload test access map",
    ]);
  });

  it("runs the suite in every leg, with Ruby, the shared build and a receipt", () => {
    for (const ran of legs) {
      for (const name of [
        ...LEG_ONLY,
        SETUP_RUBY,
        "💎 Install Rails configuration resolver for Lisa regression",
        RUN_GATE,
      ])
        expect(ran, name).toContain(name);
      for (const name of VERDICT) expect(ran, name).not.toContain(name);
    }
  });

  it("runs the native freshness benchmark once, in the first leg", () => {
    for (const name of NATIVE_ONCE) {
      expect(legs[0]).toContain(name);
      expect(legs[1]).not.toContain(name);
      expect(legs[2]).not.toContain(name);
    }
  });

  it("hands both test commands the shard plan and the shared build marker", () => {
    for (const name of [RUN_GATE, "🧪 Run integration tests"])
      expect(step("test_integration", name).env).toMatchObject({
        LISA_TEST_SHARD: "${{ steps.shard_arm.outputs.shard }}",
        LISA_TEST_SHARD_OUTPUT: "${{ steps.shard_arm.outputs.output }}",
        LISA_TEST_SHARD_PLAN: "${{ steps.shard_arm.outputs.plan }}",
        LISA_BUILD_MARKER: "${{ steps.shared_build.outputs.marker }}",
      });
  });
});

describe("test_integration_shard_plan", () => {
  const compute = step(
    "test_integration_shard_plan",
    "🧮 Compute the integration-test shard matrix"
  );

  it("runs only when the caller asked for shards and the gate is not off", () => {
    expect(plan.name).toBe("🧮 Plan Integration-Test Shards");
    expect(plan.if).toBe(
      `\${{ always() && !cancelled() && inputs.integration_test_shards != 1 && ${PLAN_SKIP} }}`
    );
    expect(plan.if).not.toContain("skip_jobs");
    expect(plan.permissions).toEqual({ contents: "read" });
    expect(plan.outputs).toEqual({
      shards: "${{ steps.plan.outputs.shards }}",
      nonce: "${{ steps.plan.outputs.nonce }}",
      plan: "${{ steps.timings.outputs.plan }}",
    });
  });

  it("refuses to shard a suite the same caller skips", () => {
    const result = execute(compute.run, {
      SHARDS: "3",
      SKIP_JOBS: "lint,test:integration",
    });
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain(
      "::error title=integration_test_shards contradicts skip_jobs::"
    );
    expect(result.output).toBe("");
  });

  it.each([
    ["2", "[1,2]"],
    ["3", "[1,2,3]"],
  ])("lays out %s shards with a fresh nonce", (shards, matrix) => {
    const result = execute(compute.run, { SHARDS: shards, SKIP_JOBS: "" });
    expect(result.status, result.stdout).toBe(0);
    expect(result.output).toContain(`shards=${matrix}\n`);
    expect(result.output).toMatch(/nonce=[0-9a-f-]{36}\n/);
  });

  it.each(["0", "21", "2.5", "three", ""])("refuses %j", shards => {
    const result = execute(compute.run, { SHARDS: shards, SKIP_JOBS: "" });
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain(
      "::error title=integration_test_shards is invalid::"
    );
  });

  it("assigns files from recorded timings only in Lisa", () => {
    const timings = step(
      "test_integration_shard_plan",
      "⏱️ Assign files to shards from recorded timings"
    );
    expect(timings.if).toBe("github.repository == 'CodySwannGT/lisa'");
    expect(timings.run).toContain("node scripts/plan-integration-shards.mjs");
  });
});

describe("test_integration_shard_build", () => {
  it("builds once, in Lisa only, and uploads under the name the legs download", () => {
    expect(build.name).toBe("🏗️ Build Once for Integration-Test Shards");
    expect(build.if).toContain("github.repository == 'CodySwannGT/lisa'");
    expect(build.if).toContain("inputs.integration_test_shards != 1");
    const upload = step(
      "test_integration_shard_build",
      "📤 Upload the shared build"
    );
    expect(upload.with?.["name"]).toBe(
      step("test_integration", "📥 Download the shared build").with?.["name"]
    );
    expect(
      step(
        "test_integration_shard_build",
        "🏗️ Build once and record the build marker"
      ).run
    ).toContain("node scripts/integration-shard-build.mjs build");
  });
});

describe("test_integration_shard", () => {
  it("is a matrix over the plan that lets every shard finish", () => {
    expect(shard.needs).toEqual([
      "gate_plan",
      "test_integration_shard_plan",
      "test_integration_shard_build",
    ]);
    expect(shard.strategy).toEqual({
      "fail-fast": false,
      matrix: {
        shard:
          "${{ fromJSON(needs.test_integration_shard_plan.outputs.shards || '[1]') }}",
      },
    });
    expect(shard.name).toBe(
      "🧪 Integration Tests shard ${{ matrix.shard }}/${{ inputs.integration_test_shards }}"
    );
    expect(shard["timeout-minutes"]).toBe(aggregate["timeout-minutes"]);
  });

  it("arms each leg with its slice, and with the timing plan when there is one", () => {
    const arm = step("test_integration", "🧩 Arm this integration-test shard");
    const planned = execute(arm.run, {
      INDEX: "1",
      TOTAL: "3",
      PLAN: '{"schema":"lisa.test-shard-plan/v1"}',
    });
    expect(planned.status, planned.stdout).toBe(0);
    expect(planned.output).toBe(
      `shard=2/3\noutput=${planned.runnerTemp}/lisa-integration-test-shard\nplan=${planned.runnerTemp}/lisa-integration-shard-plan.json\n`
    );
    expect(
      fs.readFileSync(
        `${planned.runnerTemp}/lisa-integration-shard-plan.json`,
        "utf8"
      )
    ).toBe('{"schema":"lisa.test-shard-plan/v1"}\n');

    const sliced = execute(arm.run, { INDEX: "0", TOTAL: "3", PLAN: "" });
    expect(sliced.output).toBe(
      `shard=1/3\noutput=${sliced.runnerTemp}/lisa-integration-test-shard\n`
    );
  });

  it("refuses a leg whose test command never applied the shard", () => {
    const proof = step(
      "test_integration",
      "🧾 Prove this shard ran only its slice"
    );
    const unapplied = execute(proof.run, {});
    expect(unapplied.status).not.toBe(0);
    expect(unapplied.stdout).toContain(
      "::error title=Integration-test shard was not applied::"
    );
  });
});

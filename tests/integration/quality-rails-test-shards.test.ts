/**
 * `test_shards`: the sharded RSpec jobs of `quality-rails.yml`
 * (CodySwannGT/lisa#4560), the Rails counterpart of `unit_test_shards`.
 *
 * Two halves are pinned, as for the TypeScript suite. At the default of 1,
 * `Test (PostgreSQL)` / `Test (MySQL)` run the suite exactly as before, under
 * the same names, because branch rulesets require those contexts. Above 1 they
 * become the aggregate: they fail when the plan or any leg did not succeed,
 * prove every spec file ran exactly once, and collate coverage so the
 * project's thresholds are checked once on the merged result.
 *
 * The shell bodies are executed, not string-matched, wherever they decide
 * something.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  DATABASES,
  execute as executeIn,
  holds,
  job,
  PROJECT,
  SKIP_TOKEN,
  step,
  workflow,
} from "./quality-rails-test-shards-fixture.js";

const PLAN_JOB = "test-shard-plan";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

/**
 * Run a step body after a setup prelude, in a registered scratch directory.
 * @param prelude - Shell run first
 * @param body - The step's `run:`
 * @param env - Step environment
 * @returns The outcome
 */
function execute(
  prelude: string,
  body: string | undefined,
  env: Record<string, string> = {}
) {
  return executeIn(root => roots.push(root), prelude, body, env);
}

describe("the test_shards input", () => {
  it("is a number that defaults to one unsharded job", () => {
    expect(workflow.on?.workflow_call?.inputs?.test_shards).toMatchObject({
      type: "number",
      default: 1,
      required: false,
    });
  });
});

describe.each(DATABASES)(
  "Test ($label) keeps its identity",
  ({ db, label }) => {
    const aggregate = `test-${db}`;
    const shard = `test-${db}-shard`;

    it("keeps the static name the ruleset context resolves, with no matrix", () => {
      expect(job(aggregate).name).toBe(`Test (${label})`);
      expect(job(aggregate).strategy).toBeUndefined();
    });

    it("is the only job whose check context could satisfy that ruleset entry", () => {
      const claimants = Object.entries(workflow.jobs)
        .filter(([, entry]) => (entry.name ?? "").includes(`Test (${label})`))
        .map(([id]) => id);
      expect(claimants).toEqual([aggregate]);
    });

    it("waits for the plan and every leg, and runs whatever they did", () => {
      expect(job(aggregate).needs).toEqual([PLAN_JOB, shard]);
      expect(job(aggregate).if).toBe(
        `\${{ always() && !cancelled() && ${SKIP_TOKEN} && inputs.database_type == '${db}' }}`
      );
    });

    it("keeps its permissions, database service and environment", () => {
      expect(job(aggregate).permissions).toEqual({
        contents: "read",
        checks: "write",
        "pull-requests": "write",
      });
      expect(job(shard).services).toEqual(job(aggregate).services);
      expect(job(shard).env).toEqual(job(aggregate).env);
    });

    it("runs the suite itself only at test_shards 1", () => {
      for (const name of [
        "🗄️ Prepare database",
        "🧹 Assert the scratch supervisor is installed",
        "🧪 Run tests",
      ]) {
        const condition = step(aggregate, name).if;
        expect(holds(condition, { "inputs.test_shards": 1 })).toBe(true);
        expect(holds(condition, { "inputs.test_shards": 4 })).toBe(false);
      }
      expect(step(aggregate, "🧪 Run tests").run).toBe(
        `bash scripts/lisa-scratch-run.sh --suite rspec-${db} -- bundle exec rspec`
      );
    });

    it("merges only above test_shards 1", () => {
      for (const name of [
        "📥 Download the RSpec shard plan",
        "📥 Download every RSpec shard",
        "🧾 Prove every spec file ran exactly once",
        "📊 Collate coverage and enforce the thresholds",
      ]) {
        const condition = step(aggregate, name).if;
        expect(holds(condition, { "inputs.test_shards": 1 })).toBe(false);
        expect(holds(condition, { "inputs.test_shards": 3 })).toBe(true);
      }
    });

    it.each([
      [1, "skipped", "skipped", false],
      [4, "success", "success", false],
      [4, "failure", "skipped", true],
      [4, "success", "failure", true],
      [4, "success", "cancelled", true],
      [4, "success", "skipped", true],
    ])(
      "at test_shards %i with plan %s and legs %s, the first step fails the job: %s",
      (shards, plan, legs, fires) => {
        const guard = step(
          aggregate,
          "🚨 Fail if the RSpec shards did not pass"
        );
        expect(job(aggregate).steps?.[0]).toBe(guard);
        expect(
          holds(guard.if, {
            "inputs.test_shards": shards,
            "needs.test_shard_plan.result": plan,
            [`needs.test_${db}_shard.result`]: legs,
          })
        ).toBe(fires);
        if (fires) expect(execute("", guard.run, {}).status).toBe(1);
      }
    );

    it("gives each leg the same database preparation and supervisor check as the unsharded run", () => {
      for (const name of [
        "🗄️ Prepare database",
        "🧹 Assert the scratch supervisor is installed",
      ])
        expect(step(shard, name).run).toBe(step(aggregate, name).run);
    });

    it("runs every leg to completion and posts no name containing the aggregate's", () => {
      expect(job(shard).name).toBe(
        `🧪 RSpec shard \${{ matrix.shard }}/\${{ inputs.test_shards }} (${label})`
      );
      expect(job(shard).strategy?.["fail-fast"]).toBe(false);
      expect(job(shard).strategy?.matrix?.shard).toBe(
        "${{ fromJSON(needs.test-shard-plan.outputs.shards || '[1]') }}"
      );
      expect(job(shard).if).toBe(
        `\${{ always() && !cancelled() && needs.test-shard-plan.result == 'success' && inputs.database_type == '${db}' }}`
      );
    });
  }
);

describe("the RSpec shard plan", () => {
  const plan = job(PLAN_JOB);

  it("is skipped at test_shards 1 and when the test job is skipped", () => {
    expect(plan.if).toBe(
      `\${{ inputs.test_shards != 1 && ${SKIP_TOKEN} && (inputs.database_type == 'postgres' || inputs.database_type == 'mysql') }}`
    );
    expect(plan.name).toBe("🧮 Plan RSpec Shards");
  });

  it("lays out the matrix, mints a nonce and writes a proven plan", () => {
    const outcome = execute(
      PROJECT,
      step(PLAN_JOB, "🧮 Compute the RSpec shard plan").run,
      { SHARDS: "3" }
    );
    expect(outcome.status).toBe(0);
    expect(outcome.output).toMatch(/^shards=\[1,2,3\]$/m);
    expect(outcome.output).toMatch(/^nonce=[0-9a-f-]{36}$/m);
    const written = JSON.parse(
      fs.readFileSync(
        path.join(outcome.runnerTemp, "lisa-rspec-shard-plan", "plan.json"),
        "utf8"
      )
    ) as { shards: { files: string[] }[]; basis: string };
    expect(written.basis).toBe("size");
    expect(written.shards.map(shard => shard.files)).toEqual([
      ["spec/a_spec.rb"],
      ["spec/models/b_spec.rb"],
      ["spec/c_spec.rb"],
    ]);
  });

  it.each(["0", "21", "lots"])("refuses test_shards %j", shards => {
    const outcome = execute(
      PROJECT,
      step(PLAN_JOB, "🧮 Compute the RSpec shard plan").run,
      { SHARDS: shards }
    );
    expect(outcome.status).not.toBe(0);
    expect(outcome.stdout).toContain(
      "::error title=RSpec shard plan refused::"
    );
    expect(outcome.output).toBe("");
  });

  it("refuses to shard when the Lisa-managed tooling is not installed", () => {
    const outcome = execute(
      "mkdir -p scripts",
      step(PLAN_JOB, "🧹 Assert the RSpec shard tooling is installed").run,
      { SHARDS: "4" }
    );
    expect(outcome.status).toBe(1);
    expect(outcome.stdout).toContain(
      "test_shards is 4, but scripts/lisa-rspec-shards.mjs scripts/lisa_rspec_shard_recorder.rb scripts/lisa_simplecov_collate.rb not installed."
    );
  });
});

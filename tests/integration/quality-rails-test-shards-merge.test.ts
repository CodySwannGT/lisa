/**
 * `test_shards` legs and merge (CodySwannGT/lisa#4560): a leg refuses to run
 * the whole suite, and the `Test (...)` aggregate fails on a dropped or
 * duplicated spec file and collates coverage through the project's bundle.
 * Split from `quality-rails-test-shards.test.ts` for the file-length cap.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  DATABASES,
  execute as executeIn,
  PROJECT,
  step,
} from "./quality-rails-test-shards-fixture.js";

const B_SPEC = "spec/models/b_spec.rb";
const C_SPEC = "spec/c_spec.rb";

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

describe.each(DATABASES)("a $label shard leg", ({ db }) => {
  it("refuses an empty file list rather than letting rspec run the whole suite", () => {
    const outcome = execute(
      'mkdir -p "$RUNNER_TEMP/lisa-rspec-shard" && : > "$RUNNER_TEMP/lisa-rspec-shard/files.txt"',
      step(`test-${db}-shard`, "🧪 Run this shard's tests").run,
      { LISA_RSPEC_SHARD: "2/4" }
    );
    expect(outcome.status).toBe(1);
    expect(outcome.stdout).toContain(
      "::error title=RSpec shard has no files::"
    );
  });

  it("requires the recorder from outside the project, after handing out its files", () => {
    const outcome = execute(
      `${PROJECT}\nnode scripts/lisa-rspec-shards.mjs plan --shards 2 --out "$RUNNER_TEMP/lisa-rspec-shard-plan/plan.json"`,
      step(`test-${db}-shard`, "🧩 Arm this RSpec shard").run,
      { SHARD: "2" }
    );
    expect(outcome.status).toBe(0);
    expect(
      fs.existsSync(
        path.join(outcome.runnerTemp, "lisa_rspec_shard_recorder.rb")
      )
    ).toBe(true);
    expect(
      fs.readFileSync(
        path.join(outcome.runnerTemp, "lisa-rspec-shard", "files.txt"),
        "utf8"
      )
    ).toBe("spec/c_spec.rb\nspec/models/b_spec.rb\n");
  });
});

describe.each(DATABASES)("the $label aggregate's merge", ({ db }) => {
  /**
   * A prelude that plans 2 shards and writes each leg's record.
   * @param second - Files the second leg reports RSpec loaded
   * @returns Shell setup
   */
  function shardsThatRan(second: string[]): string {
    const record = (index: number, files: string[]) =>
      `mkdir -p "$RUNNER_TEMP/lisa-rspec-shards/rspec-shard-n-${index}" && printf '%s' ${JSON.stringify(
        JSON.stringify({
          version: 1,
          shard: `${index}/2`,
          files_to_run: files,
          examples: files.map(file => ({ file, run_time: 1 })),
          simplecov: { active: false },
        })
      )} > "$RUNNER_TEMP/lisa-rspec-shards/rspec-shard-n-${index}/record.json"`;
    return [
      PROJECT,
      'node scripts/lisa-rspec-shards.mjs plan --shards 2 --out "$RUNNER_TEMP/lisa-rspec-shard-plan/plan.json" > /dev/null',
      record(1, ["spec/a_spec.rb"]),
      record(2, second),
    ].join("\n");
  }

  const verify = () =>
    step(`test-${db}`, "🧾 Prove every spec file ran exactly once").run;

  it("passes when every spec file ran exactly once, and records timings", () => {
    const outcome = execute(shardsThatRan([C_SPEC, B_SPEC]), verify());
    expect(outcome.stdout).toContain(
      "Verified: 3 spec files ran exactly once across 2 shards."
    );
    expect(outcome.status).toBe(0);
    expect(
      fs.existsSync(path.join(outcome.runnerTemp, "lisa-rspec-timings.json"))
    ).toBe(true);
  });

  it("fails when a spec file was dropped", () => {
    const outcome = execute(shardsThatRan([C_SPEC]), verify());
    expect(outcome.status).toBe(1);
    expect(outcome.stdout).toContain(`ran in no shard: ${B_SPEC}`);
  });

  it("fails when a spec file ran twice", () => {
    const outcome = execute(
      shardsThatRan(["spec/a_spec.rb", C_SPEC, B_SPEC]),
      verify()
    );
    expect(outcome.status).toBe(1);
    expect(outcome.stdout).toContain(
      "ran in more than one shard: spec/a_spec.rb (shards 1, 2)"
    );
  });

  it("saves timings only from a verified run", () => {
    expect(
      step(`test-${db}`, "⏱️ Save spec timings for the next plan").if
    ).toBe("always() && steps.shard_verify.outcome == 'success'");
  });

  const collate = () =>
    step(`test-${db}`, "📊 Collate coverage and enforce the thresholds").run;

  it("collates every shard's resultset through the project's bundle, and fails with it", () => {
    const fake = [
      'mkdir -p bin && printf \'#!/bin/sh\\necho "$@" > "$RUNNER_TEMP/bundle-args"\\nexit 2\\n\' > bin/bundle && chmod +x bin/bundle',
      'export PATH="$PWD/bin:$PATH"',
      'printf "/r/one.json\\n/r/two.json\\n" > "$RUNNER_TEMP/lisa-rspec-resultsets.txt"',
    ].join("\n");
    const outcome = execute(fake, collate());
    expect(outcome.status).toBe(2);
    expect(
      fs.readFileSync(path.join(outcome.runnerTemp, "bundle-args"), "utf8")
    ).toBe(
      "exec ruby scripts/lisa_simplecov_collate.rb /r/one.json /r/two.json\n"
    );
  });

  it("checks nothing when no shard measured coverage, as an unsharded run would not", () => {
    const outcome = execute(
      ': > "$RUNNER_TEMP/lisa-rspec-resultsets.txt"',
      collate()
    );
    expect(outcome.status).toBe(0);
    expect(outcome.stdout).toContain("nothing to collate");
  });
});

/**
 * The sharded `🧪 Run Integration Tests` aggregate's verdict, and the
 * history-scanner group the planner keeps in one leg (CodySwannGT/lisa#4599).
 * Split from `quality-integration-test-shards.test.ts`; the verdict body is
 * executed over downloaded leg results, not string-matched.
 */
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { HISTORY_SCANNER_SUITES } from "../../scripts/lib/history-scanner-suites.mjs";
import {
  executeStep,
  stepNamed as step,
} from "./quality-unit-test-shards-fixture.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
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

describe("the aggregate verdict", () => {
  const verdict = step(
    "test_integration",
    "🚨 Fail if the integration-test shards did not pass"
  );

  /**
   * Run the verdict over downloaded leg results.
   * @param outcomes - Each leg's recorded status, by 0-based index; undefined
   *   for a leg that left none
   * @param results - Plan and build job results
   * @param results.plan - Plan job result
   * @param results.build - Build job result
   * @returns What the step did
   */
  function judge(
    outcomes: readonly (string | undefined)[],
    { plan: planResult = "success", build: buildResult = "success" } = {}
  ) {
    const root = fs.mkdtempSync(path.join(tmpdir(), "lisa-verdict-"));
    roots.push(root);
    outcomes.forEach((outcome, index) => {
      if (outcome === undefined) return;
      const directory = path.join(root, `integration-test-shard-n-${index}`);
      fs.mkdirSync(directory);
      fs.writeFileSync(path.join(directory, "outcome"), `${outcome}\n`);
    });
    return execute(verdict.run, {
      PLAN: planResult,
      BUILD: buildResult,
      TOTAL: String(outcomes.length),
      RESULTS: path.join(root, "integration-test-shard-n"),
    });
  }

  it("passes when every leg reported success", () => {
    const result = judge(["success", "success", "success"]);
    expect(result.status, result.stdout).toBe(0);
    expect(result.stdout).toContain("Shard 3/3 passed.");
  });

  it("fails and names the shard that failed", () => {
    const result = judge(["success", "failure", "success"]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(
      "::error title=Integration-test shard 2/3 did not pass::Shard 2/3: failure."
    );
    expect(result.stdout).not.toContain("shard 1/3 did not pass");
  });

  it("fails and names a shard that left no result", () => {
    const result = judge(["success", "success", undefined]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(
      "Shard 3/3: no result: cancelled, timed out or never ran."
    );
  });

  it.each([
    [{ plan: "failure" }, "Integration-test shards did not run"],
    [{ build: "failure" }, "Shared build did not pass"],
    [{ build: "cancelled" }, "Shared build did not pass"],
  ])("fails when %j", (results, title) => {
    const result = judge(["success", "success"], results);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(`::error title=${title}::`);
  });

  it("passes when the build was skipped, as for a caller", () => {
    expect(judge(["success", "success"], { build: "skipped" }).status).toBe(0);
  });
});

describe("the history-scanner group", () => {
  it("is the one list the Vitest project and the planner both read", () => {
    // One list, so the leg the planner keeps the suites in is the only leg
    // whose selection holds the project behind the scanner's global setup.
    expect(HISTORY_SCANNER_SUITES.length).toBeGreaterThan(0);
    for (const suite of HISTORY_SCANNER_SUITES)
      expect(fs.existsSync(path.join(REPO_ROOT, suite)), suite).toBe(true);
    expect(
      fs.readFileSync(path.join(REPO_ROOT, "vitest.config.local.ts"), "utf8")
    ).toContain("const scannerSuites = [...HISTORY_SCANNER_SUITES];");
  });
});

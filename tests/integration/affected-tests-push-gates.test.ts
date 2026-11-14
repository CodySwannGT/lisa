/**
 * Affected-test selection through the real push gate runner
 * (CodySwannGT/lisa#4600). With `pushGate.affectedCoverage: "skip"`, a
 * partial run reports coverage-adequacy SKIPPED, "partial selection —
 * enforced by CI", and a failing selected test still refuses the push.
 * @module tests/integration/affected-tests-push-gates
 */
import * as path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../helpers/io-latency-budget.js";
import {
  MOD_CHANGE,
  OTHER_CHANGE,
  REPO_ROOT,
  change,
  fixture,
  pushEnv,
  removeFixtures,
} from "./affected-tests-fixture.js";

const RUNNER = path.join(
  REPO_ROOT,
  "all/copy-overwrite/scripts/lisa-run-gates.mjs"
);

afterAll(removeFixtures);

/**
 * Run the push gates in the fixture.
 * @param root - Fixture root
 * @returns Exit status and output
 */
function push(root: string): { status: number | null; output: string } {
  const child = boundedSpawnSync({
    label: "lisa-run-gates push (affected-tests fixture)",
    command: process.execPath,
    args: [
      RUNNER,
      "--moment=push",
      `--coverage=${path.join(root, ".lisa", "cov")}`,
    ],
    cwd: root,
    env: pushEnv(),
  });
  return { status: child.status, output: `${child.stdout}${child.stderr}` };
}

describe("affected tests through the push gate runner", () => {
  it("reports coverage-adequacy SKIPPED for a partial run in skip mode", () => {
    const root = fixture();
    change(root, MOD_CHANGE);
    const result = push(root);
    expect(result.status, result.output).toBe(0);
    expect(result.output).toMatch(
      /SKIPPED\s+required\s+coverage-adequacy\s+partial selection — enforced by CI/u
    );
    expect(result.output).toMatch(/PASSED\s+required\s+test-correctness/u);
  });

  it("refuses the push when a selected test fails", () => {
    const root = fixture();
    change(root, OTHER_CHANGE);
    const result = push(root);
    expect(result.status).not.toBe(0);
    // The stand-in prints no failure signature a real Vitest would, so the
    // runner calls it UNPROVABLE; either way the required gate blocks.
    expect(result.output).toMatch(
      /(FAILED|UNPROVABLE)\s+required\s+test-correctness/u
    );
    expect(result.output).toContain(
      "required gate NOT PROVED: test-correctness"
    );
  });
});

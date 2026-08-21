import { rm } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runStandardsProofCli } from "../../src/cli/standards-proof-cmd.js";
import { captureStandardsProof } from "../../src/standards/capture.js";
import {
  resolveStandardsCheckPlan,
  type StandardsCheckPlan,
} from "../../src/standards/registry.js";
import {
  createTypescriptRepository,
  proofResidue,
  snapshotProof,
} from "./standards-proof-fixture.js";
import { useIoLatencyBudget } from "../helpers/io-latency-budget.js";

// The 25ms process timeout below is the SUBJECT and is deliberately left alone.
// What is calibrated here is the case's own liveness bound, which used to sit
// inline as `}, 30_000)` and measured the machine like every other member of
// this fixture family (CodySwannGT/lisa#2822).
useIoLatencyBudget(30_000);

const PRODUCTION_TIMEOUT_FLOOR_MS = 180_000;
const TEST_TIMEOUT_MS = 25;
let root: string | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  if (root !== undefined) await rm(root, { recursive: true, force: true });
  root = undefined;
});

describe("real standards command timeout", () => {
  it("preserves existing proof and leaves no storage residue", async () => {
    root = await createTypescriptRepository();
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runStandardsProofCli(root);
    const prior = await snapshotProof(root);

    await expect(
      captureStandardsProof(root, { resolvePlan: resolveTimeoutTestPlan })
    ).rejects.toThrow("Standards check timed out: typescript.lint");

    expect(await snapshotProof(root)).toEqual(prior);
    expect(await proofResidue(root)).toEqual([]);
  });
});

/**
 * Preserve the production plan while shortening only one injected test process.
 * @param args - Real resolver arguments supplied by capture
 * @returns One test-only plan that reaches the native process timeout path
 */
const resolveTimeoutTestPlan: typeof resolveStandardsCheckPlan = async (
  ...args
): Promise<StandardsCheckPlan> => {
  const plan = await resolveStandardsCheckPlan(...args);
  const first = plan.checks[0];
  expect(
    plan.checks.every(check => check.timeoutMs >= PRODUCTION_TIMEOUT_FLOOR_MS)
  ).toBe(true);
  if (first === undefined) throw new Error("Expected one production check");
  return Object.freeze({
    ...plan,
    checks: Object.freeze([
      Object.freeze({
        ...first,
        argv: Object.freeze([
          process.execPath,
          "-e",
          "setTimeout(() => undefined, 60_000)",
        ]) as readonly [string, ...string[]],
        timeoutMs: TEST_TIMEOUT_MS,
      }),
    ]),
  });
};

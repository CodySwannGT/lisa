/**
 * `lisa-test-run` marks every test run with its owner and sweeps once before
 * the payload starts (CodySwannGT/lisa#4597).
 *
 * The sweep itself is injected: what it removes and kills is covered by the
 * `lisa-cleanup-sweep*.test.ts` files. This file proves the start-up contract —
 * the owner marker every descendant inherits, the once-per-run skip, and that
 * a sweep failure is printed and never fails the run.
 * @module tests/unit/scripts/lisa-test-run-sweep
 */
import { describe, expect, it, vi } from "vitest";

import { startOfRunSweep } from "../../../src/cli/lisa-test-run-sweep.js";

const MARKER = "4242:1794063600";
const RESULT = {
  removed: ["/t/lisa-a"],
  killed: [],
  errors: [],
  dryRun: false,
  durationMs: 7,
};

/**
 * Run the start-up step with injected seams.
 * @param env - Starting environment
 * @param sweep - Injected sweep
 * @returns The env after the call, written lines, and the sweep mock
 */
async function start(
  env: Record<string, string | undefined>,
  sweep: () => Promise<typeof RESULT> = async () => RESULT
) {
  const lines: string[] = [];
  const sweepMock = vi.fn(sweep);
  await startOfRunSweep(env, {
    sweep: sweepMock,
    ownerMarker: () => MARKER,
    write: line => lines.push(line),
  });
  return { env, lines, sweepMock };
}

describe("lisa-test-run start-of-run sweep", () => {
  it("sets the owner marker, sweeps once, and prints one summary line", async () => {
    const { env, lines, sweepMock } = await start({});
    expect(env["LISA_TEST_RUN_OWNER"]).toBe(MARKER);
    expect(env["LISA_CLEANUP_SWEPT"]).toBe("1");
    expect(sweepMock).toHaveBeenCalledTimes(1);
    expect(lines).toEqual([
      "🧹 swept 1 stale temp dir, 0 orphaned test processes (7 ms)\n",
    ]);
  });

  it("skips the sweep inside a run that already swept but still marks itself", async () => {
    const { env, lines, sweepMock } = await start({
      LISA_CLEANUP_SWEPT: "1",
      LISA_TEST_RUN_OWNER: "1:1",
    });
    expect(sweepMock).not.toHaveBeenCalled();
    expect(lines).toEqual([]);
    expect(env["LISA_TEST_RUN_OWNER"]).toBe(MARKER);
  });

  it("prints a sweep failure and resolves instead of failing the run", async () => {
    const { env, lines } = await start({}, async () => {
      throw new Error("disk on fire");
    });
    expect(lines).toEqual([
      expect.stringMatching(/cleanup sweep failed: disk on fire; continuing/u),
    ]);
    expect(env["LISA_TEST_RUN_OWNER"]).toBe(MARKER);
  });
});

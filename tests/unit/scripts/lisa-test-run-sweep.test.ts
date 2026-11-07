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
/** A marker naming an enclosing sweeper that is still alive. */
const LIVE_SWEEPER = "1111:5";
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
 * @returns The payload environment, written lines, and the sweep mock
 */
async function start(
  inherited: Record<string, string | undefined>,
  sweep: () => Promise<typeof RESULT> = async () => RESULT
) {
  const lines: string[] = [];
  const sweepMock = vi.fn(sweep);
  const added = await startOfRunSweep(inherited, {
    sweep: sweepMock,
    ownerMarker: () => MARKER,
    liveSweeper: value => (value === LIVE_SWEEPER ? 1111 : null),
    write: line => lines.push(line),
  });
  const env: Record<string, string | undefined> = { ...inherited, ...added };
  return { env, lines, sweepMock };
}

describe("lisa-test-run start-of-run sweep", () => {
  it("sets the owner marker, sweeps once, and prints one summary line", async () => {
    const { env, lines, sweepMock } = await start({});
    expect(env["LISA_TEST_RUN_OWNER"]).toBe(MARKER);
    expect(env["LISA_CLEANUP_SWEPT"]).toBe(MARKER);
    expect(sweepMock).toHaveBeenCalledTimes(1);
    expect(lines).toEqual([
      "🧹 swept 1 stale temp dir, 0 orphaned test processes (7 ms)\n",
    ]);
  });

  it("skips the sweep, saying so, inside a live sweeper's run, but still marks itself", async () => {
    const { env, lines, sweepMock } = await start({
      LISA_CLEANUP_SWEPT: LIVE_SWEEPER,
      LISA_TEST_RUN_OWNER: LIVE_SWEEPER,
    });
    expect(sweepMock).not.toHaveBeenCalled();
    expect(lines).toEqual([
      "🧹 cleanup sweep already ran (pid 1111); skipping\n",
    ]);
    expect(env["LISA_TEST_RUN_OWNER"]).toBe(MARKER);
  });

  it("sweeps when the recorded sweeper is gone or the mark is malformed", async () => {
    for (const stale of ["1", "999999:0"]) {
      const { env, sweepMock } = await start({ LISA_CLEANUP_SWEPT: stale });
      expect(sweepMock).toHaveBeenCalledTimes(1);
      expect(env["LISA_CLEANUP_SWEPT"]).toBe(MARKER);
    }
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

  it("prints an owner-marker failure, falls back to an unknown start, and still sweeps", async () => {
    const lines: string[] = [];
    const sweep = vi.fn(async () => RESULT);
    const env = await startOfRunSweep(
      {},
      {
        sweep,
        ownerMarker: () => {
          throw new Error("ps exploded");
        },
        write: line => lines.push(line),
      }
    );
    expect(env["LISA_TEST_RUN_OWNER"]).toBe(`${process.pid}:0`);
    expect(env["LISA_CLEANUP_SWEPT"]).toBe(`${process.pid}:0`);
    expect(sweep).toHaveBeenCalledTimes(1);
    expect(lines[0]).toMatch(/owner marker failed: ps exploded; continuing/u);
    expect(lines).toHaveLength(2);
  });

  it("gives up on a sweep that outlives its deadline and continues", async () => {
    const lines: string[] = [];
    await startOfRunSweep(
      {},
      {
        sweep: () => new Promise(() => {}),
        ownerMarker: () => MARKER,
        write: line => lines.push(line),
        timeoutMs: 20,
      }
    );
    expect(lines).toEqual([
      expect.stringMatching(
        /cleanup sweep did not finish \(timed out after .*\); continuing/u
      ),
    ]);
  });
});

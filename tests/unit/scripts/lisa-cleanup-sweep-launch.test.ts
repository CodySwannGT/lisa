/**
 * Unit tests for the synchronous start-of-run launcher the gate runner calls
 * at `--moment=push` (CodySwannGT/lisa#4597).
 *
 * The launcher exists because the gate runner's `main` is synchronous and the
 * sweep is not. Every case injects the spawn, so nothing here sweeps the real
 * temp directory or the real process table.
 * @module tests/unit/scripts/lisa-cleanup-sweep-launch
 */
import { describe, expect, it, vi } from "vitest";

import {
  runStartOfRunSweep,
  SWEPT_ENV,
} from "../../../all/copy-overwrite/scripts/lib/lisa-cleanup-sweep.mjs";

const SUMMARY = "🧹 swept 2 stale temp dirs, 1 orphaned test process (40 ms)";
/** This gate runner's own marker. */
const SELF_MARKER = "77:7";
/** A marker naming a sweeper that is still alive with the same start time. */
const LIVE_SWEEPER = "4242:9";

/**
 * Run the launcher with a fresh env and a recording log.
 * @param spawn - Injected spawn seam
 * @param env - Starting environment
 * @returns The env after the call, the log lines, and the spawn mock
 */
function launch(
  spawn: (...args: unknown[]) => unknown,
  env: Record<string, string | undefined> = {}
) {
  const lines: string[] = [];
  const spawnMock = vi.fn(spawn);
  runStartOfRunSweep({
    env,
    spawn: spawnMock,
    log: line => lines.push(line),
    ownerMarker: () => SELF_MARKER,
    liveSweeper: value => (value === LIVE_SWEEPER ? 4242 : null),
  });
  return { env, lines, spawnMock };
}

describe("start-of-run launcher", () => {
  it("runs the sweep CLI once under a short deadline and forwards its one line", () => {
    const { env, lines, spawnMock } = launch(() => ({
      status: 0,
      stdout: `${SUMMARY}\n`,
      stderr: "",
    }));
    expect(lines).toEqual([SUMMARY]);
    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [command, args, options] = spawnMock.mock.calls[0] as [
      string,
      string[],
      { timeout: number; env: Record<string, string | undefined> },
    ];
    expect(command).toBe(process.execPath);
    expect(args[0]).toMatch(/lisa-cleanup-sweep\.mjs$/u);
    expect(options.timeout).toBeLessThanOrEqual(15_000);
    expect(env[SWEPT_ENV]).toBe(SELF_MARKER);
  });

  it("skips, saying so, when a live sweeper already swept, and spawns nothing", () => {
    const { env, lines, spawnMock } = launch(
      () => ({ status: 0, stdout: "" }),
      { [SWEPT_ENV]: LIVE_SWEEPER }
    );
    expect(spawnMock).not.toHaveBeenCalled();
    expect(lines).toEqual([
      "🧹 cleanup sweep already ran (pid 4242); skipping",
    ]);
    expect(env[SWEPT_ENV]).toBe(LIVE_SWEEPER);
  });

  it("sweeps anyway, and takes over the mark, when the recorded sweeper is gone", () => {
    for (const stale of ["1", "999999:0", "4242:8"]) {
      const { env, spawnMock } = launch(
        () => ({ status: 0, stdout: `${SUMMARY}\n` }),
        { [SWEPT_ENV]: stale }
      );
      expect(spawnMock).toHaveBeenCalledTimes(1);
      expect(env[SWEPT_ENV]).toBe(SELF_MARKER);
    }
  });

  it("prints a line and continues when the sweep exits non-zero", () => {
    const { env, lines } = launch(() => ({
      status: 3,
      stdout: "",
      stderr: "kaboom\n",
    }));
    expect(lines).toEqual([
      expect.stringMatching(
        /cleanup sweep did not finish.*exit 3.*continuing/u
      ),
    ]);
    expect(env[SWEPT_ENV]).toBe(SELF_MARKER);
  });

  it("prints a line and continues when the sweep times out or cannot start", () => {
    const timedOut = launch(() => {
      throw Object.assign(new Error("spawnSync ETIMEDOUT"), {
        code: "ETIMEDOUT",
      });
    });
    expect(timedOut.lines).toEqual([
      expect.stringMatching(
        /cleanup sweep did not finish.*timed out.*continuing/u
      ),
    ]);
    const missing = launch(() => ({
      status: null,
      error: new Error("spawn ENOENT"),
      stdout: "",
    }));
    expect(missing.lines).toEqual([
      expect.stringMatching(
        /cleanup sweep did not finish.*ENOENT.*continuing/u
      ),
    ]);
  });
});

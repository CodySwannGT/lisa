/**
 * Tests for what a bounded child's callers do when the deadline is reached.
 *
 * `boundedSpawnSync` reports a killed child by THROWING — deliberately, so a
 * call site that does nothing inherits fail-closed behaviour. Three call sites
 * were written against the other contract: they read `child.error` on a
 * RETURNED result, which is the shape `spawnSync` produces and the shape the
 * helper deliberately removed. `result.error` never carries `ETIMEDOUT` past
 * the helper, so the branch each of those sites wrote for a killed child was
 * unreachable and the throw escaped instead.
 *
 * That is worth a dedicated file because of what escaping looks like from
 * outside. A killed child returns `{status: null, stdout: ""}` — identical to a
 * program that ran and said no — so an unhandled throw does not read as "the
 * box was busy". It reads as the gate runner crashing, or as an environment
 * verb that never reported which verdict it reached.
 *
 * Every assertion here drives the REAL default executor. `prepareEnvironment`
 * and `runGates` both take an injectable `exec`, and injecting one would test
 * the fixture rather than the shipped path — so these call the executors that
 * ship, with the helper stubbed to do the one thing the helper documents.
 * @module tests/unit/scripts/bounded-spawn-deadline-contract
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The error Node attaches to a child it killed at its deadline.
 *
 * `code: "ETIMEDOUT"` is the whole discriminator — `isChildTimeout` reads that
 * property and nothing else, so this is the platform fact rather than a Lisa
 * convention.
 * @returns A fresh killed-child error.
 */
function killedError(): Error & { code: string } {
  return Object.assign(new Error("spawnSync ETIMEDOUT"), {
    code: "ETIMEDOUT",
  });
}

const { boundedSpawnSync } = vi.hoisted(() => ({
  boundedSpawnSync: vi.fn(),
}));

// One mock covers both subjects: `lisa-environment-prepare.mjs` and
// `lisa-run-gates.mjs` import the same `./lib/bounded-spawn.mjs`.
vi.mock(
  "../../../all/copy-overwrite/scripts/lib/bounded-spawn.mjs",
  async importActual => ({
    ...(await importActual<object>()),
    boundedSpawnSync,
  })
);

/** A fault this module cannot name, so it must reach the caller untouched. */
const UNNAMEABLE = "the module itself is broken";

/** The one gate command every run-gates assertion below asks for. */
const GATE_COMMAND = "bun run test:unit";

/** Stand-in implementations. Their content is irrelevant — only presence is. */
const SCRIPTS = Object.freeze({
  "environment:reset": "node ./scripts/reset.mjs",
  "environment:reseed": "node ./scripts/reseed.mjs",
});

beforeEach(() => {
  boundedSpawnSync.mockReset();
  vi.stubEnv("LISA_GATES_CAPTURE", undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("a killed child reaching lisa-environment-prepare", () => {
  it("reports the killed verdict instead of throwing out of prepareEnvironment", async () => {
    boundedSpawnSync.mockImplementation(() => {
      throw killedError();
    });
    const { prepareEnvironment } =
      await import("../../../all/copy-overwrite/scripts/lisa-environment-prepare.mjs");

    const result = prepareEnvironment({
      env: "dev",
      runner: "bun run",
      scripts: SCRIPTS,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("environment_verb_failed");
    expect(result.message).toContain("was killed before it finished");
  });

  it("stops before the reseed when the reset is killed", async () => {
    boundedSpawnSync.mockImplementation(() => {
      throw killedError();
    });
    const { prepareEnvironment } =
      await import("../../../all/copy-overwrite/scripts/lisa-environment-prepare.mjs");

    const result = prepareEnvironment({
      env: "dev",
      runner: "bun run",
      scripts: SCRIPTS,
    });

    expect(result.ran).toEqual(["bun run environment:reset -- --env=dev"]);
  });

  it("still re-raises a failure that is not a deadline", async () => {
    boundedSpawnSync.mockImplementation(() => {
      throw new Error(UNNAMEABLE);
    });
    const { prepareEnvironment } =
      await import("../../../all/copy-overwrite/scripts/lisa-environment-prepare.mjs");

    expect(() =>
      prepareEnvironment({ env: "dev", runner: "bun run", scripts: SCRIPTS })
    ).toThrow(UNNAMEABLE);
  });
});

describe("a killed child reaching the lisa-run-gates executor", () => {
  it("dispatches the original command once and retains its OS nonzero status", async () => {
    boundedSpawnSync.mockImplementation(() => ({
      status: 17,
      output: [null, null, null, "diagnostic"],
      error: undefined,
    }));
    const { spawnExec } =
      await import("../../../all/copy-overwrite/scripts/lisa-run-gates.mjs");

    expect(spawnExec(GATE_COMMAND)).toEqual({
      code: 17,
      output: process.platform === "win32" ? null : "diagnostic",
    });
    expect(boundedSpawnSync).toHaveBeenCalledTimes(1);
    const [executable, args, options] = boundedSpawnSync.mock.calls[0] as [
      string,
      string[],
      { env?: Record<string, string>; stdio: string | string[] },
    ];
    expect(executable).toBe(process.execPath);
    expect(args[0]).toContain("process-tree-runner.mjs");
    expect(args.at(-1)).toBe(GATE_COMMAND);
    expect(options.env).toBeUndefined();
    expect(options.stdio).toEqual(
      process.platform === "win32"
        ? "inherit"
        : ["inherit", "inherit", "inherit", "pipe"]
    );
  });

  it("reports code null rather than throwing when the gate command is killed", async () => {
    boundedSpawnSync.mockImplementation(() => {
      throw killedError();
    });
    const { spawnExec } =
      await import("../../../all/copy-overwrite/scripts/lisa-run-gates.mjs");

    expect(spawnExec(GATE_COMMAND)).toEqual({
      code: null,
      output: null,
    });
  });

  it("reports unknown for a killed captured command without retrying", async () => {
    boundedSpawnSync.mockImplementation(() => {
      throw killedError();
    });
    const { spawnExec } =
      await import("../../../all/copy-overwrite/scripts/lisa-run-gates.mjs");

    expect(spawnExec(GATE_COMMAND)).toEqual({ code: null, output: null });
    expect(boundedSpawnSync).toHaveBeenCalledTimes(1);
    const args = boundedSpawnSync.mock.calls[0]?.[1] as string[];
    expect(args.at(-1)).toBe(GATE_COMMAND);
    expect(args.includes("--capture-fd=3")).toBe(process.platform !== "win32");
  });

  it("retains OS nonzero status when diagnostic output is unavailable", async () => {
    boundedSpawnSync.mockImplementation(() => ({
      status: 7,
      stdout: "",
      stderr: "",
      error: undefined,
    }));
    const { spawnExec } =
      await import("../../../all/copy-overwrite/scripts/lisa-run-gates.mjs");

    expect(spawnExec(GATE_COMMAND)).toEqual({ code: 7, output: null });
    expect(boundedSpawnSync).toHaveBeenCalledTimes(1);
  });

  it("keeps the capture-disabled timeout unknown on its original plain route", async () => {
    vi.stubEnv("LISA_GATES_CAPTURE", "0");
    boundedSpawnSync.mockImplementation(() => {
      throw killedError();
    });
    const { spawnExec } =
      await import("../../../all/copy-overwrite/scripts/lisa-run-gates.mjs");

    expect(spawnExec(GATE_COMMAND)).toEqual({ code: null, output: null });
    expect(boundedSpawnSync).toHaveBeenCalledTimes(1);
    const [, args, options] = boundedSpawnSync.mock.calls[0] as [
      string,
      string[],
      { stdio: string },
    ];
    expect(options.stdio).toBe("inherit");
    expect(args).not.toContain("--capture-fd=3");
    expect(args.at(-1)).toBe(GATE_COMMAND);
  });

  it("still re-raises a failure that is not a deadline", async () => {
    boundedSpawnSync.mockImplementation(() => {
      throw new Error(UNNAMEABLE);
    });
    const { spawnExec } =
      await import("../../../all/copy-overwrite/scripts/lisa-run-gates.mjs");

    expect(() => spawnExec(GATE_COMMAND)).toThrow(UNNAMEABLE);
  });
});

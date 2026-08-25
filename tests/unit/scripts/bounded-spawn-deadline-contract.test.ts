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

import { beforeEach, describe, expect, it, vi } from "vitest";

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

  it("reports code null when the capture probe survives but the gate is killed", async () => {
    boundedSpawnSync.mockImplementation((command: string, args: string[]) => {
      // The `command -v tee` probe answers normally; only the gate is killed.
      if (args?.[1]?.includes("command -v tee"))
        return { status: 0, stdout: "", stderr: "", error: undefined };
      throw killedError();
    });
    const { spawnExec } =
      await import("../../../all/copy-overwrite/scripts/lisa-run-gates.mjs");

    expect(spawnExec(GATE_COMMAND)).toEqual({
      code: null,
      output: null,
    });
  });

  it("treats a killed capture probe as a capability it cannot confirm", async () => {
    // A probe killed at its deadline must answer "no capture", not escape. The
    // probe exists to avoid claiming a capability the runner cannot confirm;
    // a throw out of it converts an unconfirmable capability into a crash.
    boundedSpawnSync.mockImplementation((command: string, args: string[]) => {
      if (args?.[1]?.includes("command -v tee")) throw killedError();
      return { status: 7, stdout: "", stderr: "", error: undefined };
    });
    const { spawnExec } =
      await import("../../../all/copy-overwrite/scripts/lisa-run-gates.mjs");

    expect(spawnExec(GATE_COMMAND)).toEqual({ code: 7, output: null });
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

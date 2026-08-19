/**
 * Tests for the environment preparation caller.
 *
 * The assertions that carry weight are about the failure modes this module
 * exists to prevent, in order of how badly each one ends:
 *
 * 1. A destructive verb reaching production. The refusal must happen before
 *    anything is invoked, and must fail closed on an identity it cannot read.
 * 2. A requested verb that does not exist resolving to a skip. A suite that
 *    runs against an environment nobody reset, and reports green, is the exact
 *    defect the facade work existed to prevent.
 * 3. A reseed running after a failed reset — fixture data layered onto whatever
 *    the last run left behind, which is worse than either state alone.
 * 4. The `--env` argument being dropped on the way to the verb. Measured: `npm
 *    run <task> --env=dev` silently discards it while `bun run` forwards it, so
 *    a command shape that works on one runner can arrive argument-less on the
 *    other.
 * @module tests/unit/scripts/lisa-environment-prepare
 */

import { describe, expect, it } from "vitest";

import {
  PREPARE_REASONS,
  prepareEnvironment,
} from "../../../all/copy-overwrite/scripts/lisa-environment-prepare.mjs";

/** Stand-in implementations. Their content is irrelevant — only presence is. */
const RESET_IMPL = "node ./scripts/reset.mjs";
const RESEED_IMPL = "node ./scripts/reseed.mjs";

/** A project declaring both verbs. */
const BOTH = Object.freeze({
  "environment:reset": RESET_IMPL,
  "environment:reseed": RESEED_IMPL,
});

/** A project whose only engine converges to fixture state (facade §1). */
const RESEED_ONLY = Object.freeze({ "environment:reseed": RESEED_IMPL });

/** The exact command lines a correctly wired preparation emits. */
const RESET_CMD = "bun run environment:reset -- --env=dev";
const RESEED_CMD = "bun run environment:reseed -- --env=dev";

/**
 * An executor that records every command and reports success.
 * @returns {{calls: string[], exec: (command: string) => number}} Recorder.
 */
function recorder() {
  const calls: string[] = [];
  return {
    calls,
    exec: (command: string) => {
      calls.push(command);
      return 0;
    },
  };
}

describe("prepareEnvironment — argument validation", () => {
  it("refuses a missing --env without invoking anything", () => {
    const { calls, exec } = recorder();
    const result = prepareEnvironment({
      env: undefined,
      scripts: BOTH,
      runner: "bun run",
      exec,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("environment_env_required");
    expect(calls).toEqual([]);
  });

  it("refuses a blank --env rather than treating it as absent-but-fine", () => {
    const { calls, exec } = recorder();
    const result = prepareEnvironment({
      env: "   ",
      scripts: BOTH,
      runner: "bun run",
      exec,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("environment_env_required");
    expect(calls).toEqual([]);
  });

  it("refuses a verb outside the facade's two", () => {
    const { calls, exec } = recorder();
    const result = prepareEnvironment({
      env: "dev",
      verbs: ["truncate"],
      scripts: BOTH,
      runner: "bun run",
      exec,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("environment_verb_unknown");
    expect(calls).toEqual([]);
  });
});

describe("prepareEnvironment — production refusal", () => {
  // Each of these classifies as production to the shipped destructive guard.
  // They are listed literally rather than generated so that a change to the
  // guard's vocabulary shows up here as a failing case with a name.
  it.each(["production", "prod", "prd", "live", "us-prod-1", "PRODUCTION"])(
    "refuses %s before invoking anything",
    env => {
      const { calls, exec } = recorder();
      const result = prepareEnvironment({
        env,
        scripts: BOTH,
        runner: "bun run",
        exec,
      });

      expect(result.ok).toBe(false);
      expect(result.reason).toBe("environment_target_forbidden");
      expect(calls).toEqual([]);
    }
  );

  it("fails closed on an identity it cannot classify", () => {
    // "unknown" is what a resolver returns when it failed. Treating it as
    // non-production would make an unreadable identity the cheapest path to a
    // destructive run.
    const { calls, exec } = recorder();
    const result = prepareEnvironment({
      env: "unknown",
      scripts: BOTH,
      runner: "bun run",
      exec,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("environment_target_forbidden");
    expect(calls).toEqual([]);
  });
});

describe("prepareEnvironment — a requested verb that is absent", () => {
  it("fails, naming the script, rather than skipping", () => {
    const { calls, exec } = recorder();
    const result = prepareEnvironment({
      env: "dev",
      verbs: ["reset", "reseed"],
      scripts: RESEED_ONLY,
      runner: "bun run",
      exec,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("environment_verb_missing");
    expect(result.message).toContain("environment:reset");
    expect(calls).toEqual([]);
  });

  it("does not invoke the verbs that DO exist when one is missing", () => {
    // Fail before starting, not part-way through: a reseed that ran because
    // the reset was merely absent leaves fixture data on top of old state.
    const { calls, exec } = recorder();
    prepareEnvironment({
      env: "dev",
      verbs: ["reset", "reseed"],
      scripts: RESEED_ONLY,
      runner: "bun run",
      exec,
    });

    expect(calls).toEqual([]);
  });

  it("accepts a project that declares only the verb the caller asked for", () => {
    // The facade contract makes the two verbs independently optional: a suite
    // built on shared persona accounts converges them and has no "empty"
    // operation at all. Requiring reseed alone must not fail on reset.
    const { calls, exec } = recorder();
    const result = prepareEnvironment({
      env: "dev",
      verbs: ["reseed"],
      scripts: RESEED_ONLY,
      runner: "bun run",
      exec,
    });

    expect(result.ok).toBe(true);
    expect(calls).toEqual([RESEED_CMD]);
  });
});

describe("prepareEnvironment — sequencing", () => {
  it("runs reset before reseed, forwarding --env after a bare --", () => {
    // The `--` is not cosmetic. Measured: `npm run <task> --env=dev` discards
    // the flag entirely while `bun run` forwards it, so the form without `--`
    // reaches the verb argument-less on npm — and a verb whose --env is
    // missing is required by the facade contract to refuse.
    const { calls, exec } = recorder();
    const result = prepareEnvironment({
      env: "dev",
      verbs: ["reset", "reseed"],
      scripts: BOTH,
      runner: "bun run",
      exec,
    });

    expect(result.ok).toBe(true);
    expect(calls).toEqual([RESET_CMD, RESEED_CMD]);
  });

  it("orders reset before reseed even when asked for in the other order", () => {
    const { calls, exec } = recorder();
    prepareEnvironment({
      env: "dev",
      verbs: ["reseed", "reset"],
      scripts: BOTH,
      runner: "bun run",
      exec,
    });

    expect(calls).toEqual([RESET_CMD, RESEED_CMD]);
  });

  it("stops after a failed reset and never reseeds", () => {
    const calls: string[] = [];
    const result = prepareEnvironment({
      env: "dev",
      verbs: ["reset", "reseed"],
      scripts: BOTH,
      runner: "bun run",
      exec: (command: string) => {
        calls.push(command);
        return 1;
      },
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("environment_verb_failed");
    expect(calls).toEqual([RESET_CMD]);
  });

  it("treats a signal-killed verb as a failure, not a pass", () => {
    // spawnSync reports a null status when the child is killed. Reading that
    // as anything but a failure lets an OOM-killed reset clear the suite.
    const { exec: _unused, calls } = recorder();
    const result = prepareEnvironment({
      env: "dev",
      verbs: ["reset"],
      scripts: BOTH,
      runner: "bun run",
      exec: (command: string) => {
        calls.push(command);
        return null;
      },
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("environment_verb_failed");
  });

  it("honours the configured runner rather than assuming one", () => {
    const { calls, exec } = recorder();
    prepareEnvironment({
      env: "staging",
      verbs: ["reset"],
      scripts: BOTH,
      runner: "npm run",
      exec,
    });

    expect(calls).toEqual(["npm run environment:reset -- --env=staging"]);
  });
});

describe("PREPARE_REASONS", () => {
  it("exposes every reason the module can return", () => {
    // The reasons are a machine-readable contract for callers and reports, so
    // they are pinned literally here: renaming one is a breaking change that
    // should require editing this list on purpose.
    expect([...PREPARE_REASONS].sort((a, b) => a.localeCompare(b))).toEqual([
      "environment_env_required",
      "environment_target_forbidden",
      "environment_verb_failed",
      "environment_verb_missing",
      "environment_verb_unknown",
    ]);
  });
});

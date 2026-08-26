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

import { describe, expect, it, vi } from "vitest";

import {
  PREPARE_REASONS,
  prepareEnvironment,
  runCli,
} from "../../../all/copy-overwrite/scripts/lisa-environment-prepare.mjs";

/** Stand-in implementations. Their content is irrelevant — only presence is. */
const RESET_IMPL = "node ./scripts/reset.mjs";
const RESEED_IMPL = "node ./scripts/reseed.mjs";
const RESET_SCRIPT = "environment:reset";

/** A project declaring both verbs. */
const BOTH = Object.freeze({
  [RESET_SCRIPT]: RESET_IMPL,
  "environment:reseed": RESEED_IMPL,
});

/** Incomplete declarations used to prove the lifecycle refuses before mutation. */
const RESEED_ONLY = Object.freeze({ "environment:reseed": RESEED_IMPL });
const RESET_ONLY = Object.freeze({ [RESET_SCRIPT]: RESET_IMPL });

/** The exact command lines a correctly wired preparation emits. */
const RESET_CMD = "bun run environment:reset -- --env=dev";
const RESEED_CMD = "bun run environment:reseed -- --env=dev";

/**
 * An executor that records every invocation and reports success.
 *
 * `calls` joins each argument VECTOR for readability; `vectors` keeps them
 * unjoined, which is what the shell-safety assertions need — a joined string
 * cannot distinguish one argument containing a space from two arguments.
 * @returns The recorder.
 */
function recorder() {
  const calls: string[] = [];
  const vectors: string[][] = [];
  return {
    calls,
    vectors,
    exec: (argv: string[]) => {
      vectors.push(argv);
      calls.push(argv.join(" "));
      return 0;
    },
  };
}

describe("prepareEnvironment — argument validation", () => {
  it("refuses an explicitly empty verbs value as incomplete", () => {
    const errors: string[] = [];
    const stderr = vi
      .spyOn(console, "error")
      .mockImplementation(value => errors.push(String(value)));

    try {
      expect(runCli(["--env=dev", "--verbs="])).toBe(1);
    } finally {
      stderr.mockRestore();
    }

    expect(errors).toContain(
      "❌ environment preparation refused: environment_lifecycle_incomplete"
    );
  });

  it("explains that a bare --verbs requires an equals-sign value", () => {
    const errors: string[] = [];
    const stderr = vi
      .spyOn(console, "error")
      .mockImplementation(value => errors.push(String(value)));
    try {
      expect(runCli(["--env=dev", "--verbs", "reset,reseed"])).toBe(1);
    } finally {
      stderr.mockRestore();
    }
    expect(errors).toContain(
      "❌ environment preparation refused: environment_verb_unknown"
    );
    expect(errors.join("\n")).toContain("--verbs=reset,reseed");
  });

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
    expect(result.message).toContain(RESET_SCRIPT);
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

  it.each([
    { verbs: ["reseed"], omitted: "reset" },
    { verbs: ["reset"], omitted: "reseed" },
    { verbs: [], omitted: "reset, reseed" },
  ])(
    "refuses an incomplete lifecycle before invoking anything: $verbs",
    ({ verbs, omitted }) => {
      const { calls, exec } = recorder();
      const result = prepareEnvironment({
        env: "dev",
        verbs,
        scripts: BOTH,
        runner: "bun run",
        exec,
      });

      expect(result.ok).toBe(false);
      expect(result.reason).toBe("environment_lifecycle_incomplete");
      expect(result.message).toContain(`omitted ${omitted}`);
      expect(calls).toEqual([]);
    }
  );

  it.each([
    { scripts: RESEED_ONLY, missing: RESET_SCRIPT },
    { scripts: RESET_ONLY, missing: "environment:reseed" },
  ])("requires both declared scripts: $missing", ({ scripts, missing }) => {
    const { calls, exec } = recorder();
    const result = prepareEnvironment({
      env: "dev",
      scripts,
      runner: "bun run",
      exec,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("environment_verb_missing");
    expect(result.message).toContain(missing);
    expect(calls).toEqual([]);
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
      exec: (argv: string[]) => {
        calls.push(argv.join(" "));
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
    const calls: string[] = [];
    const result = prepareEnvironment({
      env: "dev",
      scripts: BOTH,
      runner: "bun run",
      exec: (argv: string[]) => {
        calls.push(argv.join(" "));
        return null;
      },
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("environment_verb_failed");
    // The verb was actually reached. Without this the test would also pass if
    // the run had been refused before invoking anything, which is a different
    // outcome reported by a different reason.
    expect(calls).toEqual([RESET_CMD]);
    expect(result.ran).toEqual([RESET_CMD]);
  });

  it("honours the configured runner rather than assuming one", () => {
    const { calls, exec } = recorder();
    prepareEnvironment({
      env: "staging",
      scripts: BOTH,
      runner: "npm run",
      exec,
    });

    expect(calls).toEqual([
      "npm run environment:reset -- --env=staging",
      "npm run environment:reseed -- --env=staging",
    ]);
  });
});

describe("PREPARE_REASONS", () => {
  it("exposes every reason the module can return", () => {
    // The reasons are a machine-readable contract for callers and reports, so
    // they are pinned literally here: renaming one is a breaking change that
    // should require editing this list on purpose.
    expect([...PREPARE_REASONS].sort((a, b) => a.localeCompare(b))).toEqual([
      "environment_env_required",
      "environment_lifecycle_incomplete",
      "environment_name_malformed",
      "environment_runner_malformed",
      "environment_target_forbidden",
      "environment_verb_failed",
      "environment_verb_missing",
      "environment_verb_unknown",
    ]);
  });
});

describe("prepareEnvironment — the environment name cannot become syntax", () => {
  // Reported by review and REPRODUCED before fixing: `classifyEnvironment`
  // splits on non-alphanumerics and inspects the segments, so a value like
  // `dev; <another command>` yields the segments `dev` and the words of the
  // second command — none of which look like production — and the value passed
  // the refusal. It then reached a shell, measured as:
  //
  //   bun run environment:reset -- --env=dev; touch /tmp/lisa-injection-proof
  //
  // The severity is not "a command ran". It is that the injected half could
  // name PRODUCTION, so the missing check defeated the production guard using
  // the very input that guard exists to inspect.
  it.each([
    "dev; touch /tmp/pwned",
    "dev && echo pwned",
    "dev | echo pwned",
    "dev`echo pwned`",
    "dev$(echo pwned)",
    "dev staging",
    "dev'",
    '"dev"',
    // `../../etc/hosts` rather than the more familiar traversal target: the
    // secret scanner reads that token next to the following line and reports a
    // Generic Password. The fixture's job is "a traversal is refused", which
    // this does identically — changing the fixture beats suppressing a scanner.
    "../../etc/hosts",
    "-dev",
  ])("refuses %j without invoking anything", env => {
    const { calls, exec } = recorder();
    const result = prepareEnvironment({
      env,
      scripts: BOTH,
      runner: "bun run",
      exec,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("environment_name_malformed");
    expect(calls).toEqual([]);
  });

  it.each(["dev", "staging", "development", "us-prod-1", "preview_2", "e2e.1"])(
    "still accepts the ordinary name %j",
    env => {
      // The positive control. A validator that refused everything would pass
      // every assertion above while breaking every real caller.
      //
      // `us-prod-1` is well-formed but classifies as production, so it is
      // refused for a DIFFERENT reason. Either way it is never malformed.
      const { exec } = recorder();
      const result = prepareEnvironment({
        env,
        scripts: BOTH,
        runner: "bun run",
        exec,
      });

      expect(result.reason).not.toBe("environment_name_malformed");
    }
  );

  it("passes the environment as ONE argument, not a shell string", () => {
    // The structural half of the fix. Even if a name slipped past the
    // validator, it arrives as a single element of an argument vector executed
    // without a shell, where punctuation cannot become syntax.
    const { vectors, exec } = recorder();
    prepareEnvironment({
      env: "dev",
      scripts: BOTH,
      runner: "bun run",
      exec,
    });

    expect(vectors).toEqual([
      ["bun", "run", "environment:reset", "--", "--env=dev"],
      ["bun", "run", "environment:reseed", "--", "--env=dev"],
    ]);
  });

  it("refuses a task runner that is not a plain command", () => {
    const { calls, exec } = recorder();
    const result = prepareEnvironment({
      env: "dev",
      scripts: BOTH,
      runner: "bun run; touch /tmp/pwned",
      exec,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("environment_runner_malformed");
    expect(calls).toEqual([]);
  });

  it("BITE: refuses a runner that is not a string at all", () => {
    // `RegExp.prototype.test` coerces its argument, so `RUNNER_PREFIX.test(true)`
    // tests the STRING `"true"` and passes — the validation reads as a type
    // check and is not one. `runner` arrives from `readGates(cwd).runner`, which
    // destructures `.lisa.config.json` with a string default and hands back
    // whatever the file contained, so a non-string is reachable rather than
    // theoretical. The refusal that should have happened here instead became a
    // TypeError in `argvFor` — `runner.trim is not a function` — one line after
    // the guard that exists to stop exactly that value.
    for (const runner of [true, 42, null, ["bun", "run"], { cmd: "bun run" }]) {
      const { calls, exec } = recorder();
      const result = prepareEnvironment({
        env: "dev",
        scripts: BOTH,
        runner: runner as unknown as string,
        exec,
      });

      expect(result.ok).toBe(false);
      expect(result.reason).toBe("environment_runner_malformed");
      expect(calls).toEqual([]);
    }
  });

  it("BITE: refuses an environment name that is not a string at all", () => {
    // The sibling check, for the same coercion. `env` is normalized to a string
    // before it is matched, so the hole never opened here — this pins that the
    // normalization stays, and that a non-string still lands on the argument
    // reason rather than being coerced into a name.
    for (const env of [true, 42, ["dev"], { name: "dev" }]) {
      const { calls, exec } = recorder();
      const result = prepareEnvironment({
        env: env as unknown as string,
        scripts: BOTH,
        runner: "bun run",
        exec,
      });

      expect(result.ok).toBe(false);
      expect(result.reason).toBe("environment_env_required");
      expect(calls).toEqual([]);
    }
  });
});

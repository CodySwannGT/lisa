/**
 * Wiring of `lisa controls attest --before-enforce` (CodySwannGT/lisa#5001).
 *
 * What the run does is checked against real repositories in
 * `tests/unit/controls/attest-before-enforce*.test.ts`. This file checks
 * only that the option is on the command, that it is handed on, that it is
 * never handed on unasked, and that the run's own exit codes reach the
 * process.
 * @module tests/unit/controls/controls-cmd-attest-before-enforce
 */
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CONTROLS_COMMAND,
  addControlsCommand,
} from "../../../src/cli/controls-cmd.js";
import { createProgram } from "../../../src/cli/index.js";
import {
  BEFORE_ENFORCE_EXIT,
  BEFORE_ENFORCE_FLAG,
} from "../../../src/controls/commands/attest-before-enforce.js";
import {
  ATTEST_COMMAND,
  registerAttest,
} from "../../../src/controls/commands/attest.js";

describe("lisa controls attest --before-enforce", () => {
  const exitCodeBefore = process.exitCode;

  beforeEach(() => {
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.exitCode = exitCodeBefore;
  });

  /**
   * Build a controls group whose attest runs a stand-in.
   * @param code - Exit code the stand-in returns
   * @returns The program and the stand-in
   */
  function programWith(code: number): {
    readonly program: Command;
    readonly runAttest: ReturnType<typeof vi.fn>;
  } {
    const runAttest = vi.fn(async () => code);
    const program = new Command().exitOverride();
    addControlsCommand(program, [
      group => {
        registerAttest(group, { runAttest });
      },
    ]);
    return { program, runAttest };
  }

  it("is an option of the shipped command, and its help says nothing is written", () => {
    const option = createProgram()
      .commands.find(candidate => candidate.name() === CONTROLS_COMMAND)
      ?.commands.find(candidate => candidate.name() === ATTEST_COMMAND)
      ?.options.find(candidate => candidate.flags === BEFORE_ENFORCE_FLAG);

    expect(option?.description).toContain("Writes nothing");
    expect(option?.description).toContain("exists and is not enforced");
  });

  it("is handed on with the path and --json when asked for", async () => {
    const { program, runAttest } = programWith(BEFORE_ENFORCE_EXIT.ANSWERED);

    await program.parseAsync(
      [
        CONTROLS_COMMAND,
        ATTEST_COMMAND,
        "some/repo",
        BEFORE_ENFORCE_FLAG,
        "--json",
      ],
      { from: "user" }
    );

    expect(runAttest).toHaveBeenCalledExactlyOnceWith("some/repo", {
      beforeEnforce: true,
      json: true,
    });
    expect(process.exitCode).toBeUndefined();
  });

  it("is never handed on when it was not asked for", async () => {
    const { program, runAttest } = programWith(BEFORE_ENFORCE_EXIT.ANSWERED);

    await program.parseAsync([CONTROLS_COMMAND, ATTEST_COMMAND, "--json"], {
      from: "user",
    });

    expect(runAttest).toHaveBeenCalledExactlyOnceWith(undefined, {
      json: true,
    });
  });

  it.each([BEFORE_ENFORCE_EXIT.INCOMPLETE, BEFORE_ENFORCE_EXIT.NOT_RUN])(
    "exits %i when the run returns it",
    async code => {
      const { program } = programWith(code);

      await program.parseAsync(
        [CONTROLS_COMMAND, ATTEST_COMMAND, BEFORE_ENFORCE_FLAG],
        { from: "user" }
      );

      expect(process.exitCode).toBe(code);
    }
  );
});

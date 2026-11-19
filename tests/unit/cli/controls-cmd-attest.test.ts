/**
 * Wiring of `lisa controls attest` (CodySwannGT/lisa#4995).
 *
 * The command's own behaviour is checked against real repositories in
 * `tests/unit/controls/attest-command.test.ts`. This file checks only that
 * the command is on the group, takes what its help says it takes, and hands
 * the exit code back to the process.
 * @module tests/unit/cli/controls-cmd-attest
 */
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CONTROLS_COMMAND,
  CONTROLS_SUBCOMMANDS,
  addControlsCommand,
} from "../../../src/cli/controls-cmd.js";
import { createProgram } from "../../../src/cli/index.js";
import {
  ATTEST_COMMAND,
  ATTEST_EXIT,
  registerAttest,
} from "../../../src/controls/commands/attest.js";

/** An option no step of the attest command will ever take. */
const UNKNOWN_OPTION = "--no-such-option-4995";

describe("lisa controls attest", () => {
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

  it("is on the shipped list, with one optional path, --workspace and --json", () => {
    const command = createProgram()
      .commands.find(candidate => candidate.name() === CONTROLS_COMMAND)
      ?.commands.find(candidate => candidate.name() === ATTEST_COMMAND);

    expect(CONTROLS_SUBCOMMANDS).toContain(registerAttest);
    expect(
      command?.registeredArguments.map(argument => argument.name())
    ).toEqual(["path"]);
    expect(command?.registeredArguments[0]?.required).toBe(false);
    // Later steps add options of their own, so this names only its own two.
    expect(command?.options.map(option => option.flags)).toEqual(
      expect.arrayContaining(["--workspace <folder>", "--json"])
    );
  });

  it("runs in the current directory, as a table, with no copy named, by default", async () => {
    const { program, runAttest } = programWith(ATTEST_EXIT.PASSED);

    await program.parseAsync([CONTROLS_COMMAND, ATTEST_COMMAND], {
      from: "user",
    });

    expect(runAttest).toHaveBeenCalledExactlyOnceWith(undefined, {
      json: false,
    });
    expect(process.exitCode).toBeUndefined();
  });

  it("passes on the path, the copy and --json", async () => {
    const { program, runAttest } = programWith(ATTEST_EXIT.PASSED);

    await program.parseAsync(
      [
        CONTROLS_COMMAND,
        ATTEST_COMMAND,
        "some/repo",
        "--workspace",
        "some/copy",
        "--json",
      ],
      { from: "user" }
    );

    expect(runAttest).toHaveBeenCalledExactlyOnceWith("some/repo", {
      workspace: "some/copy",
      json: true,
    });
  });

  it.each([ATTEST_EXIT.NOT_PASSED, ATTEST_EXIT.NOT_RUN])(
    "exits %i when the command returns it",
    async code => {
      const { program } = programWith(code);

      await program.parseAsync([CONTROLS_COMMAND, ATTEST_COMMAND], {
        from: "user",
      });

      expect(process.exitCode).toBe(code);
    }
  );

  it("refuses an option it does not know", async () => {
    const { program, runAttest } = programWith(ATTEST_EXIT.PASSED);
    program.configureOutput({ writeErr: () => undefined });

    await expect(
      program.parseAsync([CONTROLS_COMMAND, ATTEST_COMMAND, UNKNOWN_OPTION], {
        from: "user",
      })
    ).rejects.toThrow();
    expect(runAttest).not.toHaveBeenCalled();
  });
});

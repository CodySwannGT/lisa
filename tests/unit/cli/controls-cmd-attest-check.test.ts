/**
 * Wiring of `lisa controls attest --check` (CodySwannGT/lisa#4998).
 *
 * What the check compares and says is covered against real repositories in
 * `tests/unit/controls/attest-check.test.ts`. This file checks only that the
 * flag is on the command, reaches the command's function, and that its exit
 * code reaches the process.
 * @module tests/unit/cli/controls-cmd-attest-check
 */
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CONTROLS_COMMAND,
  addControlsCommand,
} from "../../../src/cli/controls-cmd.js";
import { createProgram } from "../../../src/cli/index.js";
import { ATTEST_CHECK_EXIT } from "../../../src/controls/attest-check.js";
import {
  ATTEST_COMMAND,
  registerAttest,
  runAttest,
} from "../../../src/controls/commands/attest.js";

describe("lisa controls attest --check", () => {
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
    readonly stub: ReturnType<typeof vi.fn>;
  } {
    const stub = vi.fn(async () => code);
    const program = new Command().exitOverride();
    addControlsCommand(program, [
      group => {
        registerAttest(group, { runAttest: stub });
      },
    ]);
    return { program, stub };
  }

  it("is an option of the shipped command", () => {
    const command = createProgram()
      .commands.find(candidate => candidate.name() === CONTROLS_COMMAND)
      ?.commands.find(candidate => candidate.name() === ATTEST_COMMAND);

    expect(command?.options.map(option => option.flags)).toContain("--check");
  });

  it("is passed on with the path", async () => {
    const { program, stub } = programWith(ATTEST_CHECK_EXIT.MATCHES);

    await program.parseAsync(
      [CONTROLS_COMMAND, ATTEST_COMMAND, "some/repo", "--check"],
      { from: "user" }
    );

    expect(stub).toHaveBeenCalledExactlyOnceWith("some/repo", {
      json: false,
      check: true,
    });
    expect(process.exitCode).toBeUndefined();
  });

  it("is left out of what is passed on when it is not given", async () => {
    const { program, stub } = programWith(ATTEST_CHECK_EXIT.MATCHES);

    await program.parseAsync([CONTROLS_COMMAND, ATTEST_COMMAND], {
      from: "user",
    });

    expect(stub).toHaveBeenCalledExactlyOnceWith(undefined, { json: false });
  });

  it.each([ATTEST_CHECK_EXIT.DIFFERS, ATTEST_CHECK_EXIT.NOT_CHECKED])(
    "exits %i when the check returns it",
    async code => {
      const { program } = programWith(code);

      await program.parseAsync([CONTROLS_COMMAND, ATTEST_COMMAND, "--check"], {
        from: "user",
      });

      expect(process.exitCode).toBe(code);
    }
  );

  it("runs no proof and opens no workspace", async () => {
    const opened = vi.fn();
    const stderr: string[] = [];

    const code = await runAttest(
      "no/such/folder",
      { check: true },
      {
        cwd: "/",
        stdout: () => undefined,
        stderr: line => {
          stderr.push(line);
        },
        openWorkspace: opened,
        loadTools: opened,
      }
    );

    expect(code).toBe(ATTEST_CHECK_EXIT.NOT_CHECKED);
    expect(opened).not.toHaveBeenCalled();
    expect(stderr.at(-1)).toMatch(/^attest --check: FAIL\. /u);
  });
});

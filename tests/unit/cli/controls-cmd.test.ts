/**
 * Wiring of the `lisa controls` command group.
 *
 * The deterministic control commands all live behind one group. The group
 * itself is only a list: each subcommand registers itself, so adding one is a
 * new module and one more entry (CodySwannGT/lisa#4978).
 */
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CONTROLS_COMMAND,
  CONTROLS_SUBCOMMANDS,
  addControlsCommand,
} from "../../../src/cli/controls-cmd.js";
import { createProgram } from "../../../src/cli/index.js";
import { addUpdateCheckHook } from "../../../src/cli/update-check-hook.js";
import {
  GAPS_COMMAND,
  registerGaps,
} from "../../../src/controls/commands/gaps.js";
import { registerReportCheck } from "../../../src/controls/commands/report-check.js";

const REPORT_CHECK = "report-check";

/**
 * Find the controls group of a program.
 * @param program - The program
 * @returns The group, or undefined when it is not registered
 */
function controlsGroup(program: Command): Command | undefined {
  return program.commands.find(command => command.name() === CONTROLS_COMMAND);
}

describe("lisa controls", () => {
  it("is registered on the program with report-check under it", () => {
    const group = controlsGroup(createProgram());

    expect(group?.commands.map(command => command.name())).toContain(
      REPORT_CHECK
    );
  });

  it("registers exactly the subcommands on its list, in order", () => {
    const program = new Command();
    const first = vi.fn((group: Command) => {
      group.command("first");
    });
    const second = vi.fn((group: Command) => {
      group.command("second");
    });

    addControlsCommand(program, [first, second]);

    expect(
      controlsGroup(program)?.commands.map(command => command.name())
    ).toEqual(["first", "second"]);
  });

  it("lists report-check among the shipped subcommands", () => {
    expect(CONTROLS_SUBCOMMANDS).toContain(registerReportCheck);
  });

  it("lists gaps among the shipped subcommands, with one optional path and no options", () => {
    const command = controlsGroup(createProgram())?.commands.find(
      candidate => candidate.name() === GAPS_COMMAND
    );

    expect(CONTROLS_SUBCOMMANDS).toContain(registerGaps);
    expect(
      command?.registeredArguments.map(argument => argument.name())
    ).toEqual(["path"]);
    expect(command?.registeredArguments[0]?.required).toBe(false);
    expect(command?.options).toEqual([]);
  });

  it("does not run the update check: these run inside other steps", async () => {
    const runUpdateCheck = vi.fn(async () => ({
      current: "0.0.0",
      isOutdated: false,
      latest: null,
      reason: "skipped" as const,
    }));
    const printUpdateWarning = vi.fn();
    const action = vi.fn();
    const program = new Command().exitOverride();
    addUpdateCheckHook(program, { printUpdateWarning, runUpdateCheck });
    addControlsCommand(program, [
      group => {
        group.command("example").action(action);
      },
    ]);

    await program.parseAsync([CONTROLS_COMMAND, "example"], { from: "user" });

    expect(action).toHaveBeenCalledOnce();
    expect(runUpdateCheck).not.toHaveBeenCalled();
    expect(printUpdateWarning).not.toHaveBeenCalled();
  });
});

describe("lisa controls report-check", () => {
  const exitCodeBefore = process.exitCode;

  beforeEach(() => {
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.exitCode = exitCodeBefore;
  });

  /**
   * Build a controls group whose report-check runs a stand-in.
   * @param code - Exit code the stand-in returns
   * @returns The program and the stand-in
   */
  function programWith(code: number): {
    readonly program: Command;
    readonly runReportCheck: ReturnType<typeof vi.fn>;
  } {
    const runReportCheck = vi.fn(async () => code);
    const program = new Command().exitOverride();
    addControlsCommand(program, [
      group => {
        registerReportCheck(group, { runReportCheck });
      },
    ]);
    return { program, runReportCheck };
  }

  it("takes one optional project path and no options", () => {
    const { program } = programWith(0);
    const command = controlsGroup(program)?.commands.find(
      candidate => candidate.name() === REPORT_CHECK
    );

    expect(
      command?.registeredArguments.map(argument => argument.name())
    ).toEqual(["path"]);
    expect(command?.registeredArguments[0]?.required).toBe(false);
    expect(command?.options).toEqual([]);
  });

  it("passes the path to the check and leaves the exit code alone on a pass", async () => {
    const { program, runReportCheck } = programWith(0);

    await program.parseAsync([CONTROLS_COMMAND, REPORT_CHECK, "some/repo"], {
      from: "user",
    });

    expect(runReportCheck).toHaveBeenCalledExactlyOnceWith("some/repo");
    expect(process.exitCode).toBeUndefined();
  });

  it("checks the current directory when no path is given", async () => {
    const { program, runReportCheck } = programWith(0);

    await program.parseAsync([CONTROLS_COMMAND, REPORT_CHECK], {
      from: "user",
    });

    expect(runReportCheck).toHaveBeenCalledExactlyOnceWith(undefined);
  });

  it("exits non-zero when the report is refused", async () => {
    const { program } = programWith(1);

    await program.parseAsync([CONTROLS_COMMAND, REPORT_CHECK], {
      from: "user",
    });

    expect(process.exitCode).toBe(1);
  });
});

/**
 * `lisa controls report-check --absorb`: the option, and which of the two
 * jobs it selects.
 *
 * With the option the command records what people typed on the answer lines
 * and does nothing else; without it the command checks the report and renders
 * it. The two never run in one invocation, so absorbing can come first in a
 * re-run without a check failing it (CodySwannGT/lisa#4980).
 */
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  addControlsCommand,
  CONTROLS_COMMAND,
} from "../../../src/cli/controls-cmd.js";
import { createProgram } from "../../../src/cli/index.js";
import { registerReportCheck } from "../../../src/controls/commands/report-check.js";

const REPORT_CHECK = "report-check";
const ABSORB = "--absorb";

describe("lisa controls report-check --absorb", () => {
  const exitCodeBefore = process.exitCode;

  beforeEach(() => {
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.exitCode = exitCodeBefore;
  });

  /**
   * Build a controls group whose report-check runs stand-ins.
   * @param code - Exit code the absorb stand-in returns
   * @returns The program and the two stand-ins
   */
  function programWith(code: number): {
    readonly program: Command;
    readonly runReportCheck: ReturnType<typeof vi.fn>;
    readonly runReportAbsorb: ReturnType<typeof vi.fn>;
  } {
    const runReportCheck = vi.fn(async () => 0);
    const runReportAbsorb = vi.fn(async () => code);
    const program = new Command().exitOverride();
    addControlsCommand(program, [
      group => {
        registerReportCheck(group, { runReportCheck, runReportAbsorb });
      },
    ]);
    return { program, runReportCheck, runReportAbsorb };
  }

  it("is the one option the shipped command takes, and takes no value", () => {
    const command = createProgram()
      .commands.find(candidate => candidate.name() === CONTROLS_COMMAND)
      ?.commands.find(candidate => candidate.name() === REPORT_CHECK);

    expect(command?.options.map(option => option.long)).toEqual([ABSORB]);
    expect(command?.options[0]?.required).toBe(false);
    expect(command?.options[0]?.optional).toBe(false);
    expect(command?.options[0]?.description).toMatch(/answer/u);
  });

  it("absorbs, and does not check, when the option is given", async () => {
    const { program, runReportCheck, runReportAbsorb } = programWith(0);

    await program.parseAsync(
      [CONTROLS_COMMAND, REPORT_CHECK, ABSORB, "some/repo"],
      { from: "user" }
    );

    expect(runReportAbsorb).toHaveBeenCalledExactlyOnceWith("some/repo");
    expect(runReportCheck).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });

  it("absorbs in the current directory when no path is given", async () => {
    const { program, runReportAbsorb } = programWith(0);

    await program.parseAsync([CONTROLS_COMMAND, REPORT_CHECK, ABSORB], {
      from: "user",
    });

    expect(runReportAbsorb).toHaveBeenCalledExactlyOnceWith(undefined);
  });

  it("checks, and does not absorb, when the option is left out", async () => {
    const { program, runReportCheck, runReportAbsorb } = programWith(0);

    await program.parseAsync([CONTROLS_COMMAND, REPORT_CHECK, "some/repo"], {
      from: "user",
    });

    expect(runReportCheck).toHaveBeenCalledExactlyOnceWith("some/repo");
    expect(runReportAbsorb).not.toHaveBeenCalled();
  });

  it("exits with the code absorbing returned when it refuses", async () => {
    const { program } = programWith(1);

    await program.parseAsync([CONTROLS_COMMAND, REPORT_CHECK, ABSORB], {
      from: "user",
    });

    expect(process.exitCode).toBe(1);
  });
});

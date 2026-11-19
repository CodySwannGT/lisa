/**
 * Wiring of the three `lisa controls` subcommands the configure step runs:
 * `seed`, `propose-threshold` and `declaration-check`.
 *
 * Each is its own module registered on the group. What is checked here is
 * that each is on the shipped list, takes the arguments the configure skill
 * gives it, hands them to its runner, and turns a refusal into a non-zero
 * exit (CodySwannGT/lisa#4984).
 */
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CONTROLS_COMMAND,
  CONTROLS_SUBCOMMANDS,
  addControlsCommand,
  type ControlsSubcommand,
} from "../../../src/cli/controls-cmd.js";
import { createProgram } from "../../../src/cli/index.js";
import {
  DECLARATION_CHECK_COMMAND,
  registerDeclarationCheck,
} from "../../../src/controls/commands/declaration-check.js";
import {
  PROPOSE_THRESHOLD_COMMAND,
  registerProposeThreshold,
} from "../../../src/controls/commands/propose-threshold.js";
import {
  SEED_COMMAND,
  registerSeed,
} from "../../../src/controls/commands/seed.js";

const exitCodeBefore = process.exitCode;
const NAME = "--name";
const MEASURED = "--measured";
const DIRECTION = "--direction";

/**
 * Find one subcommand of a program's controls group.
 * @param program - The program
 * @param name - The subcommand's name
 * @returns The subcommand, or undefined when it is not registered
 */
function subcommand(program: Command, name: string): Command | undefined {
  return program.commands
    .find(command => command.name() === CONTROLS_COMMAND)
    ?.commands.find(command => command.name() === name);
}

/**
 * Build a program holding one subcommand of the controls group.
 * @param register - Registers the subcommand with its stand-in runner
 * @returns The program
 */
function programWith(register: ControlsSubcommand): Command {
  const program = new Command().exitOverride();
  addControlsCommand(program, [register]);
  return program;
}

/**
 * Run a controls subcommand the way an operator types it.
 * @param program - The program
 * @param argv - The words after `lisa controls`
 */
async function run(program: Command, argv: readonly string[]): Promise<void> {
  await program.parseAsync([CONTROLS_COMMAND, ...argv], { from: "user" });
}

beforeEach(() => {
  process.exitCode = undefined;
});

afterEach(() => {
  process.exitCode = exitCodeBefore;
});

describe("the configure subcommands", () => {
  it.each([
    [SEED_COMMAND, registerSeed],
    [PROPOSE_THRESHOLD_COMMAND, registerProposeThreshold],
    [DECLARATION_CHECK_COMMAND, registerDeclarationCheck],
  ] as const)("ship %s on the controls group", (name, register) => {
    expect(CONTROLS_SUBCOMMANDS).toContain(register);
    expect(subcommand(createProgram(), name)?.name()).toBe(name);
  });
});

describe.each([
  [
    SEED_COMMAND,
    (runner: (targetPath: string | undefined) => Promise<number>) =>
      (group: Command): void => {
        registerSeed(group, { runSeed: runner });
      },
  ],
  [
    DECLARATION_CHECK_COMMAND,
    (runner: (targetPath: string | undefined) => Promise<number>) =>
      (group: Command): void => {
        registerDeclarationCheck(group, { runDeclarationCheck: runner });
      },
  ],
] as const)("lisa controls %s", (name, registerWith) => {
  it("takes one optional project path and no options", () => {
    const command = subcommand(programWith(registerWith(async () => 0)), name);

    expect(
      command?.registeredArguments.map(argument => argument.name())
    ).toEqual(["path"]);
    expect(command?.registeredArguments[0]?.required).toBe(false);
    expect(command?.options).toEqual([]);
  });

  it("passes the path on and leaves the exit code alone on a pass", async () => {
    const runner = vi.fn(async () => 0);

    await run(programWith(registerWith(runner)), [name, "some/repo"]);

    expect(runner).toHaveBeenCalledExactlyOnceWith("some/repo");
    expect(process.exitCode).toBeUndefined();
  });

  it("uses the current directory when no path is given", async () => {
    const runner = vi.fn(async () => 0);

    await run(programWith(registerWith(runner)), [name]);

    expect(runner).toHaveBeenCalledExactlyOnceWith(undefined);
  });

  it("exits non-zero on a refusal", async () => {
    await run(programWith(registerWith(async () => 1)), [name]);

    expect(process.exitCode).toBe(1);
  });
});

describe(`lisa controls ${PROPOSE_THRESHOLD_COMMAND}`, () => {
  /**
   * Build a program whose propose-threshold runs a stand-in.
   * @param code - Exit code the stand-in returns
   * @returns The program and the stand-in
   */
  function proposing(code: number): {
    readonly program: Command;
    readonly runProposeThreshold: ReturnType<typeof vi.fn>;
  } {
    const runProposeThreshold = vi.fn(() => code);
    return {
      program: programWith(group => {
        registerProposeThreshold(group, { runProposeThreshold });
      }),
      runProposeThreshold,
    };
  }

  it("takes a name, a measured value and a direction, and no path: it reads no repository", () => {
    const command = subcommand(proposing(0).program, PROPOSE_THRESHOLD_COMMAND);

    expect(command?.registeredArguments).toEqual([]);
    expect(command?.options.map(option => option.long)).toEqual([
      NAME,
      MEASURED,
      DIRECTION,
    ]);
  });

  it("passes what was typed on, with a floor when no direction is named", async () => {
    const { program, runProposeThreshold } = proposing(0);

    await run(program, [
      PROPOSE_THRESHOLD_COMMAND,
      NAME,
      "minimum-coverage",
      MEASURED,
      "41%",
    ]);

    expect(runProposeThreshold).toHaveBeenCalledExactlyOnceWith({
      name: "minimum-coverage",
      measured: "41%",
      direction: "floor",
    });
    expect(process.exitCode).toBeUndefined();
  });

  it("passes a ceiling on when one is named", async () => {
    const { program, runProposeThreshold } = proposing(0);

    await run(program, [
      PROPOSE_THRESHOLD_COMMAND,
      NAME,
      "max-warnings",
      MEASURED,
      "12",
      DIRECTION,
      "ceiling",
    ]);

    expect(runProposeThreshold).toHaveBeenCalledExactlyOnceWith({
      name: "max-warnings",
      measured: "12",
      direction: "ceiling",
    });
  });

  it("exits non-zero when nothing could be proposed", async () => {
    await run(proposing(1).program, [PROPOSE_THRESHOLD_COMMAND]);

    expect(process.exitCode).toBe(1);
  });
});

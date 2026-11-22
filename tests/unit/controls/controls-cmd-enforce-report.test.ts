/**
 * Wiring of `lisa controls enforce-report` into the `lisa controls` group.
 *
 * The command is handed three result files by name, so the options that name
 * them, and what the help says each outcome means, are part of the contract
 * (CodySwannGT/lisa#4994).
 */
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CONTROLS_COMMAND,
  CONTROLS_SUBCOMMANDS,
} from "../../../src/cli/controls-cmd.js";
import { createProgram } from "../../../src/cli/index.js";
import {
  ENFORCE_REPORT_COMMAND,
  ENFORCE_REPORT_HELP_AFTER,
  registerEnforceReport,
} from "../../../src/controls/commands/enforce-report.js";
import type { EnforceInputPaths } from "../../../src/controls/enforce-inputs.js";
import { ENFORCE_OUTCOMES } from "../../../src/controls/enforce-types.js";

/**
 * Find `enforce-report` on the shipped program.
 * @returns The command, or undefined when it is not registered
 */
function shipped(): Command | undefined {
  return createProgram()
    .commands.find(command => command.name() === CONTROLS_COMMAND)
    ?.commands.find(command => command.name() === ENFORCE_REPORT_COMMAND);
}

/**
 * Parse an argument list against a group holding only `enforce-report`.
 * @param argv - The arguments after `lisa controls`
 * @param exitCode - What the stand-in command exits with
 * @returns The calls the stand-in received
 */
async function parse(
  argv: readonly string[],
  exitCode = 0
): Promise<readonly [string | undefined, EnforceInputPaths][]> {
  const calls: [string | undefined, EnforceInputPaths][] = [];
  const group = new Command(CONTROLS_COMMAND);
  registerEnforceReport(group, {
    runEnforceReport: (targetPath, paths) => {
      calls.push([targetPath, paths]);
      return Promise.resolve(exitCode);
    },
  });
  await group.parseAsync([...argv], { from: "user" });
  return calls;
}

describe("lisa controls enforce-report wiring", () => {
  const previousExitCode = process.exitCode;

  beforeEach(() => {
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.exitCode = previousExitCode;
  });

  it("is registered on the shipped program, once", () => {
    expect(shipped()).toBeDefined();
    expect(
      CONTROLS_SUBCOMMANDS.filter(
        register => register === registerEnforceReport
      )
    ).toHaveLength(1);
  });

  it("takes the three result files by name, and the repository as its argument", async () => {
    const calls = await parse([
      ENFORCE_REPORT_COMMAND,
      "some/repository",
      "--carriers",
      "/results/carriers.json",
      "--tickets",
      "/results/tickets.json",
      "--protect",
      "/results/protect.json",
    ]);

    expect(calls).toEqual([
      [
        "some/repository",
        {
          carriers: "/results/carriers.json",
          tickets: "/results/tickets.json",
          protect: "/results/protect.json",
        },
      ],
    ]);
  });

  it("passes a result that was not named on as missing, for the command to refuse", async () => {
    const [[targetPath, paths] = []] = await parse([ENFORCE_REPORT_COMMAND]);

    expect(targetPath).toBeUndefined();
    expect(paths).toEqual({
      carriers: undefined,
      tickets: undefined,
      protect: undefined,
    });
  });

  it("sets the process exit code to the command's", async () => {
    await parse([ENFORCE_REPORT_COMMAND], 1);

    expect(process.exitCode).toBe(1);
  });

  it("leaves the process exit code alone when the command succeeds", async () => {
    await parse([ENFORCE_REPORT_COMMAND]);

    expect(process.exitCode).toBeUndefined();
  });

  it("says in its help what each outcome means and that it writes nothing", () => {
    expect(
      ENFORCE_OUTCOMES.filter(
        outcome => !ENFORCE_REPORT_HELP_AFTER.includes(outcome)
      )
    ).toEqual([]);
    expect(ENFORCE_REPORT_HELP_AFTER).toContain(
      "writes nothing in the repository"
    );
    expect(shipped()?.description()).toContain("writes nothing");
  });
});

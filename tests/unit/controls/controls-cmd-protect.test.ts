/**
 * Wiring of `lisa controls protect` into the `lisa controls` group.
 *
 * The command changes merge protection only when it is told to, so the flag
 * that allows it, and what the help says about it, are part of the contract
 * (CodySwannGT/lisa#4993).
 */
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CONTROLS_COMMAND,
  CONTROLS_SUBCOMMANDS,
} from "../../../src/cli/controls-cmd.js";
import { createProgram } from "../../../src/cli/index.js";
import {
  PROTECT_COMMAND,
  PROTECT_HELP_AFTER,
  registerProtect,
} from "../../../src/controls/commands/protect.js";
import type { ProtectOptions } from "../../../src/controls/protect.js";

/**
 * Find `protect` on the shipped program.
 * @returns The command, or undefined when it is not registered
 */
function shippedProtect(): Command | undefined {
  return createProgram()
    .commands.find(command => command.name() === CONTROLS_COMMAND)
    ?.commands.find(command => command.name() === PROTECT_COMMAND);
}

/**
 * Parse an argument list against a group holding only `protect`.
 * @param argv - The arguments after `lisa controls`
 * @param exitCode - What the stand-in command exits with
 * @returns The calls the stand-in received
 */
async function parse(
  argv: readonly string[],
  exitCode = 0
): Promise<readonly [string | undefined, ProtectOptions][]> {
  const calls: [string | undefined, ProtectOptions][] = [];
  const group = new Command(CONTROLS_COMMAND);
  registerProtect(group, {
    runProtect: (targetPath, options) => {
      calls.push([targetPath, options]);
      return Promise.resolve(exitCode);
    },
  });
  await group.parseAsync([...argv], { from: "user" });
  return calls;
}

describe("lisa controls protect wiring", () => {
  const previousExitCode = process.exitCode;

  beforeEach(() => {
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.exitCode = previousExitCode;
    vi.restoreAllMocks();
  });

  it("is on the shipped list and on the shipped program", () => {
    expect(CONTROLS_SUBCOMMANDS).toContain(registerProtect);
    expect(shippedProtect()).toBeDefined();
  });

  it("takes one optional path and exactly the three options", () => {
    const command = shippedProtect();

    expect(
      command?.registeredArguments.map(argument => argument.name())
    ).toEqual(["path"]);
    expect(command?.registeredArguments[0]?.required).toBe(false);
    expect(command?.options.map(option => option.long)).toEqual([
      "--apply",
      "--branch",
      "--ruleset",
    ]);
  });

  it("does not allow a change unless --apply is given", async () => {
    expect(await parse([PROTECT_COMMAND])).toEqual([
      [undefined, { apply: false, branch: undefined, ruleset: undefined }],
    ]);
    expect(await parse([PROTECT_COMMAND, "some/repo", "--apply"])).toEqual([
      ["some/repo", { apply: true, branch: undefined, ruleset: undefined }],
    ]);
  });

  it("passes the branch and the ruleset through", async () => {
    expect(
      await parse([
        PROTECT_COMMAND,
        "--branch",
        "release",
        "--ruleset",
        "quality checks",
      ])
    ).toEqual([
      [
        undefined,
        { apply: false, branch: "release", ruleset: "quality checks" },
      ],
    ]);
  });

  it("sets the process exit code to the command's, and leaves 0 alone", async () => {
    await parse([PROTECT_COMMAND]);
    expect(process.exitCode).toBeUndefined();

    await parse([PROTECT_COMMAND], 2);
    expect(process.exitCode).toBe(2);
  });

  it("says in its help that it only reads unless --apply is given", () => {
    const command = shippedProtect();

    expect(command?.description()).toMatch(
      /reads only unless --apply is given/u
    );
    expect(
      command?.options.find(option => option.long === "--apply")?.description
    ).toMatch(/without this flag nothing is ever changed/u);
    expect(PROTECT_HELP_AFTER).toContain("Reads only, unless --apply is given");
    expect(PROTECT_HELP_AFTER).toMatch(
      /any other hosting platform: nothing is sent/u
    );
    expect(PROTECT_HELP_AFTER).toMatch(/\n {2}0 .*\n {2}2 .*\n {2}1 /u);
  });
});

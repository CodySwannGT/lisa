/**
 * Wiring of `lisa controls merge-protection` into the `lisa controls` group.
 *
 * The audit runs this command in a repository it may change nothing in, so
 * that it has no option at all, and what its help says about only reading,
 * are part of the contract (CodySwannGT/lisa#4981).
 */
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CONTROLS_COMMAND,
  CONTROLS_SUBCOMMANDS,
} from "../../../src/cli/controls-cmd.js";
import { createProgram } from "../../../src/cli/index.js";
import {
  MERGE_PROTECTION_COMMAND,
  MERGE_PROTECTION_HELP_AFTER,
  registerMergeProtection,
} from "../../../src/controls/commands/merge-protection.js";

/**
 * Find `merge-protection` on the shipped program.
 * @returns The command, or undefined when it is not registered
 */
function shipped(): Command | undefined {
  return createProgram()
    .commands.find(command => command.name() === CONTROLS_COMMAND)
    ?.commands.find(command => command.name() === MERGE_PROTECTION_COMMAND);
}

/**
 * Parse an argument list against a group holding only `merge-protection`.
 * @param argv - The arguments after `lisa controls`
 * @param exitCode - What the stand-in command exits with
 * @returns The path each call of the stand-in received
 */
async function parse(
  argv: readonly string[],
  exitCode = 0
): Promise<readonly (string | undefined)[]> {
  const calls: (string | undefined)[] = [];
  const group = new Command(CONTROLS_COMMAND);
  registerMergeProtection(group, {
    runMergeProtection: targetPath => {
      calls.push(targetPath);
      return Promise.resolve(exitCode);
    },
  });
  await group.parseAsync([...argv], { from: "user" });
  return calls;
}

describe("lisa controls merge-protection wiring", () => {
  const previousExitCode = process.exitCode;

  beforeEach(() => {
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.exitCode = previousExitCode;
  });

  it("is on the shipped list and on the shipped program", () => {
    expect(CONTROLS_SUBCOMMANDS).toContain(registerMergeProtection);
    expect(shipped()).toBeDefined();
  });

  it("takes one optional path and no option, so nothing can make it write", () => {
    const command = shipped();

    expect(
      command?.registeredArguments.map(argument => argument.name())
    ).toEqual(["path"]);
    expect(command?.registeredArguments[0]?.required).toBe(false);
    expect(command?.options).toEqual([]);
  });

  it("passes the path through", async () => {
    expect(await parse([MERGE_PROTECTION_COMMAND])).toEqual([undefined]);
    expect(await parse([MERGE_PROTECTION_COMMAND, "some/repo"])).toEqual([
      "some/repo",
    ]);
  });

  it("sets the process exit code to the command's, and leaves 0 alone", async () => {
    await parse([MERGE_PROTECTION_COMMAND]);
    expect(process.exitCode).toBeUndefined();

    await parse([MERGE_PROTECTION_COMMAND], 1);
    expect(process.exitCode).toBe(1);
  });

  it("says in its help that it only reads and writes nothing", () => {
    expect(shipped()?.description()).toMatch(/reads only and writes nothing/u);
    expect(MERGE_PROTECTION_HELP_AFTER).toContain("Reads only.");
    expect(MERGE_PROTECTION_HELP_AFTER).toMatch(/writes no file/u);
    expect(MERGE_PROTECTION_HELP_AFTER).toMatch(
      /other than github\.com it\s+sends nothing at all/u
    );
    expect(MERGE_PROTECTION_HELP_AFTER).toMatch(/\n {2}0 .*\n {2}1 /u);
  });
});

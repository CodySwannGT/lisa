/**
 * Wiring of `lisa controls install-carriers` into the `lisa controls` group.
 *
 * The command changes how git behaves in a repository, so the one flag that
 * keeps it from writing, the exit codes a caller branches on, and what the
 * help promises about existing hooks are part of the contract
 * (CodySwannGT/lisa#4989).
 */
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CONTROLS_COMMAND,
  CONTROLS_SUBCOMMANDS,
} from "../../../src/cli/controls-cmd.js";
import { createProgram } from "../../../src/cli/index.js";
import type { CarrierResult } from "../../../src/controls/carrier-types.js";
import type { CarrierRun } from "../../../src/controls/carriers.js";
import {
  CARRIERS_BLOCKED_EXIT_CODE,
  CHECK_WOULD_CHANGE_EXIT_CODE,
  INSTALL_CARRIERS_COMMAND,
  INSTALL_CARRIERS_HELP_AFTER,
  type InstallCarriersOptions,
  registerInstallCarriers,
  runInstallCarriers,
} from "../../../src/controls/commands/install-carriers.js";

/** A result in which nothing is blocked and nothing was written. */
const WIRED: CarrierResult = {
  changes: [],
  each_checkout: {
    check: "lisa controls install-carriers --check",
    command: "lisa controls install-carriers",
    why: "Git does not copy hook settings into a new clone.",
  },
  enforcement_points: [],
  hook_owner: "lisa",
  mode: "install",
  outcome: "already-wired",
  reason: "Nothing changed.",
  record: ".lisa/controls/carriers.json",
  runner: {
    files: [],
    outcome: "already-wired",
    path: "scripts/lisa-run-gates.mjs",
    reason: null,
  },
  schema_version: 1,
};

/**
 * Find `install-carriers` on the shipped program.
 * @returns The command, or undefined when it is not registered
 */
function shipped(): Command | undefined {
  return createProgram()
    .commands.find(command => command.name() === CONTROLS_COMMAND)
    ?.commands.find(command => command.name() === INSTALL_CARRIERS_COMMAND);
}

/**
 * Parse an argument list against a group holding only `install-carriers`.
 * @param argv - The arguments after `lisa controls`
 * @param exitCode - What the stand-in command exits with
 * @returns The calls the stand-in received
 */
async function parse(
  argv: readonly string[],
  exitCode = 0
): Promise<readonly [string | undefined, InstallCarriersOptions][]> {
  const calls: [string | undefined, InstallCarriersOptions][] = [];
  const group = new Command(CONTROLS_COMMAND);
  registerInstallCarriers(group, {
    runInstallCarriers: (targetPath, options) => {
      calls.push([targetPath, options]);
      return Promise.resolve(exitCode);
    },
  });
  await group.parseAsync([...argv], { from: "user" });
  return calls;
}

/**
 * Run the command over a stand-in for the installer.
 * @param run - What the installer answers
 * @returns The exit code, what went to stdout and what went to stderr
 */
async function ran(
  run: CarrierRun
): Promise<{ code: number; stdout: string[]; stderr: string[] }> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await runInstallCarriers(
    ".",
    {},
    {
      install: () => Promise.resolve(run),
      stderr: line => stderr.push(line),
      stdout: text => stdout.push(text),
    }
  );
  return { code, stderr, stdout };
}

describe("lisa controls install-carriers wiring", () => {
  const previousExitCode = process.exitCode;

  beforeEach(() => {
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.exitCode = previousExitCode;
  });

  it("is on the shipped list and on the shipped program", () => {
    expect(CONTROLS_SUBCOMMANDS).toContain(registerInstallCarriers);
    expect(shipped()).toBeDefined();
  });

  it("takes one optional path and exactly one option", () => {
    const command = shipped();

    expect(
      command?.registeredArguments.map(argument => argument.name())
    ).toEqual(["path"]);
    expect(command?.registeredArguments[0]?.required).toBe(false);
    expect(command?.options.map(option => option.long)).toEqual(["--check"]);
  });

  it("writes unless --check is given", async () => {
    expect(await parse([INSTALL_CARRIERS_COMMAND])).toEqual([
      [undefined, { check: false }],
    ]);
    expect(
      await parse([INSTALL_CARRIERS_COMMAND, "some/repo", "--check"])
    ).toEqual([["some/repo", { check: true }]]);
  });

  it("sets the process exit code to the command's, and leaves 0 alone", async () => {
    await parse([INSTALL_CARRIERS_COMMAND]);
    expect(process.exitCode).toBeUndefined();

    await parse([INSTALL_CARRIERS_COMMAND], CARRIERS_BLOCKED_EXIT_CODE);
    expect(process.exitCode).toBe(CARRIERS_BLOCKED_EXIT_CODE);
  });

  it("prints the result as JSON on stdout and exits 0 when wired", async () => {
    const { code, stderr, stdout } = await ran({
      problems: null,
      result: WIRED,
    });

    expect(code).toBe(0);
    expect(JSON.parse(stdout.join("\n"))).toEqual(WIRED);
    expect(stderr).toEqual(["install-carriers: PASS. Nothing changed."]);
  });

  it("exits 2 with the whole result when a point is blocked", async () => {
    const blocked: CarrierResult = { ...WIRED, outcome: "blocked" };

    const { code, stdout } = await ran({ problems: null, result: blocked });

    expect(code).toBe(CARRIERS_BLOCKED_EXIT_CODE);
    expect(JSON.parse(stdout.join("\n"))).toEqual(blocked);
  });

  it("exits 3 when a check finds something a run would write", async () => {
    const pending: CarrierResult = {
      ...WIRED,
      changes: [{ action: "set", path: "core.hooksPath" }],
      mode: "check",
      outcome: "installed",
    };

    expect((await ran({ problems: null, result: pending })).code).toBe(
      CHECK_WOULD_CHANGE_EXIT_CODE
    );
    expect(
      (await ran({ problems: null, result: { ...pending, mode: "install" } }))
        .code
    ).toBe(0);
  });

  it("exits 1 and prints nothing on stdout when there is no result", async () => {
    const { code, stderr, stdout } = await ran({
      problems: ["not the top folder\nof a git repository"],
    });

    expect(code).toBe(1);
    expect(stdout).toEqual([]);
    expect(stderr).toEqual([
      "not the top folder of a git repository",
      "install-carriers: FAIL. No result could be produced, and nothing was written",
    ]);
  });

  it("says in its help what it keeps and what each exit code means", () => {
    expect(shipped()?.description()).toMatch(
      /without replacing any hook that is already there/u
    );
    expect(INSTALL_CARRIERS_HELP_AFTER).toMatch(
      /What was there\s+runs first, and still fails the hook when it fails/u
    );
    expect(INSTALL_CARRIERS_HELP_AFTER).toContain(
      "replaces a file it did not write"
    );
    expect(INSTALL_CARRIERS_HELP_AFTER).toMatch(
      /\n {2}0 .*\n {2}2 .*\n {2}3 .*\n {2}1 /u
    );
  });
});

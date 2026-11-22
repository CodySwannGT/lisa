/**
 * Wiring of `lisa controls proof-check` into the `lisa controls` group.
 *
 * The configure step runs this command and branches on how it ends, so its
 * one option, its exit codes, and what its help promises it never does are
 * part of the contract (CodySwannGT/lisa#5011).
 */
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CONTROLS_COMMAND,
  CONTROLS_SUBCOMMANDS,
} from "../../../src/cli/controls-cmd.js";
import { createProgram } from "../../../src/cli/index.js";
import {
  PROOF_CHECK_COMMAND,
  PROOF_CHECK_EXIT,
  PROOF_CHECK_HELP_AFTER,
  type ProofCheckOptions,
  registerProofCheck,
  runProofCheck,
} from "../../../src/controls/commands/proof-check.js";
import { registerRegister } from "../../../src/controls/commands/register.js";

/**
 * Find `proof-check` on the shipped program.
 * @returns The command, or undefined when it is not registered
 */
function shipped(): Command | undefined {
  return createProgram()
    .commands.find(command => command.name() === CONTROLS_COMMAND)
    ?.commands.find(command => command.name() === PROOF_CHECK_COMMAND);
}

/**
 * Parse an argument list against a group holding only `proof-check`.
 * @param argv - The arguments after `lisa controls`
 * @param exitCode - What the stand-in command exits with
 * @returns The calls the stand-in received
 */
async function parse(
  argv: readonly string[],
  exitCode = 0
): Promise<readonly [string | undefined, ProofCheckOptions][]> {
  const calls: [string | undefined, ProofCheckOptions][] = [];
  const group = new Command(CONTROLS_COMMAND);
  registerProofCheck(group, {
    runProofCheck: (targetPath, options) => {
      calls.push([targetPath, options]);
      return Promise.resolve(exitCode);
    },
  });
  await group.parseAsync([...argv], { from: "user" });
  return calls;
}

describe("lisa controls proof-check wiring", () => {
  const previousExitCode = process.exitCode;

  beforeEach(() => {
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.exitCode = previousExitCode;
  });

  it("is on the shipped list, before the command that writes the register, and on the shipped program", () => {
    expect(CONTROLS_SUBCOMMANDS).toContain(registerProofCheck);
    expect(CONTROLS_SUBCOMMANDS.indexOf(registerProofCheck)).toBeLessThan(
      CONTROLS_SUBCOMMANDS.indexOf(registerRegister)
    );
    expect(shipped()).toBeDefined();
  });

  it("takes one optional path and exactly one option", () => {
    const command = shipped();

    expect(
      command?.registeredArguments.map(argument => argument.name())
    ).toEqual(["path"]);
    expect(command?.registeredArguments[0]?.required).toBe(false);
    expect(command?.options.map(option => option.long)).toEqual([
      "--acknowledge-external-effects",
    ]);
  });

  it("runs a proof that reaches outside the repository only when told to", async () => {
    expect(await parse([PROOF_CHECK_COMMAND])).toEqual([
      [undefined, { acknowledgeExternalEffects: false }],
    ]);
    expect(
      await parse([
        PROOF_CHECK_COMMAND,
        "some/repo",
        "--acknowledge-external-effects",
      ])
    ).toEqual([["some/repo", { acknowledgeExternalEffects: true }]]);
  });

  it.each([PROOF_CHECK_EXIT.NOT_READY, PROOF_CHECK_EXIT.NOT_CHECKED])(
    "sets the process exit code to %i when the command returns it, and leaves 0 alone",
    async code => {
      await parse([PROOF_CHECK_COMMAND]);
      expect(process.exitCode).toBeUndefined();

      await parse([PROOF_CHECK_COMMAND], code);
      expect(process.exitCode).toBe(code);
    }
  );

  it("uses 0, 1 and 2 for ready, not ready and not checked", () => {
    expect(PROOF_CHECK_EXIT).toEqual({
      READY: 0,
      NOT_READY: 1,
      NOT_CHECKED: 2,
    });
  });

  it("exits 2 with nothing on stdout when the run itself breaks", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];

    const code = await runProofCheck(
      ".",
      {},
      {
        generate: () => Promise.reject(new Error("the registry\nis missing")),
        stderr: line => stderr.push(line),
        stdout: text => stdout.push(text),
      }
    );

    expect(code).toBe(PROOF_CHECK_EXIT.NOT_CHECKED);
    expect(stdout).toEqual([]);
    expect(stderr).toEqual([
      "the registry is missing",
      "proof-check: FAIL. The run did not finish, so there is no result",
    ]);
  });

  it("says in its help what it asks, what it never does and what each exit code means", () => {
    expect(shipped()?.description()).toMatch(/Changes nothing$/u);
    expect(PROOF_CHECK_HELP_AFTER).toMatch(
      /It never\s+writes, stages or commits anything in the repository/u
    );
    expect(PROOF_CHECK_HELP_AFTER).toMatch(
      /\n {2}1 .*\n {2}2 .*\n {2}3 .*\n {2}4 .*\n {2}5 /su
    );
    expect(PROOF_CHECK_HELP_AFTER).toMatch(/\n {2}0 .*\n {2}1 .*\n {2}2 .*$/u);
  });
});

/**
 * Wiring of `lisa controls reconcile` into the `lisa controls` group.
 *
 * The attest step runs this command and branches on how it ends, so the one
 * flag that lets it leave the machine, the exit codes, and what the help
 * promises it never does are part of the contract (CodySwannGT/lisa#5000).
 */
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CONTROLS_COMMAND,
  CONTROLS_SUBCOMMANDS,
} from "../../../src/cli/controls-cmd.js";
import { createProgram } from "../../../src/cli/index.js";
import {
  RECONCILE_COMMAND,
  RECONCILE_HELP_AFTER,
  RECONCILE_INCOMPLETE_EXIT_CODE,
  type ReconcileOptions,
  registerReconcile,
  runReconcile,
} from "../../../src/controls/commands/reconcile.js";
import type { ReconcileRun } from "../../../src/controls/reconcile.js";
import {
  RECONCILE_LIMITS,
  type ReconcileFinding,
  type ReconcileResult,
} from "../../../src/controls/reconcile-types.js";

const IN_STEP_REASON = "The register and what is installed are in step.";

/** A result in which nothing differs and everything was read. */
const IN_STEP: ReconcileResult = {
  audit_findings: [],
  enforcement_points: [],
  findings: [],
  hook_commands: [],
  hook_owner: "lisa",
  limits: RECONCILE_LIMITS,
  outcome: "in-step",
  reason: IN_STEP_REASON,
  register: {
    committed: "current",
    entries: 0,
    path: ".lisa/controls/register.json",
  },
  schema_version: 1,
  surfaces: [{ detail: null, state: "read", surface: "register" }],
};

/** A command a hook runs that no entry declares. */
const UNDECLARED: ReconcileFinding = {
  command: "npm audit",
  hook: "pre-commit",
  kind: "undeclared-command",
  line: 3,
  message: 'The commit hook also runs "npm audit".',
  moment: "commit",
  next: "Declare it or leave it.",
  path: ".husky/pre-commit",
};

/**
 * Find `reconcile` on the shipped program.
 * @returns The command, or undefined when it is not registered
 */
function shipped(): Command | undefined {
  return createProgram()
    .commands.find(command => command.name() === CONTROLS_COMMAND)
    ?.commands.find(command => command.name() === RECONCILE_COMMAND);
}

/**
 * Parse an argument list against a group holding only `reconcile`.
 * @param argv - The arguments after `lisa controls`
 * @param exitCode - What the stand-in command exits with
 * @returns The calls the stand-in received
 */
async function parse(
  argv: readonly string[],
  exitCode = 0
): Promise<readonly [string | undefined, ReconcileOptions][]> {
  const calls: [string | undefined, ReconcileOptions][] = [];
  const group = new Command(CONTROLS_COMMAND);
  registerReconcile(group, {
    runReconcile: (targetPath, options) => {
      calls.push([targetPath, options]);
      return Promise.resolve(exitCode);
    },
  });
  await group.parseAsync([...argv], { from: "user" });
  return calls;
}

/**
 * Run the command over a stand-in for the comparison.
 * @param run - What the comparison answers
 * @returns The exit code, what went to stdout and what went to stderr
 */
async function ran(
  run: ReconcileRun
): Promise<{ code: number; stdout: string[]; stderr: string[] }> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await runReconcile(
    ".",
    {},
    {
      reconcile: () => Promise.resolve(run),
      stderr: line => stderr.push(line),
      stdout: text => stdout.push(text),
    }
  );
  return { code, stderr, stdout };
}

describe("lisa controls reconcile wiring", () => {
  const previousExitCode = process.exitCode;

  beforeEach(() => {
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.exitCode = previousExitCode;
  });

  it("is on the shipped list and on the shipped program", () => {
    expect(CONTROLS_SUBCOMMANDS).toContain(registerReconcile);
    expect(shipped()).toBeDefined();
  });

  it("takes one optional path and exactly one option", () => {
    const command = shipped();

    expect(
      command?.registeredArguments.map(argument => argument.name())
    ).toEqual(["path"]);
    expect(command?.registeredArguments[0]?.required).toBe(false);
    expect(command?.options.map(option => option.long)).toEqual(["--platform"]);
  });

  it("reads the hosting platform only when --platform is given", async () => {
    expect(await parse([RECONCILE_COMMAND])).toEqual([
      [undefined, { platform: false }],
    ]);
    expect(await parse([RECONCILE_COMMAND, "some/repo", "--platform"])).toEqual(
      [["some/repo", { platform: true }]]
    );
  });

  it("sets the process exit code to the command's, and leaves 0 alone", async () => {
    await parse([RECONCILE_COMMAND]);
    expect(process.exitCode).toBeUndefined();

    await parse([RECONCILE_COMMAND], RECONCILE_INCOMPLETE_EXIT_CODE);
    expect(process.exitCode).toBe(RECONCILE_INCOMPLETE_EXIT_CODE);
  });

  it("prints the result as JSON on stdout and exits 0 when nothing differs", async () => {
    const { code, stderr, stdout } = await ran({
      problems: null,
      result: IN_STEP,
    });

    expect(code).toBe(0);
    expect(JSON.parse(stdout.join("\n"))).toEqual(IN_STEP);
    expect(stderr).toEqual([`reconcile: PASS. ${IN_STEP_REASON}`]);
  });

  it("exits 0 with findings listed, one line each", async () => {
    const differing: ReconcileResult = {
      ...IN_STEP,
      findings: [UNDECLARED],
      outcome: "findings",
      reason: "They differ.",
    };

    const { code, stderr, stdout } = await ran({
      problems: null,
      result: differing,
    });

    expect(code).toBe(0);
    expect(JSON.parse(stdout.join("\n"))).toEqual(differing);
    expect(stderr).toEqual([
      "reconcile: FINDINGS. They differ.",
      'reconcile: The commit hook also runs "npm audit". Declare it or leave it.',
    ]);
  });

  it("exits 2 with the whole result, naming what could not be read", async () => {
    const incomplete: ReconcileResult = {
      ...IN_STEP,
      outcome: "incomplete",
      reason: "This comparison is not complete.",
      surfaces: [
        {
          detail: ".husky/pre-commit is not an ordinary file.",
          state: "could-not-read",
          surface: "hooks",
        },
      ],
    };

    const { code, stderr, stdout } = await ran({
      problems: null,
      result: incomplete,
    });

    expect(code).toBe(RECONCILE_INCOMPLETE_EXIT_CODE);
    expect(JSON.parse(stdout.join("\n"))).toEqual(incomplete);
    expect(stderr).toEqual([
      "reconcile: INCOMPLETE. This comparison is not complete.",
      "reconcile: .husky/pre-commit is not an ordinary file.",
    ]);
  });

  it("exits 1 and prints nothing on stdout when there is no result", async () => {
    const { code, stderr, stdout } = await ran({
      problems: ["The control register\ncould not be read."],
    });

    expect(code).toBe(1);
    expect(stdout).toEqual([]);
    expect(stderr).toEqual([
      "The control register could not be read.",
      "reconcile: FAIL. No result could be produced, and nothing was changed",
    ]);
  });

  it("says in its help what it never does and what each exit code means", () => {
    expect(shipped()?.description()).toMatch(/Changes nothing$/u);
    expect(RECONCILE_HELP_AFTER).toMatch(
      /It never\s+writes a file, changes a setting, or runs anything it finds/u
    );
    expect(RECONCILE_HELP_AFTER).toMatch(
      /Without --platform it sends no request anywhere/u
    );
    expect(RECONCILE_HELP_AFTER).toMatch(/\n {2}0 .*\n {2}2 .*\n {2}1 /u);
  });
});

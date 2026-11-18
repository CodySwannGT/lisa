/**
 * `lisa controls install-carriers [path] [--check] [--agents[=<names>]]`:
 * make git run the gate runner at commit and at push, in any repository,
 * without taking hooks away from whatever already runs them; and, with
 * `--agents`, make each coding agent run it after the agent writes a file.
 *
 * ## What it writes
 *
 * In a repository Lisa was never applied to: the gate runner under
 * `scripts/`, one short hook script per moment under `.lisa/hooks/`, a
 * record of those files at `.lisa/controls/carriers.json`, one ignore entry
 * for the runner's push timings, and the call that makes git start the hook
 * script. Where the call goes depends on who owns hooks: a few marked lines
 * at the end of an existing hook file, an entry in a hook manager's
 * configuration, or, when nothing owns hooks, the `core.hooksPath` setting
 * of this checkout.
 *
 * It never replaces a file it did not write, and where a project type's own
 * hooks already call the runner it writes nothing.
 *
 * ## With `--agents`
 *
 * On its own the flag reads the agents from the `harness` setting of
 * `.lisa.config.json`; `--agents=claude,codex` names them, which is the only
 * form that works where that setting is missing. For each agent that has a
 * hook after a file write, one entry is added to the hook settings the agent
 * reads from the repository, merged into a file the repository already has
 * and never written over it. For an agent with no such hook nothing is
 * installed: `unenforceable_on` is added to the `post-tool` entry of each
 * gate in `.lisa.config.json`, so the control register names the agent.
 *
 * ## What it prints
 *
 * One JSON document on stdout (`../carrier-types.ts`), with one entry per
 * enforcement point and its outcome. Lines for a person go to stderr.
 *
 * ## Exit codes
 *
 * - 0: the declared checks run at every point that can run them, and under
 *   `--check` nothing would be written. A coding agent that has no hook is
 *   reported `unenforceable`, which is not a failure.
 * - 2: at least one point is `blocked`. The JSON document is complete.
 * - 3: only under `--check`: nothing is blocked, and a run would write
 *   something. The JSON document lists what.
 * - 1: no result could be produced; nothing is printed on stdout. The last
 *   line on stderr says whether anything was written before the run
 *   stopped, and lists it when something was.
 * @module controls/commands/install-carriers
 */
import path from "node:path";

import type { Command } from "commander";

import { resolveRepositoryRoot } from "../audit-report-file.js";
import { createCarrierGit } from "../carrier-git.js";
import { agentSelectionOf } from "../carrier-roster.js";
import {
  CARRIER_HOOKS_FOLDER,
  CARRIER_RECORD_PATH,
  CARRIER_RUNNER_FOLDER,
  INSTALL_CARRIERS_INVOCATION,
  type CarrierPoint,
  type CarrierResult,
} from "../carrier-types.js";
import { CODING_AGENTS, EVERY_AGENT } from "../coding-agents.js";
import {
  installCarriers,
  type CarrierRun,
  type InstallCarriersOptions,
} from "../carriers.js";

export type { InstallCarriersOptions } from "../carriers.js";

/** The subcommand's name under `lisa controls`. */
export const INSTALL_CARRIERS_COMMAND = "install-carriers";

/** The exit code when at least one enforcement point is blocked. */
export const CARRIERS_BLOCKED_EXIT_CODE = 2;

/** The exit code of `--check` when a run would write something. */
export const CHECK_WOULD_CHANGE_EXIT_CODE = 3;

/** What `--help` says after the options. */
export const INSTALL_CARRIERS_HELP_AFTER = `
Makes git run the checks the repository declares (the "gates" block of
.lisa.config.json) before a commit and before a push.

  It writes  the gate runner under ${CARRIER_RUNNER_FOLDER}/, a hook script per moment under
             ${CARRIER_HOOKS_FOLDER}/, a record of those files at ${CARRIER_RECORD_PATH},
             and one ignore entry for the runner's push timings.
  It keeps   every hook the repository already has. The call is added through
             whoever owns hooks: core.hooksPath, Husky, Lefthook, the
             pre-commit framework, or git's own hooks folder. What was there
             runs first, and still fails the hook when it fails.
  It never   replaces a file it did not write.

Git does not copy hook settings into a new clone. In each new checkout, run
"${INSTALL_CARRIERS_INVOCATION}" once; "--check" says whether a checkout is wired.

With --agents, each coding agent also runs the checks declared for the moment
after it writes a file ("post-tool").

  --agents           the agents the "harness" setting of .lisa.config.json names
  --agents=<names>   the agents named, separated by commas: ${CODING_AGENTS.join(", ")},
                     or ${EVERY_AGENT} for all of them. The only form that works
                     where there is no "harness" setting.
  It adds    one hook entry to the settings each agent reads from the repository,
             merged into a file that is already there, never written over it.
  It records an agent that has no hook that can refuse a file write: it adds
             "unenforceable_on" to each gate's "post-tool" entry in
             .lisa.config.json, so the control register names the agent.

Prints one JSON document on stdout. Exit codes:
  0  the declared checks run at commit, at push, and on each agent that has a hook
  2  at least one of those is blocked (the JSON says which and why)
  3  --check only: nothing is blocked, and a run would write something
  1  no result could be produced`;

/** What the command needs from outside, each replaceable in a test. */
export interface InstallCarriersIo {
  /** The directory the path argument is resolved from. */
  readonly cwd?: string;
  /** The environment git runs in; the process's own when left out. */
  readonly env?: NodeJS.ProcessEnv;
  /** Where the JSON document goes. */
  readonly stdout?: (text: string) => void;
  /** Where the lines for a person go, one per call. */
  readonly stderr?: (line: string) => void;
  /** Plans and makes the writes. */
  readonly install?: (
    root: string,
    options: InstallCarriersOptions
  ) => Promise<CarrierRun>;
}

/**
 * The exit code a result calls for.
 * @param result - The result
 * @returns 0, 2 when a point is blocked, 3 when a check found changes
 */
function exitCodeFor(result: CarrierResult): number {
  if (result.outcome === "blocked") return CARRIERS_BLOCKED_EXIT_CODE;
  return result.mode === "check" && result.changes.length > 0
    ? CHECK_WOULD_CHANGE_EXIT_CODE
    : 0;
}

/**
 * Name an enforcement point to a person.
 * @param point - The point
 * @returns The moment, and the coding agent when the point belongs to one
 */
function where(point: CarrierPoint): string {
  return point.agent === undefined
    ? point.moment
    : `${point.moment} on ${point.agent}`;
}

/**
 * The lines a person reads about a result.
 * @param name - How the command is named at the start of a line
 * @param result - The result
 * @returns The lines, the outcome first
 */
function linesFor(name: string, result: CarrierResult): readonly string[] {
  const code = exitCodeFor(result);
  const verdict =
    code === 0
      ? "PASS"
      : code === CARRIERS_BLOCKED_EXIT_CODE
        ? "BLOCKED"
        : "CHANGES";
  const blocked = result.enforcement_points
    .filter(point => point.outcome === "blocked")
    .slice(1)
    .map(point => `${name}: ${where(point)} is blocked. ${point.reason ?? ""}`);
  const unenforceable = result.enforcement_points
    .filter(point => point.outcome === "unenforceable")
    .map(
      point =>
        `${name}: ${where(point)} is unenforceable. ${point.reason ?? ""}`
    );
  const trust = result.enforcement_points.some(
    point => point.agent === "codex" && point.outcome !== "blocked"
  );
  const local = result.enforcement_points.some(
    point => point.outcome !== "blocked" && point.wired_through === "none"
  );
  return [
    `${name}: ${verdict}. ${result.reason}`,
    ...blocked,
    ...unenforceable,
    ...(trust
      ? [
          `${name}: Codex runs a repository's hooks only after each person has approved them once, with /hooks inside Codex.`,
        ]
      : []),
    ...(local
      ? [
          `${name}: core.hooksPath is not committed, and git does not copy it into a new clone. In each new checkout, run "${result.each_checkout.command}" once.`,
        ]
      : []),
  ];
}

/**
 * Install the carriers of one repository, or say what a run would write.
 * @param targetPath - The repository; the working directory when left out
 * @param options - The command's options
 * @param io - Replaceable collaborators
 * @returns The exit code: 0 wired, 2 blocked, 3 a check that found changes,
 *   1 when no result could be produced
 */
export async function runInstallCarriers(
  targetPath: string | undefined,
  options: InstallCarriersOptions = {},
  io: InstallCarriersIo = {}
): Promise<number> {
  const stdout = io.stdout ?? (text => process.stdout.write(`${text}\n`));
  const stderr = io.stderr ?? (line => process.stderr.write(`${line}\n`));
  const name =
    options.check === true
      ? `${INSTALL_CARRIERS_COMMAND} --check`
      : INSTALL_CARRIERS_COMMAND;
  // A run that stopped at a write it could not make has already made the
  // ones before it. They are listed, so the last line is never a claim that
  // nothing was written when something was.
  const fail = (
    problems: readonly string[],
    written: readonly string[] = []
  ): number => {
    problems.forEach(problem => {
      stderr(problem.replaceAll(/\s+/gu, " "));
    });
    stderr(
      written.length === 0
        ? `${name}: FAIL. No result could be produced, and nothing was written`
        : `${name}: FAIL. No result could be produced. Before it stopped, this run wrote: ${written.join(", ")}. Those were left in place; run this again once the cause is fixed.`
    );
    return 1;
  };

  const named = path.resolve(io.cwd ?? process.cwd(), targetPath ?? ".");
  const root = await resolveRepositoryRoot(named);
  if (root === null) {
    return fail([
      `${targetPath ?? named} is not a folder. Give the path of the repository to install carriers in.`,
    ]);
  }
  const install =
    io.install ??
    ((repository, chosen) =>
      installCarriers(repository, chosen, {
        git: createCarrierGit(io.env),
      }));
  try {
    const run = await install(root, options);
    if (run.problems !== null) return fail(run.problems, run.written);
    stdout(JSON.stringify(run.result, null, 2));
    linesFor(name, run.result).forEach(line => {
      stderr(line);
    });
    return exitCodeFor(run.result);
  } catch (error) {
    return fail([error instanceof Error ? error.message : String(error)]);
  }
}

/** The collaborator the registration needs, replaceable in a test. */
export interface InstallCarriersCommandDependencies {
  readonly runInstallCarriers: (
    targetPath: string | undefined,
    options: InstallCarriersOptions
  ) => Promise<number>;
}

/**
 * Register `install-carriers` under the `lisa controls` group.
 * @param group - The `controls` command
 * @param dependencies - Replaceable collaborators
 */
export function registerInstallCarriers(
  group: Command,
  dependencies: InstallCarriersCommandDependencies = {
    runInstallCarriers: (targetPath, options) =>
      runInstallCarriers(targetPath, options),
  }
): void {
  group
    .command(INSTALL_CARRIERS_COMMAND)
    .description(
      "Make git run the gate runner at commit and at push, through whoever owns the repository's hooks, without replacing any hook that is already there; with --agents, also after a coding agent writes a file"
    )
    .argument("[path]", "Project path (default: current directory)")
    .option(
      "--check",
      "Write nothing: report what a run would write, and fail when it would write anything or when an enforcement point is blocked"
    )
    .option(
      "--agents [names]",
      'Also make coding agents run the checks declared for the moment after a file write: on its own, the agents the "harness" setting names; with names separated by commas, those agents'
    )
    .addHelpText("after", INSTALL_CARRIERS_HELP_AFTER)
    .action(
      async (
        targetPath: string | undefined,
        options: {
          readonly check?: boolean;
          readonly agents?: true | string;
        }
      ) => {
        const code = await dependencies.runInstallCarriers(targetPath, {
          check: options.check === true,
          ...(options.agents === undefined
            ? {}
            : { agents: agentSelectionOf(options.agents) }),
        });
        if (code !== 0) process.exitCode = code;
      }
    );
}

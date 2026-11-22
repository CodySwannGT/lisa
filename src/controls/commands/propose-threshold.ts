/**
 * `lisa controls propose-threshold --name <name> --measured <value>
 * [--direction <direction>]`: turn what a repository measures today into the
 * threshold to propose to its operator.
 *
 * The configure step runs the host's own tool to measure a number such as
 * test coverage. What happens to that number is decided here, by code: the
 * proposed threshold is the measured value itself, with the direction it may
 * move in, and nothing else goes into it. Lisa's own thresholds for the
 * project types it supports are never consulted, so none can appear in a
 * repository that did not choose them.
 *
 * The output is one JSON document on stdout, a {@link ThresholdProposal}
 * with a `schema_version`. Its `parameters` is exactly what a part of a gate
 * carries once the operator says yes. The command reads no file and writes
 * none: proposing is not declaring.
 * @module controls/commands/propose-threshold
 */
import type { Command } from "commander";

import {
  DEFAULT_THRESHOLD_DIRECTION,
  isThresholdDirection,
  parseMeasuredValue,
  proposeThreshold,
  type ThresholdProposal,
} from "../threshold-proposal.js";

/** The subcommand's name under `lisa controls`. */
export const PROPOSE_THRESHOLD_COMMAND = "propose-threshold";

/** The version of the printed document. A changed shape gets a new one. */
const THRESHOLD_PROPOSAL_SCHEMA_VERSION = 1;

/** What `lisa controls propose-threshold` prints on stdout. */
export interface ThresholdProposalOutput extends ThresholdProposal {
  readonly schema_version: typeof THRESHOLD_PROPOSAL_SCHEMA_VERSION;
}

/** The command's options, as typed. */
export interface ProposeThresholdOptions {
  /** The parameter's name on the part, for example `minimum-coverage`. */
  readonly name?: string;
  /** The value the host's own tool reported, for example `41` or `41%`. */
  readonly measured?: string;
  /** `floor` or `ceiling`; `floor` when left out. */
  readonly direction?: string;
}

/** What the command needs from outside, each replaceable in a test. */
export interface ProposeThresholdDependencies {
  /** Where the JSON document goes, in one call. */
  readonly stdout?: (text: string) => void;
  /** Where problems go, one per call. */
  readonly stderr?: (line: string) => void;
}

/**
 * Say what is wrong with the options, when anything is.
 * @param options - The options as typed
 * @returns One line per problem; empty when a proposal can be made
 */
function optionProblems(options: ProposeThresholdOptions): readonly string[] {
  const { name, measured, direction = DEFAULT_THRESHOLD_DIRECTION } = options;
  return [
    name === undefined || name.trim() === ""
      ? 'Give the name the number goes by with --name, for example --name "minimum-coverage".'
      : null,
    measured === undefined
      ? 'Give the value measured today with --measured, for example --measured "41".'
      : null,
    measured !== undefined && parseMeasuredValue(measured) === null
      ? `--measured is ${JSON.stringify(measured)}, which is not one number. Give the value the repository's own tool reported, for example "41" or "41%". If it could not be measured, do not guess a number: ask the operator.`
      : null,
    isThresholdDirection(direction)
      ? null
      : `--direction is ${JSON.stringify(direction)}; expected floor (the lowest value allowed) or ceiling (the highest value allowed).`,
  ].filter((problem): problem is string => problem !== null);
}

/**
 * Propose a threshold at the value measured today.
 * @param options - The name, the measured value and the direction
 * @param dependencies - Replaceable collaborators
 * @returns The exit code: 0 when the proposal was printed, 1 when the
 *   options do not describe one measurement and nothing was printed on stdout
 */
export function runProposeThreshold(
  options: ProposeThresholdOptions,
  dependencies: ProposeThresholdDependencies = {}
): number {
  const stdout =
    dependencies.stdout ?? (text => process.stdout.write(`${text}\n`));
  const stderr =
    dependencies.stderr ?? (line => process.stderr.write(`${line}\n`));
  const problems = optionProblems(options);
  const { name, measured, direction = DEFAULT_THRESHOLD_DIRECTION } = options;
  const value = measured === undefined ? null : parseMeasuredValue(measured);
  if (
    problems.length > 0 ||
    name === undefined ||
    value === null ||
    !isThresholdDirection(direction)
  ) {
    problems.forEach(problem => {
      stderr(problem);
    });
    stderr(
      `${PROPOSE_THRESHOLD_COMMAND}: FAIL. Nothing was proposed, and no number was assumed in its place`
    );
    return 1;
  }
  const output: ThresholdProposalOutput = {
    schema_version: THRESHOLD_PROPOSAL_SCHEMA_VERSION,
    ...proposeThreshold({ name: name.trim(), measured: value, direction }),
  };
  stdout(JSON.stringify(output, null, 2));
  return 0;
}

/** The collaborator the registration needs, replaceable in a test. */
export interface ProposeThresholdCommandDependencies {
  readonly runProposeThreshold: (options: ProposeThresholdOptions) => number;
}

/**
 * Register `propose-threshold` under the `lisa controls` group.
 * @param group - The `controls` command
 * @param dependencies - Replaceable collaborators
 */
export function registerProposeThreshold(
  group: Command,
  dependencies: ProposeThresholdCommandDependencies = {
    runProposeThreshold: options => runProposeThreshold(options),
  }
): void {
  group
    .command(PROPOSE_THRESHOLD_COMMAND)
    .description(
      "Turn a value measured today into the threshold to propose to the operator, as JSON; writes nothing"
    )
    .option("--name <name>", "The name the number goes by on the part")
    .option(
      "--measured <value>",
      "The value the repository's own tool reported today"
    )
    .option(
      "--direction <direction>",
      "floor (the lowest value allowed) or ceiling (the highest value allowed)",
      DEFAULT_THRESHOLD_DIRECTION
    )
    .action((options: ProposeThresholdOptions) => {
      const code = dependencies.runProposeThreshold(options);
      if (code !== 0) process.exitCode = code;
    });
}

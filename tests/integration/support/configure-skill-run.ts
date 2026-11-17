/**
 * Running the configure skill's own commands against a fixture repository.
 *
 * Configuring is carried out by an agent, and a suite cannot hold a model.
 * What it can do is everything else: run each shell block of the skill,
 * exactly as the skill writes it and in the skill's order, with a stand-in
 * doing the three things only the agent does. It reads the road the first
 * command prints and stops where the skill says to stop, it supplies the
 * values it measured, and it writes the declaration just before the skill has
 * it checked.
 *
 * Nothing here copies a command out of the skill. The blocks are read from
 * the shipped document, so a command the skill gains is run by every case
 * that uses this module, and one it loses stops being run. A run ends at the
 * first `lisa controls` command that refuses, because the skill has the
 * agent stop there and fix the declaration.
 *
 * On the paved road the skill has the agent skip from the road command to the
 * check. Every block is still run here: the ones in between only read, so
 * running them shows they cannot change a paved repository either
 * (CodySwannGT/lisa#4984).
 * @module tests/integration/support/configure-skill-run
 */
import { tmpdir } from "node:os";
import path from "node:path";

import type { SeedOutput } from "../../../src/controls/commands/seed.js";
import type { ThresholdProposalOutput } from "../../../src/controls/commands/propose-threshold.js";
import { configureSkillShellBlocks } from "../../helpers/configure-skill.js";
import { controlAuditGitEnv } from "../../helpers/control-audit-fixtures.js";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import { GIT_BIN } from "../../support/git-executable.js";
import type { SkillStep } from "./audit-skill-run.js";

const BASH = "/bin/bash";

/** The block that decides the road and, on the paved road, declares. */
export const SEED_BLOCK = "lisa controls seed";

/** The block that checks the declaration the agent wrote. */
export const DECLARATION_CHECK_BLOCK = "lisa controls declaration-check";

/** The block that writes the register. */
export const REGISTER_BLOCK = "lisa controls register";

/** The block that compares the register with the declaration. */
export const REGISTER_CHECK_BLOCK = "lisa controls register --check";

/** The block that turns a measured value into a proposal. */
export const PROPOSE_BLOCK = "lisa controls propose-threshold";

/**
 * The skill's stand-in for a value the agent supplies: `"<measured value>"`
 * is whatever the repository's own tool reported.
 */
const SUPPLIED_VALUE = /"<([a-z ]+)>"/gu;

/** One value the stand-in measured, as the skill's command takes it. */
export interface Measurement {
  /** What the number is called on the check. */
  readonly name: string;
  /** The number as the repository's own tool reported it. */
  readonly "measured value": string;
  /** `floor` or `ceiling`. */
  readonly direction: string;
}

/** What the stand-in does on the discovery road. */
export interface ConfigureDecisions {
  /** The values it measured, one per threshold. None when left out. */
  readonly measurements?: readonly Measurement[];
  /**
   * Writes the declaration, given what the skill's command proposed for each
   * measurement. Called once, just before the declaration is checked.
   */
  readonly declare?: (proposals: readonly ThresholdProposalOutput[]) => void;
}

/**
 * Stands in for the agent. Called once, with what the road command printed.
 * Returns `null` where the skill tells the agent to stop.
 */
export type ConfigureAgent = (seed: SeedOutput) => ConfigureDecisions | null;

/** What a run has gathered so far. */
interface RunState {
  readonly steps: readonly SkillStep[];
  /** The stand-in's decisions; `undefined` before the road is known. */
  readonly decisions: ConfigureDecisions | null | undefined;
  /** Whether the run is over: the skill said stop, or a command refused. */
  readonly stopped: boolean;
}

/**
 * Tell whether a block is a command template the agent fills in.
 * @param block - The block as the skill writes it
 * @returns Whether it holds a value the agent supplies
 */
function isTemplate(block: string): boolean {
  return new RegExp(SUPPLIED_VALUE.source, "u").test(block);
}

/**
 * Run one shell command from the repository root.
 * @param repoPath - The repository being configured
 * @param lisaFolder - A folder holding the `lisa` command
 * @param block - The block as the skill writes it, for the record
 * @param command - The command to run, with any supplied value filled in
 * @returns The block with what it printed and how it exited
 */
function runBlock(
  repoPath: string,
  lisaFolder: string,
  block: string,
  command: string
): SkillStep {
  // The update check is deliberately not switched off here. It keeps its
  // cache inside the working directory, so a `lisa controls` command that ran
  // it would leave a file in the repository being configured, and a case
  // that compares git status has to be able to see that.
  const { LISA_SKIP_UPDATE_CHECK: _switchedOff, ...inherited } =
    controlAuditGitEnv();
  const child = boundedSpawnSync({
    label: `configure skill step: ${block}`,
    command: BASH,
    args: ["-c", command],
    cwd: repoPath,
    env: {
      ...inherited,
      PATH: [lisaFolder, path.dirname(GIT_BIN), "/usr/bin", "/bin"].join(":"),
      TMPDIR: tmpdir(),
    },
  });
  return {
    block,
    status: child.status,
    stdout: child.stdout,
    stderr: child.stderr,
  };
}

/**
 * The proposals the skill's command printed in a run.
 * @param steps - The steps run so far
 * @returns One proposal per measurement, in the order they were measured
 */
export function proposalsOf(
  steps: readonly SkillStep[]
): readonly ThresholdProposalOutput[] {
  return steps
    .filter(step => step.block.includes(PROPOSE_BLOCK) && step.status === 0)
    .map(step => JSON.parse(step.stdout) as ThresholdProposalOutput);
}

/**
 * Find the step that ran a given command.
 *
 * A block that is exactly the command is preferred over one that only
 * contains it, so `lisa controls register` finds the plain command and not
 * the one with `--check`.
 * @param steps - The steps of one run
 * @param command - The block, or text it contains
 * @returns The step
 * @throws {Error} When the run has no such step, so a case can never pass by
 *   not running the command it is about
 */
export function configureStep(
  steps: readonly SkillStep[],
  command: string
): SkillStep {
  const found =
    steps.find(step => step.block.trim() === command) ??
    steps.find(step => step.block.includes(command));
  if (found === undefined) {
    throw new Error(
      `The configure run has no step running "${command}". Steps: ${steps
        .map(step => step.block)
        .join(" | ")}`
    );
  }
  return found;
}

/**
 * Run every shell block of the configure skill, in order, from a repository
 * root.
 * @param repoPath - The repository being configured
 * @param lisaFolder - A folder holding the `lisa` command
 * @param agent - Stands in for the agent; by default one that makes no
 *   decision, which is all the paved road needs
 * @returns Every block that ran, with what it printed and how it exited
 */
export function runConfigureSkillCommands(
  repoPath: string,
  lisaFolder: string,
  agent: ConfigureAgent = () => ({})
): readonly SkillStep[] {
  return configureSkillShellBlocks().reduce<RunState>(
    (state, block) => {
      if (state.stopped) return state;
      if (block.trim() === DECLARATION_CHECK_BLOCK) {
        state.decisions?.declare?.(proposalsOf(state.steps));
      }
      const ran = isTemplate(block)
        ? (state.decisions?.measurements ?? []).map(measurement =>
            runBlock(
              repoPath,
              lisaFolder,
              block,
              block.replaceAll(
                SUPPLIED_VALUE,
                (_placeholder, name: keyof Measurement) =>
                  `"${measurement[name]}"`
              )
            )
          )
        : [runBlock(repoPath, lisaFolder, block, block)];
      const steps = [...state.steps, ...ran];
      const refused = ran.some(
        step => step.block.includes("lisa controls") && step.status !== 0
      );
      if (block.trim() !== SEED_BLOCK || refused) {
        return { ...state, steps, stopped: refused };
      }
      const decisions = agent(
        JSON.parse(ran[0]?.stdout ?? "null") as SeedOutput
      );
      return { steps, decisions, stopped: decisions === null };
    },
    { steps: [], decisions: undefined, stopped: false }
  ).steps;
}

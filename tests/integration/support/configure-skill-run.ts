/**
 * Running the configure skill's own commands against a fixture repository.
 *
 * Configuring is carried out by an agent, and a suite cannot hold a model.
 * What it can do is everything else: run each shell block of the skill,
 * exactly as the skill writes it and in the skill's order, with a stand-in
 * doing the things only the agent does. It reads the road the first command
 * prints and stops where the skill says to stop, it supplies the values it
 * measured, it writes the declaration just before the skill has it checked,
 * and it makes each test change in the scratch copy the skill's own command
 * made, so that the skill's own commands write the patch files
 * (CodySwannGT/lisa#5011).
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
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
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

/** The block that tries each check's pair of test changes. */
export const PROOF_CHECK_BLOCK = "lisa controls proof-check";

/** The start of the block that makes the scratch copy of the last commit. */
const CLONE_BLOCK = "git clone";

/** The skill's stand-in for the scratch folder a test change is made in. */
const SCRATCH_FOLDER = "scratch folder";

/** The skill's stand-in for the full path of the patch file being written. */
const PATCH_FILE = "patch file";

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

/** One test change the stand-in writes with the skill's own commands. */
export interface TestChange {
  /** The patch file the change is written to, from the repository root. */
  readonly file: string;
  /**
   * Makes the change in a scratch copy of the last commit, the way the agent
   * edits a file there. Called once, right after the skill's command made
   * the copy.
   */
  readonly edit: (scratchFolder: string) => void;
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
  /** The test changes it writes, two per check. None when left out. */
  readonly changes?: readonly TestChange[];
  /**
   * Names the patch files and the failure text in the declaration. Called
   * once, just before the skill has the pairs tried.
   */
  readonly declareProofs?: () => void;
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
  /** One new, empty scratch folder per test change, in the same order. */
  readonly scratch: readonly string[];
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
 * Tell whether a template is one of the commands that write a patch file.
 * @param block - The block as the skill writes it
 * @returns Whether it names the scratch folder a test change is made in
 */
function writesPatch(block: string): boolean {
  return block.includes(`"<${SCRATCH_FOLDER}>"`);
}

/**
 * Fill in the values a template names.
 * @param block - The block as the skill writes it
 * @param values - The values the stand-in supplies, by the name the skill
 *   gives each
 * @returns The command to run
 * @throws {Error} When the skill names a value the stand-in does not have,
 *   so a command is never run with a placeholder left in it
 */
function filled(
  block: string,
  values: Readonly<Record<string, string>>
): string {
  return block.replaceAll(SUPPLIED_VALUE, (_placeholder, name: string) => {
    const value = values[name];
    if (value === undefined) {
      throw new Error(
        `The configure skill asks for "<${name}>" in "${block.trim()}", and the stand-in has no such value.`
      );
    }
    return `"${value}"`;
  });
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
 * Run one of the skill's patch-writing commands once per test change.
 *
 * Each test change gets a scratch folder of its own, so every command runs
 * exactly as the skill writes it for one change. Right after the command
 * that makes the scratch copy, the stand-in makes its edit there, and the
 * folder the patch file goes in is created, as the skill tells the agent to.
 * @param repoPath - The repository being configured
 * @param lisaFolder - A folder holding the `lisa` command
 * @param block - The block as the skill writes it
 * @param state - The test changes and their scratch folders
 * @returns One step per test change
 */
function runPatchBlock(
  repoPath: string,
  lisaFolder: string,
  block: string,
  state: RunState
): readonly SkillStep[] {
  return (state.decisions?.changes ?? []).map((change, index) => {
    const scratchFolder = state.scratch[index] ?? "";
    const patchFile = path.join(repoPath, change.file);
    const step = runBlock(
      repoPath,
      lisaFolder,
      block,
      filled(block, {
        [SCRATCH_FOLDER]: scratchFolder,
        [PATCH_FILE]: patchFile,
      })
    );
    if (block.trim().startsWith(CLONE_BLOCK) && step.status === 0) {
      change.edit(scratchFolder);
      mkdirSync(path.dirname(patchFile), { recursive: true });
    }
    return step;
  });
}

/**
 * Run one block of the skill, as many times as the stand-in has values for.
 * @param repoPath - The repository being configured
 * @param lisaFolder - A folder holding the `lisa` command
 * @param block - The block as the skill writes it
 * @param state - What the run has gathered so far
 * @returns The steps that ran: one for a plain command, one per value set
 *   for a template
 */
function runSkillBlock(
  repoPath: string,
  lisaFolder: string,
  block: string,
  state: RunState
): readonly SkillStep[] {
  if (!isTemplate(block)) return [runBlock(repoPath, lisaFolder, block, block)];
  if (writesPatch(block)) {
    return runPatchBlock(repoPath, lisaFolder, block, state);
  }
  return (state.decisions?.measurements ?? []).map(measurement =>
    runBlock(repoPath, lisaFolder, block, filled(block, { ...measurement }))
  );
}

/**
 * Make one new, empty scratch folder per test change, outside the
 * repository: what the skill has the agent do with `mktemp -d`.
 * @param decisions - The stand-in's decisions
 * @returns The folders, in the order of the test changes
 */
function scratchFolders(
  decisions: ConfigureDecisions | null
): readonly string[] {
  return (decisions?.changes ?? []).map(() =>
    realpathSync(mkdtempSync(path.join(tmpdir(), "lisa-configure-scratch-")))
  );
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
  const ended = configureSkillShellBlocks().reduce<RunState>(
    (state, block) => {
      if (state.stopped) return state;
      if (block.trim() === DECLARATION_CHECK_BLOCK) {
        state.decisions?.declare?.(proposalsOf(state.steps));
      }
      if (block.trim() === PROOF_CHECK_BLOCK) {
        state.decisions?.declareProofs?.();
      }
      const ran = runSkillBlock(repoPath, lisaFolder, block, state);
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
      return {
        steps,
        decisions,
        scratch: scratchFolders(decisions),
        stopped: decisions === null,
      };
    },
    { steps: [], decisions: undefined, scratch: [], stopped: false }
  );
  // The skill has the agent remove its scratch folder once the last patch
  // is written.
  ended.scratch.forEach(folder => {
    rmSync(folder, { force: true, recursive: true });
  });
  return ended.steps;
}

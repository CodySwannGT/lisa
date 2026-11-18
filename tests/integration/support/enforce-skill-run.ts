/**
 * Running the enforce skill's own commands against a fixture repository.
 *
 * Enforcing is carried out by an agent, and a suite cannot hold a model.
 * What it can do is everything else: run each shell block of the skill,
 * exactly as the skill writes it and in the skill's order, with a stand-in
 * doing the two things only the agent does. It names the coding agents that
 * work on the repository, and it writes the ticket results just before the
 * skill has them read.
 *
 * Nothing here copies a command out of the skill. The blocks are read from
 * the shipped document, so a command the skill gains is run by every case
 * that uses this module, and one it loses stops being run. A run ends where
 * the skill tells the agent to stop: at a command that produced no result
 * (CodySwannGT/lisa#4994).
 * @module tests/integration/support/enforce-skill-run
 */
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { EnforceReport } from "../../../src/controls/enforce-types.js";
import { controlAuditGitEnv } from "../../helpers/control-audit-fixtures.js";
import { enforceSkillShellBlocks } from "../../helpers/enforce-skill.js";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import { GIT_BIN } from "../../support/git-executable.js";
import type { SkillStep } from "./audit-skill-run.js";

const BASH = "/bin/bash";

/** The block that makes the folder the results are saved in. */
export const RESULTS_FOLDER_BLOCK = "mktemp -d";

/** The block that reads the audit report before anything is installed. */
export const AUDIT_BLOCK = "lisa controls gaps";

/** The block that checks the declaration before anything is installed. */
export const DECLARATION_CHECK_BLOCK = "lisa controls declaration-check";

/** The block that installs the carriers. */
export const INSTALL_BLOCK = "lisa controls install-carriers --agents";

/** The block that writes the register. */
export const REGISTER_BLOCK = "lisa controls register";

/** The block that compares the merge settings with the register. */
export const PROTECT_BLOCK = "lisa controls protect";

/** The block that prints the outcome of every requirement. */
export const REPORT_BLOCK = "lisa controls enforce-report";

/** The block that lists what the working copy holds. */
export const CHANGED_BLOCK = "git status --porcelain";

/** The skill's stand-in for the folder its results are saved in. */
const RESULTS_FOLDER = "<results folder>";

/** The option the skill has the agent fill in, or leave off. */
const AGENTS_OPTION = ' --agents="<agents>"';

/** The exit codes of a command that still printed a complete result. */
const RESULT_PRINTED: readonly (number | null)[] = [0, 2, 3];

/** What the stand-in does in place of the agent. */
export interface EnforceAgent {
  /**
   * The coding agents that work on the repository, as the skill has the
   * agent name them. Left out, the skill has the agent run the carriers
   * command without the option.
   */
  readonly agents?: string;
  /**
   * The results of the ticket flow, written to the results folder before the
   * report is asked for. Nothing was filed when left out.
   */
  readonly tickets?: readonly unknown[];
}

/** Every block that ran, and the folder the results were saved in. */
export interface EnforceSkillRun {
  readonly steps: readonly SkillStep[];
  /** The results folder the skill made; empty before that block ran. */
  readonly results: string;
  /** Whether the skill's own commands removed that folder again. */
  readonly cleared: boolean;
}

/** What a run has gathered so far. */
interface RunState extends Omit<EnforceSkillRun, "cleared"> {
  /** Whether the skill told the agent to stop. */
  readonly stopped: boolean;
}

/**
 * Fill in the values the agent supplies in one block.
 * @param block - The block as the skill writes it
 * @param state - What the run has gathered so far
 * @param agent - The stand-in
 * @returns The command to run
 */
function filled(block: string, state: RunState, agent: EnforceAgent): string {
  return block
    .replaceAll(RESULTS_FOLDER, state.results)
    .replace(
      AGENTS_OPTION,
      agent.agents === undefined ? "" : ` --agents="${agent.agents}"`
    );
}

/**
 * Tell whether the skill has the agent stop after a block.
 * @param step - The block that ran
 * @returns Whether a `lisa controls` command produced no result
 */
function stopsRun(step: SkillStep): boolean {
  if (!step.block.includes("lisa controls")) return false;
  const printsResult =
    step.block.includes("install-carriers") ||
    step.block.includes(PROTECT_BLOCK);
  return printsResult
    ? !RESULT_PRINTED.includes(step.status)
    : step.status !== 0;
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
export function enforceStep(
  steps: readonly SkillStep[],
  command: string
): SkillStep {
  const found =
    steps.find(step => step.block.trim() === command) ??
    steps.find(step => step.block.includes(command));
  if (found === undefined) {
    throw new Error(
      `The enforce run has no step running "${command}". Steps: ${steps
        .map(step => step.block)
        .join(" | ")}`
    );
  }
  return found;
}

/**
 * The report a run printed.
 * @param run - The run
 * @returns The parsed report
 */
export function reportOf(run: EnforceSkillRun): EnforceReport {
  return JSON.parse(
    enforceStep(run.steps, REPORT_BLOCK).stdout
  ) as EnforceReport;
}

/**
 * Run every shell block of the enforce skill, in order, from a repository
 * root.
 * @param repoPath - The repository being enforced
 * @param lisaFolder - A folder holding the `lisa` command
 * @param agent - Stands in for the agent
 * @returns Every block that ran, with what it printed and how it exited
 */
export function runEnforceSkillCommands(
  repoPath: string,
  lisaFolder: string,
  agent: EnforceAgent = {}
): EnforceSkillRun {
  // The update check is deliberately not switched off here. It keeps its
  // cache inside the working directory, so a `lisa controls` command that ran
  // it would leave a file in the repository being enforced, and a case that
  // compares the repository's state has to be able to see that.
  const { LISA_SKIP_UPDATE_CHECK: _switchedOff, ...inherited } =
    controlAuditGitEnv();
  const env = {
    ...inherited,
    // The declared checks are programs of the repository's own; the one the
    // fixtures declare is run with Node.
    PATH: [
      lisaFolder,
      path.dirname(process.execPath),
      path.dirname(GIT_BIN),
      "/usr/bin",
      "/bin",
    ].join(":"),
    TMPDIR: tmpdir(),
  };
  const run = enforceSkillShellBlocks().reduce<RunState>(
    (state, block) => {
      if (state.stopped) return state;
      if (block.includes(REPORT_BLOCK)) {
        writeFileSync(
          path.join(state.results, "tickets.json"),
          JSON.stringify({ schema_version: 1, results: agent.tickets ?? [] })
        );
      }
      const child = boundedSpawnSync({
        label: `enforce skill step: ${block}`,
        command: BASH,
        args: ["-c", filled(block, state, agent)],
        cwd: repoPath,
        env,
      });
      const step: SkillStep = {
        block,
        status: child.status,
        stdout: child.stdout,
        stderr: child.stderr,
      };
      return {
        results: block.startsWith(RESULTS_FOLDER_BLOCK)
          ? child.stdout.trim()
          : state.results,
        steps: [...state.steps, step],
        stopped: stopsRun(step),
      };
    },
    { results: "", steps: [], stopped: false }
  );
  const cleared = run.results !== "" && !existsSync(run.results);
  // A run the skill stopped never reaches the block that removes the folder.
  if (run.results !== "" && !cleared) {
    rmSync(run.results, { force: true, recursive: true });
  }
  return { cleared, results: run.results, steps: run.steps };
}

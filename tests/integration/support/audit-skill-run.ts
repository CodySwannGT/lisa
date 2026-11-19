/**
 * Running the audit skill's own commands against a fixture repository.
 *
 * The audit is carried out by an agent, and a suite cannot hold a model. What
 * it can do is everything else: run each shell block of the skill, exactly as
 * the skill writes it and in the skill's order, with a stand-in doing the one
 * thing only the agent does, which is writing `.lisa/audit/report.json` once
 * the requirements have been printed.
 *
 * Nothing here copies a command out of the skill. The blocks are read from the
 * shipped document, so a command the skill gains is run by every case that
 * uses this module, and one it loses stops being run
 * (CodySwannGT/lisa#4979).
 * @module tests/integration/support/audit-skill-run
 */
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { auditSkillShellBlocks } from "../../helpers/audit-skill.js";
import { controlAuditGitEnv } from "../../helpers/control-audit-fixtures.js";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import { GIT_BIN } from "../../support/git-executable.js";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const DIST_CLI = path.join(REPO_ROOT, "dist", "index.js");
const BASH = "/bin/bash";

/** The block that prints the requirements, after which the agent writes. */
export const CATALOGUE_BLOCK = "lisa controls catalogue";

/** The block that checks the report the agent wrote. */
export const REPORT_CHECK_BLOCK = "lisa controls report-check";

/**
 * The skill's stand-in for a path the agent carries from one step to a later
 * one: `"<before picture>"` is whatever the `mktemp` block for the before
 * picture printed.
 */
const CARRIED_PATH = /"<(\w+) picture>"/gu;

/** One requirement as `lisa controls catalogue` prints it. */
export type PrintedCriterion = Readonly<Record<string, unknown>>;

/** One shell block of the skill, after it ran. */
export interface SkillStep {
  /** The block as the skill writes it. */
  readonly block: string;
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Put a `lisa` command on a private PATH folder, running the built CLI.
 *
 * The skill writes `lisa controls …` and tells the agent to run that when
 * `lisa` is on the PATH. This is that case, with the CLI being the one built
 * from this checkout rather than a published one.
 * @returns The folder, and a function that removes it
 */
export function installLisaCommand(): {
  readonly folder: string;
  readonly remove: () => void;
} {
  const folder = mkdtempSync(path.join(tmpdir(), "lisa-audit-skill-bin-"));
  const command = path.join(folder, "lisa");
  writeFileSync(
    command,
    `#!/bin/sh\nexec "${process.execPath}" "${DIST_CLI}" "$@"\n`
  );
  chmodSync(command, 0o755);
  return {
    folder,
    remove: () => {
      rmSync(folder, { force: true, recursive: true });
    },
  };
}

/**
 * The path a block that makes a temporary file printed, for the later blocks
 * that name it.
 * @param steps - The steps run so far
 * @param picture - Which picture: `before` or `after`
 * @returns The printed path, or an empty string before that block has run
 */
export function picturePath(
  steps: readonly SkillStep[],
  picture: string
): string {
  return (
    steps
      .find(
        step =>
          step.block.startsWith("mktemp ") &&
          step.block.includes(`lisa-audit-${picture}.`)
      )
      ?.stdout.trim() ?? ""
  );
}

/**
 * Run every shell block of the audit skill, in order, from a repository root.
 * @param repoPath - The repository being audited
 * @param lisaFolder - A folder holding the `lisa` command
 * @param agent - Stands in for the agent: called once, with the requirements
 *   the catalogue command printed, at the point the skill has the agent write
 *   the report
 * @returns Every block with what it printed and how it exited
 */
export function runAuditSkillCommands(
  repoPath: string,
  lisaFolder: string,
  agent: (criteria: readonly PrintedCriterion[]) => void
): readonly SkillStep[] {
  // The update check is deliberately not switched off here. It keeps its cache
  // inside the working directory, so a `lisa controls` command that ran it
  // would leave a file in the repository being audited, and a case that
  // compares git status has to be able to see that.
  const { LISA_SKIP_UPDATE_CHECK: _switchedOff, ...inherited } =
    controlAuditGitEnv();
  const env = {
    ...inherited,
    PATH: [lisaFolder, path.dirname(GIT_BIN), "/usr/bin", "/bin"].join(":"),
    TMPDIR: tmpdir(),
  };
  return auditSkillShellBlocks().reduce<readonly SkillStep[]>(
    (steps, block) => {
      const child = boundedSpawnSync({
        label: `audit skill step: ${block}`,
        command: BASH,
        args: [
          "-c",
          block.replaceAll(
            CARRIED_PATH,
            (_placeholder, picture: string) =>
              `"${picturePath(steps, picture)}"`
          ),
        ],
        cwd: repoPath,
        env,
      });
      if (block.trim() === CATALOGUE_BLOCK) {
        const printed = JSON.parse(child.stdout) as {
          readonly criteria: readonly PrintedCriterion[];
        };
        agent(printed.criteria);
      }
      return [
        ...steps,
        {
          block,
          status: child.status,
          stdout: child.stdout,
          stderr: child.stderr,
        },
      ];
    },
    []
  );
}

/**
 * Find the step that ran a given command.
 *
 * A block that is exactly the command is preferred over one that only
 * contains it, so `lisa controls report-check` finds the plain check even when
 * the skill also runs the same command with an option.
 * @param steps - The steps of one run
 * @param command - The block, or text it contains
 * @returns The step
 * @throws {Error} When the skill has no such block, so a case can never pass
 *   by not running the command it is about
 */
export function stepRunning(
  steps: readonly SkillStep[],
  command: string
): SkillStep {
  const found =
    steps.find(step => step.block.trim() === command) ??
    steps.find(step => step.block.includes(command));
  if (found === undefined) {
    throw new Error(
      `The audit skill has no shell block running "${command}". Blocks: ${steps
        .map(step => step.block)
        .join(" | ")}`
    );
  }
  return found;
}

/**
 * The lines a `diff` marks as removed or added.
 * @param output - What `diff` printed
 * @returns Each `<` or `>` line
 */
export function changedLines(output: string): readonly string[] {
  return output.split("\n").filter(line => /^[<>] /u.test(line));
}

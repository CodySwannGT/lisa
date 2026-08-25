/**
 * Registration and CLI runners for Lisa's cleanup verbs.
 *
 * These exist because an agent could previously DETECT accumulated disk state
 * and never remove it: `lisa doctor` reports dirty worktrees and work at risk,
 * and the enumerated command list held no `worktree` verb and no `stash` verb
 * (CodySwannGT/lisa#2993). Detection without remediation is not half a
 * solution — it is the state in which the disk keeps filling with a recorded
 * warning nobody is permitted to act on.
 *
 * The answer is a vetted verb, never an override. Nothing here relaxes the
 * safety-net guard: the raw `git worktree remove --force`, `git stash drop`,
 * and `git stash clear` forms stay blocked for everybody, this command never
 * passes `--force` to git, and the entitlement rules it enforces are in
 * `worktree-prune-policy` and `stash-prune-policy` where they can be tested.
 * @module cli/prune-commands
 */
import type { Command } from "commander";
import * as path from "node:path";
import {
  applyStashPrune,
  planStashPrune,
  type StashDropOutcome,
  type StashPruneOptions,
} from "./stash-prune.js";
import { renderStashPlan, renderWorktreePlan } from "./prune-report.js";
import { git } from "./worktree-inventory.js";
import {
  resolveCallerOwnerId,
  writeOwnerReceipt,
} from "./worktree-ownership.js";
import {
  applyWorktreePrune,
  defaultWorktreePruneDependencies,
  planWorktreePrune,
  pruneMissingRegistrations,
  type RemovalOutcome,
  type WorktreePruneOptions,
} from "./worktree-prune.js";

/** Help text for the optional repository-path positional argument. */
const REPO_ARG_DESCRIPTION = "Repository path (default: current directory)";

/** Options accepted by the claim verb. */
export interface WorktreeClaimOptions {
  /** Owner id to record; defaults to the runtime's session id. */
  readonly owner?: string;
}

/**
 * Print lines through a writer.
 * @param lines - Lines to print
 * @param write - Sink, defaults to stdout
 */
function emit(
  lines: readonly string[],
  write: (line: string) => void = line => process.stdout.write(`${line}\n`)
): void {
  lines.forEach(write);
}

/**
 * Run `lisa worktree prune`.
 * @param targetPath - Repository path
 * @param options - Command-line options
 * @returns Process exit code
 */
export async function runWorktreePruneCli(
  targetPath: string | undefined,
  options: WorktreePruneOptions
): Promise<number> {
  const repoPath = path.resolve(targetPath ?? process.cwd());
  const plan = await planWorktreePrune(
    repoPath,
    options,
    defaultWorktreePruneDependencies()
  );
  const outcomes: readonly RemovalOutcome[] =
    options.apply === true ? await applyWorktreePrune(plan) : [];
  const forgotten =
    options.apply === true ? await pruneMissingRegistrations(plan) : 0;
  if (options.json === true) {
    emit([
      JSON.stringify(
        { plan, outcomes, forgottenRegistrations: forgotten },
        undefined,
        2
      ),
    ]);
  } else {
    emit([
      ...renderWorktreePlan(plan, options.apply === true),
      ...outcomes
        .filter(outcome => !outcome.removed)
        .map(
          outcome =>
            `  FAILED  ${outcome.path} — ${outcome.error ?? "git refused it"}`
        ),
    ]);
  }
  return outcomes.some(outcome => !outcome.removed) ? 1 : 0;
}

/**
 * Run `lisa worktree claim`.
 * @param targetPath - Worktree path to claim
 * @param options - Command-line options
 * @returns Process exit code
 */
export async function runWorktreeClaimCli(
  targetPath: string | undefined,
  options: WorktreeClaimOptions
): Promise<number> {
  const worktree = path.resolve(targetPath ?? process.cwd());
  const owner = options.owner ?? resolveCallerOwnerId();
  if (owner === undefined) {
    emit([
      "No owner id available. Pass --owner <id>, or run under an agent runtime " +
        "that sets one, so the claim names somebody.",
    ]);
    return 1;
  }
  const adminDirectory = await git(
    ["rev-parse", "--absolute-git-dir"],
    worktree
  ).then(
    out => out.trim(),
    () => ""
  );
  if (adminDirectory === "") {
    emit([
      `${worktree} is not inside a git repository, so it cannot be claimed.`,
    ]);
    return 1;
  }
  const receipt = await writeOwnerReceipt(adminDirectory, owner);
  emit([
    `Claimed ${worktree} for ${owner}.`,
    `Receipt: ${receipt} (inside the git control plane, so it never dirties the working tree).`,
  ]);
  return 0;
}

/**
 * Run `lisa stash prune`.
 * @param targetPath - Repository path
 * @param options - Command-line options
 * @returns Process exit code
 */
export async function runStashPruneCli(
  targetPath: string | undefined,
  options: StashPruneOptions
): Promise<number> {
  const repoPath = path.resolve(targetPath ?? process.cwd());
  const plan = await planStashPrune(repoPath, options);
  const outcomes: readonly StashDropOutcome[] =
    options.apply === true ? await applyStashPrune(plan) : [];
  if (options.json === true) {
    emit([JSON.stringify({ plan, outcomes }, undefined, 2)]);
  } else {
    emit([
      ...renderStashPlan(plan, options.apply === true),
      ...outcomes
        .filter(outcome => !outcome.dropped)
        .map(
          outcome =>
            `  FAILED  ${outcome.sha.slice(0, 8)} — ${outcome.error ?? "git refused it"}`
        ),
    ]);
  }
  return outcomes.some(outcome => !outcome.dropped) ? 1 : 0;
}

/**
 * Register the worktree command group.
 * @param program - Commander program to mutate
 */
function addWorktreeCommands(program: Command): void {
  const worktree = program
    .command("worktree")
    .description("Inspect and retire this repository's agent worktrees");
  worktree
    .command("prune")
    .description(
      "Remove agent worktrees that are provably nobody's live work (dry run unless --apply)"
    )
    .argument("[path]", REPO_ARG_DESCRIPTION)
    .option("--apply", "Perform the removals (default: report only)")
    .option(
      "--idle-hours <hours>",
      "Quiescence an unclaimed worktree must show before it is eligible (default: 24)"
    )
    .option("--json", "Emit the plan and outcomes as JSON")
    .action(
      async (targetPath: string | undefined, options: WorktreePruneOptions) => {
        const code = await runWorktreePruneCli(targetPath, options);
        if (code !== 0) {
          process.exitCode = code;
        }
      }
    );
  worktree
    .command("claim")
    .description(
      "Record this agent as the owner of a worktree so it can retire it later"
    )
    .argument("[path]", "Worktree path (default: current directory)")
    .option("--owner <id>", "Owner id to record")
    .action(
      async (targetPath: string | undefined, options: WorktreeClaimOptions) => {
        const code = await runWorktreeClaimCli(targetPath, options);
        if (code !== 0) {
          process.exitCode = code;
        }
      }
    );
}

/**
 * Register the stash command group.
 * @param program - Commander program to mutate
 */
function addStashCommands(program: Command): void {
  program
    .command("stash")
    .description("Clear provably redundant stash entries")
    .command("prune")
    .description(
      "Drop stash entries that are provably redundant, preserving each one under a ref first (dry run unless --apply)"
    )
    .argument("[path]", REPO_ARG_DESCRIPTION)
    .option("--apply", "Perform the drops (default: report only)")
    .option(
      "--older-than-hours <hours>",
      "Age a machine-generated backup must reach before it counts as debris (default: 24)"
    )
    .option("--json", "Emit the plan and outcomes as JSON")
    .action(
      async (targetPath: string | undefined, options: StashPruneOptions) => {
        const code = await runStashPruneCli(targetPath, options);
        if (code !== 0) {
          process.exitCode = code;
        }
      }
    );
}

/**
 * Register every cleanup verb.
 * @param program - Commander program to mutate
 */
export function addPruneCommands(program: Command): void {
  addWorktreeCommands(program);
  addStashCommands(program);
}

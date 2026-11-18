/**
 * Building the enforce report: one outcome for every Level 1 requirement.
 *
 * The enforce step runs three things in order: it installs the carriers, it
 * files a ticket for each requirement the repository has nothing for, and it
 * compares the hosting platform's merge protection with the control
 * register. Each prints its result and keeps nothing. This module reads the
 * three results, the audit report and the register, and derives the report.
 * Nothing here is decided by an agent.
 *
 * ## What is checked before anything is derived
 *
 * - the three results are there and of the right shape (`./enforce-inputs.ts`);
 * - the audit report passes every rule `report-check` holds it to;
 * - the committed register is exactly what the declaration generates, so
 *   the report is never about a register nobody can read;
 * - the merge-protection result lists exactly the entries this register
 *   asks the hosting platform to require, so a result saved before the
 *   declaration changed is refused instead of believed;
 * - the ticket results answer for exactly the requirements the audit report
 *   lists as missing (`./enforce-tickets.ts`).
 *
 * Any of those failing stops the command with one line per problem and
 * nothing on stdout.
 *
 * ## What it writes
 *
 * Nothing in the repository. See `./enforce-types.ts` for why the outcomes
 * are printed and not kept in a file.
 * @module controls/enforce-report
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import { loadAuditReport } from "./audit-report-file.js";
import { listControlGaps } from "./commands/gaps.js";
import { deriveCriteria, outcomeProblems } from "./enforce-claims.js";
import {
  measureCurrentlyFailing,
  type HeadRunDependencies,
} from "./enforce-head-run.js";
import {
  readEnforceInputs,
  type EnforceInputPaths,
  type HandedProtect,
} from "./enforce-inputs.js";
import { enforcedEntries } from "./enforce-points.js";
import {
  countOutcomes,
  reportLimits,
  reportedChanges,
  summaryOf,
} from "./enforce-summary.js";
import { settleTickets } from "./enforce-tickets.js";
import {
  ENFORCE_REPORT_SCHEMA_VERSION,
  type CurrentlyFailing,
  type EnforceReport,
} from "./enforce-types.js";
import { isProtectedEntry } from "./protect-derive.js";
import type { PointVerdict } from "./reconcile-types.js";
import { executorVerdict } from "./reconcile-executor.js";
import {
  generateControlRegister,
  type ControlRegisterGeneration,
} from "./register.js";
import {
  CONTROL_REGISTER_PATH,
  type ControlRegister,
  type PullRequestExecutor,
} from "./register-types.js";
import { readConfiguredTracker } from "./tracker-config.js";
import { openTrackerQuestionId } from "./tracker-question.js";

/** What building the report needs from outside, each replaceable in a test. */
export interface EnforceReportDependencies {
  /** The current time, used to judge whether evidence is still fresh. */
  readonly now?: Date;
  /** Generates the control register from the declaration. */
  readonly generate?: (root: string) => Promise<ControlRegisterGeneration>;
  /** Runs the required checks on the head of the default branch. */
  readonly measure?: (
    root: string,
    register: ControlRegister,
    platformBranch: string | null
  ) => Promise<CurrentlyFailing>;
  /** Reads the pipeline file a register names. */
  readonly executorVerdict?: (
    root: string,
    executor: PullRequestExecutor
  ) => Promise<PointVerdict>;
  /** Replaceable collaborators of the default `measure`. */
  readonly head?: HeadRunDependencies;
}

/** The report, or one line per reason there is none. */
export type EnforceReportRun =
  | { readonly problems: null; readonly report: EnforceReport }
  | { readonly problems: readonly string[] };

/**
 * Read the register a repository has committed, and compare it with what the
 * declaration generates.
 * @param root - Real path of the repository
 * @param generated - The text the declaration generates
 * @returns The one-line problem, or `null` when the file is current
 */
async function registerProblem(
  root: string,
  generated: string
): Promise<string | null> {
  const committed = await readFile(
    path.join(root, CONTROL_REGISTER_PATH),
    "utf8"
  ).catch(() => null);
  if (committed === generated) return null;
  return committed === null
    ? `${CONTROL_REGISTER_PATH} is not there. Run "lisa controls register", then the merge-protection step, then this again.`
    : `${CONTROL_REGISTER_PATH} is not what the declaration generates any more. Run "lisa controls register", then the merge-protection step, then this again.`;
}

/**
 * Check that a merge-protection result is about this register.
 * @param register - The control register the declaration generates
 * @param protect - The merge-protection result
 * @returns One line per entry the result should list and does not, or lists
 *   and should not
 */
function protectProblems(
  register: ControlRegister,
  protect: HandedProtect
): readonly string[] {
  const expected = register.entries
    .filter(entry => isProtectedEntry(entry))
    .map(entry => entry.id);
  const listed = protect.entries.map(entry => entry.id);
  const again = 'Run "lisa controls protect" again and save its result.';
  return [
    ...expected
      .filter(id => !listed.includes(id))
      .map(
        id =>
          `The merge-protection result says nothing about ${id}, which the register asks the hosting platform to require. It was saved for a different declaration. ${again}`
      ),
    ...listed
      .filter(id => !expected.includes(id))
      .map(
        id =>
          `The merge-protection result is about ${id}, which the register does not ask the hosting platform to require. It was saved for a different declaration. ${again}`
      ),
  ];
}

/**
 * Build the enforce report of a repository.
 * @param root - Real path of the repository
 * @param paths - Where the three results were saved
 * @param dependencies - Replaceable collaborators
 * @returns The report, or one line per problem
 */
export async function buildEnforceReport(
  root: string,
  paths: EnforceInputPaths,
  dependencies: EnforceReportDependencies = {}
): Promise<EnforceReportRun> {
  const read = await readEnforceInputs(paths);
  if (read.problems !== null) return read;
  const { inputs } = read;
  const loaded = await loadAuditReport(root, dependencies.now ?? new Date());
  if (loaded.problems !== null) return loaded;
  const generated = await (dependencies.generate ?? generateControlRegister)(
    root
  );
  if (generated.problems !== null) return generated;
  const { register } = generated;
  const stale = await registerProblem(root, generated.text);
  const mismatched = protectProblems(register, inputs.protect);
  if (stale !== null || mismatched.length > 0) {
    return { problems: [...(stale === null ? [] : [stale]), ...mismatched] };
  }
  const tracker = await readConfiguredTracker(root);
  const tickets = settleTickets({
    gaps: listControlGaps(loaded.report, loaded.criteria),
    handed: inputs.tickets,
    tracker: {
      configured: tracker.configured,
      problem: tracker.problem,
      question: tracker.configured
        ? null
        : openTrackerQuestionId(loaded.document),
    },
  });
  if (tickets.problems !== null) return tickets;
  const entries = await enforcedEntries(register, {
    carriers: inputs.carriers,
    executorVerdict: executor =>
      (dependencies.executorVerdict ?? executorVerdict)(root, executor),
    protect: inputs.protect,
  });
  const criteria = deriveCriteria({
    criteria: loaded.criteria,
    entries,
    report: loaded.report,
    ticketFor: tickets.ticketFor,
  });
  const uncounted = outcomeProblems(criteria, loaded.criteria);
  if (uncounted.length > 0) return { problems: uncounted };
  const failing = await (
    dependencies.measure ??
    ((repository, declared, branch) =>
      measureCurrentlyFailing(repository, declared, branch, dependencies.head))
  )(root, register, inputs.protect.branch);
  const changes = reportedChanges(inputs, tickets.created);
  const counts = countOutcomes(criteria);
  return {
    problems: null,
    report: {
      schema_version: ENFORCE_REPORT_SCHEMA_VERSION,
      reason: summaryOf(counts, changes, failing),
      requirements: criteria.length,
      counts,
      criteria,
      entries,
      currently_failing: failing,
      changes,
      limits: reportLimits(register, inputs),
    },
  };
}

/**
 * `lisa controls gaps [path]`: list the requirements a repository has nothing
 * for, each with the marker its ticket carries.
 *
 * A requirement with nothing behind it cannot be enforced by installing a
 * hook. It is work, and it becomes one ticket. An agent files that ticket, so
 * everything the agent must not get wrong is decided here, by code:
 *
 * - which findings of `.lisa/audit/report.json` are in state `missing`;
 * - the marker each one's ticket is found by, so a second run finds the first
 *   run's ticket instead of filing another (`../control-gap-marker.ts`);
 * - the order they are listed in, which follows the catalogue and then the
 *   folder, never the order the audit happened to write them in;
 * - whether there is a tracker to file in at all. With none, every missing
 *   requirement is `blocked`, and the output says so itself.
 *
 * The output is one JSON document on stdout, {@link ControlGapsOutput}. The
 * command reads the same report `report-check` reads and refuses one that
 * check would refuse, printing nothing on stdout, so a caller can never parse
 * half a list. It writes nothing and calls no tracker.
 * @module controls/commands/gaps
 */
import path from "node:path";

import type { Command } from "commander";

import {
  loadAuditReport,
  resolveRepositoryRoot,
} from "../audit-report-file.js";
import {
  AUDIT_REPORT_JSON_PATH,
  describeScope,
  type AuditFinding,
  type AuditReport,
} from "../audit-report.js";
import type { InScopeCriterion } from "../catalogue.js";
import { controlGapKey, controlGapMarker } from "../control-gap-marker.js";
import { readConfiguredTracker } from "../tracker-config.js";
import { openTrackerQuestionId } from "../tracker-question.js";

/** The subcommand's name under `lisa controls`. */
export const GAPS_COMMAND = "gaps";

/** The version of {@link ControlGapsOutput}. A changed shape gets a new one. */
export const GAPS_SCHEMA_VERSION = 1;

/** The finding state this command lists. */
const MISSING = "missing";

/** The outcome of a requirement that cannot be ticketed. */
export const BLOCKED_OUTCOME = "blocked";

/** One requirement with nothing behind it, in one part of the repository. */
export interface ControlGap {
  /** Criterion id. For the marker and for joining results; never shown alone. */
  readonly criterion: string;
  /** The folder the finding is about; `.` is the whole repository. */
  readonly scope: string;
  /** The part in words: `whole repository`, or `folder <path>`. */
  readonly part: string;
  /** The requirement as the catalogue's plain question. */
  readonly question: string;
  /** What the audit found, in plain language. */
  readonly what: string;
  /** Why it matters, in plain language. */
  readonly why: string;
  /** What to do next, in plain language. */
  readonly next: string;
  /** The twelve hex characters a search for the ticket matches on. */
  readonly key: string;
  /** The line the ticket's description carries, exactly as it must appear. */
  readonly marker: string;
  /**
   * `blocked` when no ticket can be filed because there is no tracker.
   * `null` when a tracker is configured: the outcome is then the ticket
   * flow's to report, once it has looked for the ticket or filed it.
   */
  readonly outcome: typeof BLOCKED_OUTCOME | null;
}

/** Where tickets are filed, or why they cannot be. */
export interface ControlGapsTracker {
  /** Whether a tracker Lisa can file in is configured. */
  readonly configured: boolean;
  /** `jira`, `github` or `linear`; `null` when none is configured. */
  readonly name: string | null;
  /** What is wrong and what to do, in plain words; `null` when configured. */
  readonly problem: string | null;
  /**
   * The id of the audit's open question about which tracker the team uses,
   * for pointing the operator at it. `null` when a tracker is configured, and
   * when the report holds no such unanswered question.
   */
  readonly question: string | null;
}

/** What `lisa controls gaps` prints on stdout. */
export interface ControlGapsOutput {
  readonly schema_version: typeof GAPS_SCHEMA_VERSION;
  /** The report the list was read from, relative to the repository root. */
  readonly report: string;
  readonly tracker: ControlGapsTracker;
  /** Catalogue order, then folder order. Empty when nothing is missing. */
  readonly gaps: readonly ControlGap[];
}

/** What the command needs from outside, each replaceable in a test. */
export interface GapsDependencies {
  /** The directory the path argument is resolved from. */
  readonly cwd?: string;
  /** The current time, used to judge whether evidence is still fresh. */
  readonly now?: Date;
  /** Where the JSON document goes, in one call. */
  readonly stdout?: (text: string) => void;
  /** Where problems go, one per call. */
  readonly stderr?: (line: string) => void;
}

/**
 * Order two findings by folder, the same way on every machine: by code unit,
 * with no locale involved.
 * @param left - A finding
 * @param right - Another
 * @returns Negative, zero or positive, as a sort expects
 */
function byScope(left: AuditFinding, right: AuditFinding): number {
  if (left.scope === right.scope) return 0;
  return left.scope < right.scope ? -1 : 1;
}

/**
 * List the missing capabilities of a validated report.
 *
 * The outcome of each is left open; {@link runGaps} closes it when there is no
 * tracker.
 * @param report - A report that passed validation
 * @param criteria - The in-scope criteria, in catalogue order
 * @returns One entry per finding in state `missing`, in catalogue order and
 *   then folder order
 */
export function listControlGaps(
  report: AuditReport,
  criteria: readonly InScopeCriterion[]
): readonly ControlGap[] {
  const missing = report.findings.filter(finding => finding.state === MISSING);
  return criteria.flatMap(criterion =>
    missing
      .filter(finding => finding.criterion === criterion.id)
      .sort(byScope)
      .map(finding => ({
        criterion: finding.criterion,
        scope: finding.scope,
        part: describeScope(finding.scope),
        question: criterion.question,
        what: finding.what,
        why: finding.why,
        next: finding.next,
        key: controlGapKey(finding.criterion, finding.scope),
        marker: controlGapMarker(finding.criterion, finding.scope),
        outcome: null,
      }))
  );
}

/**
 * Count things in words.
 * @param count - How many
 * @param noun - What they are, singular
 * @returns For example `1 problem` or `3 problems`
 */
function counted(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * List the missing capabilities of one repository.
 * @param targetPath - The repository; the working directory when left out
 * @param dependencies - Replaceable collaborators
 * @returns The exit code: 0 when the list was printed, 1 when the report could
 *   not be relied on and nothing was printed on stdout
 */
export async function runGaps(
  targetPath: string | undefined,
  dependencies: GapsDependencies = {}
): Promise<number> {
  const stdout =
    dependencies.stdout ?? (text => process.stdout.write(`${text}\n`));
  const stderr =
    dependencies.stderr ?? (line => process.stderr.write(`${line}\n`));
  const fail = (problems: readonly string[]): number => {
    problems.forEach(problem => {
      stderr(problem.replaceAll(/\s+/gu, " "));
    });
    stderr(
      `gaps: FAIL. ${counted(problems.length, "problem")} in ${AUDIT_REPORT_JSON_PATH}; nothing was listed. Run \`lisa controls report-check\`, fix the report, then run this again`
    );
    return 1;
  };

  const named = path.resolve(
    dependencies.cwd ?? process.cwd(),
    targetPath ?? "."
  );
  const root = await resolveRepositoryRoot(named);
  if (root === null) {
    return fail([
      `${targetPath ?? named} is not a folder. Give the path of the repository to list from.`,
    ]);
  }
  const loaded = await loadAuditReport(root, dependencies.now ?? new Date());
  if (loaded.problems !== null) return fail(loaded.problems);

  const configured = await readConfiguredTracker(root);
  const output: ControlGapsOutput = {
    schema_version: GAPS_SCHEMA_VERSION,
    report: AUDIT_REPORT_JSON_PATH,
    tracker: {
      ...configured,
      question: configured.configured
        ? null
        : openTrackerQuestionId(loaded.document),
    },
    gaps: listControlGaps(loaded.report, loaded.criteria).map(gap =>
      configured.configured ? gap : { ...gap, outcome: BLOCKED_OUTCOME }
    ),
  };
  stdout(JSON.stringify(output, null, 2));
  return 0;
}

/** The collaborator the registration needs, replaceable in a test. */
export interface GapsCommandDependencies {
  readonly runGaps: (targetPath: string | undefined) => Promise<number>;
}

/**
 * Register `gaps` under the `lisa controls` group.
 * @param group - The `controls` command
 * @param dependencies - Replaceable collaborators
 */
export function registerGaps(
  group: Command,
  dependencies: GapsCommandDependencies = {
    runGaps: targetPath => runGaps(targetPath),
  }
): void {
  group
    .command(GAPS_COMMAND)
    .description(
      `List the requirements ${AUDIT_REPORT_JSON_PATH} reports as missing, as JSON, each with the marker its ticket carries`
    )
    .argument("[path]", "Project path (default: current directory)")
    .action(async (targetPath: string | undefined) => {
      const code = await dependencies.runGaps(targetPath);
      if (code !== 0) process.exitCode = code;
    });
}

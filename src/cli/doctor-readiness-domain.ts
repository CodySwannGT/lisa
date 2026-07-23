/**
 * The domain-ownership readiness producer — ship blocker B1 (PRD #1739, #1896).
 *
 * Dimension 3 of the `readiness-rubric` asks whether the business rules,
 * glossary, and danger zones are owned and written down. B1 asks the sharpest
 * consequence of getting that wrong: does a realistic path destroy or corrupt
 * data with no error surfaced and no way back?
 *
 * That question is the hardest one in the rubric to answer honestly offline, and
 * getting it wrong is expensive in exactly one direction. A standing blocker
 * flips the whole repository to `NOT_READY` regardless of this dimension's
 * status — `WARN` is a confidence signal to a human reader, never a softener —
 * so a false B1 on an ordinary brownfield repository would destroy the trust
 * this entire feature exists to build. Three disciplines follow:
 *
 * 1. **Only an unambiguous, automated, ungated, unrecoverable destruction of
 *    data stands B1.** The command must irreversibly destroy *data* (not build
 *    output), inside a job an automated trigger reaches, with no `if:`, no
 *    `environment:`, no backup step beside it, and no checked-in runbook.
 * 2. **Presence of a destructive surface is never a violation.** A `migrations/`
 *    directory, a reversible migration that drops a table, a guarded command, a
 *    manually dispatched workflow, or a command aimed at an ephemeral CI target
 *    are all reported as observations at most.
 * 3. **The clean case is a stated SKIP, never PASS.** Whether the danger zones
 *    are genuinely owned and written down cannot be established by reading
 *    files; claiming PASS would be the same overstatement B6 exists to catch.
 * @module cli/doctor-readiness-domain
 */
import {
  describeCommands,
  hasCheckedInRunbook,
  looksEphemeral,
  type OperationScan,
  scanCommands,
  type ScannedCommand,
} from "./doctor-readiness-operations.js";
import { informationalFindings } from "./doctor-readiness-shared.js";
import type { ReadinessDimensionRecord } from "./doctor-readiness-types.js";
import {
  type ParsedWorkflow,
  type ParsedWorkflowJob,
  parseRepositoryWorkflows,
  type ParsedWorkflowStep,
} from "./doctor-readiness-workflows.js";

/** The domain-ownership readiness dimension id (readiness-rubric, RRR-1). */
export const DOMAIN_OWNERSHIP_DIMENSION_ID = "domain-ownership";

/** The ship blocker for a realistic path that causes silent data loss. */
const DOMAIN_BLOCKER_ID = "B1";

/** Most destructive commands quoted in one finding before summarizing. */
const MAX_EVIDENCE_COMMANDS = 10;

/**
 * Commands that irreversibly destroy stored data. Every entry is a whole
 * operation, not a keyword: `rm -rf` is deliberately absent because build
 * outputs and caches dominate its real-world use, and a blocker built on it
 * would fire on nearly every repository that cleans a `dist/` directory.
 */
const IRREVERSIBLE_DATA_OPS: readonly RegExp[] = [
  /\brails\s+db:(drop|reset)\b/,
  /\bprisma\s+migrate\s+reset\b[^\n]*--force\b/,
  /\bredis-cli\b[^\n]*\bflushall\b/i,
  /\bkubectl\s+delete\s+(namespace|pvc)\b/,
  /\bgcloud\s+sql\s+instances\s+delete\b/,
  /\baz\s+group\s+delete\b/,
  /\b(mongo|mongosh)\b[^\n]*\bdropdatabase\s*\(/i,
  /\bdrop\s+database\b/i,
  /\bdrop\s+schema\b/i,
  /\bdrop\s+table\b/i,
  /\btruncate\s+table\b/,
  /\baws\s+s3\s+rm\b[^\n]*--recursive\b/,
  /\baws\s+s3\s+rb\b[^\n]*--force\b/,
  /\baws\s+dynamodb\s+delete-table\b/,
  /\baws\s+rds\s+delete-db-(instance|cluster)\b[^\n]*--skip-final-snapshot\b/,
];

/** Commands that create the way back: a copy taken before the destruction. */
const RECOVERY_COMMANDS: readonly RegExp[] = [
  /\bpg_dump\b/,
  /\bmysqldump\b/,
  /\bbackup\b/,
  /\bsnapshot\b/,
  /\baws\s+s3\s+sync\b/,
];

/** Local endpoints that corroborate a command targets job-owned CI state. */
const LOCAL_SERVICE_TARGETS: readonly RegExp[] = [
  /\blocalhost\b/,
  /\b127\.0\.0\.1\b/,
];

/**
 * Escape a literal string for use inside a regular expression.
 * @param value - Literal value to escape
 * @returns Regex-safe literal
 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Whether a command/env blob names the concrete service hostname.
 * @param command - Lower-cased command and environment text
 * @param service - Lower-cased service id
 * @returns True when the service appears as its own host/token
 */
function namesServiceHost(command: string, service: string): boolean {
  return new RegExp(
    `(^|[\\s:/@="'(,])${escapeRegExp(service)}($|[\\s:/;),'"?])`
  ).test(command);
}

/**
 * Whether a command irreversibly destroys data that is not obviously throwaway.
 *
 * The ephemeral screen reads the job's `env:` block alongside the command,
 * because the evidence is routinely outside the command text: `psql
 * "$DATABASE_URL" -c "DROP SCHEMA public CASCADE"` says nothing on its own,
 * while the `DATABASE_URL` it expands to may point at `127.0.0.1` and settle the
 * question outright.
 * @param command - The lower-cased `run` command
 * @param job - The job the command runs in
 * @returns True when the command is an unambiguous data-destroying operation
 */
function destroysData(command: string, job: ParsedWorkflowJob): boolean {
  return (
    IRREVERSIBLE_DATA_OPS.some(pattern => pattern.test(command)) &&
    !looksEphemeral(`${command}\n${job.env}`)
  );
}

/**
 * Whether the command plausibly targets one of the job's own `services:`
 * containers. A service only defers the step it can explain; an unrelated
 * container in the same job must not hide a durable destructive target.
 * @param job - The job to consider
 * @param step - The destructive step being classified
 * @returns True when the command plausibly points at a job-local service
 */
function commandTargetsOwnedService(
  job: ParsedWorkflowJob,
  step: ParsedWorkflowStep
): boolean {
  if (job.services.length === 0) {
    return false;
  }
  const command = `${step.run}\n${job.env}`.toLowerCase();
  return (
    LOCAL_SERVICE_TARGETS.some(pattern => pattern.test(command)) ||
    job.services.some(service =>
      namesServiceHost(command, service.toLowerCase())
    )
  );
}

/**
 * State why a service-targeted command cannot be settled. A job that starts its
 * own database is operating on state it created moments earlier, so destroying
 * it is not data loss — but proving that the command targets that service is
 * still beyond an offline read, so this is deferred, not cleared.
 * @param _workflow - The workflow declaring the job; unused for this deferral
 * @param job - The job to consider
 * @param step - The destructive step being classified
 * @returns A stated reason, or null when the service does not explain the step
 */
function servicesDeferral(
  _workflow: ParsedWorkflow,
  job: ParsedWorkflowJob,
  step: ParsedWorkflowStep
): string | null {
  if (!commandTargetsOwnedService(job, step)) {
    return null;
  }
  return (
    `Job \`${job.id}\` runs a destructive data operation while starting its own ` +
    `\`services:\` container(s) (${job.services.join(", ")}), which are created ` +
    "and thrown away inside the run, so whether the command targets durable " +
    "data is not established either way"
  );
}

/**
 * Whether a job takes its own copy before destroying anything — the way back,
 * sitting right beside the danger.
 * @param job - The parsed job
 * @returns True when any step in the job looks like a backup
 */
function jobTakesBackup(job: ParsedWorkflowJob): boolean {
  return job.steps.some(step =>
    RECOVERY_COMMANDS.some(pattern => pattern.test(step.run.toLowerCase()))
  );
}

/**
 * Build the rubric-shaped B1 finding from the destructive commands it cites.
 * @param scan - The destructive-operation scan
 * @returns The B1 finding
 */
function domainFinding(scan: OperationScan): Record<string, unknown> {
  return {
    blocker: DOMAIN_BLOCKER_ID,
    invariant_violated:
      "no realistic path destroys or corrupts data without surfacing an error " +
      "and leaving a way back",
    evidence: describeCommands(scan.ungated, MAX_EVIDENCE_COMMANDS),
    why_proof_missed:
      "the destructive command is exercised only against real data, so no test " +
      "run and no review step ever observes what it removes — the pipeline " +
      "reports green whether the data survived or not",
    root_correction:
      "put the operation behind an explicit gate (a job `environment:` or a " +
      "confirmation input) and give it a way back — a snapshot taken in the " +
      "same job, or a checked-in runbook naming the restore procedure",
    machinery_to_remove: [
      "any unattended destructive step that exists only because no retention " +
        "or lifecycle policy was configured on the store itself",
    ],
  };
}

/**
 * State why the dimension was not settled, naming what WAS looked at so an
 * operator can tell "nothing to report" from "never looked".
 * @param inspected - How many workflow files were read
 * @param runbook - Whether a runbook is checked in
 * @returns The SKIP reason
 */
function skipReason(inspected: number, runbook: boolean): string {
  if (inspected === 0) {
    return (
      "No GitHub Actions workflow files were found under `.github/workflows/`, " +
      "so no irreversible data-destroying operations could be assessed from " +
      "workflow declarations (recovery runbook " +
      `${runbook ? "present" : "absent"}). Whether this ` +
      "repository's business rules, glossary, and danger zones are genuinely " +
      "owned and written down cannot be established by reading files offline — " +
      "that needs the agent-ready domain phase — so domain ownership is not " +
      "established either way."
    );
  }
  return (
    `Read ${inspected} workflow file(s) for irreversible data-destroying ` +
    "operations and found none that this file alone proves runs unattended, " +
    `ungated, and with no way back (recovery runbook ` +
    `${runbook ? "present" : "absent"}). Whether this ` +
    "repository's business rules, glossary, and danger zones are genuinely " +
    "owned and written down cannot be established by reading files offline — " +
    "that needs the agent-ready domain phase — so domain ownership is not " +
    "established either way."
  );
}

/**
 * Build the SKIP record, carrying every guarded destructive operation as an
 * observation. Those observations name no `blocker`: they are the operator's
 * map of where the danger lives, not a verdict about it.
 * @param guarded - The destructive commands something already guards
 * @param scan - The destructive-operation scan
 * @param inspected - How many workflow files were read
 * @param runbook - Whether a runbook is checked in
 * @returns The SKIP dimension record
 */
function skipRecord(
  guarded: readonly ScannedCommand[],
  scan: OperationScan,
  inspected: number,
  runbook: boolean
): ReadinessDimensionRecord {
  return {
    id: DOMAIN_OWNERSHIP_DIMENSION_ID,
    status: "SKIP",
    findings: [
      { reason: skipReason(inspected, runbook), skip: true },
      ...informationalFindings([
        ...guarded.map(
          entry =>
            `\`${entry.workflow}\` job \`${entry.jobId}\` runs a destructive ` +
            `operation (\`${entry.command}\`) behind a gate, beside its own ` +
            "backup, or in a repository that checks in a recovery runbook, so " +
            "it was not treated as a silent-data-loss path"
        ),
        ...scan.unresolved,
      ]),
    ],
  };
}

/**
 * Assess the domain-ownership dimension: B1, "a realistic path causes silent
 * data loss". Offline by construction — it reads only the repository's declared
 * workflows — and deliberately conservative: it stands B1 only when a workflow
 * file alone proves an irreversible data-destroying command runs unattended,
 * ungated, and with no way back, and renders a stated-reason SKIP in every other
 * case, including the clean one.
 * @param root - Project root to assess
 * @param parsedWorkflows - Pre-parsed workflows (default: parse `root`)
 * @returns The domain-ownership dimension record
 */
export async function assessDomainOwnershipDimension(
  root: string,
  parsedWorkflows?: readonly ParsedWorkflow[]
): Promise<ReadinessDimensionRecord> {
  const workflows: readonly ParsedWorkflow[] =
    parsedWorkflows ?? (await parseRepositoryWorkflows(root));
  const scan = scanCommands(workflows, destroysData, {
    exemptJob: jobTakesBackup,
    unresolvedStep: servicesDeferral,
  });
  // A checked-in runbook is a way back, so it clears the "no recovery" half of
  // B1 for the whole repository — the blocker asks for BOTH halves at once.
  const recoverable = await hasCheckedInRunbook(root);
  if (scan.ungated.length === 0 || recoverable) {
    return skipRecord(
      recoverable ? [...scan.gated, ...scan.ungated] : scan.gated,
      scan,
      workflows.length,
      recoverable
    );
  }
  return {
    id: DOMAIN_OWNERSHIP_DIMENSION_ID,
    // `WARN` reports how much confidence an offline read can carry; it does NOT
    // soften the verdict. The blocker engine never reads this status, so the
    // finding below flips the repository to `NOT_READY` exactly as `FAIL` would.
    status: "WARN",
    findings: [domainFinding(scan), ...informationalFindings(scan.unresolved)],
  };
}

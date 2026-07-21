/**
 * The feedback/guardrails readiness producer — ship blocker B4 (PRD #1739,
 * #1896).
 *
 * Dimension 5 of the `readiness-rubric` asks whether a failing loop produces a
 * named outcome and a runbook. B4 asks the operational half: does every
 * irreversible or expensive operation have a gate AND a way back?
 *
 * Only part of that is answerable offline, and saying so plainly is the point.
 * Whether a declared GitHub `environment:` actually carries protection rules —
 * required reviewers, wait timers, branch restrictions — lives in the GitHub API,
 * not in any file this producer can read. That half is therefore a **stated
 * SKIP in every record emitted here**, never a guess in either direction.
 *
 * What remains is a narrow, file-provable subset: a job that runs an
 * irreversible or expensive operation with **no `environment:` key at all**, no
 * `if:` gate, reachable from an automated trigger, in a repository that checks
 * in no runbook. Only that stands B4. Everything else — an ordinary `cdk
 * deploy`, a CI-database migration, a job that names any environment, a reusable
 * workflow whose caller is invisible — is an observation at most, because a
 * standing blocker flips the whole repository to `NOT_READY` and `WARN` does not
 * soften that.
 * @module cli/doctor-readiness-guardrails
 */
import {
  describeCommands,
  hasCheckedInRunbook,
  type OperationScan,
  scanCommands,
} from "./doctor-readiness-operations.js";
import { informationalFindings } from "./doctor-readiness-shared.js";
import type { ReadinessDimensionRecord } from "./doctor-readiness-types.js";
import {
  type ParsedWorkflow,
  parseRepositoryWorkflows,
} from "./doctor-readiness-workflows.js";

/** The feedback/guardrails readiness dimension id (readiness-rubric, RRR-1). */
export const FEEDBACK_GUARDRAILS_DIMENSION_ID = "feedback-guardrails";

/** The ship blocker for a consequential operation with no gate and no recovery. */
const GUARDRAILS_BLOCKER_ID = "B4";

/** Most operations quoted in one finding before summarizing the remainder. */
const MAX_EVIDENCE_COMMANDS = 10;

/**
 * The half of B4 no offline read can settle, stated in every record this
 * producer emits so an operator is never left to infer that a declared
 * environment was checked for protection rules. It was not.
 */
const PROTECTION_RULES_SKIP_REASON =
  "Whether a declared `environment:` actually gates anything — required " +
  "reviewers, wait timers, branch restrictions — is a GitHub environment " +
  "protection rule, which lives in the GitHub API and is not resolvable " +
  "offline. That half of this question was deliberately not assessed; only the " +
  "file-provable half (an irreversible or expensive operation with no " +
  "`environment:` key at all and no checked-in runbook) was.";

/**
 * Operations that are irreversible or expensive enough that running them
 * unattended is a decision, not a detail. `cdk deploy` and a plain `terraform
 * apply` are absent on purpose: they are how normal delivery works, and a
 * blocker that fires on normal delivery is a blocker nobody will believe.
 */
const CONSEQUENTIAL_OPS: readonly RegExp[] = [
  /\bterraform\s+(\S+\s+)*apply\b[^\n]*-auto-approve\b/,
  /\bterraform\s+(\S+\s+)*destroy\b/,
  /\bcdk\s+destroy\b/,
  /\bpulumi\s+destroy\b/,
  /\bpulumi\s+up\b[^\n]*--yes\b/,
  /\bserverless\s+remove\b/,
];

/** Commands that apply schema migrations, in the ecosystems Lisa templates. */
const MIGRATION_COMMANDS: readonly RegExp[] = [
  /\bdb:migrate\b/,
  /\bmigrate\s+deploy\b/,
  /\bmigration:run\b/,
  /\balembic\s+upgrade\b/,
];

/**
 * Markers that a command explicitly targets production. A migration is only
 * consequential when the file itself says it runs against production: the same
 * command against a CI service container is ordinary test setup, and treating
 * the two alike is the false positive that would discredit this whole check.
 */
const PRODUCTION_MARKERS: readonly RegExp[] = [
  /\b(rails_env|node_env|app_env|django_settings_module|environment)=[^\s]*prod/,
  /--env(ironment)?[= ]prod/,
  /\bprod(uction)?\.tfvars\b/,
];

/**
 * Whether a command is an irreversible or expensive operation.
 * @param command - The lower-cased `run` command
 * @returns True when the command is consequential on its face
 */
function isConsequential(command: string): boolean {
  return (
    CONSEQUENTIAL_OPS.some(pattern => pattern.test(command)) ||
    (MIGRATION_COMMANDS.some(pattern => pattern.test(command)) &&
      PRODUCTION_MARKERS.some(pattern => pattern.test(command)))
  );
}

/**
 * Build the rubric-shaped B4 finding from the operations it cites.
 * @param scan - The consequential-operation scan
 * @returns The B4 finding
 */
function guardrailsFinding(scan: OperationScan): Record<string, unknown> {
  return {
    blocker: GUARDRAILS_BLOCKER_ID,
    invariant_violated:
      "every irreversible or expensive operation has a gate before it and a " +
      "way back after it",
    evidence: describeCommands(scan.ungated, MAX_EVIDENCE_COMMANDS),
    why_proof_missed:
      "the job declares no `environment:` at all, so there is nothing for a " +
      "protection rule to attach to and nothing for an operator to approve — " +
      "and with no runbook checked in, the first time anyone works out how to " +
      "undo the operation is while it is already failing",
    root_correction:
      "declare an `environment:` on the job so a protection rule can gate it, " +
      "and check in a runbook naming the recovery procedure and the run " +
      "outcome the loop reports, per the `automation-runbook-contract` rule",
    machinery_to_remove: [
      "auto-approval flags that exist only because no approval gate was ever " +
        "configured for the environment the job deploys to",
    ],
  };
}

/**
 * Build the SKIP record. Its first finding always states the network-bound half
 * that was not assessed; the observations below it carry whatever consequential
 * operations were found to be already gated.
 * @param scan - The consequential-operation scan
 * @param inspected - How many workflow files were read
 * @param runbook - Whether a runbook is checked in
 * @returns The SKIP dimension record
 */
function skipRecord(
  scan: OperationScan,
  inspected: number,
  runbook: boolean
): ReadinessDimensionRecord {
  return {
    id: FEEDBACK_GUARDRAILS_DIMENSION_ID,
    status: "SKIP",
    findings: [
      {
        reason:
          `Read ${inspected} workflow file(s) for irreversible or expensive ` +
          "operations and found none that this file alone proves runs " +
          `unattended with no gate and no way back (recovery runbook ` +
          `${runbook ? "present" : "absent"}). ${PROTECTION_RULES_SKIP_REASON}`,
        skip: true,
      },
      ...informationalFindings([
        ...scan.gated.map(
          entry =>
            `\`${entry.workflow}\` job \`${entry.jobId}\` runs a consequential ` +
            `operation (\`${entry.command}\`) behind a declared environment, an ` +
            "`if:` condition, its own confirmation switch, or in a repository " +
            "that checks in a recovery runbook, so it was not treated as " +
            "ungated and unrecoverable — whether any such gate carries " +
            "protection rules was not checked"
        ),
        ...scan.unresolved,
      ]),
    ],
  };
}

/**
 * Assess the feedback/guardrails dimension: B4, "a consequential operation has
 * no gate and no recovery". Offline by construction, and honest about it — the
 * environment-protection-rule half is reasoned-SKIPped in every record, so this
 * dimension never reports `PASS`. B4 stands only on the file-provable subset.
 * @param root - Project root to assess
 * @param parsedWorkflows - Pre-parsed workflows (default: parse `root`)
 * @returns The feedback/guardrails dimension record
 */
export async function assessFeedbackGuardrailsDimension(
  root: string,
  parsedWorkflows?: readonly ParsedWorkflow[]
): Promise<ReadinessDimensionRecord> {
  const workflows: readonly ParsedWorkflow[] =
    parsedWorkflows ?? (await parseRepositoryWorkflows(root));
  const scan = scanCommands(workflows, isConsequential);
  const runbook = await hasCheckedInRunbook(root);
  if (scan.ungated.length === 0 || runbook) {
    return skipRecord(
      runbook ? { ...scan, gated: [...scan.gated, ...scan.ungated] } : scan,
      workflows.length,
      runbook
    );
  }
  return {
    id: FEEDBACK_GUARDRAILS_DIMENSION_ID,
    // `WARN` reports how much confidence an offline read can carry; it does NOT
    // soften the verdict. The blocker engine never reads this status.
    status: "WARN",
    findings: [
      guardrailsFinding(scan),
      // The unassessable half must travel with the standing blocker too:
      // dropping it here would let a reader believe the gate was checked.
      ...informationalFindings([
        PROTECTION_RULES_SKIP_REASON,
        ...scan.unresolved,
      ]),
    ],
  };
}

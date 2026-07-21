/**
 * The delivery/authority readiness producer — ship blockers B2 and B3
 * (PRD #1739, #1896).
 *
 * Dimension 7 of the `readiness-rubric` asks two questions no other dimension
 * can answer: does the thing that ships equal the thing that was validated
 * (B2), and does the shipping credential carry only the authority it needs
 * (B3)? Both are answered offline from the repository's own
 * `.github/workflows/*.yml` declarations — the release path is a property of
 * what CI declares, so no network call is needed and none is made.
 *
 * Two disciplines are load-bearing rather than stylistic:
 *
 * 1. **A finding names a `blocker` id ONLY on an actual violation.** The blocker
 *    engine stands a blocker up on any finding that names an id and carries
 *    evidence, regardless of the finding's status — so a clean repository's PASS
 *    finding must carry no `blocker` key, or a healthy repository reports
 *    NOT_READY.
 * 2. **Never manufacture RED from absence.** Reading workflow files offline
 *    cannot see a calling workflow, an upstream `workflow_run`, or a branch
 *    protection rule. When the file alone does not prove a bypass, this producer
 *    renders a stated-reason SKIP — including when the repository publishes
 *    nothing at all, because "nothing ships here" is not proof that what ships
 *    was validated.
 * @module cli/doctor-readiness-delivery
 */
import {
  type CredentialFindings,
  detectCredentialFindings,
} from "./doctor-readiness-credentials.js";
import { informationalFindings } from "./doctor-readiness-shared.js";
import {
  assessReleasePath,
  PROMOTION_ACTION,
  type ReleasePathOutcome,
} from "./doctor-readiness-release-path.js";
import type { ReadinessDimensionRecord } from "./doctor-readiness-types.js";
import {
  type ParsedWorkflow,
  parseRepositoryWorkflows,
} from "./doctor-readiness-workflows.js";

/** The delivery/authority readiness dimension id (readiness-rubric, RRR-1). */
export const DELIVERY_AUTHORITY_DIMENSION_ID = "delivery-authority";

/** The ship blocker for a release path that bypasses the validated artifact. */
const RELEASE_BLOCKER_ID = "B2";

/** The ship blocker for credentials carrying material unintended authority. */
const CREDENTIAL_BLOCKER_ID = "B3";

/** Everything one readiness pass established about the release paths. */
interface ReleasePathSummary {
  readonly violations: readonly string[];
  readonly unresolved: readonly string[];
  readonly cleanCount: number;
  readonly publishJobCount: number;
}

/**
 * Assess every publishing job across every workflow.
 * @param workflows - Parsed workflows
 * @returns What the release paths established, in aggregate
 */
function summarizeReleasePaths(
  workflows: readonly ParsedWorkflow[]
): ReleasePathSummary {
  const outcomes: readonly ReleasePathOutcome[] = workflows.flatMap(workflow =>
    workflow.jobs.flatMap(job => {
      const outcome = assessReleasePath(workflow, job);
      return outcome ? [outcome] : [];
    })
  );
  return {
    violations: outcomes.flatMap(outcome =>
      outcome.kind === "violation" ? [outcome.evidence] : []
    ),
    unresolved: outcomes.flatMap(outcome =>
      outcome.kind === "unresolved" ? [outcome.reason] : []
    ),
    cleanCount: outcomes.filter(outcome => outcome.kind === "clean").length,
    publishJobCount: outcomes.length,
  };
}

/**
 * Build the B2 finding from its evidence lines.
 * @param violations - Evidence lines
 * @returns The rubric-shaped B2 finding
 */
function releaseFinding(
  violations: readonly string[]
): Record<string, unknown> {
  return {
    blocker: RELEASE_BLOCKER_ID,
    invariant_violated:
      "what ships to users is the exact artifact the validating pipeline checked",
    evidence: violations.join(" | "),
    why_proof_missed:
      "the existing checks prove things about the source tree, not about the " +
      "artifact the release path actually hands to users, so a release that " +
      "skips or rebuilds past them still reports green",
    root_correction:
      "make the release job depend on the validating jobs and publish only an " +
      `artifact downloaded via \`${PROMOTION_ACTION}\`, so the validated bytes ` +
      "are the only bytes that can ship",
    machinery_to_remove: [
      "any rebuild step inside the release job, which exists only because the " +
        "validated artifact was not carried forward",
    ],
  };
}

/**
 * Build the B3 finding from its evidence lines.
 * @param violations - Evidence lines
 * @returns The rubric-shaped B3 finding
 */
function credentialFinding(
  violations: readonly string[]
): Record<string, unknown> {
  return {
    blocker: CREDENTIAL_BLOCKER_ID,
    invariant_violated:
      "a shipping credential carries only the authority the job it runs needs",
    evidence: violations.join(" | "),
    why_proof_missed:
      "credential scope is declared, never exercised, so no test or review run " +
      "observes the unused authority a workflow silently carries",
    root_correction:
      "declare a minimal job-level `permissions:` block, map secrets explicitly " +
      "per environment instead of inheriting them, and prefer keyless OIDC over " +
      "long-lived static keys",
    machinery_to_remove: [
      "blanket permission grants and inherited secret blocks made unnecessary " +
        "by explicit per-job scoping",
    ],
  };
}

/**
 * Build the SKIP record for a repository whose release paths could not be
 * settled from the workflow files alone.
 * @param reasons - Stated reasons, one per unsettled release path
 * @param credentials - The credential half of the assessment
 * @returns The SKIP dimension record
 */
function unresolvedRecord(
  reasons: readonly string[],
  credentials: CredentialFindings
): ReadinessDimensionRecord {
  return {
    id: DELIVERY_AUTHORITY_DIMENSION_ID,
    status: "SKIP",
    findings: [
      { reason: reasons.join(" | "), skip: true },
      ...informationalFindings(credentials.informational),
    ],
  };
}

/**
 * Build the PASS record. It carries evidence of exactly what was inspected and
 * names no `blocker` — naming one here would stand the blocker up.
 * @param summary - What the release paths established
 * @param workflows - Parsed workflows
 * @param credentials - The credential half of the assessment
 * @returns The PASS dimension record
 */
function cleanRecord(
  summary: ReleasePathSummary,
  workflows: readonly ParsedWorkflow[],
  credentials: CredentialFindings
): ReadinessDimensionRecord {
  return {
    id: DELIVERY_AUTHORITY_DIMENSION_ID,
    status: "PASS",
    findings: [
      {
        evidence:
          `Inspected ${summary.publishJobCount} publishing job(s) across ` +
          `${workflows.length} workflow file(s): each is preceded by a test ` +
          `run or promotes the CI-built artifact via \`${PROMOTION_ACTION}\`. ` +
          "No workflow declares blanket permissions, inherited secrets, or " +
          "static cloud keys.",
        checked: [RELEASE_BLOCKER_ID, CREDENTIAL_BLOCKER_ID],
      },
      ...informationalFindings(credentials.informational),
    ],
  };
}

/**
 * Build the FAIL record from whichever halves found violations, ordered by
 * consequence: shipping unvalidated bytes outranks over-broad authority, because
 * it is already user-visible rather than latent.
 * @param summary - What the release paths established
 * @param credentials - The credential half of the assessment
 * @returns The FAIL dimension record
 */
function violationRecord(
  summary: ReleasePathSummary,
  credentials: CredentialFindings
): ReadinessDimensionRecord {
  return {
    id: DELIVERY_AUTHORITY_DIMENSION_ID,
    status: "FAIL",
    findings: [
      ...(summary.violations.length > 0
        ? [releaseFinding(summary.violations)]
        : []),
      ...(credentials.violations.length > 0
        ? [credentialFinding(credentials.violations)]
        : []),
      // A standing blocker must not swallow the release paths that could not be
      // settled offline: dropping those reasons is #1898's defect one layer in.
      // They carry no `blocker` key, so they add nothing to the verdict.
      ...informationalFindings(summary.unresolved),
      ...informationalFindings(credentials.informational),
    ],
  };
}

/**
 * Build the SKIP record for a repository that declares no workflows at all.
 * @returns The SKIP dimension record
 */
function noWorkflowsRecord(): ReadinessDimensionRecord {
  return {
    id: DELIVERY_AUTHORITY_DIMENSION_ID,
    status: "SKIP",
    findings: [
      {
        reason:
          "no .github/workflows/*.yml files were found, so this repository " +
          "declares no release path or shipping credential to assess; " +
          "delivery authority is not established either way",
        skip: true,
      },
    ],
  };
}

/**
 * Build the SKIP record for a repository whose workflows publish nothing.
 * @param workflows - Parsed workflows
 * @param credentials - The credential half of the assessment
 * @returns The SKIP dimension record
 */
function noReleasePathRecord(
  workflows: readonly ParsedWorkflow[],
  credentials: CredentialFindings
): ReadinessDimensionRecord {
  return {
    id: DELIVERY_AUTHORITY_DIMENSION_ID,
    status: "SKIP",
    findings: [
      {
        reason:
          `None of the ${workflows.length} workflow file(s) declares a ` +
          "publishing or deploy step, so whether what ships equals what was " +
          "validated is not established either way. Credential scope was " +
          "assessed and found nothing over-authorized.",
        skip: true,
      },
      ...informationalFindings(credentials.informational),
    ],
  };
}

/**
 * Assess the delivery/authority dimension: B2 (release path bypasses the
 * validated artifact) and B3 (credentials carry unintended authority). Offline
 * by construction — it reads only the repository's declared workflows, and
 * degrades to a stated-reason SKIP wherever those files cannot settle the
 * question.
 * @param root - Project root to assess
 * @param parsedWorkflows - Pre-parsed workflows (default: parse `root`)
 * @returns The delivery/authority dimension record
 */
export async function assessDeliveryAuthorityDimension(
  root: string,
  parsedWorkflows?: readonly ParsedWorkflow[]
): Promise<ReadinessDimensionRecord> {
  const workflows = parsedWorkflows ?? (await parseRepositoryWorkflows(root));
  if (workflows.length === 0) {
    return noWorkflowsRecord();
  }
  const summary = summarizeReleasePaths(workflows);
  const credentials = detectCredentialFindings(workflows);
  if (summary.violations.length > 0 || credentials.violations.length > 0) {
    return violationRecord(summary, credentials);
  }
  if (summary.unresolved.length > 0) {
    return unresolvedRecord(summary.unresolved, credentials);
  }
  if (summary.publishJobCount === 0) {
    return noReleasePathRecord(workflows, credentials);
  }
  return cleanRecord(summary, workflows, credentials);
}

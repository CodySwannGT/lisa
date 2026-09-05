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
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import {
  type CredentialFindings,
  detectCredentialFindings,
} from "./doctor-readiness-credentials.js";
import { deployOutcomeObservations } from "./doctor-readiness-deploy-outcome.js";
import { informationalFindings } from "./doctor-readiness-shared.js";
import {
  assessReleasePaths,
  PROMOTION_ACTION,
  type ReleasePathOutcome,
} from "./doctor-readiness-release-path.js";
import { unpinnedPublishingActionViolations } from "./doctor-readiness-action-pins.js";
import type { ReadinessDimensionRecord } from "./doctor-readiness-types.js";
import {
  type ParsedWorkflow,
  parseRepositoryWorkflows,
} from "./doctor-readiness-workflows.js";
import { isJsonObject } from "../sync/json-path.js";

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
  readonly publishStepCount: number;
  /**
   * Deploy jobs that go SILENT when their release fails (#3740).
   *
   * Carried on this summary rather than added at one call site because it has
   * to reach EVERY record shape below. A repository whose release paths are
   * clean, or whose workflows publish nothing this parser can see, is exactly
   * the repository where this observation would otherwise be dropped — and
   * dropping a finding on the healthy path is how a check ends up reporting
   * nothing in the case it was written for.
   */
  readonly deployOutcomeObservations: readonly string[];
}

/**
 * Assess every publishing job across every workflow.
 * @param workflows - Parsed workflows
 * @param defaultBranches - Project-local default-like branch names
 * @returns What the release paths established, in aggregate
 */
function summarizeReleasePaths(
  workflows: readonly ParsedWorkflow[],
  defaultBranches?: readonly string[]
): ReleasePathSummary {
  const outcomes: readonly ReleasePathOutcome[] = workflows.flatMap(workflow =>
    workflow.jobs.flatMap(job =>
      assessReleasePaths(workflow, job, defaultBranches, workflows)
    )
  );
  const unpinnedActionViolations = workflows.flatMap(workflow =>
    workflow.jobs.flatMap(job =>
      unpinnedPublishingActionViolations(workflow, job, workflows)
    )
  );
  return {
    deployOutcomeObservations: deployOutcomeObservations(workflows),
    violations: [
      ...outcomes.flatMap(outcome =>
        outcome.kind === "violation" ? [outcome.evidence] : []
      ),
      ...unpinnedActionViolations,
    ],
    unresolved: outcomes.flatMap(outcome =>
      outcome.kind === "unresolved" ? [outcome.reason] : []
    ),
    cleanCount: outcomes.filter(outcome => outcome.kind === "clean").length,
    publishStepCount: outcomes.length,
  };
}

/**
 * Resolve the repository's local `.git` directory. Worktrees store this as a
 * pointer file, while ordinary checkouts use a directory.
 * @param root - Project root to inspect
 * @returns The resolved git directory path, or null when it cannot be read
 */
async function localGitDir(root: string): Promise<string | null> {
  const dotGit = path.join(root, ".git");
  try {
    const marker = await readFile(dotGit, "utf8");
    const trimmed = marker.trim();
    const prefix = "gitdir:";
    if (!trimmed.toLowerCase().startsWith(prefix)) {
      return null;
    }
    const target = trimmed.slice(prefix.length).trim();
    return path.isAbsolute(target) ? target : path.resolve(root, target);
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EISDIR" ? dotGit : null;
  }
}

/**
 * Resolve where shared refs live for a gitdir. Linked worktrees keep refs in
 * the common directory named by `commondir`; ordinary repositories do not.
 * @param gitDir - The resolved `.git` or per-worktree gitdir
 * @returns The directory that owns shared refs
 */
async function commonGitDir(gitDir: string): Promise<string> {
  try {
    const raw = await readFile(path.join(gitDir, "commondir"), "utf8");
    const target = raw.trim();
    return path.isAbsolute(target) ? target : path.resolve(gitDir, target);
  } catch {
    return gitDir;
  }
}

/**
 * Read the default branch cached by git's local `origin/HEAD` symbolic ref.
 * This is best-effort and does not fetch; if the ref is absent, callers fall
 * back to Lisa config and built-in branch names.
 * @param root - Project root to inspect
 * @returns The local remote-default branch name when available
 */
async function gitDefaultBranch(root: string): Promise<string | null> {
  const gitDir = await localGitDir(root);
  if (!gitDir) {
    return null;
  }
  const refsGitDir = await commonGitDir(gitDir);
  try {
    const raw = await readFile(
      path.join(refsGitDir, "refs", "remotes", "origin", "HEAD"),
      "utf8"
    );
    const trimmed = raw.trim();
    const prefix = "ref: refs/remotes/origin/";
    return trimmed.startsWith(prefix) ? trimmed.slice(prefix.length) : null;
  } catch {
    return null;
  }
}

/**
 * Read Lisa's configured production branch hint.
 * @param root - Project root to inspect
 * @returns A one-item branch list, or empty when no hint exists
 */
async function configDefaultBranches(root: string): Promise<readonly string[]> {
  try {
    const raw = await readFile(path.join(root, ".lisa.config.json"), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!isJsonObject(parsed) || !isJsonObject(parsed.deploy)) {
      return [];
    }
    const deployBranches = parsed.deploy.branches;
    return isJsonObject(deployBranches) &&
      typeof deployBranches.production === "string"
      ? [deployBranches.production]
      : [];
  } catch {
    return [];
  }
}

/**
 * Read local default-branch hints Lisa can establish offline. This stays
 * best-effort: unreadable or unusual config/git metadata falls back to the
 * built-in `main`/`master` defaults in the release-path assessor.
 * @param root - Project root to inspect
 * @returns Configured default-like branch names
 */
async function configuredDefaultBranches(
  root: string
): Promise<readonly string[]> {
  const configBranches = await configDefaultBranches(root);
  const gitBranch = await gitDefaultBranch(root);
  const branches = gitBranch ? [...configBranches, gitBranch] : configBranches;
  return [...new Set(branches.map(branch => branch.trim()).filter(Boolean))];
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
 * @param summary - What the release paths established
 * @param credentials - The credential half of the assessment
 * @returns The SKIP dimension record
 */
function unresolvedRecord(
  summary: ReleasePathSummary,
  credentials: CredentialFindings
): ReadinessDimensionRecord {
  return {
    id: DELIVERY_AUTHORITY_DIMENSION_ID,
    status: "SKIP",
    findings: [
      { reason: summary.unresolved.join(" | "), skip: true },
      ...informationalFindings(summary.deployOutcomeObservations),
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
          `Inspected ${summary.publishStepCount} publishing step(s) across ` +
          `${workflows.length} workflow file(s): each is preceded by a test ` +
          `run or promotes the CI-built artifact via \`${PROMOTION_ACTION}\`. ` +
          "No workflow declares blanket permissions, inherited secrets, or " +
          "static cloud keys.",
        checked: [RELEASE_BLOCKER_ID, CREDENTIAL_BLOCKER_ID],
      },
      ...informationalFindings(summary.deployOutcomeObservations),
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
      ...informationalFindings(summary.deployOutcomeObservations),
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
 * @param summary - What the release paths established
 * @param credentials - The credential half of the assessment
 * @returns The SKIP dimension record
 */
function noReleasePathRecord(
  workflows: readonly ParsedWorkflow[],
  summary: ReleasePathSummary,
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
      ...informationalFindings(summary.deployOutcomeObservations),
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
  const summary = summarizeReleasePaths(
    workflows,
    await configuredDefaultBranches(root)
  );
  const credentials = detectCredentialFindings(workflows);
  if (summary.violations.length > 0 || credentials.violations.length > 0) {
    return violationRecord(summary, credentials);
  }
  if (summary.unresolved.length > 0) {
    return unresolvedRecord(summary, credentials);
  }
  if (summary.publishStepCount === 0) {
    return noReleasePathRecord(workflows, summary, credentials);
  }
  return cleanRecord(summary, workflows, credentials);
}

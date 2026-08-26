/**
 * @file doctor-nightly-e2e-guard-job.ts
 * @description Executable-field parsing for one reachable workflow job
 * @module cli/doctor-nightly-e2e-guard-job
 */
import {
  NIGHTLY_GUARD_CANONICAL_TARGET,
  type NightlyGuardScanFailure,
  type NightlyGuardWorkflowRecord,
  nightlyGuardObject,
  nightlyGuardText,
  normalizeNightlyGuardTarget,
} from "./doctor-nightly-e2e-guard-contract.js";
import {
  bypassBearingMapping,
  hasAnyNightlyGuardBypassEvidence,
  inspectNightlyGuardJobEvidence,
  type NightlyGuardJobEvidence,
} from "./doctor-nightly-e2e-guard-evidence.js";
import type { NightlyGuardRunInspection } from "./doctor-nightly-e2e-guard-shell.js";

const OFFICIAL_PREFIX =
  "CodySwannGT/lisa/.github/workflows/nightly-e2e-health.yml@";
const OFFICIAL_REF = /^[^\s${}]+$/u;
const LOCAL = /^\.\/\.github\/workflows\/([A-Za-z0-9._-]+\.ya?ml)$/u;

/** Supported active target resolved from one job. */
export interface NightlyGuardJobCaller {
  /** Direct Node invocation or Lisa's exact official reusable endpoint. */
  readonly kind: "official-reusable" | "direct";
  /** Literal normalized target path. */
  readonly target: string;
}

/** Executable interpretation of one reachable job. */
export interface NightlyGuardJobInspection {
  /** Guard caller when this job directly invokes one. */
  readonly caller?: NightlyGuardJobCaller;
  /** Local reusable basename when this job calls one. */
  readonly local?: string;
  /** Fail-closed ambiguity or unsupported syntax. */
  readonly failure?: NightlyGuardScanFailure;
}

const failure = (
  workflow: NightlyGuardWorkflowRecord,
  reason: string
): NightlyGuardScanFailure => ({ workflow: workflow.file, reason });

const indirectReusableBypassEvidence = (
  evidence: NightlyGuardJobEvidence
): boolean =>
  evidence.inheritedEnvironment || evidence.stepEnvironment || evidence.run;

const inspectOfficial = (
  workflow: NightlyGuardWorkflowRecord,
  jobId: string,
  job: Readonly<Record<string, unknown>>,
  evidence: NightlyGuardJobEvidence
): NightlyGuardJobInspection | undefined => {
  const uses = nightlyGuardText(job.uses);
  if (!uses.startsWith(OFFICIAL_PREFIX)) return undefined;
  if (evidence.condition) {
    return {
      failure: failure(
        workflow,
        `${jobId}: executable if bypass-label logic can skip the guard and is unsupported`
      ),
    };
  }
  if (indirectReusableBypassEvidence(evidence)) {
    return {
      failure: failure(
        workflow,
        `${jobId}: indirect bypass environment or run logic around the official reusable is unsupported`
      ),
    };
  }
  const reference = uses.slice(OFFICIAL_PREFIX.length);
  if (!OFFICIAL_REF.test(reference)) {
    return {
      failure: failure(
        workflow,
        `${jobId}: official reusable reference is not a static literal`
      ),
    };
  }
  const input = nightlyGuardObject(job.with)?.guard_script;
  const candidate =
    input === undefined
      ? NIGHTLY_GUARD_CANONICAL_TARGET
      : nightlyGuardText(input);
  const target = normalizeNightlyGuardTarget(candidate);
  return target
    ? { caller: { kind: "official-reusable", target } }
    : {
        failure: failure(
          workflow,
          `${jobId}: with.guard_script must be one literal contained relative ASCII JavaScript path`
        ),
      };
};

const conditionalFailure = (
  workflow: NightlyGuardWorkflowRecord,
  jobId: string,
  evidence: NightlyGuardJobEvidence
): NightlyGuardScanFailure | undefined =>
  evidence.condition &&
  (evidence.hasNode ||
    evidence.inheritedEnvironment ||
    evidence.stepEnvironment)
    ? failure(
        workflow,
        `${jobId}: executable if bypass-label logic can skip the guard and is unsupported`
      )
    : undefined;

const runBypassFailure = (
  workflow: NightlyGuardWorkflowRecord,
  jobId: string,
  evidence: NightlyGuardJobEvidence
): NightlyGuardScanFailure | undefined => {
  if (!evidence.run || !evidence.hasNode) return undefined;
  const bypass = evidence.analyses.find(
    analysis => analysis.bypassWiring
  )?.bypassWiring;
  return failure(
    workflow,
    bypass === "GITHUB_ENV"
      ? `${jobId}: indirect GITHUB_ENV bypass wiring is unsupported; use a literal YAML env mapping`
      : `${jobId}: executable run bypass wiring is unsupported; use a literal YAML env mapping`
  );
};

const directResult = (
  workflow: NightlyGuardWorkflowRecord,
  jobId: string,
  relevant: readonly NightlyGuardRunInspection[]
): NightlyGuardJobInspection => {
  const refused = relevant.find(item => item.reason)?.reason;
  if (refused) return { failure: failure(workflow, `${jobId}: ${refused}`) };
  const targets = relevant.flatMap(item => (item.target ? [item.target] : []));
  if (targets.length === 1) {
    return { caller: { kind: "direct", target: targets[0] ?? "" } };
  }
  if (targets.length === 0 && relevant.every(step => step.reportingOnly)) {
    return {};
  }
  return {
    failure: failure(
      workflow,
      targets.length === 0
        ? `${jobId}: bypass-bearing job has no supported literal Node guard target`
        : `${jobId}: multiple Node guard targets are ambiguous`
    ),
  };
};

const inspectDirect = (
  workflow: NightlyGuardWorkflowRecord,
  jobId: string,
  evidence: NightlyGuardJobEvidence
): NightlyGuardJobInspection => {
  const condition = conditionalFailure(workflow, jobId, evidence);
  if (condition) return { failure: condition };
  if (evidence.withMapping && evidence.hasNode) {
    return {
      failure: failure(
        workflow,
        `${jobId}: bypass-bearing with inputs on a direct job are unsupported`
      ),
    };
  }
  const runBypass = runBypassFailure(workflow, jobId, evidence);
  if (runBypass) return { failure: runBypass };
  const relevant = evidence.analyses.filter(
    (_analysis, index) =>
      evidence.inheritedEnvironment ||
      bypassBearingMapping(evidence.steps[index]?.env)
  );
  return relevant.length === 0 ? {} : directResult(workflow, jobId, relevant);
};

const inspectLocal = (
  workflow: NightlyGuardWorkflowRecord,
  jobId: string,
  uses: string,
  evidence: NightlyGuardJobEvidence
): NightlyGuardJobInspection => {
  if (
    evidence.condition ||
    evidence.withMapping ||
    indirectReusableBypassEvidence(evidence)
  ) {
    return {
      failure: failure(
        workflow,
        evidence.condition
          ? `${jobId}: executable if bypass logic around a local reusable is unsupported`
          : `${jobId}: indirect bypass logic around a local reusable is unsupported`
      ),
    };
  }
  const local = LOCAL.exec(uses)?.[1];
  return local
    ? { local }
    : {
        failure: failure(
          workflow,
          `${jobId}: local reusable path is unsupported or escapes .github/workflows`
        ),
      };
};

/**
 * Interpret one reachable executable job without scanning prose or comments.
 * @param workflow - Parsed workflow containing the job
 * @param jobId - Stable job mapping key
 * @param job - Parsed job mapping
 * @returns Direct caller, local edge, or an explicit refusal
 */
export function inspectNightlyGuardJob(
  workflow: NightlyGuardWorkflowRecord,
  jobId: string,
  job: Readonly<Record<string, unknown>>
): NightlyGuardJobInspection {
  const evidence = inspectNightlyGuardJobEvidence(workflow, job);
  const official = inspectOfficial(workflow, jobId, job, evidence);
  if (official) return official;
  const uses = nightlyGuardText(job.uses);
  if (uses.startsWith("./")) {
    return inspectLocal(workflow, jobId, uses, evidence);
  }
  if (uses.length > 0) {
    return hasAnyNightlyGuardBypassEvidence(evidence)
      ? {
          failure: failure(
            workflow,
            `${jobId}: bypass evidence on an unsupported remote reusable is unavailable`
          ),
        }
      : {};
  }
  return inspectDirect(workflow, jobId, evidence);
}

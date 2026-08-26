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
  hasNightlyBypassReference,
  inspectNightlyGuardRun,
  type NightlyGuardRunInspection,
} from "./doctor-nightly-e2e-guard-shell.js";

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

const literalEnv = (
  ...levels: readonly unknown[]
): Readonly<Record<string, string>> =>
  Object.assign(
    {},
    ...levels.map(level =>
      Object.fromEntries(
        Object.entries(nightlyGuardObject(level) ?? {}).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string"
        )
      )
    )
  );

const bypassBearingEnv = (...levels: readonly unknown[]): boolean =>
  levels.some(level =>
    Object.entries(nightlyGuardObject(level) ?? {}).some(
      ([key, value]) =>
        key === "GATE_BYPASS" ||
        key.startsWith("NIGHTLY_BYPASS_") ||
        (typeof value === "string" && hasNightlyBypassReference(value))
    )
  );

const conditionalBypass = (value: unknown): boolean =>
  typeof value === "string" && hasNightlyBypassReference(value);

const inspectOfficial = (
  workflow: NightlyGuardWorkflowRecord,
  jobId: string,
  job: Readonly<Record<string, unknown>>
): NightlyGuardJobInspection | undefined => {
  const uses = nightlyGuardText(job.uses);
  if (!uses.startsWith(OFFICIAL_PREFIX)) return undefined;
  if (conditionalBypass(job.if)) {
    return {
      failure: failure(
        workflow,
        `${jobId}: executable if bypass-label logic can skip the guard and is unsupported`
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
  job: Readonly<Record<string, unknown>>,
  mapped: readonly Readonly<Record<string, unknown>>[],
  hasGuardEvidence: boolean
): NightlyGuardScanFailure | undefined =>
  hasGuardEvidence &&
  (conditionalBypass(job.if) || mapped.some(step => conditionalBypass(step.if)))
    ? failure(
        workflow,
        `${jobId}: executable if bypass-label logic can skip the guard and is unsupported`
      )
    : undefined;

const shellBypassFailure = (
  workflow: NightlyGuardWorkflowRecord,
  jobId: string,
  analyses: readonly NightlyGuardRunInspection[],
  hasNode: boolean
): NightlyGuardScanFailure | undefined => {
  const bypass = analyses.find(analysis => analysis.bypassWiring)?.bypassWiring;
  if (!bypass || !hasNode) return undefined;
  return failure(
    workflow,
    bypass === "GITHUB_ENV"
      ? `${jobId}: indirect GITHUB_ENV bypass wiring is unsupported; use a literal YAML env mapping`
      : `${jobId}: inline env GATE_BYPASS wiring is unsupported; use a literal YAML env mapping`
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
  job: Readonly<Record<string, unknown>>
): NightlyGuardJobInspection => {
  const steps = Array.isArray(job.steps) ? job.steps : [];
  const mapped = steps.map(step => nightlyGuardObject(step) ?? {});
  const inherited = bypassBearingEnv(workflow.document.env, job.env);
  const analyses = mapped.map(step =>
    inspectNightlyGuardRun(
      nightlyGuardText(step.run),
      literalEnv(workflow.document.env, job.env, step.env)
    )
  );
  const hasNode = analyses.some(analysis => analysis.containsNode);
  const hasEnvironmentBypass =
    inherited || mapped.some(step => bypassBearingEnv(step.env));
  const condition = conditionalFailure(
    workflow,
    jobId,
    job,
    mapped,
    hasNode || hasEnvironmentBypass
  );
  if (condition) return { failure: condition };
  const shellBypass = shellBypassFailure(workflow, jobId, analyses, hasNode);
  if (shellBypass) return { failure: shellBypass };
  const relevant = analyses.filter(
    (_analysis, index) => inherited || bypassBearingEnv(mapped[index]?.env)
  );
  if (relevant.length === 0) return {};
  return directResult(workflow, jobId, relevant);
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
  const official = inspectOfficial(workflow, jobId, job);
  if (official) return official;
  const uses = nightlyGuardText(job.uses);
  if (uses.startsWith("./")) {
    if (conditionalBypass(job.if)) {
      return {
        failure: failure(
          workflow,
          `${jobId}: executable if bypass-label logic can skip the guard and is unsupported`
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
  }
  return inspectDirect(workflow, jobId, job);
}

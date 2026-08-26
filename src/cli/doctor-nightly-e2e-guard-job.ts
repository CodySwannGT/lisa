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

const OFFICIAL_PREFIX =
  "CodySwannGT/lisa/.github/workflows/nightly-e2e-health.yml@";
const OFFICIAL_REF = /^[^\s${}]+$/u;
const LOCAL = /^\.\/\.github\/workflows\/([A-Za-z0-9._-]+\.ya?ml)$/u;
const LITERAL_NODE = /^node[ \t]+(?:(['"])([^'"\s]+)\1|([^'"\s]+))[ \t]*$/u;
const ENV_NODE =
  /^node[ \t]+(['"]?)\$(?:\{([A-Z][A-Z0-9_]*)\}|([A-Z][A-Z0-9_]*))\1[ \t]*$/u;
const PROBE_OR_REPORT =
  /^node[ \t]+[^\s]+[ \t]+--(?:contract-version|report-issues)[ \t]*$/u;
const BYPASS_NAME = /(?:GATE_BYPASS|NIGHTLY_BYPASS_|nightly-e2e-bypass)/u;
const INLINE_BYPASS = /(?:^|[\s;])(?:GATE_BYPASS|NIGHTLY_BYPASS_[A-Z0-9_]*)=/u;

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
        (typeof value === "string" && value.includes("nightly-e2e-bypass"))
    )
  );

const conditionalBypass = (value: unknown): boolean =>
  typeof value === "string" && BYPASS_NAME.test(value);

const targetFromRun = (
  run: string,
  env: Readonly<Record<string, string>>
): { readonly target?: string; readonly reason?: string } => {
  const command = run.trim();
  if (!/(?:^|[ \t])node(?:[ \t]|$)/u.test(command)) return {};
  if (PROBE_OR_REPORT.test(command)) return {};
  const literal = LITERAL_NODE.exec(command);
  const variable = ENV_NODE.exec(command);
  const candidate = variable
    ? env[variable[2] ?? variable[3] ?? ""]
    : (literal?.[2] ?? literal?.[3]);
  if (candidate === undefined) {
    return {
      reason:
        "could not resolve the Node target from one literal environment level",
    };
  }
  const target = normalizeNightlyGuardTarget(candidate);
  return target
    ? { target }
    : {
        reason:
          "Node target must be one literal contained relative ASCII .js/.mjs/.cjs path; expressions, substitutions, absolute/escaping paths, and multiple commands are unsupported",
      };
};

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

const inspectDirect = (
  workflow: NightlyGuardWorkflowRecord,
  jobId: string,
  job: Readonly<Record<string, unknown>>
): NightlyGuardJobInspection => {
  const steps = Array.isArray(job.steps) ? job.steps : [];
  const mapped = steps.map(step => nightlyGuardObject(step) ?? {});
  if (
    conditionalBypass(job.if) ||
    mapped.some(step => conditionalBypass(step.if))
  ) {
    return {
      failure: failure(
        workflow,
        `${jobId}: executable if bypass-label logic can skip the guard and is unsupported`
      ),
    };
  }
  if (mapped.some(step => INLINE_BYPASS.test(nightlyGuardText(step.run)))) {
    return {
      failure: failure(
        workflow,
        `${jobId}: inline bypass environment wiring is unsupported; use a literal YAML env mapping`
      ),
    };
  }
  const inherited = bypassBearingEnv(workflow.document.env, job.env);
  const relevant = mapped.filter(
    step => inherited || bypassBearingEnv(step.env)
  );
  if (relevant.length === 0) return {};
  const resolved = relevant.map(step =>
    targetFromRun(
      nightlyGuardText(step.run),
      literalEnv(workflow.document.env, job.env, step.env)
    )
  );
  const refused = resolved.find(item => item.reason)?.reason;
  if (refused) {
    return { failure: failure(workflow, `${jobId}: ${refused}`) };
  }
  const targets = resolved.flatMap(item => (item.target ? [item.target] : []));
  if (targets.length === 1) {
    return { caller: { kind: "direct", target: targets[0] ?? "" } };
  }
  const reportingOnly = relevant.every(step =>
    /--report-issues[ \t]*$/u.test(nightlyGuardText(step.run))
  );
  return targets.length === 0 && reportingOnly
    ? {}
    : {
        failure: failure(
          workflow,
          targets.length === 0
            ? `${jobId}: bypass-bearing job has no supported literal Node guard target`
            : `${jobId}: multiple Node guard targets are ambiguous`
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

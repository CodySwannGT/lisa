/**
 * @file doctor-nightly-e2e-guard-evidence.ts
 * @description Preclassification evidence pass for one reachable workflow job
 * @module cli/doctor-nightly-e2e-guard-evidence
 */
import {
  type NightlyGuardWorkflowRecord,
  nightlyGuardObject,
  nightlyGuardText,
} from "./doctor-nightly-e2e-guard-contract.js";
import {
  hasNightlyBypassReference,
  inspectNightlyGuardRun,
  isNightlyBypassEnvironmentName,
  type NightlyGuardRunInspection,
} from "./doctor-nightly-e2e-guard-shell.js";

/** Evidence gathered before deciding which supported job grammar applies. */
export interface NightlyGuardJobEvidence {
  /** YAML-decoded steps retained for per-step environment attribution. */
  readonly steps: readonly Readonly<Record<string, unknown>>[];
  /** Comment-stripped POSIX run interpretations for those steps. */
  readonly analyses: readonly NightlyGuardRunInspection[];
  /** Workflow/job environment carries recognized bypass semantics. */
  readonly inheritedEnvironment: boolean;
  /** At least one step environment carries recognized bypass semantics. */
  readonly stepEnvironment: boolean;
  /** Job or step condition carries recognized bypass semantics. */
  readonly condition: boolean;
  /** Reusable input mapping carries recognized bypass semantics. */
  readonly withMapping: boolean;
  /** Comment-stripped run tokens construct recognized bypass state. */
  readonly run: boolean;
  /** At least one supported or refused run contains a Node command. */
  readonly hasNode: boolean;
}

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

const bypassKey = (key: string): boolean =>
  isNightlyBypassEnvironmentName(key) || hasNightlyBypassReference(key);

/**
 * Recognize only operational bypass keys or values with nightly-E2E semantics.
 * @param levels - YAML mappings at increasing precedence
 * @returns Whether a mapping participates in this guard's bypass contract
 */
export const bypassBearingMapping = (...levels: readonly unknown[]): boolean =>
  levels.some(level =>
    Object.entries(nightlyGuardObject(level) ?? {}).some(
      ([key, value]) =>
        bypassKey(key) ||
        (typeof value === "string" && hasNightlyBypassReference(value))
    )
  );

/**
 * Conditions are executable evidence only when their value has guard semantics.
 * @param value - Parsed job/step `if` value
 * @returns Whether the condition can participate in nightly bypass behavior
 */
export const conditionalBypass = (value: unknown): boolean =>
  typeof value === "string" && hasNightlyBypassReference(value);

const workflowShell = (workflow: NightlyGuardWorkflowRecord): unknown =>
  nightlyGuardObject(nightlyGuardObject(workflow.document.defaults)?.run)
    ?.shell;

const jobShell = (job: Readonly<Record<string, unknown>>): unknown =>
  nightlyGuardObject(nightlyGuardObject(job.defaults)?.run)?.shell;

const firstDefined = (...values: readonly unknown[]): unknown =>
  values.find(value => value !== undefined);

/**
 * Inspect all executable fields before official/local/direct classification.
 * @param workflow - Parsed owner of the job and workflow defaults
 * @param job - Parsed job mapping with runner and step metadata
 * @returns Evidence shared by every classification branch
 */
export const inspectNightlyGuardJobEvidence = (
  workflow: NightlyGuardWorkflowRecord,
  job: Readonly<Record<string, unknown>>
): NightlyGuardJobEvidence => {
  const rawSteps = Array.isArray(job.steps) ? job.steps : [];
  const steps = rawSteps.map(step => nightlyGuardObject(step) ?? {});
  const inheritedEnvironment = bypassBearingMapping(
    workflow.document.env,
    job.env
  );
  const analyses = steps.map(step =>
    inspectNightlyGuardRun(
      nightlyGuardText(step.run),
      literalEnv(workflow.document.env, job.env, step.env),
      {
        shell: firstDefined(step.shell, jobShell(job), workflowShell(workflow)),
        runsOn: job["runs-on"],
      }
    )
  );
  return {
    steps,
    analyses,
    inheritedEnvironment,
    stepEnvironment: steps.some(step => bypassBearingMapping(step.env)),
    condition:
      conditionalBypass(job.if) ||
      steps.some(step => conditionalBypass(step.if)),
    withMapping: bypassBearingMapping(job.with),
    run: analyses.some(analysis => analysis.bypassEvidence),
    hasNode: analyses.some(analysis => analysis.containsNode),
  };
};

/**
 * Collapse evidence only after every executable field has been inspected.
 * @param evidence - Complete preclassification evidence record
 * @returns Whether any field places the job in the nightly bypass contract
 */
export const hasAnyNightlyGuardBypassEvidence = (
  evidence: NightlyGuardJobEvidence
): boolean =>
  evidence.inheritedEnvironment ||
  evidence.stepEnvironment ||
  evidence.condition ||
  evidence.withMapping ||
  evidence.run;

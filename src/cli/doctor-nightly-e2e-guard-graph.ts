/**
 * @file doctor-nightly-e2e-guard-graph.ts
 * @description Root-preserving traversal of reachable local reusable workflows
 * @module cli/doctor-nightly-e2e-guard-graph
 */
import {
  MAX_NIGHTLY_GUARD_CALLERS,
  MAX_NIGHTLY_GUARD_LOCAL_DEPTH,
  MAX_NIGHTLY_GUARD_TARGETS,
  type NightlyGuardCaller,
  type NightlyGuardScanFailure,
  type NightlyGuardScanResult,
  type NightlyGuardWorkflowRecord,
  nightlyGuardObject,
  orderNightlyGuardStrings,
} from "./doctor-nightly-e2e-guard-contract.js";
import { inspectNightlyGuardJob } from "./doctor-nightly-e2e-guard-job.js";

/** Successful recursive traversal fragment. */
interface TraversalSuccess {
  /** Callers reached through this fragment. */
  readonly callers: readonly NightlyGuardCaller[];
}

/** Recursive traversal fragment or a fail-closed graph refusal. */
type TraversalResult =
  | TraversalSuccess
  | { readonly failure: NightlyGuardScanFailure };

/** Root-to-node traversal state. */
interface TraversalContext {
  /** Current reusable depth. */
  readonly depth: number;
  /** Workflow basenames on the current recursion stack. */
  readonly stack: readonly string[];
  /** Job-attribution segments before the current workflow. */
  readonly parents: readonly string[];
}

const failure = (
  workflow: NightlyGuardWorkflowRecord,
  reason: string
): TraversalResult => ({ failure: { workflow: workflow.file, reason } });

const isFailure = (
  result: TraversalResult
): result is { readonly failure: NightlyGuardScanFailure } =>
  "failure" in result;

const triggerNames = (value: unknown): readonly string[] => {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) {
    return value.filter(item => typeof item === "string");
  }
  return Object.keys(nightlyGuardObject(value) ?? {});
};

const isRoot = (record: NightlyGuardWorkflowRecord): boolean =>
  triggerNames(record.document.on).some(event => event !== "workflow_call");

const pathPart = (
  workflow: NightlyGuardWorkflowRecord,
  jobId: string
): string => `${workflow.file}#${jobId}`;

const validateBounds = (
  workflow: NightlyGuardWorkflowRecord,
  callers: readonly NightlyGuardCaller[]
): TraversalResult => {
  if (callers.length > MAX_NIGHTLY_GUARD_CALLERS) {
    return failure(
      workflow,
      `bypass caller limit ${MAX_NIGHTLY_GUARD_CALLERS} exceeded`
    );
  }
  const targets = new Set(callers.map(caller => caller.target));
  return targets.size > MAX_NIGHTLY_GUARD_TARGETS
    ? failure(
        workflow,
        `guard target limit ${MAX_NIGHTLY_GUARD_TARGETS} exceeded`
      )
    : { callers };
};

const callerFor = (
  workflow: NightlyGuardWorkflowRecord,
  jobId: string,
  context: TraversalContext,
  caller: NonNullable<ReturnType<typeof inspectNightlyGuardJob>["caller"]>
): NightlyGuardCaller => ({
  workflow: workflow.file,
  job: jobId,
  callPath: [...context.parents, pathPart(workflow, jobId)].join(" -> "),
  kind: caller.kind,
  target: caller.target,
});

const childContext = (
  workflow: NightlyGuardWorkflowRecord,
  jobId: string,
  context: TraversalContext
): TraversalContext => ({
  depth: context.depth + 1,
  stack: [...context.stack, workflow.name],
  parents: [...context.parents, pathPart(workflow, jobId)],
});

/**
 * Traverse one workflow and every local edge below it.
 * @param workflow - Current parsed workflow
 * @param byName - Bounded inventory keyed by basename
 * @param context - Root-path recursion state
 * @returns Callers below this workflow or an explicit graph refusal
 */
const walkWorkflow = (
  workflow: NightlyGuardWorkflowRecord,
  byName: ReadonlyMap<string, NightlyGuardWorkflowRecord>,
  context: TraversalContext
): TraversalResult => {
  if (context.stack.includes(workflow.name)) {
    return failure(
      workflow,
      `reachable local workflow cycle: ${[...context.stack, workflow.name].join(" -> ")}`
    );
  }
  const jobs = nightlyGuardObject(workflow.document.jobs) ?? {};
  const jobIds = orderNightlyGuardStrings(Object.keys(jobs));

  const walkJobs = (
    index: number,
    accumulated: readonly NightlyGuardCaller[]
  ): TraversalResult => {
    const jobId = jobIds[index];
    if (jobId === undefined) return validateBounds(workflow, accumulated);
    const job = nightlyGuardObject(jobs[jobId]);
    if (!job) return walkJobs(index + 1, accumulated);
    const inspection = inspectNightlyGuardJob(workflow, jobId, job);
    if (inspection.failure) return { failure: inspection.failure };
    const own = inspection.caller
      ? [callerFor(workflow, jobId, context, inspection.caller)]
      : [];
    if (!inspection.local) return walkJobs(index + 1, [...accumulated, ...own]);
    const child = byName.get(inspection.local);
    if (!child) {
      return failure(
        workflow,
        `${jobId}: local reusable ${inspection.local} is missing or unresolved`
      );
    }
    if (context.depth >= MAX_NIGHTLY_GUARD_LOCAL_DEPTH) {
      return failure(
        workflow,
        `reachable local workflow depth exceeds ${MAX_NIGHTLY_GUARD_LOCAL_DEPTH}`
      );
    }
    const nested = walkWorkflow(
      child,
      byName,
      childContext(workflow, jobId, context)
    );
    return isFailure(nested)
      ? nested
      : walkJobs(index + 1, [...accumulated, ...own, ...nested.callers]);
  };

  return walkJobs(0, []);
};

/**
 * Traverse each root independently so shared reusables retain every active
 * root-to-job attribution while static target proof remains deduplicated.
 * @param records - Parsed bounded workflow inventory
 * @returns Deterministic active callers or the first graph refusal
 */
export function traceNightlyGuardCallers(
  records: readonly NightlyGuardWorkflowRecord[]
): NightlyGuardScanResult {
  const byName = new Map(records.map(record => [record.name, record]));
  const roots = records.filter(isRoot);
  const walkRoots = (
    index: number,
    accumulated: readonly NightlyGuardCaller[]
  ): TraversalResult => {
    const root = roots[index];
    if (root === undefined)
      return validateBounds(records[0] ?? emptyRecord, accumulated);
    const result = walkWorkflow(root, byName, {
      depth: 0,
      stack: [],
      parents: [],
    });
    return isFailure(result)
      ? result
      : walkRoots(index + 1, [...accumulated, ...result.callers]);
  };
  const result = walkRoots(0, []);
  if (isFailure(result)) {
    return { state: "unavailable", failures: [result.failure] };
  }
  const callers = [...result.callers].sort((left, right) =>
    left.callPath < right.callPath ? -1 : left.callPath > right.callPath ? 1 : 0
  );
  return { state: "ok", callers };
}

/** Synthetic owner for bounds when an inventory contains no records. */
const emptyRecord: NightlyGuardWorkflowRecord = {
  file: ".github/workflows",
  name: "",
  document: {},
};

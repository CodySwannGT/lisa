/**
 * Assemble one gate's row from its cells.
 *
 * Separated from the report's own module because the two do different work:
 * that one reads the world, this one shapes what was read. Everything here is
 * pure — the same inputs give the same row, which is what makes the byte-
 * identical property testable without touching a filesystem.
 * @module cli/gate-report-assemble
 */
import { buildCell, type CellContext } from "./gate-report-cells.js";
import type {
  GateRegistryModule,
  ResolvedGate,
} from "./gate-report-registry.js";
import type { GateMomentCell, GateReportRow } from "./gate-report-types.js";

/** One moment's resolution, in axis order. */
export interface ResolvedMoment {
  /** The moment, `:environment` suffix included. */
  readonly moment: string;
  /** `resolveMoment(..., includeOff: true)` keyed by gate id, or null. */
  readonly resolved: Map<string, ResolvedGate> | null;
  /** Why `resolved` is null, when it is. */
  readonly failure: string | null;
}

/**
 * A gate-level `run` override from the settings file.
 * @param gates - The gates block
 * @param id - Gate id
 * @returns The task, or null
 */
function projectLevelTask(
  gates: Record<string, unknown>,
  id: string
): string | null {
  const gate = gates[id];
  if (typeof gate !== "object" || gate === null) return null;
  const run: unknown = Reflect.get(gate, "run");
  return typeof run === "string" ? run : null;
}

/**
 * Invert the static job table so a gate can name its CI job.
 * @param registry - The shipped registry
 * @returns Gate id -> job id
 */
export function invertJobTable(
  registry: GateRegistryModule
): Map<string, string> {
  // A gate may have several provers and exactly one job whose name IS its
  // label — the job a ruleset matches — and that is the one this map must
  // name. Secondary provers are excluded by the shipped list rather than by
  // declaration order: order produced the right answer and was a trap, since
  // reordering the table would silently change which job a gate reports as its
  // own with nothing to notice.
  const secondary = new Set<string>(registry.SECONDARY_PROVER_JOBS ?? []);
  // The reverse survives for the case the list does not cover: two PRIMARY
  // jobs naming one gate is a defect the façade suite fails on, and until it
  // is fixed the first declaration still wins rather than the last.
  return new Map(
    Object.entries(registry.QUALITY_JOB_GATES)
      .filter(([job]) => !secondary.has(job))
      .map(([job, gate]): [string, string] => [gate, job])
      .reverse()
  );
}

/**
 * Build one gate's row.
 * @param context - Report-wide cell inputs
 * @param moments - Per-moment resolution results, in axis order
 * @param id - Gate id
 * @param jobForGate - Gate id -> `quality.yml` job
 * @returns The row
 */
export function buildRow(
  context: CellContext,
  moments: readonly ResolvedMoment[],
  id: string,
  jobForGate: ReadonlyMap<string, string>
): GateReportRow {
  const definition = context.registry.REGISTRY[id];
  const mergeIndex = moments.findIndex(
    entry => entry.moment === context.mergeMoment
  );
  const qualityJob = jobForGate.get(id) ?? null;
  const cells: GateMomentCell[] = moments.map(moment =>
    buildCell(context, moment, id, qualityJob)
  );
  return {
    id,
    label: definition?.label ?? id,
    summary: definition?.summary ?? "",
    legalMoments: [...(definition?.moments ?? [])].sort((left, right) =>
      left.localeCompare(right)
    ),
    defaultTask: definition?.task ?? null,
    taskAt: { ...definition?.taskAt },
    projectTask: projectLevelTask(context.gates, id),
    mayRewrite: definition?.mayRewrite === true,
    costly: definition?.costly === true,
    interceptor: context.registry.INTERCEPTORS[id] ?? null,
    qualityJob,
    moments: cells,
    merge: context.merge({
      expectedContext: cells[mergeIndex]?.expectedContext ?? null,
      task: cells[mergeIndex]?.task ?? null,
      label: definition?.label ?? id,
    }),
  };
}

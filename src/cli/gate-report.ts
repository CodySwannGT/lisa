/**
 * Build the deterministic gate report.
 *
 * Same project and config in, identical bytes out. That is the load-bearing
 * property, not a nicety: an agent-written version of this report would differ
 * between runs when nothing changed, so a real regression would be
 * indistinguishable from a rephrasing — and the error class it would reproduce
 * is documented. Four times in one session, "absent from the settings file" was
 * read as "does not run" for a check that was in fact running from a workflow
 * or a hook nobody had looked in. Deriving the answer removes the reader.
 *
 * The report splits into three tiers by what a consumer can actually reach.
 * Tier 1 is everything derivable from files the project holds. Tier 2 is the
 * live ruleset, which needs a network call and degrades to `unknown`. Tier 3 is
 * whether a CI job reads the declaration or runs a hardcoded command — that
 * lives in a `quality.yml` a consumer does not have, so it is stated as
 * unknowable rather than inferred from the presence of a mapping row.
 * @module cli/gate-report
 */
import { readFile } from "node:fs/promises";
import * as path from "node:path";

import { buildCell, type CellContext } from "./gate-report-cells.js";
import { collectHookEvidence } from "./gate-report-executors.js";
import {
  loadGateRegistry,
  type GateRegistryModule,
  type ResolvedGate,
} from "./gate-report-registry.js";
import {
  compareContexts,
  defaultRequiredContextsReader,
  readRequiredContexts,
  type RequiredContextsReader,
} from "./gate-report-ruleset.js";
import {
  buildSkipJobRows,
  defaultSkipJobTokensReader,
  type SkipJobTokensReader,
} from "./gate-report-skip-jobs.js";
import { readConfig } from "./gate-report-config.js";
import { summarise } from "./gate-report-summary.js";
import {
  GATE_REPORT_VERSION,
  type Finding,
  type GateMomentCell,
  type GateReport,
  type GateReportRow,
  type MergeBlock,
  type RulesetComparison,
} from "./gate-report-types.js";

/** The workflow whose name prefixes a run gate's status context. */
const QUALITY_WORKFLOW_NAME = "🔍 Quality Checks";

/** The moment a ruleset guards, and the one `quality.yml` defaults to. */
const MERGE_MOMENT = "pull-request";

/** Options for one report. */
export interface GateReportOptions {
  /** Project root to report on. */
  readonly projectRoot: string;
  /** Suppress the network call and report Tier 2 as `unknown`. */
  readonly offline?: boolean;
  /** Injectable Tier 2 reader, so tests never shell out. */
  readonly readRequiredContexts?: RequiredContextsReader;
  /** Injectable `skip_jobs` reader, for the same reason. */
  readonly readSkipJobTokens?: SkipJobTokensReader;
}

/**
 * Read `package.json` scripts, distinguishing absent from unreadable.
 * @param projectRoot - Project root
 * @returns The scripts block, or null when it could not be read
 */
async function readScripts(
  projectRoot: string
): Promise<Record<string, string> | null> {
  const source = await readFile(
    path.join(projectRoot, "package.json"),
    "utf8"
  ).catch(() => undefined);
  if (source === undefined) return null;
  try {
    const parsed: unknown = JSON.parse(source);
    if (parsed === null || typeof parsed !== "object") return null;
    const scripts: unknown = Reflect.get(parsed, "scripts");
    if (scripts === null || typeof scripts !== "object") return {};
    return scripts as Record<string, string>;
  } catch {
    return null;
  }
}

/**
 * Every moment the report has a column for.
 *
 * There is no fixed set. `MOMENTS` is five, and three families take an
 * `:<environment>` suffix, so a project with staging and production has more
 * deploy columns than one with production alone. The axis is therefore the
 * fixed moments plus whatever family moments this project actually declares —
 * and never a bare `deploy`, which is not a moment Lisa knows.
 * @param registry - The shipped registry
 * @param gates - The gates block
 * @returns The axis, fixed moments first, then declared family moments sorted
 */
export function momentAxis(
  registry: GateRegistryModule,
  gates: Record<string, unknown>
): string[] {
  const declared = Object.values(gates)
    .filter((gate): gate is object => typeof gate === "object" && gate !== null)
    .flatMap(gate => Object.keys(gate))
    .filter(key => !registry.MOMENTS.includes(key) && registry.isMoment(key));
  return [
    ...registry.MOMENTS,
    ...[...new Set(declared)].sort((left, right) => left.localeCompare(right)),
  ];
}

/**
 * Resolve one moment, capturing a refusal rather than throwing it upward.
 *
 * `resolveMoment` asserts the whole gates block's moment keys, so one typo
 * anywhere makes every moment unresolvable. That must surface as a stated
 * problem, not as a report that looks like a project declaring nothing.
 * @param registry - The shipped registry
 * @param gates - The gates block
 * @param runner - The project's runner
 * @param moment - The moment to resolve
 * @returns Resolved gates keyed by id, or the failure that prevented it
 */
function resolveOneMoment(
  registry: GateRegistryModule,
  gates: Record<string, unknown>,
  runner: string,
  moment: string
): { resolved: Map<string, ResolvedGate> | null; failure: string | null } {
  try {
    const entries = registry.resolveMoment({
      gates,
      moment,
      runner,
      includeOff: true,
    });
    return {
      resolved: new Map(entries.map(entry => [entry.id, entry])),
      failure: null,
    };
  } catch (error) {
    return {
      resolved: null,
      failure: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * The Tier 2 answer for one cell, never defaulted to a verdict.
 * @param contexts - The live required contexts, or an unknown
 * @returns A resolver for one cell's expected context
 */
function mergeBlockResolver(
  contexts: Finding<readonly string[]>
): (moment: string, expectedContext: string | null) => Finding<MergeBlock> {
  return (moment, expectedContext) => {
    if (moment !== MERGE_MOMENT) {
      return {
        state: "not-applicable",
        reason: "moment-produces-no-merge-context",
        message: `A ruleset guards a merge, and only the ${MERGE_MOMENT} gate set produces the status contexts it names. A declaration at ${moment} is enforced by a hook, not by branch protection.`,
      };
    }
    if (expectedContext === null) {
      return {
        state: "not-applicable",
        reason: "no-required-declaration",
        message:
          "Only a `required` declaration produces a status context, so there is nothing here for a ruleset to require.",
      };
    }
    if (contexts.state !== "verified") return contexts;
    return {
      state: "verified",
      value: {
        required: contexts.value.includes(expectedContext),
        context: contexts.value.includes(expectedContext)
          ? expectedContext
          : null,
      },
    };
  };
}

/**
 * Build one gate's row.
 * @param context - Report-wide cell inputs
 * @param moments - Per-moment resolution results, in axis order
 * @param id - Gate id
 * @param jobForGate - Gate id -> `quality.yml` job
 * @returns The row
 */
function buildRow(
  context: CellContext,
  moments: readonly {
    moment: string;
    resolved: Map<string, ResolvedGate> | null;
    failure: string | null;
  }[],
  id: string,
  jobForGate: ReadonlyMap<string, string>
): GateReportRow {
  const definition = context.registry.REGISTRY[id];
  const cells: GateMomentCell[] = moments.map(moment =>
    buildCell(context, moment, id)
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
    qualityJob: jobForGate.get(id) ?? null,
    moments: cells,
  };
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
function invertJobTable(registry: GateRegistryModule): Map<string, string> {
  // Reversed before the Map is built so that when two jobs name one gate the
  // FIRST in declaration order wins, which is the order the table reads in.
  return new Map(
    Object.entries(registry.QUALITY_JOB_GATES)
      .map(([job, gate]): [string, string] => [gate, job])
      .reverse()
  );
}

/**
 * The contexts a gates block implies at the merge moment.
 * @param registry - The shipped registry
 * @param gates - The gates block
 * @returns The contexts, or null when the block cannot be resolved
 */
function declaredContexts(
  registry: GateRegistryModule,
  gates: Record<string, unknown>
): string[] | null {
  try {
    return registry.contextsFor(gates, {
      moment: MERGE_MOMENT,
      workflowName: QUALITY_WORKFLOW_NAME,
    });
  } catch {
    return null;
  }
}

/**
 * The ruleset comparison, or the same unknown the contexts came back with.
 * @param registry - The shipped registry
 * @param gates - The gates block
 * @param contexts - Live required contexts, or an unknown
 * @returns The comparison
 */
function buildRulesetFinding(
  registry: GateRegistryModule,
  gates: Record<string, unknown>,
  contexts: Finding<readonly string[]>
): Finding<RulesetComparison> {
  if (contexts.state !== "verified") return contexts;
  const declared = declaredContexts(registry, gates);
  if (declared === null) {
    return {
      state: "unknown",
      reason: "declarations-unresolvable",
      message:
        "The gates block could not be resolved, so the contexts it implies cannot be compared with the ruleset.",
    };
  }
  return {
    state: "verified",
    value: compareContexts(declared, contexts.value),
  };
}

/**
 * The report emitted when the shipped registry cannot be found.
 * @returns A report that claims nothing
 */
function registryMissingReport(): GateReport {
  const missing: Finding<never> = {
    state: "unknown",
    reason: "registry-not-found",
    message:
      "Lisa's shipped gate registry could not be located, so no gate could be reported. Nothing here is a pass.",
  };
  return {
    version: GATE_REPORT_VERSION,
    registrySource: missing,
    runner: missing,
    runnerSource: "unknown",
    momentAxis: [],
    declarationProblems: [],
    gates: [],
    skipJobs: missing,
    ruleset: missing,
    summary: summarise([], 0),
  };
}

/**
 * Build the gate report for one project.
 * @param options - Report inputs
 * @returns The report
 */
export async function buildGateReport(
  options: GateReportOptions
): Promise<GateReport> {
  const registry = await loadGateRegistry();
  if (registry === null) return registryMissingReport();
  const { projectRoot } = options;
  const parsed = readConfig(registry, projectRoot);
  const gates = parsed.gates;
  const axis = momentAxis(registry, gates);
  const [scripts, hooks, contexts, skipJobs] = await Promise.all([
    readScripts(projectRoot),
    collectHookEvidence(projectRoot),
    readRequiredContexts({
      projectRoot,
      offline: options.offline === true,
      read: options.readRequiredContexts ?? defaultRequiredContextsReader,
    }),
    buildSkipJobRows({
      registry,
      projectRoot,
      read: options.readSkipJobTokens ?? defaultSkipJobTokensReader,
    }),
  ]);
  const context: CellContext = {
    registry,
    gates,
    hooks,
    scripts,
    runner: parsed.runner,
    workflowName: QUALITY_WORKFLOW_NAME,
    blocksMerge: mergeBlockResolver(contexts),
  };
  const moments = axis.map(moment => ({
    moment,
    ...resolveOneMoment(registry, gates, parsed.runner, moment),
  }));
  const jobForGate = invertJobTable(registry);
  const rows = Object.keys(registry.REGISTRY)
    .sort((left, right) => left.localeCompare(right))
    .map(id => buildRow(context, moments, id, jobForGate));
  return {
    version: GATE_REPORT_VERSION,
    // Deliberately a token, not the path. An absolute path differs per machine
    // and would break the byte-identical property the report is built on.
    registrySource: { state: "verified", value: "lisa-package" },
    runner: parsed.runnerFinding,
    runnerSource: parsed.runnerSource,
    momentAxis: axis,
    declarationProblems: parsed.problems,
    gates: rows,
    skipJobs,
    ruleset: buildRulesetFinding(registry, gates, contexts),
    summary: summarise(rows, axis.length),
  };
}

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

import { collectAgentHooks } from "./gate-report-agent-hooks.js";
import {
  buildRow,
  invertJobTable,
  type ResolvedMoment,
} from "./gate-report-assemble.js";
import type { CellContext } from "./gate-report-cells.js";
import {
  collectHookEvidence,
  type HookEvidence,
} from "./gate-report-executors.js";
import {
  facadeFinding,
  facadeSourceOf,
  readFacadeFacts,
  type FacadeFacts,
} from "./gate-report-facade.js";
import { mergeVerdict } from "./gate-report-merge.js";
import {
  collectUpstream,
  toolMomentLegalGates,
} from "./gate-report-upstream.js";
import {
  loadGateRegistry,
  type GateRegistryModule,
  type ResolvedGate,
} from "./gate-report-registry.js";
import {
  buildDeclarationDrift,
  buildRequiredContexts,
  buildRulesetFinding,
  liveEnforcement,
  mergeBlockResolver,
  type JoinContext,
} from "./gate-report-joins.js";
import {
  readTemplateEnforcement,
  type TemplateEnforcementReader,
} from "./gate-report-templates.js";
import {
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
import type { EnforcedContext } from "../core/gate-declaration-drift.js";
import {
  GATE_REPORT_VERSION,
  type AgentHookEvidence,
  type Finding,
  type GateReport,
  type SkipJobRow,
} from "./gate-report-types.js";

/** The workflow whose name prefixes a run gate's status context. */
const QUALITY_WORKFLOW_NAME = "🔍 Quality Checks";

/** The moment a ruleset guards, and the one `quality.yml` defaults to. */
const MERGE_MOMENT = "pull-request";

/** The package this repository publishes as, for the upstream self-check. */
const LISA_PACKAGE_NAME = "@codyswann/lisa";

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
  /** Injectable Tier 1 ruleset-template reader, for the same reason. */
  readonly readTemplateContexts?: TemplateEnforcementReader;
  /** Injectable home directory, so agent-hook discovery is testable. */
  readonly homedir?: () => string;
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
    declarationDrift: { templates: missing, live: missing },
    requiredContexts: missing,
    agentHooks: missing,
    facadeSource: { present: false, files: [] },
    upstream: [],
    projectIsUpstream: false,
    summary: summarise([], 0),
  };
}

/**
 * Whether the project being reported on is Lisa itself.
 *
 * Lisa is both a project and the upstream, so its own run is the one place the
 * upstream section is actionable rather than merely explanatory. Read from the
 * package name rather than from a path, because a path differs per machine and
 * a checkout can be called anything.
 * @param projectRoot - Project root
 * @returns True when this checkout is the Lisa package
 */
async function readProjectIsUpstream(projectRoot: string): Promise<boolean> {
  const source = await readFile(
    path.join(projectRoot, "package.json"),
    "utf8"
  ).catch(() => undefined);
  if (source === undefined) return false;
  try {
    const parsed: unknown = JSON.parse(source);
    return (
      parsed !== null &&
      typeof parsed === "object" &&
      Reflect.get(parsed, "name") === LISA_PACKAGE_NAME
    );
  } catch {
    return false;
  }
}

/**
 * Every input the report is derived from, read once and in parallel.
 *
 * One place, so a new input is a line here rather than a new sequential await
 * buried in the assembly — and so the one call that reaches the network stays
 * visible beside the six that do not.
 * @param registry - The shipped registry
 * @param options - Report inputs
 * @returns Scripts, hooks, contexts, skip jobs, workflows, agent hooks, and
 *   whether this project is Lisa
 */
async function readInputs(
  registry: GateRegistryModule,
  options: GateReportOptions
): Promise<
  [
    Record<string, string> | null,
    HookEvidence,
    Finding<readonly string[]>,
    Finding<readonly SkipJobRow[]>,
    FacadeFacts,
    Finding<readonly AgentHookEvidence[]>,
    boolean,
    Finding<readonly EnforcedContext[]>,
  ]
> {
  const { projectRoot } = options;
  return await Promise.all([
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
    readFacadeFacts(projectRoot),
    collectAgentHooks(
      projectRoot,
      options.homedir === undefined ? {} : { homedir: options.homedir }
    ),
    readProjectIsUpstream(projectRoot),
    readTemplateEnforcement(
      options.readTemplateContexts === undefined
        ? { projectRoot }
        : { projectRoot, read: options.readTemplateContexts }
    ),
  ]);
}

/**
 * The declaration held against both surfaces that enforce it.
 *
 * Two surfaces, never merged into one verdict: the template needs no network
 * and says what protection would require the moment anyone provisions it; the
 * live ruleset says what the repository requires right now, and is `unknown`
 * whenever this run did not read it. Folding them would let a reachable
 * surface vouch for an unreachable one.
 * @param joins - The join inputs
 * @param templates - What the shipped templates require, or why that is unknown
 * @returns One comparison per surface
 */
function declarationDrift(
  joins: JoinContext,
  templates: Finding<readonly EnforcedContext[]>
): GateReport["declarationDrift"] {
  return {
    templates: buildDeclarationDrift(joins, "ruleset-templates", templates),
    live: buildDeclarationDrift(
      joins,
      "live-ruleset",
      liveEnforcement(joins.contexts)
    ),
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
  const [
    scripts,
    hooks,
    contexts,
    skipJobs,
    facade,
    agentHooks,
    isUpstream,
    templates,
  ] = await readInputs(registry, options);
  const joins: JoinContext = {
    registry,
    gates,
    contexts,
    facade,
    mergeMoment: MERGE_MOMENT,
    workflowName: QUALITY_WORKFLOW_NAME,
  };
  const context: CellContext = {
    registry,
    gates,
    hooks,
    scripts,
    runner: parsed.runner,
    workflowName: QUALITY_WORKFLOW_NAME,
    blocksMerge: mergeBlockResolver(joins),
    facade: (gateId, qualityJob) => facadeFinding(facade, gateId, qualityJob),
    facadeKnown: facade.qualityYmlPresent,
    mergeMoment: MERGE_MOMENT,
    merge: inputs => mergeVerdict({ ...inputs, required: contexts, facade }),
  };
  const moments: ResolvedMoment[] = axis.map(moment => ({
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
    ruleset: buildRulesetFinding(joins),
    declarationDrift: declarationDrift(joins, templates),
    requiredContexts: buildRequiredContexts(joins),
    agentHooks,
    facadeSource: facadeSourceOf(facade),
    upstream: collectUpstream({
      rows,
      agentHooks,
      toolMomentLegalGates: toolMomentLegalGates(registry),
    }),
    projectIsUpstream: isUpstream,
    summary: summarise(rows, axis.length),
  };
}

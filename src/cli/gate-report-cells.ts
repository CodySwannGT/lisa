/**
 * Derive one (gate, moment) cell — the report's real unit.
 *
 * The pair is the unit rather than the gate because the verdict is genuinely
 * mixed per moment: in this repository `conflict-residue` is bucket A at push
 * and bucket B at pull-request. A gate-shaped row would have to summarise that
 * into a single cell, and every summary of a mixed verdict is a place for a
 * green to hide.
 * @module cli/gate-report-cells
 */
import {
  declaredCallerPrefix,
  type GateRegistryModule,
  type RegistryGate,
  type ResolvedGate,
} from "./gate-report-registry.js";
import { executorsFor, type HookEvidence } from "./gate-report-executors.js";
import { TIER_THREE_UNKNOWABLE } from "./gate-report-facade.js";
import type {
  Bucket,
  DeclarationState,
  ExecutorEvidence,
  Finding,
  GateMomentCell,
  MergeBlock,
  MergeVerdict,
  ProofMode,
  TaskProvenance,
} from "./gate-report-types.js";

/** Levels that put a gate into service. `off` is a declaration, not service. */
const ACTIVE_LEVELS = new Set(["required", "optional"]);

/** Every level the settings file may carry, `off` included. */
const DECLARED_LEVELS = new Set([...ACTIVE_LEVELS, "off"]);

/** The state of a gate the settings file never mentions at a moment. */
const UNDECLARED: DeclarationState = "not-declared";

/** Everything one moment's cells are derived from. */
export interface MomentContext {
  /** The moment, `:environment` suffix included. */
  readonly moment: string;
  /** `resolveMoment(..., includeOff: true)` keyed by gate id, or null. */
  readonly resolved: ReadonlyMap<string, ResolvedGate> | null;
  /** Why `resolved` is null, when it is. */
  readonly failure: string | null;
}

/** Inputs shared by every cell in the report. */
export interface CellContext {
  readonly registry: GateRegistryModule;
  readonly gates: Record<string, unknown>;
  readonly hooks: HookEvidence;
  /** `package.json` scripts, or null when it could not be read. */
  readonly scripts: Readonly<Record<string, string>> | null;
  /** The runner a command is built with. */
  readonly runner: string;
  /** The workflow name branch-protection contexts are built from. */
  readonly workflowName: string;
  /** Tier 2: the live ruleset's answer for one expected context. */
  readonly blocksMerge: (
    moment: string,
    expectedContext: string | null
  ) => Finding<MergeBlock>;
  /** Tier 3: whether the mapped CI job reads the declaration. */
  readonly facade: (
    gateId: string,
    qualityJob: string | null
  ) => Finding<boolean>;
  /**
   * Whether this run could read the workflows Tier 3 is written in.
   *
   * When it could, "nothing runs this and nothing declares it" becomes
   * provable rather than merely unproved, and bucket D stops being a thing the
   * report has to decline to say.
   */
  readonly facadeKnown: boolean;
  /** The moment a CI job's verdict actually applies at. */
  readonly mergeMoment: string;
  /** Tier 2 joined with the workflow: does this gate block a merge? */
  readonly merge: (inputs: {
    expectedContext: string | null;
    task: string | null;
    label: string;
  }) => Finding<MergeVerdict>;
}

/** Tier 3 is the same refusal everywhere, so it is written once. */
const TIER_THREE = TIER_THREE_UNKNOWABLE;

/**
 * The raw per-moment entry the settings file holds for one gate.
 * @param gates - The gates block
 * @param id - Gate id
 * @param moment - Moment key
 * @returns The entry, normalised to an object, or null when absent
 */
function rawEntry(
  gates: Record<string, unknown>,
  id: string,
  moment: string
): Record<string, unknown> | null {
  const gate = gates[id];
  if (typeof gate !== "object" || gate === null) return null;
  const raw = (gate as Record<string, unknown>)[moment];
  if (typeof raw === "string") return { level: raw };
  if (typeof raw === "object" && raw !== null) {
    return raw as Record<string, unknown>;
  }
  return null;
}

/**
 * A gate-level `run` override, which applies at every declared moment.
 * @param gates - The gates block
 * @param id - Gate id
 * @returns The task, or null
 */
export function gateLevelRun(
  gates: Record<string, unknown>,
  id: string
): string | null {
  const gate = gates[id];
  if (typeof gate !== "object" || gate === null) return null;
  const run = (gate as Record<string, unknown>).run;
  return typeof run === "string" ? run : null;
}

/**
 * Which of the five sources supplies this pair's task.
 *
 * Named rather than merely resolved: a per-moment `run` and a gate-level `run`
 * produce identical commands and mean different things, and a registry `taskAt`
 * swap ships to every project while a project `run` does not.
 *
 * This ladder is a SECOND implementation of the one in `resolveMoment`, which
 * returns only the winner's task and cannot say which rung it came from. The
 * duplication is deliberate and its cost is real: a rung added to one and not
 * the other makes this report describe a command the runner will not run. When
 * the fifth rung landed (#2916), a report left un-updated would have printed
 * `security:dast`, `commandExists: false`, and bucket C for a gate that
 * actually runs `security:zap` and passes.
 * @param options - Resolution inputs
 * @param options.entry - The raw per-moment entry
 * @param options.gateRun - A gate-level project `run`
 * @param options.definition - The registry gate
 * @param options.family - The moment's family
 * @param options.scripts - The project's `package.json` scripts, or null when
 *   unreadable. `null` suppresses the `shippedAs` rung entirely: an unknown
 *   manifest cannot establish that the concern-named script is absent.
 * @returns The winning source and its task
 */
export function resolveProvenance(options: {
  entry: Record<string, unknown> | null;
  gateRun: string | null;
  definition: RegistryGate | undefined;
  family: string;
  scripts?: Readonly<Record<string, string>> | null;
}): { task: string | null; provenance: TaskProvenance } {
  const { entry, gateRun, definition, family, scripts = null } = options;
  const momentRun = entry?.run;
  if (typeof momentRun === "string") {
    return { task: momentRun, provenance: "moment-run" };
  }
  if (gateRun !== null) return { task: gateRun, provenance: "gate-run" };
  const swap = definition?.taskAt?.[family];
  const registryTask = typeof swap === "string" ? swap : definition?.task;
  const shipped = shippedAsTask(definition, registryTask, scripts);
  if (shipped !== null) {
    return { task: shipped, provenance: "registry-shipped-as" };
  }
  if (typeof swap === "string") {
    return { task: swap, provenance: "registry-task-at" };
  }
  if (typeof definition?.task === "string") {
    return { task: definition.task, provenance: "registry-task" };
  }
  return { task: null, provenance: "none" };
}

/**
 * The alias that stands in for a registry default this project cannot run.
 *
 * The same three conditions `aliasFor` applies in `lisa-gates.mjs`, and they
 * have to stay the same three: the default is absent here, the alias is
 * present here, and the manifest was actually read.
 * @param definition - The registry gate
 * @param registryTask - The registry default that would otherwise win
 * @param scripts - The project's scripts, or null when unreadable
 * @returns The alias to run, or null when the default stands
 */
function shippedAsTask(
  definition: RegistryGate | undefined,
  registryTask: string | undefined,
  scripts: Readonly<Record<string, string>> | null
): string | null {
  const alias = definition?.shippedAs;
  if (typeof alias !== "string" || typeof registryTask !== "string") {
    return null;
  }
  if (scripts === null) return null;
  if (Object.hasOwn(scripts, registryTask)) return null;
  return Object.hasOwn(scripts, alias) ? alias : null;
}

/**
 * Whether `package.json` defines the task the pair resolves to.
 * @param scripts - The scripts block, or null when unreadable
 * @param task - The resolved task
 * @returns A three-state finding, never a defaulted pass
 */
export function commandExistsFinding(
  scripts: Readonly<Record<string, string>> | null,
  task: string | null
): Finding<boolean> {
  if (task === null) {
    return {
      state: "not-applicable",
      reason: "no-task",
      message: "This gate resolves to no task at this moment.",
    };
  }
  if (scripts === null) {
    return {
      state: "unknown",
      reason: "package-json-unreadable",
      message:
        "package.json could not be read, so whether this command exists is unknown.",
    };
  }
  return { state: "verified", value: Object.hasOwn(scripts, task) };
}

/**
 * Classify one pair into a bucket, or decline to.
 *
 * D is never a fallback. "Nothing runs and nothing is declared" requires
 * proving that no executor exists, and in a consumer the CI half of that proof
 * lives in a file the project does not have — so an unclassifiable pair says
 * so instead of being quietly counted as dark.
 * @param options - Classification inputs
 * @param options.active - Whether the declaration puts the gate into service
 * @param options.mode - How the gate is proved
 * @param options.commandExists - Whether the task exists
 * @param options.executors - Executors proved for this pair
 * @param options.facade - Whether the mapped CI job reads the declaration
 * @param options.atMergeMoment - Whether a CI verdict applies at this moment
 * @param options.facadeKnown - Whether this run could read the CI workflows
 * @returns A bucket, or an explicit refusal
 */
export function classifyBucket(options: {
  active: boolean;
  mode: ProofMode | null;
  commandExists: Finding<boolean>;
  executors: readonly ExecutorEvidence[];
  facade: Finding<boolean>;
  atMergeMoment: boolean;
  facadeKnown: boolean;
}): Finding<Bucket> {
  const local = localBucket(options);
  if (local !== null) return { state: "verified", value: local };
  const ci = ciBucket(options);
  if (ci !== null) return { state: "verified", value: ci };
  return options.facadeKnown ? { state: "verified", value: "D" } : TIER_THREE;
}

/**
 * The bucket the project's own files alone can prove.
 * @param options - Classification inputs
 * @param options.active - Whether the declaration puts the gate into service
 * @param options.mode - How the gate is proved
 * @param options.commandExists - Whether the task exists
 * @param options.executors - Executors proved for this pair
 * @returns A bucket, or null when the local files do not settle it
 */
function localBucket(options: {
  active: boolean;
  mode: ProofMode | null;
  commandExists: Finding<boolean>;
  executors: readonly ExecutorEvidence[];
}): Bucket | null {
  const { active, mode, commandExists, executors } = options;
  const missingCommand =
    commandExists.state === "verified" && !commandExists.value;
  if (active && mode === "run" && missingCommand) return "C";
  if (active && executors.some(entry => entry.kind === "gate-runner")) {
    return "A";
  }
  if (!active && executors.some(entry => entry.kind !== "gate-runner")) {
    return "B";
  }
  return null;
}

/**
 * The bucket the CI half settles, once the workflow declaring the job is read.
 *
 * A wired façade under a live declaration is the whole point of the façade; a
 * wired façade under NO declaration runs the hardcoded fallback, which is
 * bucket B wearing the clothes of bucket A.
 * @param options - Classification inputs
 * @param options.active - Whether the declaration puts the gate into service
 * @param options.facade - Whether the mapped CI job reads the declaration
 * @param options.atMergeMoment - Whether a CI verdict applies at this moment
 * @returns A bucket, or null when CI does not settle it
 */
function ciBucket(options: {
  active: boolean;
  facade: Finding<boolean>;
  atMergeMoment: boolean;
}): Bucket | null {
  const { active, facade, atMergeMoment } = options;
  if (!atMergeMoment || facade.state !== "verified") return null;
  return facade.value && active ? "A" : "B";
}

/**
 * The branch-protection context a `required` declaration implies.
 * @param options - Context inputs
 * @param options.level - The declared level
 * @param options.mode - How the gate is proved
 * @param options.awaits - The awaited signal's own name
 * @param options.label - The gate's CI job name
 * @param options.workflowName - The calling workflow's name
 * @param options.callerPrefix - The chain this declaration named for itself,
 *   already joined, or null when it named none. A gate proved outside the
 *   quality facade is not reached through the facade's callers, so the
 *   caller-wide name would describe a route to it that does not exist.
 * @returns The expected context, or null
 */
function expectedContextFor(options: {
  level: DeclarationState;
  mode: ProofMode | null;
  awaits: string | null;
  label: string;
  workflowName: string;
  callerPrefix: string | null;
}): string | null {
  const { level, mode, awaits, label, workflowName, callerPrefix } = options;
  if (level !== "required") return null;
  if (mode === "await") return awaits;
  return `${callerPrefix ?? workflowName} / ${label}`;
}

/**
 * Build one cell.
 * @param context - Report-wide inputs
 * @param momentContext - Per-moment inputs
 * @param id - Gate id
 * @param qualityJob - The CI job the static table pairs with this gate
 * @returns The cell
 */
export function buildCell(
  context: CellContext,
  momentContext: MomentContext,
  id: string,
  qualityJob: string | null
): GateMomentCell {
  const { registry, gates, hooks, scripts, runner, workflowName } = context;
  const { moment, resolved, failure } = momentContext;
  const definition = registry.REGISTRY[id];
  const family = registry.momentFamily(moment);
  const legal = definition?.moments.includes(family) === true;
  const entry = rawEntry(gates, id, moment);
  const gateRun = gateLevelRun(gates, id);
  const { task, provenance } = resolveProvenance({
    entry,
    gateRun,
    definition,
    family,
    scripts,
  });
  const hit = resolved?.get(id);
  const declaration = declarationOf(entry, resolved, failure, id);
  const active = ACTIVE_LEVELS.has(declaration);
  const mode = modeOf(declaration, hit);
  const awaits = hit?.awaits ?? null;
  const cellTask = mode === "await" || mode === "intercept" ? null : task;
  const commandExists = commandExistsFinding(scripts, cellTask);
  const executors = executorsFor(hooks, {
    moment,
    gateId: id,
    task: cellTask,
    declared: active,
  });
  const facade = context.facade(id, qualityJob);
  const expectedContext = expectedContextFor({
    level: declaration,
    mode,
    awaits,
    label: definition?.label ?? id,
    workflowName,
    callerPrefix: declaredCallerPrefix(registry, hit?.callerChain),
  });
  return {
    moment,
    legal,
    declaration,
    mode,
    awaits,
    task: cellTask,
    command: cellCommand(mode, cellTask, runner),
    provenance: cellTask === null ? "none" : provenance,
    commandExists,
    executors,
    expectedContext,
    blocksMerge: context.blocksMerge(moment, expectedContext),
    facadeReadsDeclaration: facade,
    bucket: legal
      ? classifyBucket({
          active,
          mode,
          commandExists,
          executors,
          facade,
          atMergeMoment: moment === context.mergeMoment,
          facadeKnown: context.facadeKnown,
        })
      : {
          state: "not-applicable",
          reason: "moment-illegal",
          message: `The registry does not permit declaring this gate at ${moment}.`,
        },
  };
}

/**
 * What the settings file says, degrading to `not-declared` only when it is.
 * @param entry - The raw per-moment entry
 * @param resolved - Resolved gates at this moment, or null
 * @param failure - Why resolution failed, when it did
 * @param id - Gate id
 * @returns The declaration state
 */
function declarationOf(
  entry: Record<string, unknown> | null,
  resolved: ReadonlyMap<string, ResolvedGate> | null,
  failure: string | null,
  id: string
): DeclarationState {
  if (resolved !== null) return asDeclaration(resolved.get(id)?.level);
  if (failure !== null && entry !== null) return asDeclaration(entry.level);
  return UNDECLARED;
}

/**
 * Narrow a raw level to a declaration state.
 *
 * Anything that is not one of the three levels is `not-declared` — including a
 * level Lisa does not know, which is a typo rather than a claim.
 * @param level - The raw level
 * @returns The declaration state
 */
function asDeclaration(level: unknown): DeclarationState {
  return DECLARED_LEVELS.has(level as string)
    ? (level as DeclarationState)
    : UNDECLARED;
}

/**
 * The proof mode for a cell.
 * @param declaration - What the settings file says
 * @param hit - The resolved gate, when resolution succeeded
 * @returns The mode, or null when nothing is declared
 */
function modeOf(
  declaration: DeclarationState,
  hit: ResolvedGate | undefined
): ProofMode | null {
  if (declaration === UNDECLARED) return null;
  if (declaration === "off") return "off";
  const mode = hit?.mode;
  if (mode === "run" || mode === "await" || mode === "intercept") return mode;
  return "run";
}

/**
 * The command a cell would run.
 *
 * Built for an undeclared pair too. "What would run here if this were turned
 * on, and does that command exist" is the question a project with zero
 * declarations opened the report to ask.
 * @param mode - Proof mode
 * @param task - Resolved task
 * @param runner - The project's runner
 * @returns The command, or null
 */
function cellCommand(
  mode: ProofMode | null,
  task: string | null,
  runner: string
): string | null {
  if (task === null || mode === "off") return null;
  return `${runner} ${task}`;
}

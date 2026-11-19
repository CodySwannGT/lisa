/**
 * The shipped ruleset code `lisa controls protect` is built from.
 *
 * Lisa already has one way to derive the checks a pull request must pass
 * (`contextsFor` in the gate registry), one way to compare them with a
 * repository's live rulesets and write the difference
 * (`lisa-reconcile-policy.mjs`), one generator for a ruleset's shape
 * (`lisa-ruleset-payload.mjs`) and one matcher for the branches a ruleset
 * governs (`lisa-ruleset-reach.mjs`). `protect` does not restate any of them.
 * It imports those scripts from the running Lisa package, the same way
 * `lisa health` does, so the command, the applier and the reconciler can
 * never disagree about what a declaration requires or how a ruleset is
 * written.
 * @module controls/protect-modules
 */
import path from "node:path";
import { pathToFileURL } from "node:url";

import { resolveGateRegistryPath } from "../cli/gate-registry-source.js";
import type { GatesModule } from "./gates-declaration.js";

/** What one `gh` call answers; the shape the reconciler's runner returns. */
export interface GhResult {
  readonly ok: boolean;
  readonly stdout: string;
  readonly stderr: string;
  /** `gh` is not installed. */
  readonly missing?: boolean;
  /** `gh` was killed before it finished. */
  readonly timedOut?: boolean;
}

/** Runs `gh` with fixed arguments and, for a write, a request body. */
export type GhRunner = (
  args: readonly string[],
  options?: { readonly input?: string }
) => GhResult;

/** A ruleset as the platform returns it. Only the named fields are read. */
export interface LiveRuleset {
  readonly name?: unknown;
  readonly id?: unknown;
  readonly rules?: unknown;
}

/** One required check a live ruleset carries. */
interface LiveContext {
  readonly context: string;
  readonly integration_id: number | null;
  readonly ruleset: string;
}

/** One declared requirement: a check, and where and by whom when stated. */
export interface CheckRecord {
  readonly context: string;
  readonly ruleset?: string;
  readonly integration_id?: number;
}

/** The comparison of declared checks with live ones. */
export interface ContextDrift {
  readonly missing: readonly string[];
  readonly missingRecords: readonly CheckRecord[];
  readonly matched: readonly string[];
}

/** One step of a repair. A `manual` step is a message and is never sent. */
export interface RepairAction {
  readonly kind: string;
  readonly message?: string;
  readonly ruleset?: string;
  readonly rulesetId?: unknown;
  readonly add?: readonly string[];
  readonly payload?: Readonly<Record<string, unknown>>;
}

/** What became of one repair step. */
interface RepairOutcome {
  readonly action: RepairAction;
  readonly applied: boolean;
  readonly note: string | null;
}

/** Everything one read of the repository returned, or why it failed. */
export type LivePolicyRead =
  | {
      readonly ok: true;
      readonly rulesets: readonly LiveRuleset[];
      /** How many rulesets the list held, whatever each one applies to. */
      readonly listed: number;
      readonly settings: Readonly<Record<string, unknown>>;
    }
  | {
      readonly ok: false;
      readonly unproven: { readonly reason: string; readonly detail: string };
    };

/** The slice of `lisa-reconcile-policy.mjs` the command calls. */
interface ReconcileModule {
  readonly ghRunner: GhRunner;
  /** Why a read gave up, by the name the reconciler reports it under. */
  readonly UNPROVEN: {
    readonly NO_CLI: string;
    readonly UNAUTHENTICATED: string;
  };
  readonly readLivePolicy: (options: {
    readonly repo: string;
    readonly gh: GhRunner;
  }) => LivePolicyRead;
  readonly liveContexts: (rulesets: readonly unknown[]) => LiveContext[];
  readonly reconcileContexts: (options: {
    readonly declared: readonly string[];
    readonly live: readonly LiveContext[];
    readonly homes: Readonly<Record<string, string>>;
    readonly pins: Readonly<Record<string, number>>;
    readonly records: readonly CheckRecord[];
    readonly awaited: readonly CheckRecord[];
  }) => ContextDrift;
  readonly planRepairs: (options: {
    readonly contexts: ContextDrift & { readonly extra: readonly never[] };
    readonly settings: { readonly drift: readonly never[] };
    readonly live: { readonly rulesets: readonly LiveRuleset[] };
    readonly prune: false;
    readonly rulesetName: string | null;
    readonly awaited: readonly CheckRecord[];
    readonly pins: Readonly<Record<string, number>>;
    readonly homes: Readonly<Record<string, string>>;
  }) => RepairAction[];
  readonly applyRepairs: (options: {
    readonly repo: string;
    readonly gh: GhRunner;
    readonly plan: readonly RepairAction[];
  }) => RepairOutcome[];
  readonly declaredChecks: (requiredChecks: unknown) => {
    readonly homes: Readonly<Record<string, string>>;
    readonly pins: Readonly<Record<string, number>>;
    readonly records: readonly CheckRecord[];
  };
  readonly awaitedContexts: (gates: unknown, moment: string) => string[];
  readonly awaitedPins: (
    gates: unknown,
    moment: string
  ) => Record<string, number>;
  readonly awaitedHome: (
    live: { readonly rulesets: readonly LiveRuleset[] },
    rulesetName: string | null
  ) => string | null;
}

/** The slice of `lisa-ruleset-payload.mjs` the command calls. */
interface PayloadModule {
  readonly buildRulesetPayload: (input: {
    readonly gates: Readonly<Record<string, unknown>>;
    readonly policy: unknown;
  }) => Readonly<Record<string, unknown>>;
}

/** The slice of `lisa-ruleset-reach.mjs` the command calls. */
interface ReachModule {
  readonly rulesetReach: (input: {
    readonly ruleset: unknown;
    readonly branches: readonly string[];
    readonly defaultBranch: string | undefined;
  }) => {
    /** The ruleset's name, or `""` when the payload has none. */
    readonly name: string;
    /** `governs`, `undetermined`, or a word for why it governs nothing. */
    readonly verdict: string;
    readonly matched: readonly string[];
    /** Why, for every verdict but `governs`. */
    readonly reason: string;
  };
}

/** The gate registry, with the two functions the register does not use. */
type ProtectGatesModule = Omit<GatesModule, "readGates"> & {
  readonly contextsFor: (
    gates: unknown,
    options: { readonly moment: string }
  ) => string[];
  readonly verifyContextsPosted: (input: {
    readonly derived: readonly string[];
    readonly posted: readonly string[];
  }) => { readonly ok: boolean; readonly missing: string[] };
  readonly readGates: (cwd: string) => {
    readonly runner: string;
    readonly gates: Record<string, unknown>;
    readonly policy?: unknown;
    readonly config?: Readonly<Record<string, unknown>>;
  };
};

/** Every shipped script the command is built from. */
export interface ProtectionModules {
  readonly gates: ProtectGatesModule;
  readonly reconcile: ReconcileModule;
  readonly payload: PayloadModule;
  readonly reach: ReachModule;
}

/** Each script's path from the Lisa package root. */
const SCRIPT_PATHS = {
  reconcile: ["all", "copy-overwrite", "scripts", "lisa-reconcile-policy.mjs"],
  payload: ["scripts", "lisa-ruleset-payload.mjs"],
  reach: ["scripts", "lisa-ruleset-reach.mjs"],
} as const;

/** How many folders the gate registry sits below the package root. */
const REGISTRY_DEPTH = 4;

/**
 * Import the shipped ruleset scripts from the running Lisa package.
 * @returns The scripts
 * @throws {Error} When this copy of Lisa does not hold them
 */
export async function loadProtectionModules(): Promise<ProtectionModules> {
  const registry = resolveGateRegistryPath();
  if (registry === null) {
    throw new Error(
      "The gate registry is missing from this copy of Lisa (expected all/copy-overwrite/scripts/lisa-gates.mjs). Reinstall Lisa."
    );
  }
  const packageRoot = path.resolve(
    registry,
    ...Array.from({ length: REGISTRY_DEPTH }, () => "..")
  );
  const load = async <T>(file: string): Promise<T> =>
    (await import(pathToFileURL(file).href)) as unknown as T;
  const shipped = (segments: readonly string[]): string =>
    path.join(packageRoot, ...segments);
  const [gates, reconcile, payload, reach] = await Promise.all([
    load<ProtectGatesModule>(registry),
    load<ReconcileModule>(shipped(SCRIPT_PATHS.reconcile)),
    load<PayloadModule>(shipped(SCRIPT_PATHS.payload)),
    load<ReachModule>(shipped(SCRIPT_PATHS.reach)),
  ]);
  return { gates, reconcile, payload, reach };
}

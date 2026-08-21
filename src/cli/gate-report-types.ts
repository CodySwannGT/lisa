/**
 * The shape of the deterministic gate report.
 *
 * Every fact in this payload carries one of three states, never two.
 * `verified` means this run checked it and this is the answer — including when
 * the answer is "no". `unknown` means the fact exists but this run could not
 * reach it. `not-applicable` means there is no such fact here at all.
 *
 * The distinction is the whole point of the report rather than a nicety. This
 * repository has catalogued controls that reported success while proving
 * nothing; a report that folded "could not check" into "pass" would be that
 * defect sited at the one screen an operator would trust. So `unknown` is
 * structurally distinct — not a boolean, not an absent key, not a default — and
 * every count states its unknown band explicitly.
 * @module cli/gate-report-types
 */

import type {
  DeclarationDriftReport,
  DeclarationState,
} from "../core/gate-declaration-drift.js";

/** Report format version, bumped when a consumer would have to change. */
export const GATE_REPORT_VERSION = 2;

/**
 * One fact, in one of the three states.
 *
 * `unknown` and `not-applicable` both carry a machine `reason` and a human
 * `message`, matching the live-status `ProbeResult` contract the console
 * already renders — a report that says "not checkable here" without saying why
 * is indistinguishable from a bug.
 */
export type Finding<T> =
  | { readonly state: "verified"; readonly value: T }
  | {
      readonly state: "unknown";
      readonly reason: string;
      readonly message: string;
    }
  | {
      readonly state: "not-applicable";
      readonly reason: string;
      readonly message: string;
    };

/**
 * What the settings file says about one gate at one moment.
 *
 * Defined once in `core/gate-declaration-drift` and re-exported here. The
 * declaration-versus-ruleset comparison turns on the difference between `off`
 * and `not-declared`, so a second definition that drifted by one member would
 * be a defect in exactly the place the comparison exists to protect.
 */
export type { DeclarationState };

/** How a declared gate is proved. */
export type ProofMode = "run" | "await" | "intercept" | "off";

/**
 * Which of the four task sources won, narrowest first.
 *
 * Two projects render identically and behave differently if a per-moment `run`
 * is not distinguished from a gate-level one, so the report names the winner
 * rather than only the result.
 */
export type TaskProvenance =
  | "moment-run"
  | "gate-run"
  | "registry-task-at"
  | "registry-task"
  | "none";

/**
 * The four buckets, computed per (gate, moment) pair rather than per gate.
 *
 * A pair is genuinely mixed — the same gate can be A at push and B at
 * pull-request in one repository — so a gate-level bucket would have to
 * summarise a mixed verdict.
 */
export type Bucket = "A" | "B" | "C" | "D";

/** One executor this run proved would run the gate's task. */
export interface ExecutorEvidence {
  /** How the executor was found. */
  readonly kind: "gate-runner" | "hook-builtin" | "hook-literal";
  /** Project-relative file holding it. Never an absolute path. */
  readonly file: string;
  /** Operator-readable sentence. */
  readonly detail: string;
}

/** Whether a required status context stands between this gate and a merge. */
export interface MergeBlock {
  /** True when the ruleset requires a context this gate produces. */
  readonly required: boolean;
  /** The matching required context, when there is one. */
  readonly context: string | null;
}

/** One (gate, moment) pair — the report's real unit. */
export interface GateMomentCell {
  /** The moment, including any `:environment` suffix. */
  readonly moment: string;
  /** Whether the registry permits declaring this gate here. */
  readonly legal: boolean;
  /** What the settings file says. */
  readonly declaration: DeclarationState;
  /** How it is proved, or null when nothing is declared. */
  readonly mode: ProofMode | null;
  /** The signal an `await` gate waits for. */
  readonly awaits: string | null;
  /** The task that would run. */
  readonly task: string | null;
  /** The task with the project's runner in front of it. */
  readonly command: string | null;
  /** Which of the four sources supplied the task. */
  readonly provenance: TaskProvenance;
  /** Whether `package.json` scripts actually define that task. */
  readonly commandExists: Finding<boolean>;
  /** Executors this run proved. Empty is a real answer, not an unknown. */
  readonly executors: readonly ExecutorEvidence[];
  /** The branch-protection context this declaration implies, if any. */
  readonly expectedContext: string | null;
  /** Tier 2 — the live ruleset, or an honest unknown. */
  readonly blocksMerge: Finding<MergeBlock>;
  /** Tier 3 — lives in a `quality.yml` no consumer holds. */
  readonly facadeReadsDeclaration: Finding<boolean>;
  /** A, B, C, D, or an explicit refusal to classify. */
  readonly bucket: Finding<Bucket>;
}

/** One registry gate, with a cell for every moment on the report's axis. */
export interface GateReportRow {
  /** Registry id. */
  readonly id: string;
  /** CI job name — load-bearing, a ruleset names contexts by exact string. */
  readonly label: string;
  /** What a pass proves. */
  readonly summary: string;
  /** The moments the registry permits, sorted. */
  readonly legalMoments: readonly string[];
  /** The registry's default prover. */
  readonly defaultTask: string | null;
  /** Registry task swaps that ship to everyone, keyed by moment family. */
  readonly taskAt: Readonly<Record<string, string>>;
  /** A project-wide `run` override, applying at every moment. */
  readonly projectTask: string | null;
  /** Registry flag: the task may rewrite the working tree. */
  readonly mayRewrite: boolean;
  /** Registry flag: the task costs minutes, not seconds. */
  readonly costly: boolean;
  /** The interception this gate is, when a task cannot implement it. */
  readonly interceptor: string | null;
  /** The `quality.yml` job this gate maps to, from the static table. */
  readonly qualityJob: string | null;
  /** One cell per moment on the report's axis, in axis order. */
  readonly moments: readonly GateMomentCell[];
}

/** One `skip_jobs` token the project still forwards, and its migration. */
export interface SkipJobRow {
  /** The token exactly as the caller spells it. */
  readonly token: string;
  /** One of the registry's `SKIP_JOB_STATUS` values. */
  readonly status: string;
  /** The gate that replaces it, or null. */
  readonly gate: string | null;
  /** The declaration to write, or null when none exists. */
  readonly declaration: string | null;
}

/** How the declared contexts compare with the ones a ruleset requires. */
export interface RulesetComparison {
  /** Declared required and required by the ruleset. */
  readonly matched: readonly string[];
  /** Declared required, absent from the ruleset — governs nothing. */
  readonly declaredNotRequired: readonly string[];
  /** Required by the ruleset, governed by no declaration. */
  readonly requiredNotDeclared: readonly string[];
}

/** Counts, each stating its denominator and its unknown band. */
export interface GateReportSummary {
  /** Registry gates in this report. */
  readonly gateCount: number;
  /** Moments on the report's axis. */
  readonly momentCount: number;
  /** Gates carrying at least one `required` or `optional` declaration. */
  readonly governedBySettings: number;
  /** Gates whose only declarations are `off`. */
  readonly declaredOffOnly: number;
  /** Gates the settings file never mentions. */
  readonly notDeclared: number;
  /** Legal (gate, moment) pairs — the denominator for the buckets. */
  readonly legalCells: number;
  /** Bucket membership counts. Unclassifiable pairs are counted separately. */
  readonly buckets: Readonly<Record<Bucket, number>>;
  /** Pairs this run declined to classify. Never folded into D. */
  readonly bucketUnknown: number;
  /** Declared pairs whose task is missing from `package.json` — bucket C. */
  readonly declaredWithoutCommand: number;
  /** Undeclared pairs proved anyway by a command written into a script. */
  readonly provedAnyway: number;
}

/** The whole payload emitted under `lisa doctor --json`. */
export interface GateReport {
  /** Format version. */
  readonly version: number;
  /** Where the registry was read from, or why it could not be. */
  readonly registrySource: Finding<string>;
  /** The runner gate commands are built with. */
  readonly runner: Finding<string>;
  /** Whether the runner came from the project or from Lisa's default. */
  readonly runnerSource: "declared" | "default" | "unknown";
  /** Every moment the report has a column for, in a stable order. */
  readonly momentAxis: readonly string[];
  /** Everything `validateGates` objected to, verbatim. */
  readonly declarationProblems: readonly string[];
  /** One row per registry gate, sorted by id. */
  readonly gates: readonly GateReportRow[];
  /** The project's forwarded `skip_jobs` tokens. */
  readonly skipJobs: Finding<readonly SkipJobRow[]>;
  /** Declared contexts against the live ruleset — Tier 2. */
  readonly ruleset: Finding<RulesetComparison>;
  /**
   * The declaration held against each surface that enforces it.
   *
   * Two surfaces, reported separately and never merged. `templates` needs no
   * network and says what protection would require the moment anyone
   * provisions it; `live` says what the repository requires right now, and is
   * `unknown` whenever this run could not read it. Folding them into one
   * verdict would let a reachable surface vouch for an unreachable one.
   */
  readonly declarationDrift: {
    readonly templates: Finding<DeclarationDriftReport>;
    readonly live: Finding<DeclarationDriftReport>;
  };
  /** Counts. */
  readonly summary: GateReportSummary;
}

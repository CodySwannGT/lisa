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
 * Which of the five task sources won, narrowest first.
 *
 * Two projects render identically and behave differently if a per-moment `run`
 * is not distinguished from a gate-level one, so the report names the winner
 * rather than only the result.
 *
 * `registry-shipped-as` is the widest and the only one that depends on what is
 * installed rather than on what is declared: the registry's `shippedAs` alias,
 * used where the concern-named default resolves to no script in this project
 * and the alias resolves to one. It is named separately because it means
 * something no other source does — nobody chose this command, the template
 * that installed the script did.
 */
export type TaskProvenance =
  | "moment-run"
  | "gate-run"
  | "registry-task-at"
  | "registry-task"
  | "registry-shipped-as"
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

/**
 * Whether this gate stands between a change and a merge.
 *
 * Three answers, not two, and the middle one is what the column exists for.
 * A property proved inside a job named after a different gate still blocks the
 * merge — but a red build then names a property that did not fail, and the
 * report that collapses that into "yes" cannot surface the class at all.
 */
export interface MergeVerdict {
  /** Whether it blocks, and under whose name. */
  readonly verdict: "yes" | "yes-under-another-name" | "no";
  /** The required context doing the blocking, when there is one. */
  readonly context: string | null;
  /** The job whose name it blocks under, when that is not this gate's own. */
  readonly underJob: string | null;
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
  /**
   * Whether a merge is blocked on this gate — Tier 2 joined with the workflow.
   *
   * Row-level rather than per-cell because a ruleset guards a merge and only
   * the merge moment produces the contexts it names; asking it of `commit`
   * would be asking a question that has no answer by construction.
   */
  readonly merge: Finding<MergeVerdict>;
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
  /**
   * Of those, the ones an upstream limitation accounts for.
   *
   * Not a softening: the pair is still unclassified and still counts into
   * `bucketUnknown`. It is the difference between telling an operator their
   * project is largely unverified and telling them one upstream defect with a
   * ticket number affects this many rows.
   */
  readonly bucketUnknownUpstream: number;
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
  /**
   * Every context a merge is blocked on, with who owns it.
   *
   * A Lisa-shaped report describing only Lisa's own jobs invites the
   * conclusion that it is the whole picture of what gates this work. It is
   * not: a project's CI almost always carries jobs Lisa neither ships nor
   * governs, and some of them block merges.
   */
  readonly requiredContexts: Finding<readonly RequiredContextRow[]>;
  /** Agent hooks proved active at `pre-tool`, or why they could not be read. */
  readonly agentHooks: Finding<readonly AgentHookEvidence[]>;
  /** Which workflow files answered Tier 3, and whether `quality.yml` was one. */
  readonly facadeSource: FacadeSource;
  /**
   * Limitations of Lisa itself, each stated once with the count it affects.
   *
   * Empty is the goal state. Every entry here is a row this report could not
   * answer for a reason that is not the project's doing.
   */
  readonly upstream: readonly UpstreamLimitation[];
  /**
   * Whether the project being reported on IS Lisa.
   *
   * Lisa is both a project and the upstream, so its own run is the one place
   * the upstream section is actionable rather than merely explanatory.
   */
  readonly projectIsUpstream: boolean;
  /** Counts. */
  readonly summary: GateReportSummary;
}

/**
 * Who owns a finding the report could not turn into a pass.
 *
 * The report has two audiences and they are not the same person. A consumer
 * asks "what is wrong with MY project, that I can fix"; showing them Lisa's
 * own unfixed defect as fifty-two blanks in their report tells them their
 * project is largely unverified when nothing about it is at fault.
 *
 * Attribution, never suppression. A finding is reattributed away from the
 * project only when it is provably not the project's — a missing script, an
 * absent declaration or an unrunnable command stays firmly in the project's
 * view however unflattering, and no reattribution ever turns a row green.
 */
export type Attribution = "project" | "lisa" | "third-party";

/**
 * One limitation of Lisa itself, stated once rather than per affected cell.
 *
 * "Fifty-two not checked here" is the wrong unit. It is ONE upstream
 * limitation affecting fifty-two cells, and it has a ticket number.
 */
export interface UpstreamLimitation {
  /** The machine `reason` the affected findings carry. */
  readonly reason: string;
  /** The upstream issue that closes it. */
  readonly ticket: string;
  /** One operator-readable sentence naming the limitation. */
  readonly headline: string;
  /** Why the report cannot answer, and what closing it would change. */
  readonly detail: string;
  /** How many things in THIS report it affects. */
  readonly affected: number;
  /** What those things are — checks, scripts — so the count reads as a fact. */
  readonly unit: string;
}

/**
 * One agent hook proved installed and active on this machine.
 *
 * These fire on every file an agent writes or edits — the `pre-tool` moment —
 * and no gate can be declared there at all, so nothing in a settings file can
 * govern, tune or switch them off. A `pre-tool` column rendered as a wall of
 * "not legal here" reads as "nothing happens here", and the truth is the more
 * alarming state: things run here that nothing can govern.
 */
export interface AgentHookEvidence {
  /** The enabled plugin supplying it, as the settings file spells it. */
  readonly plugin: string;
  /** The harness event it is registered on. */
  readonly event: string;
  /** The tool matcher it fires for. */
  readonly matcher: string;
  /** The script's file name. Never an absolute path — those differ per machine. */
  readonly script: string;
}

/** Where a required status context comes from. */
export type ContextOrigin =
  | "lisa-governed"
  | "lisa-undeclared"
  | "project-workflow"
  | "third-party";

/** One context a merge is actually blocked on, and who put it there. */
export interface RequiredContextRow {
  /** The context string, exactly as the ruleset names it. */
  readonly context: string;
  /** Who owns it. */
  readonly origin: ContextOrigin;
  /** Operator-readable sentence saying what that means here. */
  readonly detail: string;
}

/** Whether a project's own CI holds the workflow Tier 3 is written in. */
export interface FacadeSource {
  /** True when `.github/workflows/quality.yml` was read this run. */
  readonly present: boolean;
  /** Workflow files scanned for façade resolve steps, project-relative. */
  readonly files: readonly string[];
}

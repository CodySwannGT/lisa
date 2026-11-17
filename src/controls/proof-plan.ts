/**
 * Deciding, before anything is changed, whether an entry's proof can be run.
 *
 * Everything that can be settled by reading is settled here: the moment the
 * proof stands for, the two patch files, the command that measures the
 * entry, and whether the proof may run at all. An entry that cannot be proved
 * gets its result at this point and no file is touched for it.
 *
 * The questions are asked in a fixed order, and the first that settles the
 * entry's result is the one reported:
 *
 * 1. Is the entry enforced at commit or push? If not, it is `unproved`: a
 *    pull-request entry belongs to the hosting platform.
 * 2. Does the declaration name both halves? If not, `unproved`.
 * 3. Is what measures it a command? If not, `unknown`.
 * 4. Does the proof reach outside the repository without having been allowed
 *    to? If so, `unknown`, quoting what it says it does.
 * 5. Are both patch files there? A missing one is `unproved`; one that is
 *    there and cannot be read safely is `unknown`.
 * @module controls/proof-plan
 */
import { readProofPatch, type ProofPatchRead } from "./proof-patch.js";
import {
  PROOF_HALVES,
  PROOF_MOMENTS,
  PULL_REQUEST_MOMENT,
  type ProofEntryReason,
  type ProofEntryResult,
  type ProofHalf,
  type ProofOutcome,
} from "./proof-types.js";
import {
  externalEffectsDetail,
  missingHalvesDetail,
  noMomentDetail,
  notACommandDetail,
  unreadableDetail,
  type MissingHalf,
} from "./proof-wording.js";
import {
  mechanismAt,
  type CommandMechanism,
  type ControlRegisterEntry,
  type EnforcementPoint,
} from "./register-types.js";

/**
 * The longest one half of a proof may run, in seconds. It is the gate
 * runner's own ceiling for a command started with no shell, and a half with
 * no declared limit gets it: the time the same command has when the gate
 * runs it.
 */
export const PROOF_TIME_LIMIT_CEILING_SECONDS = 30 * 60;

/** A proof that can be run, with everything running it needs. */
export interface RunnableProof {
  readonly run: true;
  readonly entry: ControlRegisterEntry;
  /** The moment the proof stands for. */
  readonly moment: string;
  /** What measures the entry at that moment. */
  readonly mechanism: CommandMechanism;
  /** How long one half may run. */
  readonly timeLimitSeconds: number;
  /** The failure text the entry declares; empty when it declares none. */
  readonly shape: readonly string[];
  /** Each half's patch file and its content. */
  readonly patches: Readonly<
    Record<ProofHalf, { readonly file: string; readonly text: string }>
  >;
}

/** A proof to run, or the result of an entry that cannot be proved. */
export type ProofPlan =
  | RunnableProof
  | { readonly run: false; readonly result: ProofEntryResult };

/** What planning is given beside the entry. */
export interface ProofPlanContext {
  /** Real path of the repository the patch files are read from. */
  readonly root: string;
  /** Whether proofs that reach outside the repository may run. */
  readonly acknowledgeExternalEffects: boolean;
}

/**
 * The result of an entry whose proof was not run.
 * @param entry - The entry
 * @param verdict - Its result
 * @param verdict.outcome - `unproved` or `unknown`
 * @param verdict.reason - Why
 * @param verdict.detail - The same, as a sentence
 * @param verdict.moment - The moment the proof would have stood for
 * @returns The plan
 */
function settled(
  entry: ControlRegisterEntry,
  verdict: {
    readonly outcome: ProofOutcome;
    readonly reason: ProofEntryReason;
    readonly detail: string;
    readonly moment?: string;
  }
): ProofPlan {
  return {
    run: false,
    result: {
      entry_id: entry.id,
      gate: entry.gate,
      scope: entry.scope,
      criteria: entry.criteria,
      moment: verdict.moment ?? null,
      outcome: verdict.outcome,
      failed_halves: [],
      reason: verdict.reason,
      detail: verdict.detail,
      time_limit_seconds: null,
      halves: [],
    },
  };
}

/**
 * The enforcement point an entry's proof stands for: its first at commit or
 * push.
 * @param entry - The entry
 * @returns The point, or `undefined` when it has none there
 */
export function proofPoint(
  entry: ControlRegisterEntry
): EnforcementPoint | undefined {
  return entry.enforcement_points.find(point =>
    (PROOF_MOMENTS as readonly string[]).includes(point.moment)
  );
}

/**
 * Settle an entry that is not enforced where this runner can exercise it.
 * @param entry - The entry
 * @returns The plan
 */
function noMoment(entry: ControlRegisterEntry): ProofPlan {
  const moments = entry.enforcement_points.map(point => point.moment);
  const onPullRequests = moments.includes(PULL_REQUEST_MOMENT);
  return settled(entry, {
    outcome: "unproved",
    reason: onPullRequests ? "pull-request-moment" : "no-proof-moment",
    detail: noMomentDetail(moments, onPullRequests),
  });
}

/**
 * Settle an entry from what its declaration says, before any file is read.
 * @param entry - The entry
 * @param point - The enforcement point its proof stands for
 * @param context - Whether proofs that reach outside may run
 * @returns The entry's result, or the command that measures it when the
 *   declaration allows the proof
 */
function declarationVerdict(
  entry: ControlRegisterEntry,
  point: EnforcementPoint,
  context: ProofPlanContext
):
  | { readonly settled: ProofPlan }
  | { readonly settled: null; readonly mechanism: CommandMechanism } {
  const { moment } = point;
  const undeclared: readonly MissingHalf[] = PROOF_HALVES.filter(
    half => entry.proof[half] === null
  ).map(half => ({ half, file: null }));
  if (undeclared.length > 0) {
    return {
      settled: settled(entry, {
        outcome: "unproved",
        reason: "half-missing",
        detail: missingHalvesDetail(undeclared),
        moment,
      }),
    };
  }
  const mechanism = mechanismAt(entry, point);
  if (mechanism.kind !== "command") {
    return {
      settled: settled(entry, {
        outcome: "unknown",
        reason: "mechanism-not-a-command",
        detail: notACommandDetail(moment, mechanism.kind),
        moment,
      }),
    };
  }
  const effects = entry.proof.external_effects ?? [];
  return effects.length > 0 && !context.acknowledgeExternalEffects
    ? {
        settled: settled(entry, {
          outcome: "unknown",
          reason: "external-effects",
          detail: externalEffectsDetail(effects),
          moment,
        }),
      }
    : { settled: null, mechanism };
}

/**
 * Settle an entry whose patch files are not both there to plant.
 *
 * A missing file is asked about first. An entry with half a proof is
 * `unproved` whatever is wrong with the other half.
 * @param entry - The entry
 * @param moment - The moment the proof stands for
 * @param reads - What reading each half's file gave, in half order
 * @returns The plan, or `null` when both were read
 */
function patchVerdict(
  entry: ControlRegisterEntry,
  moment: string,
  reads: readonly ProofPatchRead[]
): ProofPlan | null {
  const missing: readonly MissingHalf[] = PROOF_HALVES.filter(
    (_, index) => reads[index]?.kind === "missing"
  ).map(half => ({ half, file: entry.proof[half] }));
  if (missing.length > 0) {
    return settled(entry, {
      outcome: "unproved",
      reason: "half-missing",
      detail: missingHalvesDetail(missing),
      moment,
    });
  }
  const unreadable = reads.find(read => read.kind === "unreadable");
  return unreadable?.kind === "unreadable"
    ? settled(entry, {
        outcome: "unknown",
        reason: "patch-unreadable",
        detail: unreadableDetail(unreadable.problem),
        moment,
      })
    : null;
}

/**
 * Decide whether an entry's proof can be run, and gather what running it
 * needs.
 * @param entry - The register entry
 * @param context - The repository, and whether proofs that reach outside it
 *   may run
 * @returns The proof to run, or the entry's result when it cannot be proved
 */
export async function planProof(
  entry: ControlRegisterEntry,
  context: ProofPlanContext
): Promise<ProofPlan> {
  const point = proofPoint(entry);
  if (point === undefined) return noMoment(entry);
  const declared = declarationVerdict(entry, point, context);
  if (declared.settled !== null) return declared.settled;

  const reads = await Promise.all(
    PROOF_HALVES.map(half =>
      readProofPatch(context.root, entry.proof[half] ?? "")
    )
  );
  const unplantable = patchVerdict(entry, point.moment, reads);
  if (unplantable !== null) return unplantable;

  const [violation, clean] = reads.map(read =>
    read.kind === "text" ? read.text : ""
  );
  return {
    run: true,
    entry,
    moment: point.moment,
    mechanism: declared.mechanism,
    timeLimitSeconds: Math.min(
      entry.proof.timeout_seconds ?? PROOF_TIME_LIMIT_CEILING_SECONDS,
      PROOF_TIME_LIMIT_CEILING_SECONDS
    ),
    shape: (entry.proof.failure_shape ?? []).filter(text => text !== ""),
    patches: {
      violation: { file: entry.proof.violation ?? "", text: violation ?? "" },
      clean: { file: entry.proof.clean ?? "", text: clean ?? "" },
    },
  };
}

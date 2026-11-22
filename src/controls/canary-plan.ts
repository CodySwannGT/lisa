/**
 * Deciding, before anything is created, whether an entry's pull-request
 * proof can be run with canaries.
 *
 * These are the questions the commit and push proofs are asked
 * (`./proof-plan.ts`), in the same order and with the same words, less the
 * one about a command: on a pull request the hosting platform's check is
 * what measures the entry.
 *
 * 1. Does the declaration name both halves? If not, `unproved`.
 * 2. Does the proof reach outside the repository without having been allowed
 *    to? If so, `unknown`, quoting what it says it does. A canary is itself
 *    an effect outside the repository, which the operator agreed to by
 *    asking for canaries; this is about what the proof declares beyond that.
 * 3. Are both patch files there? A missing one is `unproved`; one that is
 *    there and cannot be read safely is `unknown`.
 * @module controls/canary-plan
 */
import { readProofPatch } from "./proof-patch.js";
import { PROOF_TIME_LIMIT_CEILING_SECONDS } from "./proof-plan.js";
import {
  PROOF_HALVES,
  type ProofEntryResult,
  type ProofHalf,
} from "./proof-types.js";
import {
  externalEffectsDetail,
  missingHalvesDetail,
  unreadableDetail,
  type MissingHalf,
} from "./proof-wording.js";
import type { ControlRegisterEntry } from "./register-types.js";

/** A pull-request proof that can be run, with what running it needs. */
export interface RunnableCanaries {
  readonly run: true;
  /** How long one half may wait for the platform's answer. */
  readonly timeLimitSeconds: number;
  /** Each half's patch file and its content. */
  readonly patches: Readonly<
    Record<ProofHalf, { readonly file: string; readonly text: string }>
  >;
}

/** A proof to run, or why the entry is settled without one. */
export type CanaryPlan =
  | RunnableCanaries
  | ({ readonly run: false } & Pick<
      ProofEntryResult,
      "outcome" | "reason" | "detail"
    >);

/**
 * Decide whether an entry's pull-request proof can be run.
 * @param entry - The register entry
 * @param context - The repository, and whether proofs that reach outside it
 *   may run
 * @param context.root - Real path of the repository
 * @param context.acknowledgeExternalEffects - Whether they may
 * @returns The proof to run, or the entry's result when it cannot be
 */
export async function planCanaries(
  entry: ControlRegisterEntry,
  context: {
    readonly root: string;
    readonly acknowledgeExternalEffects: boolean;
  }
): Promise<CanaryPlan> {
  const undeclared: readonly MissingHalf[] = PROOF_HALVES.filter(
    half => entry.proof[half] === null
  ).map(half => ({ half, file: null }));
  if (undeclared.length > 0) {
    return {
      run: false,
      outcome: "unproved",
      reason: "half-missing",
      detail: missingHalvesDetail(undeclared),
    };
  }
  const effects = entry.proof.external_effects ?? [];
  if (effects.length > 0 && !context.acknowledgeExternalEffects) {
    return {
      run: false,
      outcome: "unknown",
      reason: "external-effects",
      detail: externalEffectsDetail(effects),
    };
  }
  const reads = await Promise.all(
    PROOF_HALVES.map(half =>
      readProofPatch(context.root, entry.proof[half] ?? "")
    )
  );
  const missing: readonly MissingHalf[] = PROOF_HALVES.filter(
    (_, index) => reads[index]?.kind === "missing"
  ).map(half => ({ half, file: entry.proof[half] }));
  if (missing.length > 0) {
    return {
      run: false,
      outcome: "unproved",
      reason: "half-missing",
      detail: missingHalvesDetail(missing),
    };
  }
  const unreadable = reads.find(read => read.kind === "unreadable");
  if (unreadable?.kind === "unreadable") {
    return {
      run: false,
      outcome: "unknown",
      reason: "patch-unreadable",
      detail: unreadableDetail(unreadable.problem),
    };
  }
  const [violation, clean] = reads.map(read =>
    read.kind === "text" ? read.text : ""
  );
  return {
    run: true,
    timeLimitSeconds: Math.min(
      entry.proof.timeout_seconds ?? PROOF_TIME_LIMIT_CEILING_SECONDS,
      PROOF_TIME_LIMIT_CEILING_SECONDS
    ),
    patches: {
      violation: { file: entry.proof.violation ?? "", text: violation ?? "" },
      clean: { file: entry.proof.clean ?? "", text: clean ?? "" },
    },
  };
}

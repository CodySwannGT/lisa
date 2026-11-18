/**
 * Deciding, by reading only, what `lisa controls proof-check` has to try for
 * each declared part.
 *
 * Everything that can be settled without a copy of the repository is settled
 * here, in a fixed order, and the first question that settles a part is the
 * one reported:
 *
 * 1. Does the part name any patch file? If not, it has no proof (`no-proof`).
 * 2. Does it name both? Are both files there, ordinary files under
 *    `.lisa/controls/proofs/`, and do they hold different changes?
 * 3. Does it declare failure text? Without it the attest step can never
 *    count a rejection.
 * 4. Is what measures it a command, and may the proof run at all?
 *
 * A part that gets through all of them is handed on as the same
 * `RunnableProof` the paired-proof runner plans (`./proof-plan.ts`), so the
 * command, the time limit and the failure text are read exactly as the
 * attest step reads them.
 *
 * Unlike the attest step, a part is checked whatever moment it runs at: the
 * pair of a check that runs before a merge is worth getting right too. Where
 * the attest step will not prove a part at commit or push, a note says why.
 * @module controls/proof-check-plan
 */
import type {
  DeclaredProof,
  ProofCheckPart,
  ProofCheckReason,
} from "./proof-check-types.js";
import {
  externalEffectsDetail,
  halfNotDeclaredDetail,
  identicalDetail,
  NO_FAILURE_TEXT_DETAIL,
  NO_PROOF_DETAIL,
  noMomentNote,
  notACommandDetail,
  optionalNote,
  patchMissingDetail,
  patchUnreadableDetail,
  pullRequestNote,
} from "./proof-check-wording.js";
import { PROOF_HALVES, type ProofHalf } from "./proof-halves.js";
import { readProofPatch, type ProofPatchRead } from "./proof-patch.js";
import {
  declaredFailureText,
  proofPoint,
  proofTimeLimitSeconds,
  type RunnableProof,
} from "./proof-plan.js";
import { PULL_REQUEST_MOMENT } from "./pull-request-executor.js";
import {
  mechanismAt,
  type ControlRegister,
  type ControlRegisterEntry,
} from "./register-types.js";

/** The moment written on a proof whose part runs at no moment at all. */
const NO_MOMENT = "none";

/** A part's plan: its result when nothing is tried, or what to try. */
export type ProofCheckPlan =
  | { readonly check: false; readonly part: ProofCheckPart }
  | {
      readonly check: true;
      readonly proof: RunnableProof;
      /** Why the attest step will not prove the part locally, if it will not. */
      readonly note: string | null;
    };

/** What planning is given beside the register. */
export interface ProofCheckPlanContext {
  /** Real path of the repository the patch files are read from. */
  readonly root: string;
  /** Whether proofs that say they reach outside the repository may run. */
  readonly acknowledgeExternalEffects: boolean;
}

/**
 * What a part's declaration says about its proof.
 * @param entry - The register entry of the part
 * @returns The two patch files and the failure text
 */
export function declaredProof(entry: ControlRegisterEntry): DeclaredProof {
  return {
    violation: entry.proof.violation,
    clean: entry.proof.clean,
    failure_shape: declaredFailureText(entry),
  };
}

/**
 * Say why the attest step will not prove a part at commit or push, when it
 * will not.
 * @param entry - The register entry of the part
 * @returns The note, or `null` when the attest step proves it there
 */
export function attestNote(entry: ControlRegisterEntry): string | null {
  const point = proofPoint(entry);
  if (point !== undefined) {
    return point.level === "optional" ? optionalNote(point.moment) : null;
  }
  return entry.enforcement_points.some(
    candidate => candidate.moment === PULL_REQUEST_MOMENT
  )
    ? pullRequestNote()
    : noMomentNote();
}

/**
 * The result of a part nothing is tried for.
 * @param entry - The register entry of the part
 * @param reason - Why nothing is tried
 * @param detail - The same as a sentence, with what to change
 * @returns The plan
 */
function settled(
  entry: ControlRegisterEntry,
  reason: ProofCheckReason,
  detail: string
): ProofCheckPlan {
  return {
    check: false,
    part: {
      entry_id: entry.id,
      gate: entry.gate,
      scope: entry.scope,
      result: reason === "no-proof" ? "no-proof" : "not-ready",
      reason,
      detail,
      note: null,
      proof: declaredProof(entry),
      halves: [],
    },
  };
}

/**
 * Settle a part whose two patch files are not both there to read.
 * @param entry - The register entry of the part
 * @param reads - What reading each half's file gave, in half order
 * @returns The plan, or `null` when both were read
 */
function unreadPatch(
  entry: ControlRegisterEntry,
  reads: readonly ProofPatchRead[]
): ProofCheckPlan | null {
  const first = PROOF_HALVES.map((half, index) => ({
    half,
    read: reads[index],
  })).find(({ read }) => read?.kind !== "text");
  if (first?.read === undefined) return null;
  const { half, read } = first;
  return read.kind === "unreadable"
    ? settled(
        entry,
        "patch-unreadable",
        patchUnreadableDetail(half, read.problem)
      )
    : settled(
        entry,
        "patch-missing",
        patchMissingDetail(half, entry.proof[half] ?? "")
      );
}

/**
 * Settle a part from what its declaration says about running the proof.
 * @param entry - The register entry of the part
 * @param context - Whether proofs that reach outside may run
 * @returns The plan, or `null` when the declaration allows the proof
 */
function declarationProblem(
  entry: ControlRegisterEntry,
  context: ProofCheckPlanContext
): ProofCheckPlan | null {
  if (declaredFailureText(entry).length === 0) {
    return settled(entry, "no-failure-text", NO_FAILURE_TEXT_DETAIL);
  }
  const effects = entry.proof.external_effects ?? [];
  return effects.length > 0 && !context.acknowledgeExternalEffects
    ? settled(entry, "external-effects", externalEffectsDetail(effects))
    : null;
}

/**
 * Decide what has to be tried for one declared part.
 * @param entry - The register entry of the part
 * @param context - The repository, and whether outside effects are allowed
 * @returns What to try, or the part's result when nothing is tried
 */
export async function planPart(
  entry: ControlRegisterEntry,
  context: ProofCheckPlanContext
): Promise<ProofCheckPlan> {
  const undeclared: readonly ProofHalf[] = PROOF_HALVES.filter(
    half => entry.proof[half] === null
  );
  const [missing] = undeclared;
  if (undeclared.length === PROOF_HALVES.length) {
    return settled(entry, "no-proof", NO_PROOF_DETAIL);
  }
  if (missing !== undefined) {
    return settled(entry, "half-not-declared", halfNotDeclaredDetail(missing));
  }
  const reads = await Promise.all(
    PROOF_HALVES.map(half =>
      readProofPatch(context.root, entry.proof[half] ?? "")
    )
  );
  const unread = unreadPatch(entry, reads);
  if (unread !== null) return unread;
  const [violation = "", clean = ""] = reads.map(read =>
    read.kind === "text" ? read.text : ""
  );
  const files = {
    violation: entry.proof.violation ?? "",
    clean: entry.proof.clean ?? "",
  };
  if (violation === clean) {
    return settled(
      entry,
      "patches-identical",
      identicalDetail(files.violation, files.clean)
    );
  }
  const refused = declarationProblem(entry, context);
  if (refused !== null) return refused;
  const point = proofPoint(entry);
  const mechanism =
    point === undefined ? entry.measuring_mechanism : mechanismAt(entry, point);
  if (mechanism.kind !== "command") {
    return settled(entry, "not-a-command", notACommandDetail(mechanism.kind));
  }
  return {
    check: true,
    note: attestNote(entry),
    proof: {
      run: true,
      entry,
      moment: point?.moment ?? entry.enforcement_points[0]?.moment ?? NO_MOMENT,
      mechanism,
      timeLimitSeconds: proofTimeLimitSeconds(entry),
      shape: declaredFailureText(entry),
      patches: {
        violation: { file: files.violation, text: violation },
        clean: { file: files.clean, text: clean },
      },
    },
  };
}

/**
 * Tell whether a register entry was generated from one of a gate's parts.
 *
 * Every such entry names what supports it, and no other entry does: the
 * entry of a gate with no parts is a check Lisa ships for a supported
 * project type, and its proof is not something a repository writes.
 * @param entry - The register entry
 * @returns Whether it is a declared part
 */
export function isDeclaredPart(entry: ControlRegisterEntry): boolean {
  return entry.evidence !== undefined;
}

/**
 * Decide what has to be tried for every declared part of a register. Nothing
 * is changed anywhere.
 * @param register - The control register
 * @param context - The repository, and whether outside effects are allowed
 * @returns One plan per declared part, in register order
 */
export async function planProofCheck(
  register: ControlRegister,
  context: ProofCheckPlanContext
): Promise<readonly ProofCheckPlan[]> {
  return Promise.all(
    register.entries
      .filter(entry => isDeclaredPart(entry))
      .map(entry => planPart(entry, context))
  );
}

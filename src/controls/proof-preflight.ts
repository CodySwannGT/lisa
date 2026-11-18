/**
 * Looking at both changes of a pair before any check is started.
 *
 * A proof never changes what the check is (`./proof-change-rule.ts`). The
 * runner cannot find that out half by half: a violating change that rewrites
 * the check is not run, and if the clean change were then run on its own and
 * let through, the two together would read as an answer about the control.
 * So each change of the pair is planted, the workspace is asked which file
 * of that kind it touches, and the change is taken back out, before either
 * check is started. A pair in which one change touches such a file is
 * settled `unknown` there, and neither check runs.
 *
 * A change that will not go in is passed over here. The half that plants it
 * says so when its turn comes.
 * @module controls/proof-preflight
 */
import type { RunnableProof } from "./proof-plan.js";
import {
  PROOF_HALVES,
  type PatchOutcome,
  type ProofHalf,
  type ProofWorkspace,
} from "./proof-types.js";

/** What looking at a pair found, before any check is started. */
export type PairStanding =
  /** Neither change edits what the check is. */
  | { readonly kind: "clear" }
  /** One change edits a file that says what the check is, or runs it. */
  | {
      readonly kind: "changes-check";
      readonly half: ProofHalf;
      /** The file, from the repository root. */
      readonly file: string;
    }
  /** A change could not be taken back out; the workspace cannot be used. */
  | { readonly kind: "spoiled"; readonly why: string };

/**
 * Call a workspace, turning anything it throws into a problem.
 * @param call - Plants a change or takes one back out
 * @returns What the workspace answered
 */
async function attempt(
  call: () => PatchOutcome | Promise<PatchOutcome>
): Promise<PatchOutcome> {
  try {
    return await call();
  } catch (error) {
    return { problem: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Plant one change, ask what it touches, and take it back out.
 * @param proof - The proof the change belongs to
 * @param half - Which change
 * @param workspace - Where it is planted
 * @param asked - Says which file of the kind the planted change touches
 * @returns What was found about this change
 * @throws {Error} When the workspace cannot say what the change touches
 */
async function standingOf(
  proof: RunnableProof,
  half: ProofHalf,
  workspace: ProofWorkspace,
  asked: () => string | null | Promise<string | null>
): Promise<PairStanding> {
  const { text } = proof.patches[half];
  const planted = await attempt(() => workspace.apply(text));
  if (planted.problem !== null) return { kind: "clear" };
  const file = await asked();
  const restored = await attempt(() => workspace.restore(text));
  if (restored.problem !== null) {
    return {
      kind: "spoiled",
      why: `The ${half} change of ${proof.entry.id} was left in place: ${restored.problem}`,
    };
  }
  return file === null
    ? { kind: "clear" }
    : { kind: "changes-check", half, file };
}

/**
 * Look at both changes of a pair before any check is started.
 * @param proof - The proof about to be run
 * @param workspace - Where its changes are planted
 * @returns Whether the pair may be run, which change edits what the check
 *   is, or why the workspace can no longer be used
 * @throws {Error} When the workspace cannot say what a change touches
 */
export async function pairStanding(
  proof: RunnableProof,
  workspace: ProofWorkspace
): Promise<PairStanding> {
  const asked = workspace.changedCheckFile;
  if (asked === undefined) return { kind: "clear" };
  return PROOF_HALVES.reduce<Promise<PairStanding>>(
    async (earlier, half) => {
      const sofar = await earlier;
      return sofar.kind === "clear"
        ? standingOf(proof, half, workspace, asked)
        : sofar;
    },
    Promise.resolve({ kind: "clear" })
  );
}

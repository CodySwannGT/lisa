/**
 * Looking at both changes of a pair before any check is started.
 *
 * A proof never changes what the check is (`./proof-change-rule.ts`). The
 * runner cannot find that out half by half: a violating change that rewrites
 * the check is not run, and if the clean change were then run on its own and
 * let through, the two together would read as an answer about the control.
 * So each change of the pair is planted, the workspace is asked what it
 * touches that a proof's change may not, and the change is taken back out,
 * before either check is started. A pair in which one change touches such a
 * thing is settled `unknown` there, and neither check runs.
 *
 * A change that will not go in is passed over here. The half that plants it
 * says so when its turn comes.
 * @module controls/proof-preflight
 */
import type { ChangeFinding } from "./proof-change-rule.js";
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
  /**
   * One change touches something a proof's change may not: a file that says
   * what the check is or runs it, or a path the repository ignores.
   */
  | {
      readonly kind: "changes-check";
      readonly half: ProofHalf;
      /** What it touches. */
      readonly finding: ChangeFinding;
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
 * @param asked - Says what the planted change touches that it may not
 * @returns What was found about this change
 * @throws {Error} When the workspace cannot say what the change touches
 */
async function standingOf(
  proof: RunnableProof,
  half: ProofHalf,
  workspace: ProofWorkspace,
  asked: NonNullable<ProofWorkspace["changeFinding"]>
): Promise<PairStanding> {
  const { text } = proof.patches[half];
  const planted = await attempt(() => workspace.apply(text));
  if (planted.problem !== null) return { kind: "clear" };
  // A workspace that cannot answer still gets its change taken back out
  // before the failure is passed on.
  const answered = await Promise.resolve()
    .then(() =>
      asked({
        patch: text,
        command: { argv: proof.mechanism.argv, scope: proof.entry.scope },
      })
    )
    .then(
      finding => ({ finding, failure: null }),
      (failure: unknown) => ({ finding: null, failure })
    );
  const restored = await attempt(() => workspace.restore(text));
  if (restored.problem !== null) {
    return {
      kind: "spoiled",
      why: `The ${half} change of ${proof.entry.id} was left in place: ${restored.problem}`,
    };
  }
  if (answered.failure !== null) throw answered.failure;
  return answered.finding === null
    ? { kind: "clear" }
    : { kind: "changes-check", half, finding: answered.finding };
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
  const asked = workspace.changeFinding;
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

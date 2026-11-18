/**
 * The paired-proof runner: the one piece of code allowed to say a control
 * works.
 *
 * For each entry of the control register it plants a change that breaks the
 * entry's rule and triggers the entry's moment, then does the same with a
 * change that does not. The entry passes only when the first was rejected
 * and the second accepted. What a half showed and what the two together mean
 * are decided in `./proof-judgement.ts`; whether a proof can be run at all is
 * decided in `./proof-plan.ts`; whether its changes leave the check alone is
 * asked in `./proof-preflight.ts`; one half is run in `./proof-half-run.ts`.
 * This module only does things in order and puts the results together.
 *
 * ## Why the same inputs always give the same results
 *
 * Nothing here asks a model anything or opens a connection. Entries are
 * proved one at a time, in register order, and each half is planted, run and
 * taken back out before the next begins. The only clock read is the one
 * handed in, and it is read exactly twice per half. The folder the proofs ran
 * in is taken out of every piece of text that is kept, since it differs from
 * run to run. So two runs on the same repository give results that differ
 * only in their times — as long as the checks themselves print the same
 * thing twice.
 *
 * ## Where it runs
 *
 * It never touches a folder itself. It is handed a `ProofWorkspace`
 * (`./proof-types.ts`) and asks that to plant a change, trigger the moment
 * and put things back, so the same runner serves a plain copy of the
 * repository and a clone with the commit and push carriers installed.
 *
 * A change that cannot be taken back out leaves the workspace unfit for
 * anything after it. Every later half is then reported `unknown` without
 * being run, because a check run on files nobody can vouch for proves
 * nothing.
 * @module controls/proof-runner
 */
import { runHalf, type HalfContext } from "./proof-half-run.js";
import { entryVerdict } from "./proof-judgement.js";
import { planProof, type RunnableProof } from "./proof-plan.js";
import { pairStanding, type PairStanding } from "./proof-preflight.js";
import type { ProofJudge } from "./proof-tools.js";
import {
  PROOF_OUTCOMES,
  PROOF_RUN_SCHEMA_VERSION,
  type ProofCounts,
  type ProofEntryResult,
  type ProofHalf,
  type ProofRun,
  type ProofWorkspace,
} from "./proof-types.js";
import { pairChangesCheckDetail, verdictDetail } from "./proof-wording.js";
import type { ControlRegister } from "./register-types.js";

/** What a run of paired proofs is given. */
export interface PairedProofInputs {
  /** The register whose entries are proved. */
  readonly register: ControlRegister;
  /** Real path of the repository the patch files are read from. */
  readonly root: string;
  /** Where the changes are planted and the moments triggered. */
  readonly workspace: ProofWorkspace;
  /** Reads an answer the way the gate runner does. */
  readonly judge: ProofJudge;
  /** The clock every time in the results is read from. */
  readonly clock?: () => Date;
  /** Whether proofs that say they reach outside the repository may run. */
  readonly acknowledgeExternalEffects?: boolean;
}

/** The entries proved so far, and whether the workspace is still fit to use. */
interface Progress {
  readonly entries: readonly ProofEntryResult[];
  /** Why the workspace can no longer be vouched for, or `null` when it can. */
  readonly spoiled: string | null;
}

/**
 * Run both halves of one entry's proof and say what they show together.
 * @param proof - The proof to run
 * @param context - The workspace, the judge and the clock
 * @param spoiled - Why the workspace can no longer be vouched for, if it
 *   cannot
 * @returns The entry's result, and whether the workspace is still fit to use
 */
async function runProof(
  proof: RunnableProof,
  context: HalfContext,
  spoiled: string | null
): Promise<{
  readonly result: ProofEntryResult;
  readonly spoiled: string | null;
}> {
  // Both changes are looked at before either check is started: a proof
  // never changes what the check is. A workspace that is already unfit is
  // not asked; its halves say so below.
  const standing: PairStanding =
    spoiled === null
      ? await pairStanding(proof, context.workspace)
      : { kind: "clear" };
  if (standing.kind === "changes-check") {
    return { result: changesCheck(proof, standing), spoiled: null };
  }
  return runHalves(
    proof,
    context,
    standing.kind === "spoiled" ? standing.why : spoiled
  );
}

/**
 * The result of an entry whose proof was not run because one of its changes
 * edits what the check is.
 * @param proof - The proof
 * @param found - Which change, and the file it edits
 * @param found.half - The half the change belongs to
 * @param found.file - The file, from the repository root
 * @returns The entry's result
 */
function changesCheck(
  proof: RunnableProof,
  found: { readonly half: ProofHalf; readonly file: string }
): ProofEntryResult {
  const { entry } = proof;
  return {
    entry_id: entry.id,
    gate: entry.gate,
    scope: entry.scope,
    criteria: entry.criteria,
    moment: proof.moment,
    outcome: "unknown",
    failed_halves: [],
    reason: "declaration-changed",
    detail: pairChangesCheckDetail(found.half, found.file),
    time_limit_seconds: null,
    halves: [],
  };
}

/**
 * Run the two halves of one entry's proof, in order.
 * @param proof - The proof to run
 * @param context - The workspace, the judge and the clock
 * @param spoiled - Why the workspace can no longer be vouched for, if it
 *   cannot
 * @returns The entry's result, and whether the workspace is still fit to use
 */
async function runHalves(
  proof: RunnableProof,
  context: HalfContext,
  spoiled: string | null
): Promise<{
  readonly result: ProofEntryResult;
  readonly spoiled: string | null;
}> {
  const violation = await runHalf(proof, "violation", context, spoiled);
  const clean = await runHalf(proof, "clean", context, violation.spoiled);
  const verdict = entryVerdict(violation.result, clean.result);
  const unanswered = [violation.result, clean.result].find(
    half => half.outcome === "unknown"
  );
  const { entry } = proof;
  return {
    result: {
      entry_id: entry.id,
      gate: entry.gate,
      scope: entry.scope,
      criteria: entry.criteria,
      moment: proof.moment,
      ...verdict,
      detail: verdictDetail(verdict.reason, unanswered),
      time_limit_seconds: proof.timeLimitSeconds,
      halves: [violation.result, clean.result],
    },
    spoiled: clean.spoiled,
  };
}

/**
 * Put entry results together as one run, with its counts and whether it
 * passed.
 *
 * A run passes only when there is at least one entry and every entry
 * passed. No entries is not a pass: nothing was shown to work.
 * @param entries - One result per register entry, in register order
 * @returns The run
 */
export function proofRunOf(entries: readonly ProofEntryResult[]): ProofRun {
  const counts = Object.fromEntries(
    PROOF_OUTCOMES.map(outcome => [
      outcome,
      entries.filter(entry => entry.outcome === outcome).length,
    ])
  ) as ProofCounts;
  return {
    schema_version: PROOF_RUN_SCHEMA_VERSION,
    passed: entries.length > 0 && counts.passed === entries.length,
    counts,
    entries,
  };
}

/**
 * Run the paired proof of every entry in a control register.
 *
 * Nothing is written anywhere but the workspace, and the workspace is left
 * as it was found.
 * @param inputs - The register, the repository, the workspace, the judge and
 *   the clock
 * @returns One result per entry, in register order
 */
export async function runPairedProofs(
  inputs: PairedProofInputs
): Promise<ProofRun> {
  const context: HalfContext = {
    workspace: inputs.workspace,
    judge: inputs.judge,
    clock: inputs.clock ?? (() => new Date()),
  };
  const planning = {
    root: inputs.root,
    acknowledgeExternalEffects: inputs.acknowledgeExternalEffects === true,
  };
  const done = await inputs.register.entries.reduce<Promise<Progress>>(
    async (earlier, entry) => {
      const { entries, spoiled } = await earlier;
      const plan = await planProof(entry, planning);
      if (!plan.run) return { entries: [...entries, plan.result], spoiled };
      const proved = await runProof(plan, context, spoiled);
      return { entries: [...entries, proved.result], spoiled: proved.spoiled };
    },
    Promise.resolve({ entries: [], spoiled: null })
  );
  return proofRunOf(done.entries);
}

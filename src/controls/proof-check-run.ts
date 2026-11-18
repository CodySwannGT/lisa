/**
 * Trying each part's pair of changes, and saying whether the pair is one
 * the attest step can use.
 *
 * For a part whose declaration got through `./proof-check-plan.ts`, three
 * more questions are asked in a fresh clone of the last commit, in this
 * order, and the first that goes wrong is the one reported:
 *
 * 1. Does each change apply to the last commit?
 * 2. Does each change touch a file inside the part's own folder? A change
 *    that touches nothing there never starts the part's check at commit or
 *    push. A change that edits a file that says what the checks are or runs
 *    them (`./proof-change-rule.ts`), or that leaves nothing git would
 *    commit, is turned away at the same point.
 * 3. Started on the violating change, does the part's own command fail and
 *    print the declared failure text? Started on the clean change, does it
 *    pass, without printing that text?
 *
 * ## One judgement, not two
 *
 * The third question is the paired proof's own. The command is started and
 * its answer read by `measureChange` (`./before-enforce-observe.ts`), which
 * is what the before-enforce run uses for the same thing: the gate runner's
 * `judgePart`, then the declared failure text. Nothing here decides what an
 * exit status or a line of output means. This module only turns that
 * reading into a sentence that says what to change.
 *
 * The clone is put back to its starting commit after every change. If it
 * ever cannot be, the run stops: a check run on files nobody can vouch for
 * says nothing about a pair.
 * @module controls/proof-check-run
 */
import {
  measureChange,
  type BeforeEnforceContext,
} from "./before-enforce-observe.js";
import type { BeforeEnforceTool } from "./before-enforce-types.js";
import { declaredProof, type ProofCheckPlan } from "./proof-check-plan.js";
import type {
  ProofCheckHalf,
  ProofCheckPart,
  ProofCheckReason,
} from "./proof-check-types.js";
import {
  cleanRejectedDetail,
  failureTextOnCleanDetail,
  killedDetail,
  noChangeDetail,
  notAppliedDetail,
  nothingMeasuredDetail,
  notStartedDetail,
  outsideFolderDetail,
  READY_DETAIL,
  timedOutDetail,
  VIOLATION_ACCEPTED_DETAIL,
  wrongFailureTextDetail,
} from "./proof-check-wording.js";
import type {
  PlantedChange,
  ProofCheckWorkspace,
} from "./proof-check-workspace.js";
import { PROOF_HALVES, type ProofHalf } from "./proof-halves.js";
import {
  PROOF_TIME_LIMIT_CEILING_SECONDS,
  type RunnableProof,
} from "./proof-plan.js";
import { declarationChangedDetail } from "./proof-wording.js";

/** What trying the planned parts needs. */
export interface ProofCheckContext extends BeforeEnforceContext {
  /** The fresh clone the changes are tried in. */
  readonly workspace: ProofCheckWorkspace;
}

/** A part whose declaration allows its pair to be tried. */
type PlannedPart = Extract<ProofCheckPlan, { readonly check: true }>;

/** Why a part is not ready: the code, and the sentence. */
interface Problem {
  readonly reason: ProofCheckReason;
  readonly detail: string;
}

/** One change that applied, and what it touches. */
interface Tried {
  readonly half: ProofHalf;
  readonly change: PlantedChange;
}

/** The changes that applied, and the first that did not. */
interface Planting {
  readonly tried: readonly Tried[];
  readonly refused: {
    readonly half: ProofHalf;
    readonly problem: string;
  } | null;
}

/** What the part's command said about each change it was started on. */
type Runs = Partial<Record<ProofHalf, BeforeEnforceTool>>;

/**
 * Stop the run because the clone can no longer be vouched for.
 * @param why - What could not be undone
 * @throws {Error} Always
 */
function spoiled(why: string): never {
  throw new Error(
    `The temporary copy could not be put back to its starting commit, so nothing more was checked. ${why} Nothing in your repository was changed. Run this again.`
  );
}

/**
 * Put each change on the last commit in turn, and note what it touches.
 * @param proof - The part and its two changes
 * @param workspace - The fresh clone
 * @returns The changes that applied, and the first that did not
 */
async function plantEach(
  proof: RunnableProof,
  workspace: ProofCheckWorkspace
): Promise<Planting> {
  return PROOF_HALVES.reduce<Promise<Planting>>(
    async (earlier, half) => {
      const sofar = await earlier;
      if (sofar.refused !== null) return sofar;
      const planted = await workspace.plant(proof.patches[half].text);
      if (planted.problem !== null) {
        return { ...sofar, refused: { half, problem: planted.problem } };
      }
      const change = workspace.planted(proof.entry.scope);
      const restored = await workspace.restore();
      if (restored.problem !== null) spoiled(restored.problem);
      return { tried: [...sofar.tried, { half, change }], refused: null };
    },
    Promise.resolve({ tried: [], refused: null })
  );
}

/**
 * Say what is wrong with where the changes are, when something is.
 * @param proof - The part
 * @param tried - Each change and what it touches
 * @returns The problem, or `null` when both changes are in the right place
 */
function misplaced(
  proof: RunnableProof,
  tried: readonly Tried[]
): Problem | null {
  const { scope } = proof.entry;
  const first = (
    wrong: (change: PlantedChange) => boolean
  ): Tried | undefined => tried.find(({ change }) => wrong(change));
  // The rule the attest step holds a pair to as well; see
  // ./proof-change-rule.ts.
  const edits = first(change => change.checkFile !== null);
  if (edits !== undefined && edits.change.checkFile !== null) {
    return {
      reason: "declaration-changed",
      detail: declarationChangedDetail(edits.half, edits.change.checkFile),
    };
  }
  const empty = first(change => change.paths.length === 0);
  if (empty !== undefined) {
    return { reason: "no-change", detail: noChangeDetail(empty.half, scope) };
  }
  const outside = first(change => !change.startsCheck);
  return outside === undefined
    ? null
    : {
        reason: "outside-folder",
        detail: outsideFolderDetail(outside.half, scope),
      };
}

/**
 * Say why a command that never ran to an answer is a problem.
 * @param proof - The part
 * @param half - Which change it was started on
 * @param tool - What the command left behind
 * @returns The problem
 */
function unanswered(
  proof: RunnableProof,
  half: ProofHalf,
  tool: BeforeEnforceTool
): Problem {
  if (tool.reason === "timed-out") {
    return {
      reason: "timed-out",
      detail: timedOutDetail(
        half,
        proof.timeLimitSeconds,
        PROOF_TIME_LIMIT_CEILING_SECONDS
      ),
    };
  }
  if (tool.reason === "killed") {
    return { reason: "killed", detail: killedDetail(half) };
  }
  return tool.reason === "nothing-measured"
    ? { reason: "nothing-measured", detail: nothingMeasuredDetail(half) }
    : { reason: "not-started", detail: notStartedDetail(half, tool.detail) };
}

/**
 * Say what is wrong with the command's answer on the violating change.
 * @param proof - The part
 * @param tool - What the command said
 * @returns The problem, or `null` when it failed as declared
 */
function violationProblem(
  proof: RunnableProof,
  tool: BeforeEnforceTool
): Problem | null {
  if (tool.outcome === "rejected") return null;
  if (tool.outcome === "accepted") {
    return { reason: "violation-accepted", detail: VIOLATION_ACCEPTED_DETAIL };
  }
  return tool.reason === "wrong-reason"
    ? {
        reason: "wrong-failure-text",
        detail: wrongFailureTextDetail(proof.shape),
      }
    : unanswered(proof, "violation", tool);
}

/**
 * Say what is wrong with the command's answer on the clean change.
 * @param proof - The part
 * @param tool - What the command said
 * @returns The problem, or `null` when it passed without the failure text
 */
function cleanProblem(
  proof: RunnableProof,
  tool: BeforeEnforceTool
): Problem | null {
  if (tool.outcome === "accepted") {
    return tool.matched_lines.length === 0
      ? null
      : {
          reason: "failure-text-on-clean",
          detail: failureTextOnCleanDetail(proof.shape),
        };
  }
  return tool.outcome === "rejected" || tool.reason === "wrong-reason"
    ? {
        reason: "clean-rejected",
        detail: cleanRejectedDetail(tool.outcome === "rejected"),
      }
    : unanswered(proof, "clean", tool);
}

/**
 * Start the part's own command on one of its changes.
 * @param proof - The part, its command and its two changes
 * @param context - The clone, the judge and the clock
 * @param half - Which change
 * @returns What the command said
 * @throws {Error} When the clone can no longer be vouched for
 */
async function started(
  proof: RunnableProof,
  context: ProofCheckContext,
  half: ProofHalf
): Promise<BeforeEnforceTool> {
  const measured = await measureChange(proof, context, half);
  if (!measured.planted) {
    throw new Error(
      `The ${half} change of ${proof.entry.id} applied to the temporary copy a moment ago and then did not, so nothing more was checked. ${measured.problem} Nothing in your repository was changed. Run this again.`
    );
  }
  if (measured.spoiled !== null) return spoiled(measured.spoiled);
  return measured.tool;
}

/**
 * Start the part's command on the violating change and then on the clean
 * one, stopping at the first answer that is a problem.
 * @param proof - The part, its command and its two changes
 * @param context - The clone, the judge and the clock
 * @returns What the command said each time, and the problem if there is one
 */
async function runBoth(
  proof: RunnableProof,
  context: ProofCheckContext
): Promise<{ readonly runs: Runs; readonly problem: Problem | null }> {
  const violation = await started(proof, context, "violation");
  const first = violationProblem(proof, violation);
  if (first !== null) return { runs: { violation }, problem: first };
  const clean = await started(proof, context, "clean");
  return {
    runs: { violation, clean },
    problem: cleanProblem(proof, clean),
  };
}

/**
 * Try one part's pair of changes and say whether it is ready.
 * @param planned - The part, with everything trying it needs
 * @param context - The clone, the judge and the clock
 * @returns The part's result
 * @throws {Error} When the clone can no longer be vouched for
 */
async function checkPart(
  planned: PlannedPart,
  context: ProofCheckContext
): Promise<ProofCheckPart> {
  const { proof, note } = planned;
  const { entry } = proof;
  const planting = await plantEach(proof, context.workspace);
  const part = (problem: Problem | null, runs: Runs = {}): ProofCheckPart => ({
    entry_id: entry.id,
    gate: entry.gate,
    scope: entry.scope,
    result: problem === null ? "ready" : "not-ready",
    reason: problem?.reason ?? "ready",
    detail: problem?.detail ?? READY_DETAIL,
    note,
    proof: declaredProof(entry),
    halves: planting.tried.map(
      ({ half, change }): ProofCheckHalf => ({
        half,
        patch: proof.patches[half].file,
        changed_paths: change.paths,
        run: runs[half] ?? null,
      })
    ),
  });
  if (planting.refused !== null) {
    const { half, problem } = planting.refused;
    return part({
      reason: "patch-not-applied",
      detail: notAppliedDetail(half, proof.patches[half].file, problem),
    });
  }
  const wrongPlace = misplaced(proof, planting.tried);
  if (wrongPlace !== null) return part(wrongPlace);
  const { runs, problem } = await runBoth(proof, context);
  return part(problem, runs);
}

/**
 * Give every declared part its result, one at a time and in order.
 *
 * Nothing is written anywhere but the clone, and the clone is put back to
 * its starting commit after every change.
 * @param plans - One plan per declared part, in register order
 * @param context - The clone, the judge and the clock
 * @returns One result per part, in the same order
 * @throws {Error} When the clone can no longer be vouched for
 */
export async function runProofCheckPlans(
  plans: readonly ProofCheckPlan[],
  context: ProofCheckContext
): Promise<readonly ProofCheckPart[]> {
  return plans.reduce<Promise<readonly ProofCheckPart[]>>(
    async (earlier, plan) => {
      const parts = await earlier;
      return [
        ...parts,
        plan.check ? await checkPart(plan, context) : plan.part,
      ];
    },
    Promise.resolve([])
  );
}

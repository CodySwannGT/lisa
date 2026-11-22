/**
 * Running one half of a paired proof, and writing down what happened.
 *
 * One half is one planted change: put it in place, trigger the entry's
 * moment, take the change back out, and say what the check's answer showed.
 * The order matters. The change is taken back out before the answer is read,
 * so nothing that goes wrong while reading it can leave a planted violation
 * behind.
 *
 * What is kept of a half is plain data: the moment it stood for, the patch
 * that was planted, the command that was started, its exit status, the two
 * times read from the clock handed in, the end of what it printed, and what
 * that showed. It names its entry and its moment itself, so one half is
 * everything an evidence record needs without the entry beside it. The
 * folder the half ran in is replaced by {@link WORKSPACE_PLACEHOLDER}
 * wherever it appears in kept text, because it is a temporary folder that
 * differs from run to run and says nothing about the control.
 *
 * A check can print anything, a token it was given included. The answer is
 * judged on everything the check printed, and nothing else sees that. What a
 * half keeps of the output, and of the lines that carried the failure text,
 * has every credential-shaped value taken out first (`./secret-scan.ts`) and
 * is cut to its last {@link OUTPUT_EXCERPT_LIMIT} characters afterwards. In
 * the other order a cut could fall inside a value: a private key would keep
 * its body with the line that marks its start gone, and a token would keep
 * its end with the prefix that makes it recognisable gone.
 *
 * Not to be confused with `./proof-halves.ts`, which reads which halves an
 * evidence file already holds a record of.
 * @module controls/proof-half-run
 */
import { observeHalf } from "./proof-judgement.js";
import { proofTrigger, type RunnableProof } from "./proof-plan.js";
import type { ProofJudge } from "./proof-tools.js";
import type {
  PatchOutcome,
  ProofAnswer,
  ProofHalf,
  ProofHalfReason,
  ProofHalfResult,
  ProofWorkspace,
} from "./proof-types.js";
import { halfDetail } from "./proof-wording.js";
import { redactCredentials } from "./secret-scan.js";

/** The most of a check's output that is kept with a half, in characters. */
export const OUTPUT_EXCERPT_LIMIT = 4000;

/** What stands in for the workspace folder in every piece of kept text. */
export const WORKSPACE_PLACEHOLDER = "<workspace>";

/** What running one half needs. */
export interface HalfContext {
  /** Where the change is planted and the moment triggered. */
  readonly workspace: ProofWorkspace;
  /** Reads an answer the way the gate runner does. */
  readonly judge: ProofJudge;
  /** The clock every time in the results is read from. */
  readonly clock: () => Date;
}

/** A half's result, and whether the workspace is still fit to use. */
export interface HalfRun {
  readonly result: ProofHalfResult;
  /** Why the workspace can no longer be vouched for, or `null` when it can. */
  readonly spoiled: string | null;
}

/** One half that has begun: which it is, and when it began. */
interface StartedHalf {
  readonly proof: RunnableProof;
  readonly half: ProofHalf;
  /** When it began, from the clock handed in. */
  readonly startedAt: string;
  /** Takes the workspace folder out of a piece of text. */
  readonly plain: (text: string) => string;
}

/**
 * Say what went wrong, whatever was thrown.
 * @param error - What was thrown
 * @returns Its message
 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

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
    return { problem: messageOf(error) };
  }
}

/**
 * Trigger a half's moment, turning anything the workspace throws into an
 * answer that says nothing was started.
 * @param proof - The proof being run
 * @param half - Which staged proof case is being triggered
 * @param workspace - Where it runs
 * @returns What the check answered
 */
async function triggered(
  proof: RunnableProof,
  half: ProofHalf,
  workspace: ProofWorkspace
): Promise<ProofAnswer> {
  const { mechanism } = proof;
  try {
    return await workspace.trigger(proofTrigger(proof, half));
  } catch (error) {
    return {
      command: [...mechanism.argv],
      cwd: workspace.root,
      code: null,
      output: null,
      notStarted: messageOf(error),
    };
  }
}

/**
 * Keep the end of a check's output, cut at the start of a line.
 * @param output - Everything that was kept of what the check printed
 * @returns The excerpt, and whether earlier output was left out
 */
function excerpt(output: string): {
  readonly output_excerpt: string;
  readonly output_truncated: boolean;
} {
  if (output.length <= OUTPUT_EXCERPT_LIMIT) {
    return { output_excerpt: output, output_truncated: false };
  }
  const tail = output.slice(-OUTPUT_EXCERPT_LIMIT);
  const firstBreak = tail.indexOf("\n");
  return {
    output_excerpt:
      firstBreak >= 0 && firstBreak < tail.length - 1
        ? tail.slice(firstBreak + 1)
        : tail,
    output_truncated: true,
  };
}

/**
 * The sentence for a half, from its reason and what is known about it.
 * @param started - The half
 * @param reason - Why it showed what it did
 * @param problem - Why something could not be done, when that is the reason
 * @returns The sentence for the operator
 */
function detailOf(
  started: StartedHalf,
  reason: ProofHalfReason,
  problem?: string
): string {
  const { proof, half, plain } = started;
  return halfDetail(reason, {
    patch: proof.patches[half].file,
    shape: proof.shape,
    limitSeconds: proof.timeLimitSeconds,
    ...(problem === undefined ? {} : { problem: plain(problem) }),
  });
}

/**
 * The result of a half whose check was never started.
 * @param started - The half
 * @param reason - Why no check was started
 * @param problem - The same, in the words of whatever stood in the way
 * @param completedAt - When that was known, from the clock handed in
 * @returns The half's result
 */
function unrun(
  started: StartedHalf,
  reason: ProofHalfReason,
  problem: string,
  completedAt: string
): ProofHalfResult {
  const { proof, half, startedAt } = started;
  return {
    entry_id: proof.entry.id,
    half,
    moment: proof.moment,
    patch: proof.patches[half].file,
    command: null,
    exit_status: null,
    started_at: startedAt,
    completed_at: completedAt,
    output_excerpt: "",
    output_truncated: false,
    matched_lines: [],
    outcome: "unknown",
    reason,
    detail: detailOf(started, reason, problem),
  };
}

/**
 * The result of a half whose check was triggered.
 * @param started - The half
 * @param answer - What the check answered
 * @param completedAt - When the answer was in, from the clock handed in
 * @param judge - Reads the answer the way the gate runner does
 * @returns The half's result
 */
function ran(
  started: StartedHalf,
  answer: ProofAnswer,
  completedAt: string,
  judge: ProofJudge
): ProofHalfResult {
  const { proof, half, startedAt, plain } = started;
  // The check's answer is read from everything it printed. What is kept of
  // it is another matter: every credential-shaped value comes out of the
  // whole output first, and only then is the end of it cut off, so the cut
  // can never fall inside a value and leave the rest of it behind.
  const kept = (text: string): string => redactCredentials(plain(text)).text;
  const judgement = judge(answer, {
    gate: proof.entry.gate,
    shape: proof.shape,
  });
  const { outcome, reason } = observeHalf(answer, judgement, proof.shape);
  return {
    entry_id: proof.entry.id,
    half,
    moment: proof.moment,
    patch: proof.patches[half].file,
    command: [...answer.command],
    exit_status: answer.code,
    started_at: startedAt,
    completed_at: completedAt,
    ...excerpt(kept(answer.output ?? "")),
    matched_lines: judgement.matched.map(line => kept(line)),
    outcome,
    reason,
    detail: detailOf(started, reason, answer.notStarted),
  };
}

/**
 * Run one half of a proof: plant the change, trigger the moment, take the
 * change back out, and say what the check's answer showed.
 * @param proof - The proof being run
 * @param half - Which half
 * @param context - The workspace, the judge and the clock
 * @param spoiled - Why the workspace can no longer be vouched for, if it
 *   cannot; the half is then reported without being run
 * @returns The half's result, and whether the workspace is still fit to use
 */
export async function runHalf(
  proof: RunnableProof,
  half: ProofHalf,
  context: HalfContext,
  spoiled: string | null
): Promise<HalfRun> {
  const { workspace, judge, clock } = context;
  const { text } = proof.patches[half];
  const started: StartedHalf = {
    proof,
    half,
    startedAt: clock().toISOString(),
    plain: value => value.replaceAll(workspace.root, WORKSPACE_PLACEHOLDER),
  };
  const now = (): string => clock().toISOString();
  if (spoiled !== null) {
    return {
      result: unrun(started, "workspace-not-restored", spoiled, now()),
      spoiled,
    };
  }
  const planted = await attempt(() => workspace.apply(text));
  if (planted.problem !== null) {
    return {
      result: unrun(started, "patch-not-applied", planted.problem, now()),
      spoiled: null,
    };
  }
  const answer = await triggered(proof, half, workspace);
  const completedAt = now();
  // Taken back out before the answer is read, so nothing that goes wrong
  // while reading it can leave the change in place.
  const restored = await attempt(() => workspace.restore(text));
  return {
    result: ran(started, answer, completedAt, judge),
    spoiled:
      restored.problem === null
        ? null
        : `The ${half} change of ${proof.entry.id} was left in place: ${restored.problem}`,
  };
}

/**
 * Doing one thing with one of an entry's changes in the fresh clone, and
 * writing down what happened.
 *
 * One observation is one planted change: put it in place, do one thing with
 * it (commit or push it for real, or start the entry's own command on it),
 * put the clone back, and keep what was seen as plain data. The order
 * matters. The clone is put back before the answer is read, so nothing that
 * goes wrong while reading it can leave a violating change behind.
 *
 * The before-enforce run only ever plants the violating change, so that is
 * the change planted when none is named. {@link measureChange} is the whole
 * of "start the entry's own command on a change and say what it showed", and
 * `lisa controls proof-check` calls it for both changes of a pair
 * (`./proof-check-run.ts`), so the two can never read a tool's answer
 * differently.
 *
 * What is kept of a command is the command, its exit status, the two times
 * read from the clock handed in, and the end of what it printed. The text
 * goes through `prepareEvidenceExcerpt`, the one place check output is made
 * ready to be kept, so whatever that does to output it does here too. The
 * clone's folder is taken out of every kept text, because it is a temporary
 * folder that differs from run to run.
 * @module controls/before-enforce-observe
 */
import type {
  BeforeEnforceCanary,
  BeforeEnforceReason,
  BeforeEnforceTool,
} from "./before-enforce-types.js";
import type { BeforeEnforceWorkspace } from "./before-enforce-workspace.js";
import { prepareEvidenceExcerpt } from "./evidence-write.js";
import { WORKSPACE_PLACEHOLDER } from "./proof-half-run.js";
import type { ProofHalf } from "./proof-halves.js";
import { observeHalf } from "./proof-judgement.js";
import { proofTrigger, type RunnableProof } from "./proof-plan.js";
import type { ProofJudge } from "./proof-tools.js";
import type {
  PatchOutcome,
  ProofAnswer,
  ProofHalfOutcome,
  ProofTrigger,
} from "./proof-types.js";
import { HALF_NAMES, halfDetail } from "./proof-wording.js";

/** The change a before-enforce run plants: the one that breaks the rule. */
const VIOLATION: ProofHalf = "violation";

/** What exercising the planned entries needs. */
export interface BeforeEnforceContext {
  /** The fresh clone the changes are tried in. */
  readonly workspace: BeforeEnforceWorkspace;
  /** Reads the tool's answer the way the gate runner does. */
  readonly judge: ProofJudge;
  /** The clock every time in the results is read from. */
  readonly clock: () => Date;
}

/** A planted change that was acted on, and what answered. */
export interface Seen {
  readonly planted: true;
  readonly answer: ProofAnswer;
  readonly startedAt: string;
  readonly completedAt: string;
  /** Why the clone can no longer be vouched for, or `null` when it can. */
  readonly spoiled: string | null;
}

/** What one planted change led to. */
export type Observation =
  | Seen
  | { readonly planted: false; readonly problem: string };

/** The fields a record carries about the command itself. */
type CommandFields = Pick<
  BeforeEnforceCanary,
  | "command"
  | "exit_status"
  | "started_at"
  | "completed_at"
  | "output_excerpt"
  | "output_truncated"
>;

/** Why a commit or push gave no answer that can be believed. */
type AttemptReason = Extract<
  BeforeEnforceReason,
  "not-started" | "timed-out" | "killed"
>;

/**
 * Say what went wrong, whatever was thrown.
 * @param error - What was thrown
 * @returns Its message
 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Call the workspace, turning anything it throws into a problem.
 * @param call - Plants a change or puts the clone back
 * @returns What the workspace answered
 */
async function guarded(
  call: () => Promise<PatchOutcome>
): Promise<PatchOutcome> {
  try {
    return await call();
  } catch (error) {
    return { problem: messageOf(error) };
  }
}

/**
 * Plant one of an entry's changes, do one thing with it, and put the clone
 * back.
 * @param proof - The entry and its two changes
 * @param context - The clone and the clock
 * @param act - What to do with the planted change
 * @param half - Which change to plant; the violating one when left out
 * @returns What it led to
 */
export async function observe(
  proof: RunnableProof,
  context: BeforeEnforceContext,
  act: (request: ProofTrigger) => Promise<ProofAnswer>,
  half: ProofHalf = VIOLATION
): Promise<Observation> {
  const { workspace, clock } = context;
  const { entry } = proof;
  const startedAt = clock().toISOString();
  const planted = await guarded(() =>
    workspace.plant(proof.patches[half].text)
  );
  if (planted.problem !== null) {
    return { planted: false, problem: planted.problem };
  }
  const answer = await act(proofTrigger(proof, half)).catch(
    (error: unknown): ProofAnswer => ({
      command: [],
      cwd: workspace.root,
      code: null,
      output: null,
      notStarted: messageOf(error),
    })
  );
  const completedAt = clock().toISOString();
  // Put back before the answer is read, so nothing that goes wrong while
  // reading it can leave the violating change in the clone.
  const restored = await guarded(() => workspace.restore());
  return {
    planted: true,
    answer,
    startedAt,
    completedAt,
    spoiled:
      restored.problem === null
        ? null
        : `The ${HALF_NAMES[half]} change of ${entry.id} was left in place: ${restored.problem}`,
  };
}

/**
 * What is kept of a command that was started.
 * @param seen - The observation
 * @param root - The clone's folder, taken out of the kept text
 * @returns The fields a record carries about the command itself
 */
export function commandFields(seen: Seen, root: string): CommandFields {
  const { answer } = seen;
  return {
    command: answer.command.length === 0 ? null : [...answer.command],
    exit_status: answer.code,
    started_at: seen.startedAt,
    completed_at: seen.completedAt,
    ...prepareEvidenceExcerpt(
      (answer.output ?? "").replaceAll(root, WORKSPACE_PLACEHOLDER),
      false
    ),
  };
}

/**
 * Say what a commit or push of the violating change showed.
 *
 * The workspace has already compared git's exit status with what git did,
 * and marks an answer in which the two disagree as one that was not started.
 * So an exit status that reaches here can be believed.
 * @param answer - What git answered
 * @returns Whether the change went through or was refused; or why neither
 *   is known
 */
export function attemptOutcome(answer: ProofAnswer): {
  readonly outcome: ProofHalfOutcome;
  readonly reason: AttemptReason | null;
} {
  if (answer.notStarted !== undefined) {
    return { outcome: "unknown", reason: "not-started" };
  }
  if (answer.timedOut === true) {
    return { outcome: "unknown", reason: "timed-out" };
  }
  if (answer.code === null) return { outcome: "unknown", reason: "killed" };
  return { outcome: answer.code === 0 ? "accepted" : "rejected", reason: null };
}

/**
 * The record of the entry's own command on one of its changes.
 * @param proof - The entry and its declared failure text
 * @param seen - What starting the command led to
 * @param context - The clone and the judge
 * @param half - Which change the command was started on; the violating one
 *   when left out
 * @returns The record
 */
function toolRecord(
  proof: RunnableProof,
  seen: Seen,
  context: BeforeEnforceContext,
  half: ProofHalf = VIOLATION
): BeforeEnforceTool {
  const { answer } = seen;
  const { root } = context.workspace;
  const plain = (text: string): string =>
    text.replaceAll(root, WORKSPACE_PLACEHOLDER);
  const judgement = context.judge(answer, {
    gate: proof.entry.gate,
    shape: proof.shape,
  });
  const { outcome, reason } = observeHalf(answer, judgement, proof.shape);
  return {
    ...commandFields(seen, root),
    matched_lines: judgement.matched.map(line => plain(line)),
    outcome,
    reason,
    detail: halfDetail(reason, {
      patch: proof.patches[half].file,
      shape: proof.shape,
      limitSeconds: proof.timeLimitSeconds,
      ...(answer.notStarted === undefined
        ? {}
        : { problem: plain(answer.notStarted) }),
    }),
  };
}

/** What starting an entry's own command on one of its changes came to. */
export type Measured =
  | { readonly planted: false; readonly problem: string }
  | {
      readonly planted: true;
      /** What the command said, read the way the gate runner reads it. */
      readonly tool: BeforeEnforceTool;
      /** Why the clone can no longer be vouched for, or `null` when it can. */
      readonly spoiled: string | null;
    };

/**
 * Plant one of an entry's changes, start the entry's own command on it in
 * the entry's own folder, put the clone back, and say what the command
 * showed.
 *
 * This is the one place a tool's own run on a planted change is judged
 * outside a proof: the gate runner's reading of the answer, then the
 * declared failure text, exactly as a half of a paired proof is read.
 * @param proof - The entry, its command and its two changes
 * @param context - The clone, the judge and the clock
 * @param half - Which change to plant; the violating one when left out
 * @returns The record of the command, or why the change was never planted
 */
export async function measureChange(
  proof: RunnableProof,
  context: BeforeEnforceContext,
  half: ProofHalf = VIOLATION
): Promise<Measured> {
  const seen = await observe(
    proof,
    context,
    request => context.workspace.measure(request),
    half
  );
  return seen.planted
    ? {
        planted: true,
        tool: toolRecord(proof, seen, context, half),
        spoiled: seen.spoiled,
      }
    : seen;
}

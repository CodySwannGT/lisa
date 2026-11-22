/**
 * Human-needed subcommands of the session-manager CLI (CodySwannGT/lisa#4555,
 * part 3): `mark-plan`, `answer` and `item-answer`.
 *
 * `mark-plan` says how to mark an item that needs a human: the configured
 * human-needed label (else the configured `blocked` role), a move to the
 * `blocked` role for an `exhausted` item, and the comment to post. It writes
 * nothing; the manager applies the plan through `lisa-tracker-write`, so the
 * tracker write stays with the vendor writers. `answer` and `item-answer`
 * queue a human's answer in the ledger for the next cycle to deliver.
 *
 * Question and answer text arrive on stdin, never in argv, and are refused
 * (exit 2) when they look like they hold a credential.
 * @module session-manager/cli-human
 */
import { resolveRole } from "../../../scripts/resolve-lifecycle-role.mjs";
import {
  CliError,
  EXIT,
  asSetupError,
  asSetupErrorAsync,
  humanNeededLabel,
  loadProject,
  requirePositional,
  stdinText,
  validOrAbsent,
} from "./cli-runtime.mjs";
import { parseJson } from "./cli-queue.mjs";
import { parseIdEntry } from "../../../scripts/operator-id-kinds.mjs";
import { notifyProvider, trustedReleaseEntries } from "./config.mjs";
import { wronglyEscalatedLabel } from "./cli-overruled.mjs";
import {
  carriesWronglyEscalated,
  overruledFingerprint,
  overruledMarkerComment,
} from "./escalation-overruled.mjs";
import { pickItemAnswer } from "./human-answer.mjs";
import { findCredentialShape, planMark } from "./human-needed.mjs";
import { readLedger } from "./ledger.mjs";
import { queueAnswer } from "./ledger-questions.mjs";

/**
 * The project's configured tracker.
 * @param {ReturnType<typeof loadProject>} project - Loaded project
 * @returns {string | undefined} `github`, `jira` or `linear`
 */
function trackerOf(project) {
  return project.local?.tracker ?? project.global?.tracker;
}

/**
 * `mark-plan <ref> --kind <kind> [--cause <cause>] [--item-label <l>]...`
 * (question or reason on stdin). `--item-label` names the item's current
 * labels; when one is the configured wrongly-escalated label, a
 * `--cause human-gate` hold counts as a planning miss (#4657).
 * @param {object} ctx - CLI context
 * @returns {{ json: object }} `{ref,kind,marker,move?,comment,answerWith}`
 */
export function markPlan(ctx) {
  const ref = requirePositional(ctx, "ref");
  const text = stdinText(ctx, "question or reason");
  const project = loadProject(ctx.root);
  const config = validOrAbsent(project);
  const tracker = trackerOf(project);
  const blocked = resolveRole({
    role: "blocked",
    vendor: tracker,
    intent: "write",
    local: project.local,
    global: project.global,
  }).value;
  const overruledLabel = wronglyEscalatedLabel(project, tracker);
  const plan = asSetupError(() =>
    planMark({
      ref,
      kind: ctx.values.kind,
      text,
      label: humanNeededLabel(project, tracker),
      blocked: blocked || undefined,
      channel: config ? notifyProvider(config) === "telegram" : false,
      answerers: allowedAnswerers(config).length > 0,
      cause: ctx.values.cause ?? "planning",
      overruled: carriesWronglyEscalated(
        ctx.values["item-label"] ?? [],
        overruledLabel
      ),
    })
  );
  return { json: withOverruledMarker(plan, ref, overruledLabel) };
}

/**
 * A `wrongly-escalated` candidate is the same capture the overruled sweep
 * makes, so it carries the same marker: the manager posts it after routing
 * the candidate, and the sweep then skips the item instead of capturing the
 * one ruling twice (#4657).
 * @param {object} plan - `planMark` result
 * @param {string} ref - Item ref
 * @param {string} label - Resolved wrongly-escalated label
 * @returns {object} The plan, with `planningMiss.overruledMarker` when due
 */
function withOverruledMarker(plan, ref, label) {
  if (plan.planningMiss?.candidate?.signal !== "wrongly-escalated") return plan;
  const fingerprint = overruledFingerprint(ref);
  return {
    ...plan,
    planningMiss: {
      ...plan.planningMiss,
      overruledMarker: {
        fingerprint,
        comment: overruledMarkerComment(fingerprint, label),
      },
    },
  };
}

/**
 * Refuse (exit 2) text that looks like it holds a credential.
 * @param {string} text - Answer text
 * @param {string} [consequence] - What the refusal left undone
 */
export function refuseCredential(text, consequence = "nothing was queued") {
  const shape = findCredentialShape(text);
  if (shape) {
    throw new CliError(
      `The answer looks like it holds a credential (${shape}); ${consequence}. Keep secrets in the secrets provider.`,
      EXIT.SETUP
    );
  }
}

/**
 * `answer <ref>` (answer on stdin): queue an operator's answer from the
 * terminal. Exit 2 when the ref has no pending question.
 * @param {object} ctx - CLI context
 * @returns {Promise<{ json: object }>} `{queued:true,ref,source}`
 */
export async function answer(ctx) {
  const ref = requirePositional(ctx, "ref");
  const text = stdinText(ctx, "answer");
  refuseCredential(text);
  await asSetupErrorAsync(() =>
    queueAnswer(ctx.root, { ref, source: "cli", text })
  );
  return { json: { queued: true, ref, source: "cli" } };
}

/**
 * Who may answer on the item: operators and the people trusted to release a
 * human gate (`trustedReleaseIds`, else `trustedAuthorIds`; #4895). There is
 * no fallback to the tracker identity (`control.me`): workers and the
 * manager post as that identity, so its comments cannot be told apart from
 * an answer.
 * @param {object | null} config - Resolved `sessionManager` block
 * @returns {string[]} Allowed author ids (empty: nobody may answer there)
 */
function allowedAnswerers(config) {
  // An `integration:` entry names no person, so it can never answer; counting
  // it would tell the operator to reply on the item when no reply is read.
  return [...(config?.operatorIds ?? []), ...trustedReleaseEntries(config)]
    .map(String)
    .filter(entry => parseIdEntry(entry)?.kind !== "integration");
}

/** Why nothing is read off the item when nobody may answer there. */
/** Why no answer can be read, and the fix, when the question is not found. */
const NO_QUESTION =
  "The question comment was not found on the item: its id is not recorded " +
  "(or not among these comments), and no comment by an operator or trusted " +
  "author starts with the question marker. Replies cannot be read until it " +
  "is. Re-post the question comment from mark-plan, then record its id " +
  "with ledger marked --comment-id <id>.";

/** Why a reply was not used, and what the operator must do about it. */
const CREDENTIAL_REPLY =
  "A reply on the item looks like it holds a credential, so it was not " +
  "used as the answer and nothing from it was queued. The credential is " +
  "now in the tracker: delete that comment, rotate the secret, keep it in " +
  "the secrets provider, and reply again without it.";

const NO_ANSWERERS =
  "No person who may answer is configured (sessionManager.operatorIds, " +
  "trustedReleaseIds, or a trustedAuthorIds entry other than " +
  "integration:<service>), so " +
  "replies on the item are not read: the tracker identity is the one " +
  "workers post as. Answer with the answerCommand that status lists, or " +
  "set sessionManager.operatorIds.";

/** Why replies are not read while the question's mark is unread. */
const NOT_MARKED =
  "The pending question has not been marked on the item yet (markedAt is " +
  "null): it was recorded, or its text changed, and its question comment " +
  "has not been posted and read back. Replies are not read until it is, " +
  "or a reply to an earlier question would be taken as this one's answer. " +
  "Finish Mark and move on, then record the new comment with ledger marked " +
  "--comment-id <id>.";

/**
 * Why no reply can be read off the item yet, or null when one can. A queued
 * answer is kept. An unmarked question (`markedAt` null) is refused because
 * the answer search anchors on the last recorded question comment, which
 * after a changed question is still the OLD one: reading replies then would
 * queue a reply to the old question as the new one's answer
 * (CodySwannGT/lisa#4643).
 * @param {string} ref - Item ref
 * @param {{answer?: object|null, markedAt?: string|null}} pending - Pending
 *   question
 * @returns {object | null} The not-queued result, or null
 */
function notReadable(ref, pending) {
  if (pending.answer) return { queued: false, ref, reason: "already-queued" };
  if (!pending.markedAt) {
    return {
      queued: false,
      ref,
      reason: "not-marked",
      explanation: NOT_MARKED,
    };
  }
  return null;
}

/**
 * `item-answer <ref>` (stdin `{"comments":[...]}`): find the human's answer
 * on the item and queue it. stdout `{queued:false,reason}` when there is none
 * yet, `reason: "not-marked"` (exit 0) while the question's mark has not been
 * read back, or `reason: "no-answerers-configured"` (exit 0) when nobody may
 * answer there. A reply that looks like it holds a credential is skipped and
 * listed in `refused` (with `reason: "credential-refused"` when no later
 * reply answers), so it never wedges the item. Exit 2 when the ref has no
 * pending question, the ledger is corrupt, or stdin is not valid JSON. A
 * system error reading the ledger (EACCES, say) is not a setup error and
 * still exits 1.
 * @param {object} ctx - CLI context
 * @returns {Promise<{ json: object }>} What was queued, or why nothing was
 */
export async function itemAnswer(ctx) {
  const ref = requirePositional(ctx, "ref");
  const input = parseJson(stdinText(ctx, "item comments JSON"), "stdin");
  const config = validOrAbsent(loadProject(ctx.root));
  // Wrapped as `answer` wraps its ledger read: a corrupt ledger is a setup
  // error (exit 2), not a run failure (CodySwannGT/lisa#4571).
  const ledger = await asSetupErrorAsync(() => readLedger(ctx.root));
  const pending = Object.hasOwn(ledger.items, ref)
    ? ledger.items[ref].pendingQuestion
    : null;
  if (!pending) {
    throw new CliError(`${ref} has no pending question in the ledger.`, 2);
  }
  const held = notReadable(ref, pending);
  if (held) return { json: held };
  const allowed = allowedAnswerers(config);
  if (allowed.length === 0) {
    return {
      json: {
        queued: false,
        ref,
        reason: "no-answerers-configured",
        explanation: NO_ANSWERERS,
      },
    };
  }
  const picked = asSetupError(() =>
    pickItemAnswer({
      comments: input?.comments,
      allowed,
      managerCommentIds: pending.managerCommentIds ?? [],
      refuses: findCredentialShape,
    })
  );
  const refused =
    picked.refused !== undefined
      ? { refused: picked.refused, refusedExplanation: CREDENTIAL_REPLY }
      : {};
  if (!picked.answer) {
    return {
      json: {
        queued: false,
        ref,
        reason: picked.reason,
        ...(picked.reason === "no-question-comment"
          ? { explanation: NO_QUESTION }
          : {}),
        ...refused,
      },
    };
  }
  await asSetupErrorAsync(() =>
    queueAnswer(ctx.root, {
      ref,
      source: "item",
      text: picked.answer.text,
      author: picked.answer.author,
    })
  );
  return {
    json: {
      queued: true,
      ref,
      source: "item",
      author: picked.answer.author,
      ...refused,
    },
  };
}

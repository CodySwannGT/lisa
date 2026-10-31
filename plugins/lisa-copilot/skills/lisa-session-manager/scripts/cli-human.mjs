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
import { notifyProvider } from "./config.mjs";
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
 * `mark-plan <ref> --kind <kind>` (question or reason on stdin).
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
  return {
    json: asSetupError(() =>
      planMark({
        ref,
        kind: ctx.values.kind,
        text,
        label: humanNeededLabel(project, tracker),
        blocked: blocked || undefined,
        channel: config ? notifyProvider(config) === "telegram" : false,
        answerers: allowedAnswerers(config).length > 0,
      })
    ),
  };
}

/**
 * Refuse (exit 2) text that looks like it holds a credential.
 * @param {string} text - Answer text
 */
function refuseCredential(text) {
  const shape = findCredentialShape(text);
  if (shape) {
    throw new CliError(
      `The answer looks like it holds a credential (${shape}); nothing was queued. Keep secrets in the secrets provider.`,
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
 * Who may answer on the item: operators and trusted authors only. There is
 * no fallback to the tracker identity (`control.me`): workers and the
 * manager post as that identity, so its comments cannot be told apart from
 * an answer.
 * @param {object | null} config - Resolved `sessionManager` block
 * @returns {string[]} Allowed author ids (empty: nobody may answer there)
 */
function allowedAnswerers(config) {
  return [
    ...(config?.operatorIds ?? []),
    ...(config?.trustedAuthorIds ?? []),
  ].map(String);
}

/** Why nothing is read off the item when nobody may answer there. */
const NO_ANSWERERS =
  "No sessionManager.operatorIds or trustedAuthorIds are configured, so " +
  "replies on the item are not read: the tracker identity is the one " +
  "workers post as. Answer with the answerCommand that status lists, or " +
  "set sessionManager.operatorIds.";

/**
 * `item-answer <ref>` (stdin `{"comments":[...]}`): find the human's answer
 * on the item and queue it. stdout `{queued:false,reason}` when there is none
 * yet, or `reason: "no-answerers-configured"` (exit 0) when nobody may
 * answer there. Exit 2 when the ref has no pending question.
 * @param {object} ctx - CLI context
 * @returns {Promise<{ json: object }>} What was queued, or why nothing was
 */
export async function itemAnswer(ctx) {
  const ref = requirePositional(ctx, "ref");
  const input = parseJson(stdinText(ctx, "item comments JSON"), "stdin");
  const config = validOrAbsent(loadProject(ctx.root));
  const ledger = await readLedger(ctx.root);
  const pending = Object.hasOwn(ledger.items, ref)
    ? ledger.items[ref].pendingQuestion
    : null;
  if (!pending) {
    throw new CliError(`${ref} has no pending question in the ledger.`, 2);
  }
  if (pending.answer) {
    return { json: { queued: false, ref, reason: "already-queued" } };
  }
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
    })
  );
  if (!picked.answer) {
    return { json: { queued: false, ref, reason: picked.reason } };
  }
  refuseCredential(picked.answer.text);
  await queueAnswer(ctx.root, {
    ref,
    source: "item",
    text: picked.answer.text,
    author: picked.answer.author,
  });
  return {
    json: { queued: true, ref, source: "item", author: picked.answer.author },
  };
}

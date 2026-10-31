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
import {
  findCredentialShape,
  pickItemAnswer,
  planMark,
} from "./human-needed.mjs";
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
 * Who may answer on the item: operators and trusted authors, else the
 * tracker identity the manager runs as.
 * @param {object | null} config - Resolved `sessionManager` block
 * @param {string | null} me - Ledger `control.me`
 * @returns {string[]} Allowed author ids
 */
function allowedAnswerers(config, me) {
  const ids = [
    ...(config?.operatorIds ?? []),
    ...(config?.trustedAuthorIds ?? []),
  ].map(String);
  if (ids.length > 0) return ids;
  return me ? [me] : [];
}

/**
 * `item-answer <ref>` (stdin `{"comments":[...]}`): find the human's answer
 * on the item and queue it. stdout `{queued:false,reason}` when there is none
 * yet. Exit 2 when the ref has no pending question or nobody may answer.
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
  const allowed = allowedAnswerers(config, ledger.control.me);
  if (allowed.length === 0) {
    throw new CliError(
      "Nobody may answer on the item: set sessionManager.operatorIds (or record the tracker identity with ledger control --me).",
      2
    );
  }
  const picked = asSetupError(() =>
    pickItemAnswer({ comments: input?.comments, allowed })
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

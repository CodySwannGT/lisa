/**
 * Answers that only the item can carry to the next attempt
 * (CodySwannGT/lisa#4624): `channel-answer` and `answer-plan`.
 *
 * `channel-answer` queues an operator's Telegram answer in the ledger (source
 * `channel`), so it is handled like a terminal answer instead of being
 * followed straight into Clearing and lost. `answer-plan` says whether the
 * queued answer must be posted on the item before the question is cleared
 * (the worker finished, or the item is `exhausted`) and gives the comment. It
 * writes nothing; the manager posts through `lisa-tracker-write`, as it does
 * for `mark-plan`. Both are manager-only: the operator answers with `answer`.
 *
 * Answer text arrives on stdin, never in argv, and a credential-shaped
 * answer is refused (exit 2) before it can be queued or posted.
 * @module session-manager/cli-answer-record
 */
import { planAnswerRecord } from "./answer-record.mjs";
import { refuseCredential } from "./cli-human.mjs";
import {
  asSetupError,
  asSetupErrorAsync,
  requirePositional,
  stdinText,
} from "./cli-runtime.mjs";
import { readLedger } from "./ledger.mjs";
import { queueAnswer } from "./ledger-questions.mjs";

/**
 * `channel-answer <ref>` (answer on stdin): queue the operator's Telegram
 * answer. Exit 2 when the ref has no pending question, or the text looks
 * like a credential.
 * @param {object} ctx - CLI context
 * @returns {Promise<{ json: object }>} `{queued:true,ref,source:"channel"}`
 */
export async function channelAnswer(ctx) {
  const ref = requirePositional(ctx, "ref");
  const text = stdinText(ctx, "answer");
  refuseCredential(text);
  await asSetupErrorAsync(() =>
    queueAnswer(ctx.root, { ref, source: "channel", text })
  );
  return { json: { queued: true, ref, source: "channel" } };
}

/**
 * `answer-plan <ref>`: plan recording the queued answer on the item. Exit 2
 * when the ledger is corrupt or the queued answer looks like a credential
 * (nothing is printed, so nothing can be posted).
 * @param {object} ctx - CLI context
 * @returns {Promise<{ json: object }>} `{ref,record:false,reason}` or
 *   `{ref,record:true,source,comment}`
 */
export async function answerPlan(ctx) {
  const ref = requirePositional(ctx, "ref");
  const ledger = await asSetupErrorAsync(() => readLedger(ctx.root));
  const entry = Object.hasOwn(ledger.items, ref) ? ledger.items[ref] : null;
  const pending = entry?.pendingQuestion ?? null;
  if (pending?.answer) {
    refuseCredential(pending.answer.text, "nothing will be posted on the item");
  }
  const plan = asSetupError(() =>
    planAnswerRecord({ ref, status: entry?.status, pending })
  );
  return { json: plan };
}

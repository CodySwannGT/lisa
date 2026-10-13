/**
 * Decide which worker an inbound Telegram message is for, or whether it is an
 * operator command.
 *
 * Several workers can be waiting on the operator at once, and an answer
 * delivered to the wrong one is acted on with permissions skipped. So routing
 * only ever uses an explicit signal, in this order:
 *
 * 1. a leading `[REF]`, `REF:` or `REF ` naming a ledger ref or its worker
 *    token (case-insensitive, exact token — `TEAM-1` never matches `TEAM-12`).
 *    A GitHub ref `owner/repo#12` also answers to `repo#12` and `#12`, which
 *    is what a phone user types; a short form that names more than one ledger
 *    item names none;
 * 2. a Telegram reply to the message that carried a pending question. The
 *    Telegram channel plugin (0.0.7) does not pass the replied-to message id
 *    on, so the manager can only supply `--reply-to` from a plugin that does;
 *    the leading ref is what operators are told to use;
 * 3. an operator command (`status`, `pause`, `resume`, `cap N`, `stop REF`).
 *    A recognised command with bad arguments (`cap 40`, `stop A B`) is
 *    `invalid-command`, never an answer;
 * 4. the only pending question, when exactly one exists.
 *
 * Anything else is `ambiguous`, and the manager asks which item was meant.
 * Commands sit below an explicit ref or reply, so "pause" sent as a reply to a
 * question is an answer, but above the single-pending fallback, so a bare
 * "pause" is never swallowed as an answer.
 *
 * The message text is untrusted data. It is sliced and returned, never
 * evaluated, interpolated into a shell, or used as a pattern.
 * @module telegram-route
 */

import { parseWorkerName, sanitizeRefToken } from "./workers.mjs";

/** Upper bound for `cap N`, matching the ledger's `control.maxWorkers`. */
const MAX_CAP = 32;

/** Commands that take no argument. */
const BARE_COMMANDS = new Set(["status", "pause", "resume"]);

/**
 * Leading-ref forms, tried in order. Each captures `[ref, body]`.
 * @type {RegExp[]}
 */
const PREFIX_PATTERNS = [
  /^\[([^\]\s]+)\]\s*([\s\S]*)$/,
  /^([^\s:[\]]+)\s*:\s*([\s\S]*)$/,
  /^(\S+)\s+([\s\S]*)$/,
];

/**
 * Every token that names a ledger item: the ref, its name-safe token, and the
 * token in its worker's name.
 * @param {string} ref - Ledger key
 * @param {{worker?: string|null}} entry - Ledger item
 * @returns {string[]} Lower-cased tokens
 */
function namesFor(ref, entry) {
  const safeToken = (() => {
    try {
      return sanitizeRefToken(ref);
    } catch {
      return null;
    }
  })();
  return [
    ref,
    safeToken,
    parseWorkerName(entry?.worker)?.token,
    ...shortForms(ref),
  ]
    .filter(name => typeof name === "string")
    .map(name => name.toLowerCase());
}

/**
 * The phone-friendly short forms of a GitHub ref: `owner/repo#12` gives
 * `repo#12` and `#12`. Jira and Linear keys have none.
 * @param {string} ref - Ledger key
 * @returns {string[]} Short forms, possibly empty
 */
function shortForms(ref) {
  const github = /^[^/\s]+\/([^#\s]+)(#\d+)$/.exec(ref);
  return github ? [`${github[1]}${github[2]}`, github[2]] : [];
}

/**
 * Find the ledger ref a token names. A token that names several items (a
 * `#12` shared by two repos) names none, so it can never pick one at random.
 * @param {Record<string, object>} items - Ledger items
 * @param {string} token - Candidate from the message
 * @returns {string | null} Ledger key, or null
 */
function matchRef(items, token) {
  const wanted = token.toLowerCase();
  const matches = Object.keys(items).filter(ref =>
    namesFor(ref, items[ref]).includes(wanted)
  );
  return matches.length === 1 ? matches[0] : null;
}

/**
 * Read a leading ref and the body after it.
 * @param {Record<string, object>} items - Ledger items
 * @param {string} text - Trimmed message
 * @returns {{ref: string, body: string} | null} Match, or null
 */
function matchPrefix(items, text) {
  return (
    PREFIX_PATTERNS.map(pattern => pattern.exec(text))
      .filter(match => match !== null)
      .map(([, token, body]) => ({
        ref: matchRef(items, token),
        body: body.trim(),
      }))
      .find(({ ref, body }) => ref !== null && body !== "") ?? null
  );
}

/**
 * Parse an operator command.
 * @param {string} text - Message text
 * @returns {{kind: "command", name: "status"|"pause"|"resume"} | {kind: "command", name: "cap", value: number} | {kind: "command", name: "stop", ref: string} | {kind: "not-a-command", reason?: string}} Command, or why not
 */
export function parseCommand(text) {
  const words = (typeof text === "string" ? text : "")
    .trim()
    .replace(/^\//, "")
    .split(/\s+/);
  const name = words[0].toLowerCase();
  const args = words.slice(1);
  if (BARE_COMMANDS.has(name) && args.length === 0)
    return { kind: "command", name };
  if (name === "cap") {
    const value =
      args.length === 1 && /^\d+$/.test(args[0]) ? Number(args[0]) : Number.NaN;
    return value <= MAX_CAP
      ? { kind: "command", name, value }
      : {
          kind: "not-a-command",
          reason: `cap needs one whole number from 0 to ${MAX_CAP}`,
        };
  }
  if (name === "stop") {
    return args.length === 1
      ? { kind: "command", name, ref: args[0] }
      : { kind: "not-a-command", reason: "stop needs exactly one ref" };
  }
  return { kind: "not-a-command" };
}

/**
 * Route one inbound message.
 * @param {{text: string, replyToMessageId?: number|null, ledger: {items?: Record<string, {worker?: string|null, pendingQuestion?: {telegramMessageId?: number|null}|null}>}}} input - Message and current ledger
 * @returns {{kind: "answer", ref: string, body: string} | ReturnType<typeof parseCommand> & {kind: "command"} | {kind: "invalid-command", reason: string} | {kind: "ambiguous", candidates: string[]}} Route
 */
export function routeInbound({ text, replyToMessageId, ledger }) {
  const items = ledger?.items ?? {};
  const message = typeof text === "string" ? text.trim() : "";
  const pending = Object.keys(items)
    .filter(ref => items[ref]?.pendingQuestion)
    .sort();
  const ambiguous = { kind: "ambiguous", candidates: pending };
  if (message === "") return ambiguous;

  const prefixed = matchPrefix(items, message);
  if (prefixed)
    return { kind: "answer", ref: prefixed.ref, body: prefixed.body };

  const repliedTo =
    replyToMessageId === undefined || replyToMessageId === null
      ? undefined
      : pending.find(
          ref =>
            items[ref].pendingQuestion.telegramMessageId === replyToMessageId
        );
  if (repliedTo) return { kind: "answer", ref: repliedTo, body: message };

  const command = parseCommand(message);
  if (command.kind === "command") {
    return command.name === "stop"
      ? { ...command, ref: matchRef(items, command.ref) ?? command.ref }
      : command;
  }
  // A recognised command with bad arguments ("cap 40", "stop A B") is a
  // mistyped command, not an answer. Falling through to the single-pending
  // fallback would hand it to a worker that acts on it with permissions
  // skipped, so the operator is told what was wrong instead.
  if (command.reason) {
    return { kind: "invalid-command", reason: command.reason };
  }

  return pending.length === 1
    ? { kind: "answer", ref: pending[0], body: message }
    : ambiguous;
}

/**
 * Wrap an operator's answer for delivery to a worker, so the worker can tell
 * a human answer from the manager's own messages.
 * @param {string} owner - Display name of the person who answered
 * @param {string} body - Answer text, passed through as data
 * @returns {string} Message for the worker
 */
export function formatAnswer(owner, body) {
  if (typeof owner !== "string" || owner.trim() === "") {
    throw new Error("owner must be a non-empty string");
  }
  return `${owner.trim()}'s answer: ${body}`;
}

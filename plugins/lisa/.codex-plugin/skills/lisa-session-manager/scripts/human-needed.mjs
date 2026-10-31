/**
 * "Mark and move on" (CodySwannGT/lisa#4555, part 3): what the manager writes
 * on a work item that cannot progress without a human, and how it reads the
 * human's answer back off the item. Pure: no I/O, no clock, no config reads.
 *
 * Four cases need a human: a worker's question, an ambiguous repo route, an
 * item `exhausted` after `stall.maxAttempts`, and a design or product
 * decision. In each the manager marks the item with the configured
 * human-needed marker, posts the question on the item with enough context to
 * answer it there, records it pending in the ledger, and keeps dispatching
 * other work. One item waiting on a person never stops the queue.
 *
 * The marker is the tracker's configured human-needed label; with no label
 * for the tracker it is the configured `blocked` role. An `exhausted` item is
 * also moved to the `blocked` role, because no worker is building it any
 * more. Names always come from config, never from this file.
 *
 * Tracker text is untrusted. An answer is picked only from an allowed
 * answerer (operators and trusted authors, else the tracker identity), only
 * after the manager's own question comment, and never from a comment that
 * carries a `[lisa-` marker, so neither a bot comment nor an earlier comment
 * nor a stranger can answer for the operator. The text is carried as data.
 * @module session-manager/human-needed
 */

/** The four reasons an item can need a human. */
export const HUMAN_NEEDED_KINDS = Object.freeze([
  "worker-question",
  "repo-route",
  "exhausted",
  "decision",
]);

/** Marks the manager's question comment, so its answer can be found after it. */
export const QUESTION_MARKER = "[lisa-session-manager-question]";

/** Any Lisa marker: a comment carrying one is Lisa's own, never an answer. */
const LISA_MARKER = /\[lisa-/i;

/** What each kind is called in the comment's first line. */
const KIND_TITLES = {
  "worker-question": "the worker building it has a question",
  "repo-route": "it is not clear which repository it belongs to",
  exhausted: "every automatic attempt to build it stopped without finishing",
  decision: "it needs a design or product decision",
};

/**
 * Credential shapes refused in question and answer text. Best effort: a match
 * is refused, a miss is not proof the text is safe. A secret belongs in the
 * project's secrets provider, never in a tracker comment or the ledger.
 */
const CREDENTIAL_SHAPES = [
  ["Telegram bot token", /\b\d{8,10}:[A-Za-z0-9_-]{30,}\b/],
  ["GitHub token", /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_\w{30,})/],
  ["AWS access key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ["Slack token", /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ["API key", /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}/],
  ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["bearer token", /\bbearer\s+[A-Za-z0-9._~+/=-]{20,}/i],
];

/**
 * The name of the first credential shape found in `text`, or null.
 * @param {string} text - Question or answer text
 * @returns {string | null} Shape name
 */
export function findCredentialShape(text) {
  const found = CREDENTIAL_SHAPES.find(([, pattern]) => pattern.test(text));
  return found ? found[0] : null;
}

/**
 * The short label an operator starts a Telegram answer with: `#12` for a
 * GitHub ref (`owner/repo#12`), the key itself for Jira and Linear.
 * @param {string} ref - Item ref
 * @returns {string} Answer label
 */
export function answerLabel(ref) {
  const hash = ref.lastIndexOf("#");
  return hash > 0 ? ref.slice(hash) : ref;
}

/**
 * The comment the manager posts on the item. It names the ref, the reason,
 * the question verbatim, and every way to answer, with no local path in it.
 * @param {{ref: string, kind: string, text: string, label: string,
 *   markerText: string, channel: boolean}} input - What to say
 * @returns {string} Comment body
 */
function questionComment({ ref, kind, text, label, markerText, channel }) {
  const ways = [
    `- Reply in a comment on this item. The session manager reads the first reply from an operator or trusted author on its next cycle.`,
    `- Or, on the machine running the session manager: \`node "$SM/session-manager.mjs" answer ${ref}\` with the answer on stdin.`,
    ...(channel
      ? [`- Or on Telegram: \`Answer with: ${label} <your answer>\`.`]
      : []),
  ];
  return [
    `${QUESTION_MARKER} ${ref} needs a human: ${KIND_TITLES[kind]}.`,
    "",
    text,
    "",
    "How to answer:",
    ...ways,
    "",
    `The session manager keeps working on other items meanwhile. Once the answer is delivered it removes ${markerText} and says so here.`,
  ].join("\n");
}

/**
 * The marker for an item: the human-needed label, else the `blocked` role.
 * @param {string | undefined} label - Configured human-needed label
 * @param {string | undefined} blocked - Configured `blocked` role value
 * @returns {{type: "label"|"role", value: string}} Marker
 */
function chooseMarker(label, blocked) {
  if (label) return { type: "label", value: label };
  if (blocked) return { type: "role", value: blocked };
  throw new Error(
    "no human-needed label and no blocked role is configured for this tracker; configure one (see the config-resolution rule) so the manager can mark the item"
  );
}

/**
 * Plan how to mark one item human-needed. Throws (a setup refusal) on an
 * unknown kind, empty or credential-shaped text, no marker, or an `exhausted`
 * item with no `blocked` role to move it to.
 * @param {{ref: string, kind: string, text: string, label?: string,
 *   blocked?: string, channel?: boolean}} input - The item, why, the question,
 *   the configured human-needed label and `blocked` role value, and whether a
 *   notification channel exists
 * @returns {{ref: string, kind: string, marker: {type: string, value: string},
 *   move?: {role: "blocked", value: string}, comment: string,
 *   answerWith: {item: string, cli: string, channel: string|null}}} Plan
 */
export function planMark({ ref, kind, text, label, blocked, channel = false }) {
  if (!HUMAN_NEEDED_KINDS.includes(kind)) {
    throw new Error(`--kind must be one of: ${HUMAN_NEEDED_KINDS.join(", ")}.`);
  }
  const question = String(text ?? "").trim();
  if (question === "") throw new Error("the question or reason is empty");
  const shape = findCredentialShape(question);
  if (shape) {
    throw new Error(
      `the text looks like it holds a credential (${shape}); it would be posted on the item. Remove it and keep secrets in the secrets provider.`
    );
  }
  const marker = chooseMarker(label, blocked);
  if (kind === "exhausted" && !blocked) {
    throw new Error(
      "an exhausted item moves to the blocked role, and none is configured for this tracker"
    );
  }
  const move =
    kind === "exhausted" ? { role: "blocked", value: blocked } : undefined;
  const short = answerLabel(ref);
  const markerText =
    marker.type === "label"
      ? `the \`${marker.value}\` label`
      : `the hold (it moves the item out of \`${marker.value}\`)`;
  return {
    ref,
    kind,
    marker,
    ...(move ? { move } : {}),
    comment: questionComment({
      ref,
      kind,
      text: question,
      label: short,
      markerText,
      channel,
    }),
    answerWith: {
      item: `a comment on ${ref}`,
      cli: `session-manager.mjs answer ${ref} (answer on stdin)`,
      channel: channel ? `Answer with: ${short} <your answer>` : null,
    },
  };
}

/**
 * Every identity string a tracker author object can carry.
 * @param {unknown} author - `author`/`user` from a comment
 * @returns {string[]} Ids, logins, account ids and names
 */
function authorIds(author) {
  if (typeof author === "string") return [author];
  if (author === null || typeof author !== "object") return [];
  return ["login", "id", "accountId", "name", "displayName", "email"]
    .map(key => author[key])
    .filter(value => typeof value === "string" || typeof value === "number")
    .map(String);
}

/**
 * The comment body, whatever the tracker calls it.
 * @param {Record<string, unknown>} comment - One comment
 * @returns {string} Body text
 */
function bodyOf(comment) {
  const body = comment.body ?? comment.text ?? "";
  return typeof body === "string" ? body : "";
}

/**
 * Pick the human's answer from an item's comments: the first comment after
 * the manager's latest question comment whose author is allowed and whose
 * body carries no `[lisa-` marker. Comments are taken in the order given
 * (the tracker's chronological order).
 * @param {{comments: unknown, allowed: readonly string[]}} input - The item's
 *   comments and the answerer ids
 * @returns {{answer: {text: string, author: string, at: string|null} | null,
 *   reason: string}} The answer, or null with why there is none
 */
export function pickItemAnswer({ comments, allowed }) {
  if (!Array.isArray(comments)) {
    throw new Error('stdin must be JSON {"comments":[...]}');
  }
  const rows = comments.filter(row => row && typeof row === "object");
  const asked = rows.findLastIndex(row =>
    bodyOf(row).includes(QUESTION_MARKER)
  );
  if (asked === -1) return { answer: null, reason: "no-question-comment" };
  const allow = new Set(allowed.map(String));
  const reply = rows.slice(asked + 1).find(row => {
    const ids = authorIds(row.author ?? row.user);
    const text = bodyOf(row);
    return (
      ids.some(id => allow.has(id)) &&
      !LISA_MARKER.test(text) &&
      text.trim() !== ""
    );
  });
  if (!reply) return { answer: null, reason: "no-answer-yet" };
  const author = authorIds(reply.author ?? reply.user).find(id =>
    allow.has(id)
  );
  const at = reply.createdAt ?? reply.created ?? reply.created_at ?? null;
  return {
    answer: {
      text: bodyOf(reply).trim(),
      author,
      at: typeof at === "string" ? at : null,
    },
    reason: "answered",
  };
}

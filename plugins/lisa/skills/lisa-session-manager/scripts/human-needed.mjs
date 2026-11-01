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
 * Reading the answer back off the item lives in human-answer.mjs.
 * @module session-manager/human-needed
 */

/** The four reasons an item can need a human. */
export const HUMAN_NEEDED_KINDS = Object.freeze([
  "worker-question",
  "repo-route",
  "exhausted",
  "decision",
]);

/**
 * Why a stop needed a human, as far as the planning-miss signal cares
 * (CodySwannGT/lisa#4569). `planning` is the default: the item passed the
 * ready gate and still needed a person. `environment` is an outage, an
 * expired credential or a flaky tool; `human-gate` is a decision planning
 * flagged as a human gate on the item. Neither of those two is a planning
 * miss.
 */
export const PLANNING_MISS_CAUSES = Object.freeze([
  "planning",
  "environment",
  "human-gate",
]);

/**
 * Each kind that counts as a planning miss, with the planning stage most
 * likely to have let it through. A hint for the judge, never its verdict:
 * `learning-judge` names the stage it can prove.
 */
const PLANNING_MISS_STAGES = Object.freeze({
  // The stateless-pickup dry-run (S18) exists to find the question first.
  "worker-question": "ready-gate",
  // How the product should behave is the PRD's to decide.
  decision: "prd",
  // A leaf the router cannot place should have been split per repo-scope-split.
  "repo-route": "decomposition",
});

/** Why a stop does not count, keyed by what ruled it out. */
const NOT_A_PLANNING_MISS = Object.freeze({
  exhausted:
    "repeated failed attempts are a build or environment problem, not a gap in the plan",
  environment:
    "an outage, an expired credential or a flaky tool is not a gap in the plan",
  "human-gate":
    "planning flagged this decision as a human gate, so asking was the plan working",
});

/**
 * Whether a human-needed stop is a planning miss: the PRD, decomposition or
 * ready gate let through an item a dispatched worker could not finish without
 * a person. Throws on an unknown cause.
 * @param {{kind: string, cause?: string}} input - The `--kind` and `--cause`
 * @returns {{counts: boolean, reason: string, stageHint?: string}} Verdict
 */
export function planningMissFor({ kind, cause = "planning" }) {
  if (!PLANNING_MISS_CAUSES.includes(cause)) {
    throw new Error(
      `--cause must be one of: ${PLANNING_MISS_CAUSES.join(", ")}.`
    );
  }
  if (cause !== "planning") {
    return { counts: false, reason: NOT_A_PLANNING_MISS[cause] };
  }
  const stageHint = PLANNING_MISS_STAGES[kind];
  if (!stageHint) {
    return { counts: false, reason: NOT_A_PLANNING_MISS.exhausted };
  }
  return {
    counts: true,
    stageHint,
    reason:
      "the item passed the ready gate and a dispatched worker still needed a human, so planning let a gap through",
  };
}

/**
 * The planning-miss verdict for `planMark`, plus the fields of the
 * `lisa-persist-learning` candidate the manager can fill in without judgment.
 * The rule and its why are the manager's to draft: they name the check
 * planning should have run, which no script can know.
 * @param {{ref: string, kind: string, cause?: string, question: string}}
 *   input - The item, why, the cause and the question text
 * @returns {object} `{counts, reason, stageHint?, candidate?}`
 */
function planningMissPlan({ ref, kind, cause, question }) {
  const verdict = planningMissFor({ kind, cause });
  if (!verdict.counts) return verdict;
  return {
    ...verdict,
    candidate: {
      signal: "planning-miss",
      triggering_issue: ref,
      provenance: [ref],
      scope_hint: "project",
      kind,
      missing: question,
    },
  };
}

/** Marks the manager's question comment, so its answer can be found after it. */
export const QUESTION_MARKER = "[lisa-session-manager-question]";

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
 * the question verbatim, and every way to answer, in plain English with
 * nothing a reader has to paste and no local path. A reply on the item is
 * offered only when someone may answer there (`answerers`): with no
 * operator or trusted author configured, replies are never picked up.
 * @param {{ref: string, kind: string, text: string, label: string,
 *   markerText: string, channel: boolean, answerers: boolean}} input - What
 *   to say
 * @returns {string} Comment body
 */
function questionComment({
  ref,
  kind,
  text,
  label,
  markerText,
  channel,
  answerers,
}) {
  const ways = [
    answerers
      ? `- Reply in a comment on this item, in plain words (do not start it with a bracketed tag). The session manager reads the first reply from an operator or trusted author on its next cycle.`
      : `- Replies on this item are not picked up: no operator or trusted author is configured for the session manager.`,
    `- On the machine running the session manager, run \`session-manager.mjs status\` and use the \`answerCommand\` it lists for this item.`,
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
 *   blocked?: string, channel?: boolean, answerers?: boolean, cause?: string}}
 *   input - The item, why, the question, the configured human-needed label
 *   and `blocked` role value, whether a notification channel exists, whether
 *   anyone (operatorIds / trustedAuthorIds) may answer on the item, and the
 *   cause the planning-miss signal needs (default `planning`)
 * @returns {{ref: string, kind: string, marker: {type: string, value: string},
 *   move?: {role: "blocked", value: string}, comment: string,
 *   answerWith: {item: string|null, cli: string, channel: string|null},
 *   planningMiss: {counts: boolean, reason: string, stageHint?: string,
 *   candidate?: object}}} Plan
 */
export function planMark({
  ref,
  kind,
  text,
  label,
  blocked,
  channel = false,
  answerers = true,
  cause = "planning",
}) {
  if (!HUMAN_NEEDED_KINDS.includes(kind)) {
    throw new Error(`--kind must be one of: ${HUMAN_NEEDED_KINDS.join(", ")}.`);
  }
  if (!PLANNING_MISS_CAUSES.includes(cause)) {
    throw new Error(
      `--cause must be one of: ${PLANNING_MISS_CAUSES.join(", ")}.`
    );
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
      answerers,
    }),
    answerWith: {
      item: answerers ? `a comment on ${ref}` : null,
      cli: `the answerCommand that session-manager.mjs status lists for ${ref} (answer on stdin)`,
      channel: channel ? `Answer with: ${short} <your answer>` : null,
    },
    planningMiss: planningMissPlan({ ref, kind, cause, question }),
  };
}

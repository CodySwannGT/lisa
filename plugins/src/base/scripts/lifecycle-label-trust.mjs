#!/usr/bin/env node
/**
 * Lifecycle-label trust resolution — the read-side guard for #2539.
 *
 * ## The defect
 *
 * `coderabbitai[bot]` stamps a `status:*` label on issues seconds after they are
 * filed. Measured across CodySwannGT/lisa#2460–#2540, seven of eight bot-applied
 * lifecycle labels landed 26–118s after creation — far too fast to be a real
 * claim. An issue wearing a bot-applied `status:in-progress` is invisible to
 * build-intake (it is not the `ready` role) AND looks handled to a human, so
 * nothing re-examines it. A MISSING lifecycle label is recoverable; a WRONG one
 * is silent in both directions at once.
 *
 * ## Why this guard reads instead of writes
 *
 * The label is applied by a webhook after the fact, so no pre-tool check on this
 * machine has anything to intercept — the write never passes through us. The two
 * remaining options were a reconciler that reverts the label, and this: intake
 * refusing to BELIEVE the label. The reconciler was rejected because the bot
 * re-applies on every subsequent review event, so reverting produces a label-flap
 * loop that is worse than the disease. Distrust is idempotent, cannot race, and
 * writes nothing — nothing in this module mutates a tracker.
 *
 * ## Why actor alone is not enough
 *
 * #2470 (false claim, 27s) and #2494 (real, 3001s) were BOTH applied by
 * `coderabbitai[bot]`. Rejecting every bot-authored lifecycle label would
 * discard the true one; rejecting every fast label would discard the human
 * `status:ready` applied at filing time, which is the queue's entry signal.
 * Distrust therefore requires BOTH conditions: a bot actor AND a latency below
 * the plausibility window.
 *
 * ## Why the member set is never hardcoded
 *
 * The live `status:*` family has drifted 7 → 6 members. A pinned literal breaks
 * silently — an unrecognised member simply fails to match, so the guard reports
 * clean on exactly the case it stopped covering. Membership is decided by the
 * `status:` PREFIX and terminality is resolved from live config.
 */

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Lifecycle labels are identified by this prefix, never by a pinned set. */
export const LIFECYCLE_LABEL_PREFIX = "status:";

/**
 * Fallback terminal label used only when config supplies no `done` role.
 *
 * This module ships standalone into host projects and cannot import Lisa's
 * TypeScript `BUILD_LABEL_DEFAULTS`, so the literal is repeated here — but it is
 * NOT free to drift: `lifecycle-label-trust.test.ts` asserts it stays equal to
 * `BUILD_LABEL_DEFAULTS.done.production` in `src/sync/lifecycle-defaults.ts`.
 * This is a fallback only; a configured project resolves the value live.
 */
export const DEFAULT_TERMINAL_LIFECYCLE_LABEL = "status:done";

/**
 * Seconds below which a BOT-applied lifecycle label is not believable as a claim.
 *
 * Calibrated against measurement, not taste: the observed false bot claims
 * clustered at 26–118s, while the one corroborated bot label landed at 3001s.
 * 300s sits an order of magnitude above the noise and an order of magnitude
 * below the real signal, so neither edge is close to the boundary.
 */
export const IMPLAUSIBLE_CLAIM_WINDOW_SECONDS = 300;

/**
 * Both directions a lifecycle label can contradict native state.
 *
 * Emitted on every drift result so a repair pass cannot walk one direction and
 * silently leave the other accumulating — the asymmetry that let TUN-556 and
 * TUN-503 sit on a terminal `status:done` while still natively open.
 */
export const LIFECYCLE_DRIFT_DIRECTIONS = [
  "terminal-label-open-state",
  "open-label-closed-state",
];

/**
 * @typedef {{ readonly login?: string, readonly type?: string }} Actor
 *
 * @typedef {{
 *   readonly event?: string
 *   readonly label?: { readonly name?: string }
 *   readonly actor?: Actor | null
 *   readonly created_at?: string
 * }} TimelineEvent
 *
 * @typedef {{
 *   readonly label: string
 *   readonly actor: string | null
 *   readonly latencySeconds: number | null
 *   readonly reason: string
 *   readonly trusted: boolean
 * }} EvaluatedLabel
 */

/**
 * Is this label part of the lifecycle namespace?
 *
 * Prefix-only by design — see the module preamble on set drift. `status:` with
 * no member is still lifecycle-namespaced and must not fall through as taxonomy.
 *
 * @param {unknown} name
 * @returns {boolean}
 */
export function isLifecycleLabel(name) {
  if (typeof name !== "string") {
    return false;
  }
  return name.trim().toLowerCase().startsWith(LIFECYCLE_LABEL_PREFIX);
}

/**
 * Is this timeline actor a bot?
 *
 * Checks GitHub's first-class `type` discriminator first, then falls back to the
 * `[bot]` login suffix so an actor payload lacking `type` is still classified.
 * A missing actor is NOT a bot: unattributable is handled separately, and
 * guessing "bot" there would silently drop legitimate labels.
 *
 * @param {Actor | null | undefined} actor
 * @returns {boolean}
 */
export function isBotActor(actor) {
  if (!actor || typeof actor !== "object") {
    return false;
  }
  if (typeof actor.type === "string" && actor.type.toLowerCase() === "bot") {
    return true;
  }
  return (
    typeof actor.login === "string" &&
    actor.login.trim().toLowerCase().endsWith("[bot]")
  );
}

/**
 * Resolve which of an item's lifecycle labels intake is entitled to believe.
 *
 * Read-only and total: every lifecycle label on the item lands in exactly one of
 * `trusted` or `untrusted`, and `evaluated` carries the reasoning for all of
 * them so a distrust decision is auditable rather than invisible.
 *
 * Provenance that cannot be established (a label applied at creation, which
 * GitHub records no `labeled` event for) is TRUSTED but reported in
 * `unknownProvenance`. Failing closed there would make intake ignore the
 * human `status:ready` that opens the queue, stalling every project — so the
 * blind spot is surfaced rather than guessed at. Supplying `issueAuthor` closes
 * it, by attributing creation-time labels to whoever filed the item.
 *
 * @param {{
 *   readonly labels?: readonly (string | { readonly name?: string })[]
 *   readonly timeline?: readonly TimelineEvent[]
 *   readonly issueCreatedAt?: string
 *   readonly issueAuthor?: Actor | null
 *   readonly windowSeconds?: number
 * }} input
 * @returns {{
 *   readonly trusted: readonly string[]
 *   readonly untrusted: readonly Omit<EvaluatedLabel, "trusted">[]
 *   readonly unknownProvenance: readonly string[]
 *   readonly evaluated: readonly EvaluatedLabel[]
 *   readonly hasUntrustedLifecycleLabels: boolean
 * }}
 */
export function resolveTrustedLifecycleLabels(input = {}) {
  const windowSeconds = normalizeWindow(input.windowSeconds);
  const createdAtMs = parseTimestamp(input.issueCreatedAt);
  const lifecycleLabels = normalizeLabelNames(input.labels).filter(
    isLifecycleLabel
  );
  const latestApplication = indexLatestLabelApplications(input.timeline);

  const evaluated = lifecycleLabels.map(label =>
    evaluateLabel({
      label,
      application: latestApplication.get(label.trim().toLowerCase()),
      createdAtMs,
      issueAuthor: input.issueAuthor,
      windowSeconds,
    })
  );

  return {
    trusted: evaluated.filter(entry => entry.trusted).map(entry => entry.label),
    untrusted: evaluated
      .filter(entry => !entry.trusted)
      .map(({ trusted: _trusted, ...rest }) => rest),
    unknownProvenance: evaluated
      .filter(entry => entry.reason === "provenance-unknown")
      .map(entry => entry.label),
    evaluated,
    hasUntrustedLifecycleLabels: evaluated.some(entry => !entry.trusted),
  };
}

/**
 * The lifecycle labels that mean "this work is finished", read from live config.
 *
 * Only the PRODUCTION rung of the `done` role is terminal. `status:on-dev` and
 * `status:on-stg` are shipped-somewhere, not finished, and closing on them would
 * retire work that still has environments to clear.
 *
 * @param {unknown} config a parsed `.lisa.config.json`-shaped object
 * @returns {readonly string[]}
 */
export function terminalLifecycleLabels(config) {
  const done = readPath(config, ["github", "labels", "build", "done"]);

  if (typeof done === "string" && done.trim().length > 0) {
    return [done.trim()];
  }
  const production = readPath(done, ["production"]);
  if (typeof production === "string" && production.trim().length > 0) {
    return [production.trim()];
  }
  return [DEFAULT_TERMINAL_LIFECYCLE_LABEL];
}

/** The claimed role's label when config names none. */
const DEFAULT_CLAIMED_LIFECYCLE_LABEL = "status:in-progress";

/**
 * The lifecycle label that means "somebody is already on this", from config.
 * @param {unknown} config a parsed `.lisa.config.json`-shaped object
 * @returns {string} the claimed role's label
 */
export function claimedLifecycleLabel(config) {
  const claimed = readPath(config, ["github", "labels", "build", "claimed"]);
  return typeof claimed === "string" && claimed.trim().length > 0
    ? claimed.trim()
    : DEFAULT_CLAIMED_LIFECYCLE_LABEL;
}

/**
 * Whether intake may claim this issue, and why not when it may not.
 *
 * The scan filters on the ready role alone, so an issue carrying BOTH ready and
 * claimed comes back as a candidate. Trust resolution then rescues the case
 * where a bot applied the claim — but says nothing about the case where a
 * *human* did, which is the strongest claim signal there is and the one that
 * was being ignored. An issue a person marked in-progress is somebody's active
 * work; dispatching a second agent onto it is how two branches end up fixing
 * the same thing.
 *
 * Returned as a verdict rather than left to the skill's prose. This repository
 * has measured the difference: executable controls hold, prose rules are
 * followed by roughly nobody, including their own author. The scan already
 * calls this classifier, so the answer arrives where the decision is made.
 *
 * A claim is only believed when TRUSTED, which is what keeps this from undoing
 * the bot fix: a reflexive bot label leaves the issue claimable exactly as if
 * it were absent.
 * @param {object} options inputs
 * @param {readonly string[]} options.trusted labels the classifier believes
 * @param {unknown} options.config a parsed `.lisa.config.json`-shaped object
 * @returns {{claimable: boolean, reason: string|null}} the verdict
 */
export function resolveClaimability({ trusted, config }) {
  const claimed = claimedLifecycleLabel(config);
  const normalizedClaimed = claimed.toLowerCase();
  const hasTrustedClaim = (trusted ?? []).some(
    label => String(label).trim().toLowerCase() === normalizedClaimed
  );
  if (!hasTrustedClaim) {
    return { claimable: true, reason: null };
  }
  return {
    claimable: false,
    reason:
      `already carries a trusted "${claimed}", so somebody is working it; ` +
      `intake must not dispatch a second agent onto the same issue`,
  };
}

/**
 * Detect lifecycle labels that contradict native state, in BOTH directions.
 *
 * `directionsWalked` is always the full direction list, so a caller reporting
 * "clean" is asserting it looked at both — the failure mode refinement #1 of
 * issue #2539 describes, where only the auto-complete direction was ever
 * repaired and the reverse rotted unobserved.
 *
 * `excludeLabels` removes labels from consideration entirely. Callers MUST pass
 * the untrusted set here: `open-label-closed-state` is a repair direction that
 * WRITES (it advances the label to the terminal `done` role), so without this a
 * bot-applied label the classifier just refused to believe would still drive a
 * real label write — the guard would launder the very input it rejected.
 *
 * @param {{
 *   readonly labels?: readonly (string | { readonly name?: string })[]
 *   readonly state?: string
 *   readonly terminalLabels?: readonly string[]
 *   readonly excludeLabels?: readonly string[]
 * }} input
 * @returns {{
 *   readonly drifts: readonly { direction: string, label: string }[]
 *   readonly directionsWalked: readonly string[]
 *   readonly excluded: readonly string[]
 * }}
 */
export function detectLifecycleDrift(input = {}) {
  const terminal = new Set(
    (input.terminalLabels ?? terminalLifecycleLabels(undefined)).map(label =>
      String(label).trim().toLowerCase()
    )
  );
  const excluded = new Set(
    (Array.isArray(input.excludeLabels) ? input.excludeLabels : []).map(label =>
      String(label).trim().toLowerCase()
    )
  );
  const closed =
    String(input.state ?? "")
      .trim()
      .toLowerCase() === "closed";
  const allLifecycleLabels = normalizeLabelNames(input.labels).filter(
    isLifecycleLabel
  );
  const skipped = allLifecycleLabels.filter(label =>
    excluded.has(label.trim().toLowerCase())
  );
  const lifecycleLabels = allLifecycleLabels.filter(
    label => !excluded.has(label.trim().toLowerCase())
  );

  const drifts = lifecycleLabels.flatMap(label => {
    const isTerminal = terminal.has(label.trim().toLowerCase());
    if (isTerminal && !closed) {
      return [{ direction: "terminal-label-open-state", label }];
    }
    if (!isTerminal && closed) {
      return [{ direction: "open-label-closed-state", label }];
    }
    return [];
  });

  return {
    drifts,
    directionsWalked: LIFECYCLE_DRIFT_DIRECTIONS,
    excluded: skipped,
  };
}

/**
 * Classify one lifecycle label against its most recent application.
 *
 * @param {{
 *   label: string
 *   application?: { actor?: Actor | null, createdAtMs: number | null }
 *   createdAtMs: number | null
 *   issueAuthor?: Actor | null
 *   windowSeconds: number
 * }} params
 * @returns {EvaluatedLabel}
 */
function evaluateLabel(params) {
  const { label, application, createdAtMs, issueAuthor, windowSeconds } =
    params;

  const actor = application ? application.actor : issueAuthor;
  const hasProvenance = Boolean(application) || Boolean(issueAuthor);

  if (!hasProvenance) {
    return {
      label,
      actor: null,
      latencySeconds: null,
      reason: "provenance-unknown",
      trusted: true,
    };
  }

  const login = typeof actor?.login === "string" ? actor.login : null;

  if (!isBotActor(actor)) {
    return {
      label,
      actor: login,
      latencySeconds: latencySeconds(createdAtMs, application),
      reason: "human-actor",
      trusted: true,
    };
  }

  const latency = latencySeconds(createdAtMs, application);
  const implausible = latency === null || latency < windowSeconds;

  return {
    label,
    actor: login,
    latencySeconds: latency,
    reason: implausible
      ? "bot-actor-implausible-latency"
      : "bot-actor-plausible-latency",
    trusted: !implausible,
  };
}

/**
 * Seconds between item creation and the label application.
 *
 * A creation-time label (no timeline event) is latency 0 by construction.
 *
 * @param {number | null} createdAtMs
 * @param {{ createdAtMs: number | null } | undefined} application
 * @returns {number | null}
 */
function latencySeconds(createdAtMs, application) {
  if (createdAtMs === null) {
    return null;
  }
  if (!application) {
    return 0;
  }
  if (application.createdAtMs === null) {
    return null;
  }
  return Math.max(
    0,
    Math.round((application.createdAtMs - createdAtMs) / 1000)
  );
}

/**
 * Map each lifecycle label to its MOST RECENT `labeled` event.
 *
 * Most-recent, not first: a human who removes the bot's label and re-applies it
 * has made a genuine claim, and keying on the first application would keep
 * distrusting a label the human now owns.
 *
 * @param {readonly TimelineEvent[] | undefined} timeline
 * @returns {Map<string, { actor?: Actor | null, createdAtMs: number | null }>}
 */
function indexLatestLabelApplications(timeline) {
  const index = new Map();

  for (const event of Array.isArray(timeline) ? timeline : []) {
    if (event?.event !== "labeled") {
      continue;
    }
    const name = event.label?.name;
    if (typeof name !== "string" || name.trim().length === 0) {
      continue;
    }
    const key = name.trim().toLowerCase();
    const createdAtMs = parseTimestamp(event.created_at);
    const existing = index.get(key);
    if (
      existing &&
      existing.createdAtMs !== null &&
      createdAtMs !== null &&
      existing.createdAtMs > createdAtMs
    ) {
      continue;
    }
    index.set(key, { actor: event.actor ?? null, createdAtMs });
  }

  return index;
}

/**
 * @param {readonly (string | { readonly name?: string })[] | undefined} labels
 * @returns {readonly string[]}
 */
function normalizeLabelNames(labels) {
  return (Array.isArray(labels) ? labels : [])
    .map(label => (typeof label === "string" ? label : label?.name))
    .filter(name => typeof name === "string" && name.trim().length > 0);
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function parseTimestamp(value) {
  if (typeof value !== "string") {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function normalizeWindow(value) {
  return Number.isFinite(value) && value >= 0
    ? Number(value)
    : IMPLAUSIBLE_CLAIM_WINDOW_SECONDS;
}

/**
 * @param {unknown} source
 * @param {readonly string[]} keys
 * @returns {unknown}
 */
function readPath(source, keys) {
  return keys.reduce(
    (current, key) =>
      current && typeof current === "object" ? current[key] : undefined,
    source
  );
}

/**
 * CLI: read a `{ issue, timeline, config }` payload on stdin, print the verdict.
 *
 * Exits 0 even when untrusted labels are found. This is a classifier, not a
 * gate: callers run it inside `set -e` intake bash and branch on the JSON, and a
 * non-zero exit would abort the scan on the very issues it exists to rescue.
 *
 * @returns {Promise<void>}
 */
async function main() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  const payload = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  const issue = payload.issue ?? {};

  const trust = resolveTrustedLifecycleLabels({
    labels: issue.labels,
    timeline: payload.timeline,
    issueCreatedAt: issue.created_at ?? issue.createdAt,
    issueAuthor: issue.user ?? issue.author,
    windowSeconds: payload.windowSeconds,
  });
  // Untrusted labels are excluded here rather than at the call site: the
  // `open-label-closed-state` direction WRITES, so a caller that forgot to pass
  // them would launder a label the classifier just rejected into a real write.
  const drift = detectLifecycleDrift({
    labels: issue.labels,
    state: issue.state,
    terminalLabels: terminalLifecycleLabels(payload.config),
    excludeLabels: trust.untrusted.map(entry => entry.label),
  });
  // Computed from `trust.trusted`, never from the raw label set: a bot-applied
  // claim must leave the issue claimable exactly as if it were absent, which is
  // the whole point of the trust pass above.
  const claim = resolveClaimability({
    trusted: trust.trusted,
    config: payload.config,
  });

  process.stdout.write(
    `${JSON.stringify({ ...trust, ...drift, ...claim }, null, 2)}\n`
  );
}

/**
 * True when `moduleUrl` names the module node was asked to run.
 *
 * Both sides are realpath'd. The previous spelling compared `import.meta.url`
 * against a `file://` string built from `process.argv[1]`, which compares a
 * real path against whatever the caller typed — so reached through a symlinked
 * checkout, a git worktree, or a `/tmp` path on macOS the two disagreed and
 * `main()` never ran. This module writes its verdict to stdout, so a no-op
 * leaves the caller parsing an empty payload: no untrusted labels, no
 * unclaimable verdict, everything believed. A guard that fails open on the
 * component whose job is deciding what to believe.
 *
 * Written out rather than imported: this is a plugin payload, which has no
 * `./lib/` to resolve against. Same rule and same reasoning as
 * `scripts/lib/invoked-as-script.mjs`.
 * @param {string} moduleUrl - The caller's own `import.meta.url`.
 * @param {string | undefined} [argv1] - Entry path; defaults to `process.argv[1]`.
 * @returns {boolean} Whether the caller should run its CLI body.
 */
export function invokedAsScript(moduleUrl, argv1 = process.argv[1]) {
  if (!argv1) return false;
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

if (invokedAsScript(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

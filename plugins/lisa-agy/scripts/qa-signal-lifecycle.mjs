#!/usr/bin/env node
/**
 * Transient work-item signals, and the executable predicates that void them.
 *
 * ## The defect this exists for
 *
 * `lisa-qa-fail` applies a QA-failure label as "the deterministic rework signal
 * `lisa-rework-triage` keys on". Nothing ever removed it. The pass path is
 * where that is most visible: `lisa-qa-queue` moves a passing item to the
 * certified role and leaves the label saying the item is failing QA, so an item
 * that failed once is thereafter indistinguishable from an item failing now.
 * The population only grows, so a deterministic input to triage degrades toward
 * meaning "this item has been around a while".
 *
 * The defect is not at the site that applies the label — that write is correct
 * every time it fires. It is entirely in the return path nobody wrote, which is
 * why it never appeared in a diff. See `state-changes-without-inverses`.
 *
 * ## The contract
 *
 * A signal is DURABLE (a label, which machines read) plus HISTORY (the marker
 * comments, which humans read). Only the durable half is voided; the history is
 * never rewritten, so "this item failed QA twice before shipping" stays true
 * and readable after the signal is cleared.
 *
 * Every signal in {@link SIGNALS} declares the void conditions that lift it,
 * and **every condition must have an executable predicate** in
 * {@link VOID_PREDICATES}. A condition with no predicate is reported as
 * `unchecked`, never silently treated as unmet — that is the difference between
 * a commitment and prose, and it is the shape `placeholder-expiry` exists to
 * enforce for provisional values. When a condition is unchecked the signal is
 * held LIVE: failing closed keeps the control, where failing open would delete
 * it, and this fix must not remove a control while correcting one.
 *
 * Adding the next transient signal is a row in {@link SIGNALS} plus its
 * predicate — not another bespoke clear path. The `rework` and `regression`
 * labels `lisa-rework-triage` also reads are plausible next rows; whether they
 * have the same shape is unverified here and deliberately not claimed.
 *
 * ## Why a script rather than prose in each skill
 *
 * The setter, the two clear paths and the reader are four different skills on
 * three trackers. Prose in four places is how the setter and the clearer drift
 * apart, which is the same reasoning that produced `resolve-lifecycle-role.mjs`
 * after twelve inlined `read_role()` helpers hashed to eleven implementations.
 * A process boundary also means the predicate is unit-testable rather than
 * re-read.
 * @module scripts/qa-signal-lifecycle
 */

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  GLOBAL_CONFIG,
  LOCAL_CONFIG,
  VENDOR_ROOTS,
  parseArgs,
  parseConfig,
  readPath,
  resolveRole,
} from "./resolve-lifecycle-role.mjs";

/** The QA-failure signal: applied by `lisa-qa-fail`, read by rework triage. */
export const QA_FAILURE_SIGNAL = "qa-failure";

/**
 * Every transient signal, with the void conditions that lift it.
 *
 * `fallback` is a built-in default, which lifecycle ROLES deliberately do not
 * get (`resolve-lifecycle-role` R1). The distinction is real: a defaulted role
 * invents a tracker state to write into, while this name is only a label that
 * the setter, the clearers and the reader all resolve through this one
 * function — so they cannot disagree about it, whatever it is called. A project
 * renaming the label sets `qa.labels.fail` and every path follows.
 */
export const SIGNALS = Object.freeze({
  [QA_FAILURE_SIGNAL]: Object.freeze({
    configPath: "qa.labels.fail",
    fallback: "qa-fail",
    appliedBy: "lisa-qa-fail",
    clearedBy: Object.freeze(["lisa-qa-queue", "lisa-qa-clear"]),
    readBy: "lisa-rework-triage",
    voidConditions: Object.freeze([
      "qa-pass-recorded",
      "certified-role-reached",
    ]),
  }),
});

/**
 * Marker lines that record a QA verdict, newest occurrence winning.
 *
 * Matched at the start of a line so a comment *discussing* a marker is not
 * mistaken for one. `[lisa-qa-queue] QA blocked:` deliberately does not match
 * the pass pattern — "could not test" is not a verdict.
 */
export const VERDICT_MARKERS = Object.freeze([
  Object.freeze({ verdict: "fail", pattern: /^\s*\[lisa-qa-fail\]/u }),
  Object.freeze({ verdict: "pass", pattern: /^\s*\[lisa-qa-queue\] QA pass/u }),
  Object.freeze({ verdict: "pass", pattern: /^\s*\[lisa-qa-clear\]/u }),
]);

/** Evaluation outcomes; the caller branches on these, never on prose. */
export const OUTCOMES = Object.freeze({
  ABSENT: "absent",
  LIVE: "live",
  STALE: "stale",
  UNCHECKED: "unchecked",
  UNKNOWN_SIGNAL: "unknown-signal",
});

/** What the caller should do about the durable half of the signal. */
export const ACTIONS = Object.freeze({
  NONE: "none",
  KEEP: "keep",
  CLEAR: "clear",
});

/**
 * Compare tracker names the way trackers actually behave: case drifts.
 *
 * @param {unknown} value a label, status or state name
 * @returns {string} a comparable form, empty when there is nothing to compare
 */
const normalize = value =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

/**
 * The most recent QA verdict recorded on an item.
 *
 * @param {readonly unknown[]} [comments] comment bodies, oldest first
 * @returns {"pass" | "fail" | null} the newest verdict, or null when none
 */
export const latestQaVerdict = comments => {
  const bodies = Array.isArray(comments) ? comments : [];
  for (let index = bodies.length - 1; index >= 0; index -= 1) {
    const verdict = verdictOf(bodies[index]);
    if (verdict) return verdict;
  }
  return null;
};

/**
 * The verdict one comment body records, if any.
 *
 * @param {unknown} body a comment body
 * @returns {"pass" | "fail" | null} the verdict its first marker line records
 */
const verdictOf = body => {
  if (typeof body !== "string") return null;
  for (const line of body.split("\n")) {
    const marker = VERDICT_MARKERS.find(entry => entry.pattern.test(line));
    if (marker) return marker.verdict;
  }
  return null;
};

/**
 * Role names whose occupancy proves the QA failure was resolved: the certified
 * role, and every environment rung of the terminal `done` map.
 *
 * @param {object} options inputs
 * @param {string} options.vendor `jira` | `linear` | `github`
 * @param {unknown} options.config merged config object
 * @returns {string[]} configured role names, empty when none are bound
 */
export const voidingRoles = ({ vendor, config }) => {
  const certified = resolveRole({
    role: "qa.certified",
    vendor,
    global: config,
  });
  const root = VENDOR_ROOTS[vendor];
  const doneMap = root ? readPath(config, `${root}.done`) : undefined;
  const done =
    doneMap && typeof doneMap === "object" ? Object.values(doneMap) : [];
  return [certified.value, ...done].filter(
    name => typeof name === "string" && name.trim().length > 0
  );
};

/**
 * The executable predicate behind each declared void condition.
 *
 * Both are ORed: either an explicit later pass verdict, or the item having
 * reached a role it can only occupy once the failure was resolved. The second
 * is what repairs items whose label predates this module — no comment archaeology
 * is required to see that a certified item is not failing QA.
 */
export const VOID_PREDICATES = Object.freeze({
  "qa-pass-recorded": ({ verdict }) => verdict === "pass",
  "certified-role-reached": ({ role, resolvedRoles }) =>
    normalize(role) !== "" &&
    resolvedRoles.some(name => normalize(name) === normalize(role)),
});

/**
 * Void conditions declared by some signal with no predicate to evaluate them.
 *
 * Exported so the contract is checkable rather than asserted: a registry row
 * naming a condition nothing can evaluate is a defect, not an exemption.
 *
 * @returns {string[]} unchecked condition keys across every declared signal
 */
export const unpredicatedConditions = () =>
  Object.values(SIGNALS)
    .flatMap(declared => declared.voidConditions)
    .filter(key => typeof VOID_PREDICATES[key] !== "function");

/**
 * Resolve a signal's label name from config, falling back to its declared name.
 *
 * @param {object} options inputs
 * @param {string} options.signal a key of {@link SIGNALS}
 * @param {unknown} [options.config] merged config object
 * @returns {{ value: string, source: string }} the name and where it came from
 */
export const resolveSignalLabel = ({ signal, config }) => {
  const declared = SIGNALS[signal];
  if (!declared) return { value: "", source: "none" };
  const configured = readPath(config, declared.configPath);
  if (typeof configured === "string" && configured.trim().length > 0) {
    return { value: configured.trim(), source: "config" };
  }
  return { value: declared.fallback, source: "fallback" };
};

/**
 * Label names off a tracker payload, accepting strings or `{ name }` objects.
 *
 * @param {readonly unknown[]} [labels] the item's labels
 * @returns {string[]} their names
 */
const labelNames = labels =>
  (Array.isArray(labels) ? labels : [])
    .map(entry => (typeof entry === "string" ? entry : entry?.name))
    .filter(name => typeof name === "string");

/**
 * Decide whether a signal on an item is still live, and what to do about it.
 *
 * @param {object} options inputs
 * @param {string} [options.signal] a key of {@link SIGNALS}
 * @param {readonly unknown[]} [options.labels] the item's labels
 * @param {readonly unknown[]} [options.comments] comment bodies, oldest first
 * @param {string} [options.role] the item's current lifecycle role name
 * @param {string} options.vendor `jira` | `linear` | `github`
 * @param {unknown} [options.config] merged config object
 * @returns {object} the evaluation, including `outcome`, `action` and `reason`
 */
export const evaluateSignal = ({
  signal = QA_FAILURE_SIGNAL,
  labels,
  comments,
  role = "",
  vendor,
  config,
}) => {
  const declared = SIGNALS[signal];
  if (!declared) {
    return {
      signal,
      outcome: OUTCOMES.UNKNOWN_SIGNAL,
      action: ACTIONS.NONE,
      reason: `Unknown signal '${signal}'. Declared: ${Object.keys(SIGNALS).join(", ")}.`,
    };
  }

  const label = resolveSignalLabel({ signal, config });
  const present = labelNames(labels).some(
    name => normalize(name) === normalize(label.value)
  );
  const verdict = latestQaVerdict(comments);
  const context = {
    verdict,
    role,
    resolvedRoles: voidingRoles({ vendor, config }),
  };
  const unchecked = declared.voidConditions.filter(
    key => typeof VOID_PREDICATES[key] !== "function"
  );
  const voided = declared.voidConditions.filter(
    key => VOID_PREDICATES[key]?.(context) === true
  );

  return {
    signal,
    label: label.value,
    labelSource: label.source,
    present,
    verdict,
    voided,
    unchecked,
    ...verdictOnPresence({ present, voided, unchecked, label: label.value }),
  };
};

/**
 * The outcome/action/live triple for one evaluated signal.
 *
 * Held LIVE while any declared condition is unchecked: keeping a control that
 * may be stale beats deleting one that is not.
 *
 * @param {object} options evaluated state
 * @param {boolean} options.present whether the label is on the item
 * @param {readonly string[]} options.voided conditions that fired
 * @param {readonly string[]} options.unchecked conditions with no predicate
 * @param {string} options.label the resolved label name
 * @returns {{ live: boolean, outcome: string, action: string, reason: string }} the verdict
 */
const verdictOnPresence = ({ present, voided, unchecked, label }) => {
  if (!present) {
    return {
      live: false,
      outcome: OUTCOMES.ABSENT,
      action: ACTIONS.NONE,
      reason: `'${label}' is not on this item.`,
    };
  }
  if (unchecked.length > 0) {
    return {
      live: true,
      outcome: OUTCOMES.UNCHECKED,
      action: ACTIONS.KEEP,
      reason: `'${label}' declares void conditions with no predicate (${unchecked.join(", ")}); holding it live.`,
    };
  }
  if (voided.length > 0) {
    return {
      live: false,
      outcome: OUTCOMES.STALE,
      action: ACTIONS.CLEAR,
      reason: `'${label}' was voided by ${voided.join(", ")}; remove the label. The marker comments stay as history.`,
    };
  }
  return {
    live: true,
    outcome: OUTCOMES.LIVE,
    action: ACTIONS.KEEP,
    reason: `'${label}' is live: no void condition has fired.`,
  };
};

/**
 * CLI entry point.
 *
 * Exit codes: `0` when the signal was evaluated (branch on `action`), `2` on a
 * usage error, unreadable config, or a declared condition with no predicate.
 *
 * @param {string[]} argv arguments after the script name
 * @returns {number} process exit code
 */
export const main = argv => {
  const args = parseArgs(argv);
  if (!args.vendor) {
    process.stderr.write(
      "usage: qa-signal-lifecycle.mjs --vendor <jira|linear|github> [--signal qa-failure] [--print-label] [--item <file.json>]\n"
    );
    return 2;
  }

  const local = parseConfig(args.local ?? LOCAL_CONFIG);
  const globalConfig = parseConfig(args.config ?? GLOBAL_CONFIG);
  for (const parsed of [local, globalConfig]) {
    if (parsed.error) {
      process.stderr.write(`${parsed.error}\n`);
      return 2;
    }
  }
  const config = { ...globalConfig.value, ...local.value };
  const signal = args.signal ?? QA_FAILURE_SIGNAL;

  if (args["print-label"] === "true") {
    const label = resolveSignalLabel({ signal, config });
    if (!label.value) {
      process.stderr.write(`Unknown signal '${signal}'.\n`);
      return 2;
    }
    process.stdout.write(`${label.value}\n`);
    return 0;
  }

  const item = args.item
    ? parseConfig(args.item)
    : { value: {}, error: undefined };
  if (item.error) {
    process.stderr.write(`${item.error}\n`);
    return 2;
  }
  const result = evaluateSignal({
    signal,
    labels: item.value?.labels,
    comments: item.value?.comments,
    role: args.role ?? item.value?.role ?? "",
    vendor: args.vendor,
    config,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.outcome === OUTCOMES.UNKNOWN_SIGNAL) return 2;
  return result.outcome === OUTCOMES.UNCHECKED ? 2 : 0;
};

const invokedDirectly = (() => {
  try {
    return (
      realpathSync(process.argv[1] ?? "") ===
      realpathSync(fileURLToPath(import.meta.url))
    );
  } catch {
    return false;
  }
})();

if (invokedDirectly) process.exit(main(process.argv.slice(2)));

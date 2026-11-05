#!/usr/bin/env node
/**
 * What a `human_gate` must name: an ACT an agent cannot perform.
 *
 * The filing contract used to define a human gate as "a human product call is
 * pending". Almost any open choice reads as a product call, so agents followed
 * the contract to the letter and held plain decisions for a person — which name
 * to use, how to classify existing state, when to dispatch a follow-up — and
 * the person's answer was nearly always "you decide" (CodySwannGT/lisa#4658).
 * A hold costs an operator interruption and stalls the work until someone
 * notices, so a hold that only names a topic is worse than no hold at all.
 *
 * This module is the one answer to "is this a legitimate gate?". A reason is
 * legitimate only when it names one of the acts below, or a decision class the
 * project has explicitly declared human-only in `.lisa.config.json`
 * (`humanGate.humanOnly`). Anything else is a decision: the agent picks the
 * reasonable default, records it on the item, and files it build-ready.
 *
 * Refusal is the default, deliberately. A closed vocabulary of acts can be
 * audited; an open vocabulary of "topics that feel important" is exactly the
 * reading that produced the false gates.
 *
 * The same classifier runs on both ends:
 * - the writers call the CLI below before stamping a hold, and refuse a
 *   topic-only reason with {@link DECIDE_AND_RECORD};
 * - the intake sweeps call `planHumanGateLift` in `intake-blocker-reprobe.mjs`,
 *   which uses it to lift holds filed under the old wording.
 *
 * Usage:
 *   node human-gate-act.mjs check --reason "<human_gate reason>" \
 *     [--config .lisa.config.json] [--local .lisa.config.local.json]
 * Prints a JSON verdict. Exit 0 when the gate is legitimate, 1 when refused,
 * 2 on a usage or config error.
 * @module human-gate-act
 */
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The acts an agent cannot perform. Each `label` is phrased so it completes
 * "Held for a person to …", which is how the writers render the visible line.
 *
 * The patterns run over a normalized reason (lower case, hyphens and
 * underscores read as spaces) so a slug and its prose spelling match alike.
 * They are intentionally narrow: a word that is also an everyday topic
 * ("token", "login", "billing page") is left out, because a pattern that
 * matches a topic re-opens the gate this module closes.
 */
export const HUMAN_GATE_ACTS = Object.freeze([
  Object.freeze({
    act: "credential",
    label: "supply a credential only a person holds",
    pattern:
      /\b(credentials?|secrets?|passwords?|passphrases?|api keys?|access keys?|private keys?|auth tokens?|oauth|2fa|mfa|otp|one time codes?)\b/u,
  }),
  Object.freeze({
    act: "spend",
    label: "approve spending money",
    pattern:
      /\b(spend|spending|payments?|pay for|purchase|purchasing|buy|budget approval|credit card|money|paid (plan|tier|seat|account)s?)\b/u,
  }),
  Object.freeze({
    act: "external-account",
    label: "open an external account",
    pattern:
      /\b((open|opening|create|creating|register|registering|sign up for|signing up for)( (a|an|the|new))?( [a-z0-9]+){0,3} accounts?|(vendor|provider|third party|external) accounts?|accounts? in (a|an|the|our) [a-z]+ name|signup)\b/u,
  }),
  Object.freeze({
    act: "legal-signoff",
    label: "give a legal or compliance sign-off",
    pattern:
      /\b(legal|lawyer|counsel|compliance|regulatory|hipaa|gdpr|soc ?2|contracts?|terms of service|licen[cs]e agreements?|protected (deploy|deployment|environment)s?)\b/u,
  }),
  Object.freeze({
    act: "accountable-person",
    label: "name an accountable person",
    pattern:
      /\b(accountable (person|owner|party)|name (an|the) (owner|approver|accountable)|(owner|approver) who answers|answers for)\b/u,
  }),
  Object.freeze({
    act: "unreachable-system",
    label: "act in a system the agent cannot reach",
    pattern:
      /\b(physical|hardware|on site|in person|unreachable|cannot reach|can ?not reach|cant reach|no access|outside (the )?agent|grant(s|ed|ing)? ([a-z]+ ){0,3}(access|permissions?|roles?)|give (the )?agent ([a-z]+ ){0,3}access|access (the )?agent (lacks|does not have|doesnt have|cannot get)|agent (lacks|does not have|doesnt have) ([a-z]+ ){0,4}access|tool access|missing access|access grant|provision(ing)? access|phone call)\b/u,
  }),
  Object.freeze({
    act: "lisa-policy",
    label: "make a call Lisa's own policy reserves for a person",
    // Lisa's own human-only gates: exploratory-QA findings (the named exception
    // in `ready-role-filing`), learnings promotion/demotion, harness
    // interventions, automation retirement, and a hold the operator explicitly
    // asked for. Each is a gate the factory model places outside the factory.
    pattern:
      /\b(exploratory (finding|qa)|harness intervention|(promot|demot|retir)\w*\b.*\b(knowledge|learnings?)|(knowledge|learnings?)\b.*\b(promot|demot|retir)\w*|automation retirement|retire (an |the )?automations?|operator (prioriti[sz]ation|requested)|operator (explicitly )?(asked|requested)|explicitly asked for|requested by (the )?operator)\b/u,
  }),
]);

/**
 * Acts whose keyword alone could be a topic. A slug such as
 * `compliance-dashboard-triage` or `oauth-provider-choice` carries an act
 * keyword but names a decision about a topic, so for these acts a topic word
 * with no act verb beside it is refused. Lisa's own policy gates and
 * project-declared classes are exempt: they are already named decisions.
 */
const KEYWORD_ACTS = new Set([
  "credential",
  "spend",
  "external-account",
  "legal-signoff",
  "accountable-person",
  "unreachable-system",
]);

/** Words that mark a reason as being about a topic, not an act. */
const TOPIC_WORDS =
  /\b(triage|dispatch|naming|rename|choice|choose|design|copy|colou?r|layout|wording|migration|refactor|classification|classify|cleanup|dashboard|page|button|ui|ux|docs?|documentation|schema|decision|selection|split|labels?|error message)\b/u;

/** Verbs that say what a person must actually do. */
const ACT_VERBS =
  /\b(supply|supplies|provide|provides|enter|holds?|held by|approv\w*|sign(s|ed|ing)?|signoff|grant\w*|give|gives|open|opens|register\w*|attest\w*|pay|pays|spend\w*|only (a|the) (person|founder|owner|operator|human|admin)|lacks?|does not have|doesnt have|cannot|can not|physically|in person|on site)\b/u;

/** The path a refused gate is pointed at. One string, so writers cannot drift. */
export const DECIDE_AND_RECORD =
  "This is a decision, not an act a person must perform. Decide and record: " +
  "pick the reasonable default, write the decision on the item (a `Decision:` " +
  "line saying what was chosen and why), and file it with `build_ready: true`.";

/**
 * The comparable form of a reason: lower case, slug separators read as spaces.
 * @param {unknown} value - A raw reason, slug, or line of text
 * @returns {string} Normalized text
 */
export function normalizeGateText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[-_/]+/gu, " ")
    .replace(/[^a-z0-9' ]+/gu, " ")
    .replace(/'/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * The project's declared human-only decision classes, normalized.
 * @param {unknown} classes - `humanGate.humanOnly` from config
 * @returns {string[]} Non-empty normalized phrases
 */
function normalizeClasses(classes) {
  return (Array.isArray(classes) ? classes : [])
    .map(normalizeGateText)
    .filter(phrase => phrase.length > 0);
}

/**
 * Classify a `human_gate` reason.
 * @param {unknown} reason - The reason (slug or prose) a filing gives
 * @param {{ humanOnly?: unknown }} [options] - `humanOnly`: project-declared
 *   human-only decision classes (`humanGate.humanOnly`)
 * @returns {{ valid: boolean, act: string | null, label: string | null, matched: string | null, remedy: string | null }} Verdict
 */
export function classifyHumanGateReason(reason, options = {}) {
  const text = normalizeGateText(reason);
  if (text.length > 0) {
    const topicOnly = TOPIC_WORDS.test(text) && !ACT_VERBS.test(text);
    for (const entry of HUMAN_GATE_ACTS) {
      const match = entry.pattern.exec(text);
      if (match && !(topicOnly && KEYWORD_ACTS.has(entry.act))) {
        return {
          valid: true,
          act: entry.act,
          label: entry.label,
          matched: match[0],
          remedy: null,
        };
      }
    }
    const declared = normalizeClasses(options.humanOnly).find(phrase =>
      ` ${text} `.includes(` ${phrase} `)
    );
    if (declared) {
      return {
        valid: true,
        act: "project-policy",
        label: `make a ${declared} decision this project reserves for a person`,
        matched: declared,
        remedy: null,
      };
    }
  }
  return {
    valid: false,
    act: null,
    label: null,
    matched: null,
    remedy: DECIDE_AND_RECORD,
  };
}

/**
 * Render the visible hold line plus marker a writer stamps for a valid gate.
 * @param {{ reason?: unknown, slug?: unknown, label?: unknown }} hold - The
 *   reason, its short slug, and the act label from the verdict
 * @returns {string} Two lines: the visible statement and the marker
 */
export function formatHumanGateHold(hold = {}) {
  const reason = String(hold.reason ?? "").trim();
  const slug = String(hold.slug ?? "").trim();
  const label = String(hold.label ?? "").trim() || "act on this";
  const marker =
    slug.length > 0
      ? `<!-- [lisa-human-gate] reason=${slug} -->`
      : "<!-- [lisa-human-gate] -->";
  return [`Held for a person to ${label}: ${reason}.`, marker].join("\n");
}

/**
 * Read `humanGate.humanOnly` from local then global config.
 * @param {string} file - Config path
 * @returns {{ value: unknown, error: string | undefined }} Parse result
 */
function readConfig(file) {
  let raw;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return { value: undefined, error: undefined };
  }
  try {
    return { value: JSON.parse(raw), error: undefined };
  } catch (cause) {
    return { value: undefined, error: `${file} is not valid JSON: ${cause}` };
  }
}

/**
 * The effective human-only classes: local override replaces global when set.
 * @param {unknown} local - Parsed local config
 * @param {unknown} global - Parsed global config
 * @returns {unknown[]} Declared classes
 */
export function resolveHumanOnly(local, global) {
  const pick = config =>
    config && typeof config === "object"
      ? config.humanGate?.humanOnly
      : undefined;
  const value = pick(local) ?? pick(global);
  return Array.isArray(value) ? value : [];
}

/**
 * Parse `--key value` / `--key=value` flags.
 * @param {string[]} argv - Raw arguments
 * @returns {Record<string, string>} Flags
 */
function parseFlags(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const eq = token.indexOf("=");
    if (eq !== -1) {
      out[token.slice(2, eq)] = token.slice(eq + 1);
      continue;
    }
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      out[token.slice(2)] = next;
      index += 1;
    } else {
      out[token.slice(2)] = "true";
    }
  }
  return out;
}

/**
 * CLI entry point.
 * @param {string[]} argv - Arguments after the script name
 * @param {{ write?: (text: string) => void, error?: (text: string) => void }} [io] - Output sinks
 * @returns {number} Exit code: 0 legitimate, 1 refused, 2 usage/config error
 */
export function main(argv, io = {}) {
  const write = io.write ?? (text => process.stdout.write(text));
  const error = io.error ?? (text => process.stderr.write(text));
  const [command, ...rest] = argv;
  const flags = parseFlags(rest);
  if (command !== "check" || flags.reason === undefined) {
    error(
      "usage: human-gate-act.mjs check --reason <text> [--config <path>] [--local <path>]\n"
    );
    return 2;
  }
  const local = readConfig(flags.local ?? ".lisa.config.local.json");
  const global = readConfig(flags.config ?? ".lisa.config.json");
  const failed = [local, global].find(parsed => parsed.error);
  if (failed) {
    error(`${failed.error}\n`);
    return 2;
  }
  const verdict = classifyHumanGateReason(flags.reason, {
    humanOnly: resolveHumanOnly(local.value, global.value),
  });
  write(`${JSON.stringify(verdict)}\n`);
  return verdict.valid ? 0 : 1;
}

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

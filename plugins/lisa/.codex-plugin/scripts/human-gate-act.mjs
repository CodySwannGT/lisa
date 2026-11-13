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
 * Which acts count depends on `humanGate.mode` (CodySwannGT/lisa#4687). Under
 * the default `access-only` mode an agent performs every act it has access to,
 * so only an act it genuinely lacks access to is a gate: an interactive login
 * or a credential only a person holds, spending money, opening an external
 * account, a legal signature, an account only a person holds, a system the
 * agent cannot reach, or a hold the operator explicitly asked for. `strict`
 * also holds a compliance judgement, naming an accountable person, and Lisa's
 * own policy calls. `humanGate.humanOnly` widens the gate in either mode.
 *
 * Refusal is the default, deliberately. A closed vocabulary of acts can be
 * audited; an open vocabulary of "topics that feel important" is exactly the
 * reading that produced the false gates.
 *
 * The same classifier runs on both ends:
 * - the writers call the CLI below before stamping a hold, and refuse a
 *   topic-only reason with {@link DECIDE_AND_RECORD};
 * - the intake sweeps call `planHumanGateLift` in `human-gate-lift.mjs`,
 *   which uses it to lift holds filed under the old wording.
 *
 * Usage:
 *   node human-gate-act.mjs check --reason "<human_gate reason>" \
 *     [--config .lisa.config.json] [--local .lisa.config.local.json]
 *   node human-gate-act.mjs policy \
 *     [--config .lisa.config.json] [--local .lisa.config.local.json]
 * `check` prints a JSON verdict carrying the `mode` it was judged under. Exit 0
 * when the gate is legitimate, 1 when refused, 2 on a usage or config error.
 * `policy` prints the resolved `{ mode, humanOnly }` a sweep passes to
 * `planHumanGateLift` as `humanGateMode` and `humanOnly`; it exits 0.
 * `humanGate.mode` is read case- and whitespace-insensitively. A value that is
 * still not a mode is reported on stderr, never fatal, and resolves to the
 * global file's valid mode when only the local one is wrong, else to
 * `access-only`. That fallback is not "safe" for a project that meant
 * `strict` — it is the least-surprising value that can be proven, which is
 * why it is always reported.
 * @module human-gate-act
 */
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  DECIDE_AND_RECORD,
  DEFAULT_HUMAN_GATE_MODE,
  HUMAN_GATE_ACTS,
  HUMAN_GATE_MODES,
  classifyHumanGateReason,
  normalizeGateText,
  normalizeHumanGateMode,
} from "./intake-blocker-reprobe.mjs";

// The classifier lives in `intake-blocker-reprobe.mjs` so the hold verdict
// can use it without a new import edge there: the npm updater authenticates
// that file's import graph as a fixed inventory. This module re-exports it
// and adds the writer-side CLI and config resolution.
export {
  DECIDE_AND_RECORD,
  DEFAULT_HUMAN_GATE_MODE,
  HUMAN_GATE_ACTS,
  HUMAN_GATE_MODES,
  classifyHumanGateReason,
  normalizeGateText,
};

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
 * The effective `humanGate.mode`: a valid local declaration replaces the
 * global one, the same way {@link resolveHumanOnly} does. Values are compared
 * trimmed and lower-cased. An invalid local value falls back to a valid
 * global one before the default, so a typo in a personal override cannot
 * silently hide a committed `strict`. The first rejected value is returned as
 * `rejected` (its JSON spelling) so the caller can report it.
 * @param {unknown} local - Parsed local config
 * @param {unknown} global - Parsed global config
 * @returns {{ mode: string, rejected?: string }} The mode in force
 */
export function resolveHumanGateMode(local, global) {
  const pick = config =>
    config && typeof config === "object" ? config.humanGate?.mode : undefined;
  let rejected;
  for (const declared of [pick(local), pick(global)]) {
    if (declared === undefined) continue;
    const mode = normalizeHumanGateMode(declared);
    if (HUMAN_GATE_MODES.includes(mode)) {
      return rejected === undefined ? { mode } : { mode, rejected };
    }
    rejected ??= JSON.stringify(declared);
  }
  return rejected === undefined
    ? { mode: DEFAULT_HUMAN_GATE_MODE }
    : { mode: DEFAULT_HUMAN_GATE_MODE, rejected };
}

/**
 * The whole human-gate policy a reader passes on: the mode and the declared
 * human-only classes, each resolved local-then-global.
 * @param {unknown} local - Parsed local config
 * @param {unknown} global - Parsed global config
 * @returns {{ mode: string, humanOnly: unknown[], rejected?: string }} Policy
 */
export function resolveHumanGatePolicy(local, global) {
  const { mode, rejected } = resolveHumanGateMode(local, global);
  return {
    mode,
    humanOnly: resolveHumanOnly(local, global),
    ...(rejected === undefined ? {} : { rejected }),
  };
}

/**
 * The stderr line for an invalid `humanGate.mode`.
 * @param {string} rejected - JSON spelling of the declared value
 * @returns {string} One warning line
 */
function invalidModeWarning(rejected) {
  const accepted = HUMAN_GATE_MODES.map(value => `"${value}"`).join(" | ");
  return `Invalid humanGate.mode: ${rejected} is not one of ${accepted}; ignored.\n`;
}

/**
 * Parse `--key value` / `--key=value` flags.
 * @param {string[]} argv - Raw arguments
 * @returns {Record<string, string | null>} Flags; null marks a missing operand
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
      // A flag with no operand is recorded as missing, never as the string
      // "true": a reason of "true" would read as a refused gate, and a config
      // path of "true" would silently drop the project's humanOnly classes.
      out[token.slice(2)] = null;
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
  const missing = ["reason", "config", "local"].filter(
    key => key in flags && (flags[key] === null || flags[key].trim() === "")
  );
  const usable =
    command === "policy" || (command === "check" && Boolean(flags.reason));
  if (!usable || missing.length > 0) {
    error(
      "usage: human-gate-act.mjs check --reason <text> [--config <path>] [--local <path>]\n" +
        "       human-gate-act.mjs policy [--config <path>] [--local <path>]\n"
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
  const { rejected, ...policy } = resolveHumanGatePolicy(
    local.value,
    global.value
  );
  if (rejected !== undefined) {
    error(invalidModeWarning(rejected));
    error(`humanGate.mode in force: "${policy.mode}".\n`);
  }
  if (command === "policy") {
    write(`${JSON.stringify(policy)}\n`);
    return 0;
  }
  const verdict = classifyHumanGateReason(flags.reason, policy);
  write(`${JSON.stringify({ ...verdict, mode: policy.mode })}\n`);
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

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
 * - the intake sweeps call `planHumanGateLift` in `human-gate-lift.mjs`,
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

import {
  DECIDE_AND_RECORD,
  HUMAN_GATE_ACTS,
  classifyHumanGateReason,
  normalizeGateText,
} from "./intake-blocker-reprobe.mjs";

// The classifier lives in `intake-blocker-reprobe.mjs` so the hold verdict
// can use it without a new import edge there: the npm updater authenticates
// that file's import graph as a fixed inventory. This module re-exports it
// and adds the writer-side CLI and config resolution.
export {
  DECIDE_AND_RECORD,
  HUMAN_GATE_ACTS,
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

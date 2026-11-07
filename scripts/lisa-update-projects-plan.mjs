#!/usr/bin/env node
/**
 * lisa-update-projects-plan — the canary-first rollout plan for the
 * `lisa-update-projects` fleet-update skill (CodySwannGT/lisa#4604).
 *
 * ## Why this exists
 *
 * The skill used to upgrade every host in `.lisa.workspaces.json` in parallel,
 * so a bad Lisa release reached every host at once. It now upgrades ONE
 * designated canary first and touches the rest only once the canary's update
 * PR passes its required checks. The decisions that make that safe — exactly
 * one canary, every host keeping its configured branch, and "anything but a
 * pass halts" — live here as code with tests, rather than as prose an agent
 * re-derives on each run.
 *
 * ## Workspace file forms
 *
 * `.lisa.workspaces.json` maps a host path to its update PR's target branch.
 * Two value forms are accepted, and may be mixed in one file:
 *
 *   "<path>": "<branch>"                                   legacy form
 *   "<path>": { "branch": "<branch>", "canary": true }     object form
 *
 * `canary` is optional in the object form and must be a boolean. Exactly one
 * entry must set it to true; a file of legacy strings alone designates no
 * canary and is refused, because the owner decision behind #4604 requires one.
 *
 * ## Usage
 *
 *   node scripts/lisa-update-projects-plan.mjs [--workspaces <path>]
 *       prints {"canary":{path,branch},"rest":[{path,branch},...]}; exit 0,
 *       or exit 1 with the reason on stderr.
 *   node scripts/lisa-update-projects-plan.mjs decide --canary-result <pass|fail|timeout>
 *       prints "proceed" for pass and "halt" otherwise; exit 2 on bad usage.
 *
 * The host path is echoed only to this local process's output. The workspace
 * file is machine-local and gitignored; nothing here writes it anywhere else.
 *
 * @module scripts/lisa-update-projects-plan
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { invokedAsScript } from "./lib/invoked-as-script.mjs";

/** The default workspace file, resolved against the current directory. */
const DEFAULT_WORKSPACES = ".lisa.workspaces.json";

/** The flag naming a non-default workspace file. */
const WORKSPACES_FLAG = "--workspaces";

/** Keys the object value form may carry; anything else is a likely typo. */
const OBJECT_KEYS = new Set(["branch", "canary"]);

/**
 * How to designate the canary, appended to every designation refusal so the
 * human at the gate knows exactly what to change.
 */
export const DESIGNATION_HELP =
  'Designate exactly one canary host in .lisa.workspaces.json by giving its entry the object form: "<host path>": { "branch": "<target branch>", "canary": true }. Every other entry keeps its plain branch string (or uses { "branch": "<target branch>" }).';

/** What a canary result maps to. Anything not listed is refused, never defaulted. */
const DECISIONS = Object.freeze({
  pass: "proceed",
  fail: "halt",
  timeout: "halt",
});

const USAGE = [
  "usage: lisa-update-projects-plan.mjs [--workspaces <path>]",
  "       lisa-update-projects-plan.mjs decide --canary-result <pass|fail|timeout>",
].join("\n");

/**
 * Report whether a value is a plain (non-array, non-null) object.
 * @param {unknown} value - the value to test
 * @returns {boolean} true for a plain object
 */
const isPlainObject = value =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Report whether a value is a usable branch name.
 * @param {unknown} value - the candidate branch
 * @returns {boolean} true for a non-blank string
 */
const isBranch = value => typeof value === "string" && value.trim() !== "";

/**
 * Validate the object value form for one entry.
 * @param {string} key - the host path, for the refusal message
 * @param {Record<string, unknown>} value - the entry's object value
 * @returns {{ok: true, entry: {path: string, branch: string, canary: boolean}} | {ok: false, message: string}} the entry or a refusal
 */
function parseObjectEntry(key, value) {
  const unknown = Object.keys(value).filter(k => !OBJECT_KEYS.has(k));
  if (unknown.length > 0) {
    return {
      ok: false,
      message: `entry ${JSON.stringify(key)} has unknown key(s) ${unknown.join(", ")}; allowed keys are "branch" and "canary".`,
    };
  }
  if (!isBranch(value.branch)) {
    return {
      ok: false,
      message: `entry ${JSON.stringify(key)} needs a non-empty string "branch".`,
    };
  }
  if (value.canary !== undefined && typeof value.canary !== "boolean") {
    return {
      ok: false,
      message: `entry ${JSON.stringify(key)} has a non-boolean "canary"; use true or false.`,
    };
  }
  return {
    ok: true,
    entry: { path: key, branch: value.branch, canary: value.canary === true },
  };
}

/**
 * Validate one workspace entry in either value form.
 * @param {string} key - the host path
 * @param {unknown} value - the entry's value
 * @returns {{ok: true, entry: {path: string, branch: string, canary: boolean}} | {ok: false, message: string}} the entry or a refusal
 */
function parseEntry(key, value) {
  if (typeof value === "string") {
    return isBranch(value)
      ? { ok: true, entry: { path: key, branch: value, canary: false } }
      : {
          ok: false,
          message: `entry ${JSON.stringify(key)} has an empty branch.`,
        };
  }
  if (isPlainObject(value)) return parseObjectEntry(key, value);
  return {
    ok: false,
    message: `entry ${JSON.stringify(key)} must be a branch string or { "branch": "<target branch>", "canary": true }.`,
  };
}

/**
 * Parse and validate the workspace file's text.
 * @param {string} text - the raw JSON text
 * @returns {{ok: true, entries: Array<{path: string, branch: string, canary: boolean}>} | {ok: false, message: string}} the entries in file order, or the first refusal
 */
export function parseWorkspaces(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      message: `workspace file is not valid JSON: ${error.message}`,
    };
  }
  if (!isPlainObject(data)) {
    return {
      ok: false,
      message:
        "workspace file must be a JSON object mapping host path to target branch.",
    };
  }
  const results = Object.entries(data).map(([key, value]) =>
    parseEntry(key, value)
  );
  const refusal = results.find(result => !result.ok);
  return refusal ?? { ok: true, entries: results.map(result => result.entry) };
}

/**
 * Split validated entries into the canary phase and the rest.
 * @param {ReadonlyArray<{path: string, branch: string, canary: boolean}>} entries - validated entries in file order
 * @returns {{ok: true, plan: {canary: {path: string, branch: string}, rest: Array<{path: string, branch: string}>}} | {ok: false, message: string}} the plan, or a designation refusal
 */
export function buildPlan(entries) {
  if (entries.length === 0) {
    return {
      ok: false,
      message: `workspace file lists no hosts. ${DESIGNATION_HELP}`,
    };
  }
  const canaries = entries.filter(entry => entry.canary);
  if (canaries.length === 0) {
    return {
      ok: false,
      message: `workspace file designates no canary; the rollout needs one before any host is touched. ${DESIGNATION_HELP}`,
    };
  }
  if (canaries.length > 1) {
    const names = canaries.map(entry => JSON.stringify(entry.path)).join(", ");
    return {
      ok: false,
      message: `workspace file designates ${canaries.length} canaries (${names}); exactly one is allowed. ${DESIGNATION_HELP}`,
    };
  }
  const toPhase = ({ path: hostPath, branch }) => ({ path: hostPath, branch });
  return {
    ok: true,
    plan: {
      canary: toPhase(canaries[0]),
      rest: entries.filter(entry => !entry.canary).map(toPhase),
    },
  };
}

/**
 * Parse, validate and plan in one step.
 * @param {string} text - the raw workspace file text
 * @returns {ReturnType<typeof buildPlan>} the plan, or the first refusal
 */
export function planFromText(text) {
  const parsed = parseWorkspaces(text);
  return parsed.ok ? buildPlan(parsed.entries) : parsed;
}

/**
 * Decide what follows a canary result. Only an explicit pass proceeds; an
 * unrecognised result is refused rather than read as either answer.
 * @param {unknown} result - the canary's required-check result
 * @returns {{ok: true, decision: "proceed" | "halt"} | {ok: false, message: string}} the decision or a refusal
 */
export function decide(result) {
  return typeof result === "string" && Object.hasOwn(DECISIONS, result)
    ? { ok: true, decision: DECISIONS[result] }
    : {
        ok: false,
        message: `unrecognised canary result ${JSON.stringify(result)}; expected pass, fail or timeout.`,
      };
}

/**
 * Run the `decide` subcommand.
 * @param {string[]} args - arguments after `decide`
 * @returns {number} the exit code
 */
function runDecide(args) {
  const flagAt = args.indexOf("--canary-result");
  const verdict = decide(flagAt === -1 ? undefined : args[flagAt + 1]);
  if (!verdict.ok) {
    console.error(`lisa-update-projects-plan: ${verdict.message}\n${USAGE}`);
    return 2;
  }
  console.log(verdict.decision);
  return 0;
}

/**
 * Run the default plan command.
 * @param {string[]} args - CLI arguments
 * @returns {number} the exit code
 */
function runPlan(args) {
  const unknown = args.find(
    (arg, i) => arg !== WORKSPACES_FLAG && args[i - 1] !== WORKSPACES_FLAG
  );
  const flagAt = args.indexOf(WORKSPACES_FLAG);
  const file = flagAt === -1 ? DEFAULT_WORKSPACES : args[flagAt + 1];
  if (unknown !== undefined || file === undefined) {
    console.error(
      `lisa-update-projects-plan: unexpected argument ${unknown ?? WORKSPACES_FLAG}\n${USAGE}`
    );
    return 2;
  }
  let text;
  try {
    text = readFileSync(path.resolve(file), "utf8");
  } catch (error) {
    console.error(
      `lisa-update-projects-plan: cannot read ${file}: ${error.code ?? error.message}`
    );
    return 1;
  }
  const result = planFromText(text);
  if (!result.ok) {
    console.error(`lisa-update-projects-plan: ${file}: ${result.message}`);
    return 1;
  }
  console.log(JSON.stringify(result.plan, null, 2));
  return 0;
}

/**
 * CLI entry point.
 * @returns {void}
 */
export function main() {
  const args = process.argv.slice(2);
  process.exitCode =
    args[0] === "decide" ? runDecide(args.slice(1)) : runPlan(args);
}

if (invokedAsScript(import.meta.url)) {
  main();
}

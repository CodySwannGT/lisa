#!/usr/bin/env node
/**
 * Lifecycle-role resolution — the single resolver for every vendor.
 *
 * ## The defect this replaces
 *
 * Twelve skills inlined their own `read_role()` bash helper. Hashing the
 * function bodies produced ELEVEN distinct implementations — only
 * `lisa-linear-build-intake` and `lisa-linear-evidence` agreed. Copy-paste with
 * no shared source is why the three vendors drifted apart on the same contract.
 *
 * The drift was not cosmetic. `lisa-linear-evidence` resolved
 * `read_role review "In Review"` — a NON-EMPTY default — while
 * `lisa-jira-evidence/scripts/post-evidence.sh` resolved the same role with
 * `REVIEW=""` and an explicit skip branch. Same role, opposite behaviour, on the
 * question of whether an unconfigured review step exists at all.
 *
 * ## R1 — absent means SKIP, never default
 *
 * `ready`, `claimed`, `blocked` and `done` are REQUIRED: a project that omits
 * them is misconfigured and the caller should say so. `review` and the `qa.*`
 * roles are OPTIONAL and have NO built-in default, so omitting one means the
 * lifecycle skips that transition entirely.
 *
 * This is the difference between "not customized" and "we don't do this step",
 * which a defaulting resolver cannot express. Measured downstream: a project
 * deliberately bound no `review` role — a PR-open ticket was meant to stay in
 * `claimed` until it reached an environment — and agents moved issues into a
 * human-only review state anyway, because every layer that could have honoured
 * the omission supplied a default instead.
 *
 * ## R2 — a fallback may inform a READ, never supply a WRITE target
 *
 * Linear states carry a machine-readable `type`, so a skill may fall back to
 * resolving a role by type when the configured name is missing — the
 * `config-resolution` rule permits this "but only to *read* … it must never
 * invent a state to write into."
 *
 * Nothing enforced that sentence. The fallback selects the lowest-position
 * `started` state, and on the board where this was measured the states ranked
 * `blocked` (-1989.26), `claimed` (-1478.50), then two unbound human-only review
 * states at -1209.69 and -1079.70. With `blocked` and `claimed` already taken,
 * the fallback returned the first unbound one — precisely where two issues
 * landed. Not fuzzy matching; position ordering, used for a write.
 *
 * `--intent=write` therefore refuses to return a fallback value and reports a
 * setup defect instead. `--intent=read` may use one, and always reports which.
 *
 * ## Why a script rather than a shared bash snippet
 *
 * A snippet is copy-paste, which is the disease. Skills shell out to
 * `${CLAUDE_PLUGIN_ROOT}/scripts/…` for exactly this reason elsewhere
 * (`lifecycle-label-trust.mjs`, `automation-run-record.mjs`), and a real process
 * boundary means the resolution can be unit-tested rather than re-read.
 * @module scripts/resolve-lifecycle-role
 */

import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Config file consulted first; its keys override the committed file. */
export const LOCAL_CONFIG = ".lisa.config.local.json";

/** The committed config file. */
export const GLOBAL_CONFIG = ".lisa.config.json";

/**
 * Roles a project MUST bind. Omitting one is a setup defect, not a policy
 * choice — there is no coherent lifecycle without a ready lane, a claimed lane,
 * a blocked lane and a terminal.
 */
export const REQUIRED_ROLES = Object.freeze([
  "ready",
  "claimed",
  "blocked",
  "done",
]);

/**
 * Roles a project MAY bind. Omitting one means the lifecycle skips that
 * transition. These have NO built-in default — that is the whole point of R1.
 */
export const OPTIONAL_ROLES = Object.freeze([
  "review",
  "qa.queue",
  "qa.certified",
  "human_needed",
]);

/** Where each vendor keeps its build lifecycle role map. */
export const VENDOR_ROOTS = Object.freeze({
  jira: "jira.workflow",
  linear: "linear.workflow",
  github: "github.labels.build",
});

/** GitHub's PRD lifecycle is a separate required role map from build work. */
const GITHUB_PRD_PREFIX = "prd.";

/** Resolution outcomes, reported so a caller never has to guess what happened. */
export const OUTCOMES = Object.freeze({
  CONFIGURED: "configured",
  UNSET_OPTIONAL: "unset-optional",
  UNSET_REQUIRED: "unset-required",
  FALLBACK_REFUSED: "fallback-refused-for-write",
});

/**
 * Read a dotted path out of a parsed config object.
 *
 * @param {unknown} source parsed config
 * @param {string} path dotted key path, e.g. `linear.workflow.review`
 * @returns {unknown} the value, or undefined when any segment is missing
 */
export const readPath = (source, path) => {
  let cursor = source;
  for (const segment of path.split(".")) {
    if (cursor === null || typeof cursor !== "object" || !(segment in cursor))
      return undefined;
    cursor = cursor[segment];
  }
  return cursor;
};

/**
 * Parse a config file, treating an unreadable or malformed file as absent.
 *
 * A malformed local override must not silently mask the committed file, so the
 * caller is told which files actually parsed via the returned `sources`.
 *
 * @param {string} file path to read
 * @returns {{ value: object | undefined, error: string | undefined }} parse result
 */
export const parseConfig = file => {
  let raw;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return { value: undefined, error: undefined };
  }
  try {
    return { value: JSON.parse(raw), error: undefined };
  } catch (cause) {
    return {
      value: undefined,
      error: `${file} is not valid JSON: ${cause.message}`,
    };
  }
};

/**
 * Resolve one lifecycle role for one vendor.
 *
 * Resolution order is local config → global config → (nothing). There is no
 * built-in default tier: see R1 in the module docblock.
 *
 * @param {object} options resolution inputs
 * @param {string} options.role role name (`ready`, `review`, `qa.queue`, …)
 * @param {string} options.vendor one of `jira` | `linear` | `github`
 * @param {"read" | "write"} [options.intent] what the caller will do with it
 * @param {string} [options.env] env key when resolving the env-keyed `done` map
 * @param {object} [options.local] pre-parsed local config (tests)
 * @param {object} [options.global] pre-parsed global config (tests)
 * @param {string} [options.fallback] a value a vendor fallback would supply
 * @returns {{ value: string, outcome: string, source: string, message: string }} resolution
 */
export const resolveRole = ({
  role,
  vendor,
  intent = "read",
  env,
  local,
  global: globalConfig,
  fallback,
}) => {
  let root = VENDOR_ROOTS[vendor];
  let configuredRole = role;
  if (vendor === "github" && role.startsWith(GITHUB_PRD_PREFIX)) {
    root = "github.labels.prd";
    configuredRole = role.slice(GITHUB_PRD_PREFIX.length);
  }
  if (!root) {
    return {
      value: "",
      outcome: OUTCOMES.UNSET_REQUIRED,
      source: "none",
      message: `Unknown vendor '${vendor}'. Expected one of: ${Object.keys(VENDOR_ROOTS).join(", ")}.`,
    };
  }

  // `done` is env-keyed on every vendor; an env selects one rung of the map.
  const path =
    env && configuredRole === "done"
      ? `${root}.done.${env}`
      : `${root}.${configuredRole}`;

  for (const [label, source] of [
    ["local", local],
    ["global", globalConfig],
  ]) {
    const found = readPath(source, path);
    if (typeof found === "string" && found.length > 0) {
      return {
        value: found,
        outcome: OUTCOMES.CONFIGURED,
        source: label,
        message: `${path} = ${found} (from ${label} config)`,
      };
    }
  }

  const optional =
    !role.startsWith(GITHUB_PRD_PREFIX) &&
    OPTIONAL_ROLES.includes(configuredRole);

  // R2 — a fallback may inform a read, never supply a write target.
  if (fallback && intent === "write") {
    return {
      value: "",
      outcome: OUTCOMES.FALLBACK_REFUSED,
      source: "none",
      message:
        `Refusing to write to '${fallback}': it was derived by fallback, not named at ${path}. ` +
        `A fallback may inform a read but must never supply a write target (config-resolution). ` +
        `Bind ${path} explicitly, or run /lisa:setup:${vendor}.`,
    };
  }
  if (fallback) {
    return {
      value: fallback,
      outcome: OUTCOMES.CONFIGURED,
      source: "fallback",
      message: `${path} is unset; using fallback '${fallback}' for a READ only.`,
    };
  }

  if (optional) {
    return {
      value: "",
      outcome: OUTCOMES.UNSET_OPTIONAL,
      source: "none",
      message:
        `No ${path} configured; skipping the ${role} transition. ` +
        `This is a supported configuration, not an error — the item stays in its current role.`,
    };
  }

  return {
    value: "",
    outcome: OUTCOMES.UNSET_REQUIRED,
    source: "none",
    message: `Required role '${role}' is not configured at ${path}. Run /lisa:setup:${vendor}.`,
  };
};

/**
 * Parse `--key=value` / `--key value` argv into a plain object.
 *
 * @param {string[]} argv raw arguments
 * @returns {Record<string, string>} parsed flags
 */
export const parseArgs = argv => {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const [key, inline] = token.slice(2).split("=");
    if (inline !== undefined) {
      out[key] = inline;
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      out[key] = next;
      index += 1;
    } else {
      out[key] = "true";
    }
  }
  return out;
};

/**
 * CLI entry point.
 *
 * Exit codes are the contract callers branch on:
 * - `0` with a value on stdout — the role is configured (or a read fallback).
 * - `0` with EMPTY stdout — an optional role is unset; skip the transition.
 * - `2` — a required role is unset, or a write was refused a fallback value.
 *
 * The distinction between the two `0` cases is deliberate: an unset optional
 * role is a supported configuration, so it must not look like a failure.
 *
 * @param {string[]} argv arguments after the script name
 * @returns {number} process exit code
 */
export const main = argv => {
  const args = parseArgs(argv);
  if (!args.role || !args.vendor) {
    process.stderr.write(
      "usage: resolve-lifecycle-role.mjs --role <name> --vendor <jira|linear|github> " +
        "[--intent read|write] [--env dev|staging|production] [--fallback <name>]\n"
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

  const result = resolveRole({
    role: args.role,
    vendor: args.vendor,
    intent: args.intent ?? "read",
    env: args.env,
    fallback: args.fallback,
    local: local.value,
    global: globalConfig.value,
  });

  if (args.json === "true") {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } else if (result.value) {
    process.stdout.write(`${result.value}\n`);
  }

  if (result.outcome === OUTCOMES.CONFIGURED) return 0;
  if (result.outcome === OUTCOMES.UNSET_OPTIONAL) {
    process.stderr.write(`${result.message}\n`);
    return 0;
  }
  process.stderr.write(`${result.message}\n`);
  return 2;
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

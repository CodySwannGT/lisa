#!/usr/bin/env node
/**
 * Linear state-write target resolution — the access-bound guard for #3356.
 *
 * ## The defect this closes
 *
 * `lisa-linear-access operation: save-issue` accepted a raw `stateId` and
 * dispatched it. Nothing in the chokepoint knew which lifecycle role the caller
 * believed it was applying, so nothing could refuse: the resolver added in
 * #3288 could be bypassed by any caller that had an ID in hand. A caller repo in
 * the portfolio watched an issue move straight from its `ready` lane into a
 * review-shaped state that its `linear.workflow` map deliberately does not name.
 *
 * The exact historical writer is not established, and this module does not
 * claim one. The defect being closed is structural: the single chokepoint every
 * Linear write must pass through had no role argument, and therefore had no
 * possible refusal.
 *
 * ## Why this RESOLVES rather than VALIDATES
 *
 * The obvious shape — a validator placed in front of the existing `stateId`
 * argument — is the shape that already failed in #3321: the value that is
 * checked and the value that is sent are two different things, so any path that
 * reaches the send without the check is still a bypass, and the guard's
 * existence reads as safety.
 *
 * So this module does not take a target and approve it. It takes a lifecycle
 * ROLE and PRODUCES the only ID that may be written. The access layer sends
 * what this returns. A caller may still pass the ID it read from the board, but
 * only as an ASSERTION compared against the resolved one — it is never the
 * value dispatched. There is consequently no channel through which an
 * unvalidated state write can be expressed.
 *
 * ## What it refuses
 *
 * Everything that is not an exact, configured, unambiguous match: a state write
 * with no declared role, an env-indexed `done` with no environment key, a role
 * the project never bound (required or optional), a fallback value the resolver
 * refused for write intent, a malformed catalog, a configured name absent from
 * the team's catalog, a configured name that matches more than one state, and a
 * caller-asserted ID that differs from the resolved one.
 *
 * Every refusal names the lifecycle role and the configured value, because the
 * operator standing at the gate is the one who has to fix the config.
 * @module scripts/linear-state-write-target
 */

import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  GLOBAL_CONFIG,
  LOCAL_CONFIG,
  OUTCOMES,
  parseArgs,
  parseConfig,
  readPath,
  resolveRole,
} from "./resolve-lifecycle-role.mjs";

/** The config path Linear's build lifecycle roles are bound at. */
export const LINEAR_WORKFLOW_ROOT = "linear.workflow";

/**
 * Every way a state write can be refused.
 *
 * Named rather than collapsed into one `refused`, so a caller can tell a setup
 * defect (fix the config) from a caller defect (fix the skill) without parsing
 * prose, and so a test can pin the specific path it drove.
 */
export const REFUSALS = Object.freeze({
  MISSING_ROLE: "missing-lifecycle-role",
  MISSING_ENV: "missing-environment-key",
  UNEXPECTED_ENV: "unexpected-environment-key",
  ROLE_UNCONFIGURED: "role-unconfigured",
  CATALOG_MALFORMED: "catalog-malformed",
  STATE_ABSENT: "configured-state-absent",
  STATE_AMBIGUOUS: "configured-state-ambiguous",
  TARGET_MISMATCH: "target-mismatch",
});

/** Prefix every refusal carries, so a caller can grep one string for all of them. */
export const REFUSAL_PREFIX = "Refusing the Linear state write";

/**
 * Build a refusal result.
 *
 * @param {string} refusal one of {@link REFUSALS}
 * @param {string} detail operator-readable explanation
 * @returns {{ok: false, refusal: string, message: string}} refusal
 */
const refuse = (refusal, detail) => ({
  ok: false,
  refusal,
  message: `${REFUSAL_PREFIX} (${refusal}): ${detail}`,
});

/**
 * Normalize a team workflow-state catalog into a flat node list.
 *
 * Accepts the three shapes the access layer can hand over: the flat array its
 * `list-workflow-states` operation returns, the `{nodes:[…]}` connection the
 * GraphQL adapter reads, and the raw `{team:{states:{nodes:[…]}}}` envelope.
 * Anything else — including a node missing a string `id` or `name` — is
 * malformed, not empty: an empty catalog and an unreadable one must not produce
 * the same answer.
 *
 * @param {unknown} catalog raw catalog
 * @returns {{nodes: Array<{id: string, name: string}>} | {error: string}} normalized nodes
 */
export const normalizeStateCatalog = catalog => {
  const nodes = Array.isArray(catalog)
    ? catalog
    : (readPath(catalog, "nodes") ?? readPath(catalog, "team.states.nodes"));
  if (!Array.isArray(nodes))
    return {
      error:
        "the team workflow-state catalog is not a list of states. " +
        "Pass the result of `lisa-linear-access operation: list-workflow-states`.",
    };
  for (const node of nodes) {
    const id = readPath(node, "id");
    const name = readPath(node, "name");
    if (typeof id !== "string" || id.length === 0)
      return { error: "a state in the catalog has no string `id`." };
    if (typeof name !== "string" || name.length === 0)
      return { error: `state '${id}' in the catalog has no string \`name\`.` };
  }
  return { nodes };
};

/**
 * Decide whether `done` needs an environment key for this project.
 *
 * `done` is env-indexed on every vendor, so a bare `done` write is ambiguous
 * whenever the project bound a map. A project that bound a plain string has one
 * terminal and needs no key — refusing that would be inventing a requirement
 * the config does not have.
 *
 * @param {object|undefined} local parsed local config
 * @param {object|undefined} globalConfig parsed committed config
 * @returns {string[]} configured environment keys, empty when `done` is flat
 */
export const envIndexedDoneKeys = (local, globalConfig) => {
  for (const source of [local, globalConfig]) {
    const done = readPath(source, `${LINEAR_WORKFLOW_ROOT}.done`);
    if (typeof done === "string" && done.length > 0) return [];
    if (done && typeof done === "object") return Object.keys(done);
  }
  return [];
};

/**
 * Resolve the one workflow-state ID a lifecycle role may be written to.
 *
 * @param {object} options inputs
 * @param {string} [options.role] lifecycle role being applied
 * @param {string} [options.env] environment key for an env-indexed `done`
 * @param {unknown} [options.states] team workflow-state catalog
 * @param {object} [options.local] parsed local config
 * @param {object} [options.global] parsed committed config
 * @param {string} [options.assertStateId] ID the caller believes it is writing
 * @returns {{ok: true, role: string, stateId: string, stateName: string} | {ok: false, refusal: string, message: string}} outcome
 */
export const resolveStateWriteTarget = ({
  role,
  env,
  states,
  local,
  global: globalConfig,
  assertStateId,
}) => {
  if (typeof role !== "string" || role.length === 0)
    return refuse(
      REFUSALS.MISSING_ROLE,
      "no lifecycle role was declared. Every `stateId` write must name the role " +
        "it is applying (ready | claimed | blocked | review | done | qa.queue | " +
        "qa.certified) so the configured target can be resolved instead of trusted."
    );

  // The environment key belongs to exactly one shape: an env-indexed `done`.
  // Anywhere else it is a caller defect that would otherwise pass silently —
  // `resolveRole` simply ignores `env` off the `done` path, so a call carrying
  // a stray one succeeds while asserting an environment nobody checked. A
  // guard that accepts an argument it does not honour is teaching the caller
  // something false.
  const envKeys = envIndexedDoneKeys(local, globalConfig);
  if (env && role !== "done")
    return refuse(
      REFUSALS.UNEXPECTED_ENV,
      `lifecycle role '${role}' takes no environment key. Only the env-indexed ` +
        "`done` role is keyed by environment; passing one here asserts a " +
        "deployment this write does not report."
    );
  if (env && envKeys.length === 0)
    return refuse(
      REFUSALS.UNEXPECTED_ENV,
      `${LINEAR_WORKFLOW_ROOT}.done is a single state on this project, not a ` +
        `map of environments, so there is no '${env}' rung to write. Drop the ` +
        "environment key, or bind the env-indexed map if this project really " +
        "does promote through environments."
    );
  if (role === "done" && !env && envKeys.length > 0)
    return refuse(
      REFUSALS.MISSING_ENV,
      `role 'done' is env-indexed at ${LINEAR_WORKFLOW_ROOT}.done ` +
        `(${envKeys.join(", ")}). Name the environment being reported.`
    );

  const resolved = resolveRole({
    role,
    vendor: "linear",
    intent: "write",
    env,
    local,
    global: globalConfig,
  });
  if (resolved.outcome === OUTCOMES.UNSET_OPTIONAL)
    return refuse(
      REFUSALS.ROLE_UNCONFIGURED,
      `optional lifecycle role '${role}' is not bound at ` +
        `${LINEAR_WORKFLOW_ROOT}.${role}, so this project SKIPS that transition. ` +
        "That is a supported configuration, not an error — but it means there is " +
        "no target to write. The caller must skip the write; this layer will not " +
        "invent one, and a state resolved by type or board position is how " +
        "agent-owned work reaches a human-only lane."
    );
  if (resolved.outcome !== OUTCOMES.CONFIGURED)
    return refuse(REFUSALS.ROLE_UNCONFIGURED, resolved.message);

  const normalized = normalizeStateCatalog(states);
  if (normalized.error)
    return refuse(REFUSALS.CATALOG_MALFORMED, normalized.error);

  const matches = normalized.nodes.filter(node => node.name === resolved.value);
  if (matches.length === 0)
    return refuse(
      REFUSALS.STATE_ABSENT,
      `lifecycle role '${role}' is configured as '${resolved.value}', but the ` +
        "team has no workflow state with that exact name. This is a setup " +
        "defect — run /lisa:setup:linear, or correct " +
        `${LINEAR_WORKFLOW_ROOT}.${role}. Never create or guess a state here.`
    );
  if (matches.length > 1)
    return refuse(
      REFUSALS.STATE_AMBIGUOUS,
      `lifecycle role '${role}' is configured as '${resolved.value}', which ` +
        `matches ${matches.length} states on this team ` +
        `(${matches.map(node => node.id).join(", ")}). An ambiguous target is ` +
        "a setup defect; rename one state or bind the role to a unique name."
    );

  const target = matches[0];
  if (typeof assertStateId === "string" && assertStateId.length > 0)
    if (assertStateId !== target.id)
      return refuse(
        REFUSALS.TARGET_MISMATCH,
        `the caller asked to write state '${assertStateId}' while applying ` +
          `lifecycle role '${role}', but ${LINEAR_WORKFLOW_ROOT}.${role} is ` +
          `configured as '${resolved.value}' (id ${target.id}). A state absent ` +
          "from the configured workflow map is never a valid write target — " +
          "that is how agent-owned work reaches a human-only lane."
      );

  return {
    ok: true,
    role,
    stateId: target.id,
    stateName: target.name,
  };
};

/**
 * Read the state catalog named on the command line, or from stdin.
 *
 * @param {string | undefined} file path, `-`, or undefined for stdin
 * @returns {{value: unknown} | {error: string}} parsed catalog
 */
export const readCatalog = file => {
  let raw;
  try {
    raw = readFileSync(!file || file === "-" ? 0 : file, "utf8");
  } catch (cause) {
    return { error: `could not read the state catalog: ${cause.message}` };
  }
  try {
    return { value: JSON.parse(raw) };
  } catch (cause) {
    return { error: `the state catalog is not valid JSON: ${cause.message}` };
  }
};

/**
 * CLI entry point.
 *
 * Exit codes are the contract the access layer branches on:
 * - `0` — the write is permitted; the ONE permissible state ID is on stdout.
 * - `2` — refused; the operator-readable reason is on stderr and NOTHING may
 *   be dispatched.
 *
 * There is deliberately no "allowed with warnings" rung. A state write either
 * targets the configured role or it does not happen.
 *
 * @param {string[]} argv arguments after the script name
 * @returns {number} process exit code
 */
export const main = argv => {
  const args = parseArgs(argv);
  // A `--state-id` with no `--role` is not a usage slip, it is the defect this
  // guard exists for: a state write nobody declared a lifecycle role for.
  // Answer it with the refusal, so the caller reads why rather than how.
  if (!args.role) {
    process.stderr.write(
      args["state-id"]
        ? `${refuse(REFUSALS.MISSING_ROLE, "no lifecycle role was declared, but a state was supplied to write. Every state write must name the role it is applying so the configured target can be resolved instead of trusted.").message}\n`
        : "usage: linear-state-write-target.mjs --role <name> [--env <key>] " +
            "[--states <file|->] [--state-id <asserted-id>] [--json]\n"
    );
    return 2;
  }

  const local = parseConfig(args.local ?? LOCAL_CONFIG);
  const globalConfig = parseConfig(args.config ?? GLOBAL_CONFIG);
  for (const parsed of [local, globalConfig])
    if (parsed.error) {
      process.stderr.write(`${parsed.error}\n`);
      return 2;
    }

  const catalog = readCatalog(args.states);
  const result = catalog.error
    ? refuse(REFUSALS.CATALOG_MALFORMED, catalog.error)
    : resolveStateWriteTarget({
        role: args.role,
        env: args.env,
        states: catalog.value,
        local: local.value,
        global: globalConfig.value,
        assertStateId: args["state-id"],
      });

  if (args.json === "true") process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.ok) {
    if (args.json !== "true") process.stdout.write(`${result.stateId}\n`);
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

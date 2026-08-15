/**
 * Prove, before an agent starts work, that the credentials it needs resolve.
 *
 * The contract has always claimed this. `secrets.require` is documented as an
 * assertion — "a listed name that does not resolve is a startup error, not a
 * late surprise" — and that sentence is the literal text of an error message in
 * `doctor-secrets.mjs`. But nothing ran it at startup. The only caller of
 * either presence check was a bash line inside `lisa-doctor`'s SKILL.md, which
 * an agent had to read and choose to execute. The guarantee was prose; the
 * plumbing to deliver it did not exist.
 *
 * This module is the missing caller, and it answers the question the gate
 * actually asks. `AGENTS.md` requires intake to establish that the factory has
 * the tooling "*and provable access to that tooling*" before accepting work. A
 * credential that resolves nowhere is precisely a failure of provable access,
 * and discovering it forty minutes into a build — after a ticket is claimed and
 * a branch is cut — converts a clean refusal into abandoned half-work.
 *
 * **Three verdicts, and the third is the point.** `ok` and `missing` are
 * obvious. `unreachable` is what happens when the provider itself cannot be
 * asked: no CLI installed, no bootstrap token, an API that errored. That state
 * must never collapse into either neighbour. Folded into `ok` it is a vacuous
 * green — the check reports clean precisely when it learned nothing, which is
 * the failure mode that lets a suppressed error read as a measured zero. Folded
 * into `missing` it blames the vault for a fault in the caller's access, and
 * sends whoever reads it to grant a credential that was never absent.
 *
 * Both non-ok verdicts fail. They are distinguished in the *message*, not the
 * exit code, because the remediation differs completely: `missing` means extend
 * the grant in the vault, `unreachable` means fix this machine's access to it.
 * @module preflight-secrets
 */

import { execFileSync } from "node:child_process";

import { fetchAll } from "./providers.mjs";
import { readConfig } from "./surfaces.mjs";
import { readMaterialized } from "./resolve-secret.mjs";
import {
  routingFloorReasons,
  SUBSTITUTE_SUBSTRATES,
} from "./routing-floor.mjs";

/** Verdicts this check can reach, worst last. */
export const VERDICTS = ["ok", "missing", "unreachable"];

/**
 * The names that must resolve on this surface, and why each is required.
 *
 * The floor is *unioned* with `require` rather than checked against it. A
 * project should not have to restate `GH_TOKEN` to be protected by a rule its
 * own `tracker: "github"` already implies, and a required set that depends on
 * someone having typed it is exactly the hand-maintained list this replaces.
 *
 * `require` keeps its second job untouched. It still narrows resolution — a
 * name outside it cannot be fetched — and the floor deliberately does not feed
 * that. Unioning the floor into `cfg.require` would switch narrowing *on* for
 * every project that never opted into it, and every credential they resolve
 * today that is not in the floor would start throwing.
 * @param {object} cfg Resolved configuration.
 * @returns {Array<{name: string, reasons: string[]}>} Required names, sorted.
 */
export function requiredNames(cfg) {
  const reasons = routingFloorReasons(cfg.routing ?? {});
  const declared = cfg.require ?? [];
  const names = [...new Set([...(cfg.requiredFloor ?? []), ...declared])];
  return names
    .sort((left, right) => left.localeCompare(right))
    .map(name => ({
      name,
      reasons: [
        ...(reasons[name] ?? []),
        ...(declared.includes(name) ? ["declared in secrets.require"] : []),
      ],
    }));
}

/**
 * Check every required credential against the resolution ladder.
 *
 * Values are never returned, printed, or written anywhere by this function. It
 * reports names and whether each resolved, which is all a readiness check needs
 * and the only shape safe to surface into an agent's context.
 * @param {object} [cfg] Resolved configuration.
 * @param {Function} [fetch] Provider view factory, injected for tests.
 * @param {Function} [materialized] Materialized view factory, for tests.
 * @param {Record<string, string|undefined>} [env] Environment to inspect.
 * @param {Function} [probe] Substrate probe runner, injected for tests.
 * @returns {{verdict: string, required: Array<{name: string, reasons: string[]}>, missing: Array<{name: string, reasons: string[]}>, reason: string|null}}
 */
export function preflight(
  cfg = readConfig(),
  fetch = fetchAll,
  materialized = readMaterialized,
  env = process.env,
  probe = runProbe
) {
  const required = requiredNames(cfg);
  if (!required.length) {
    return { verdict: "ok", required, missing: [], reason: null };
  }

  const file = safely(() => materialized(cfg)) ?? new Map();

  // Env and the materialized file are consulted before the provider, and a
  // required name satisfied by either needs no provider call at all. A session
  // whose credentials are already exported is the common case on CI, and paying
  // a network round-trip to confirm what is already in the environment would
  // make the cheapest surface the slowest.
  const unresolvedLocally = required.filter(
    ({ name }) =>
      !present(env[name]) && !file.get(name) && !substrateSatisfies(name, probe)
  );
  if (!unresolvedLocally.length) {
    return { verdict: "ok", required, missing: [], reason: null };
  }

  let provider;
  try {
    provider = fetch(cfg);
  } catch (err) {
    return {
      verdict: "unreachable",
      required,
      missing: unresolvedLocally,
      reason: err.message,
    };
  }

  const missing = unresolvedLocally.filter(
    ({ name }) => !present(provider.get(name)?.value)
  );
  return {
    verdict: missing.length ? "missing" : "ok",
    required,
    missing,
    reason: null,
  };
}

/**
 * Render a verdict for whoever has to act on it.
 *
 * Written for a non-technical operator standing at the gate, per `AGENTS.md`:
 * everything crossing a gate outward must be readable by the person being asked
 * to decide. So each line names the credential, why it is required, and which
 * of the two remedies applies.
 * @param {object} result A {@link preflight} result.
 * @param {object} cfg Resolved configuration.
 * @returns {string} Operator-readable report, empty when nothing needs saying.
 */
export function report(result, cfg) {
  if (result.verdict === "ok") return "";

  const lines = [];
  if (result.verdict === "unreachable") {
    lines.push(
      `Secrets preflight could NOT be completed on surface "${cfg.surface}".`,
      `The "${cfg.provider}" provider could not be reached, so nothing is`,
      `known about any credential — this is not a report that they are fine.`,
      ``,
      `  reason: ${result.reason}`,
      ``,
      `Fix this machine's access to the provider (bootstrap token, CLI`,
      `install, network), then start a new session. Do not treat the`,
      `credentials below as verified:`
    );
  } else {
    lines.push(
      `Secrets preflight FAILED on surface "${cfg.surface}".`,
      `These credentials are required and resolve nowhere — not in the`,
      `environment, not materialized, not in the "${cfg.provider}" grant.`,
      `Extend the grant in the vault (or correct the routing that requires`,
      `them), then start a new session:`
    );
  }
  lines.push(``);
  for (const { name, reasons } of result.missing) {
    lines.push(`  ${name} — required because ${reasons.join("; ")}`);
  }
  lines.push(
    ``,
    `Work needing one of these cannot be completed. Route the item to`,
    `blocked with this reason rather than claiming it and stopping partway.`
  );
  return lines.join("\n");
}

/**
 * Whether an alternative substrate already provides this capability.
 * @param {string} name Required credential name.
 * @param {Function} probe Probe runner, injected for tests.
 * @returns {boolean} True when the substrate answered successfully.
 */
function substrateSatisfies(name, probe) {
  const substrate = SUBSTITUTE_SUBSTRATES[name];
  return substrate ? probe(substrate) : false;
}

/**
 * Run a substrate probe, treating any failure as "did not satisfy".
 *
 * Output is discarded rather than captured. The probe's job is to answer a
 * yes/no question with its exit status, and a command that can print a
 * credential is one whose stdout should never enter this process.
 * @param {{command: string, args: string[]}} substrate Probe definition.
 * @returns {boolean} True when the command exited zero.
 */
function runProbe(substrate) {
  try {
    execFileSync(substrate.command, substrate.args, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether a resolved value counts as present.
 * @param {unknown} value Candidate value.
 * @returns {boolean} True when it is a non-blank string.
 */
function present(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Run a thunk, treating any throw as "no view available".
 *
 * The materialized file is optional on every surface and absent on most, so a
 * failure to read it is not a preflight failure — the provider is still
 * authoritative. Only the provider's own unavailability is a verdict.
 * @param {Function} thunk Work to attempt.
 * @returns {*} The result, or undefined when it threw.
 */
function safely(thunk) {
  try {
    return thunk();
  } catch {
    return undefined;
  }
}

/**
 * CLI entry point. Prints the report and exits non-zero on any failure.
 */
function main() {
  const cfg = readConfig();
  const result = preflight(cfg);
  const text = report(result, cfg);
  if (text) console.error(text);
  if (result.verdict !== "ok") process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

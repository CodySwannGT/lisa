#!/usr/bin/env node
// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * lisa-destructive-guard — the executable arm of `production-fails-closed`.
 *
 * The `reset-seed-coverage` contract already says the right thing: production
 * is refused "with no override, escape hatch, or environment variable that
 * changes the answer", `--dry-run` is mandatory before anything destructive,
 * and a caller-supplied `--stage` is a *request* to be checked against
 * server-resolved identity rather than the source of truth. Until this module
 * existed, all three were prose — an agent reading a rule and choosing to stop.
 * Measured conformance for that rung in this codebase was approximately zero,
 * including by the agent that authored the rule. For a destructive,
 * irreversible operation that is the wrong rung, so the decision moves here.
 *
 * Three properties make this a control rather than a suggestion:
 *
 * 1. **No override exists to be found.** There is no `force` parameter, no
 *    `allowProduction` field, and no environment-variable read anywhere in this
 *    file — a test greps the shipped source for the latter, so the claim cannot
 *    rot. A caller cannot pass the wrong thing because there is no right thing
 *    to pass. The tests assert the absence structurally, not behaviourally.
 * 2. **Ambiguity resolves to refusal.** An environment identity that cannot be
 *    read is treated exactly like production. "I could not tell" must never be
 *    the cheaper answer than "it is production".
 * 3. **A dry run is not a pass.** `dryRun: true` does not soften a production
 *    denial. Enumerating production state is still reaching into production,
 *    and allowing it would hand every caller a one-flag override.
 *
 * What this module deliberately does NOT claim: it cannot verify that the
 * `environment` an adapter reports is the environment it actually connected to.
 * An adapter that resolves its stage from a caller-supplied string and reports
 * `"dev"` while pointed at production defeats every in-process check by
 * construction. That hole is why the contract says platform enforcement beats
 * process enforcement, and why the durable answer is a capability that is not
 * deployed to production at all — see `docs/decisions/`. This module closes the
 * narrower hole Lisa can close: an honest adapter can no longer report a
 * successful destructive production run, in any repo, by any path.
 * @module scripts/lisa-destructive-guard
 */

/**
 * Capabilities that mutate persistent state by definition.
 *
 * Membership is by capability name because a destructive adapter that fails
 * before it deletes anything still reports zeroes, and a guard that keyed only
 * on the counts would wave it through on the attempt that mattered.
 */
export const DESTRUCTIVE_CAPABILITIES = Object.freeze([
  "reset",
  "reseed",
  "reset-seed",
  "seed",
  "teardown",
  "truncate",
  "purge",
  "drop",
  "restore",
  "migrate-down",
]);

/**
 * Substring marking an environment segment as production.
 *
 * Deliberately a substring rather than an exact match, so `preprod`,
 * `prod-blue`, and `acme-prod-1` all classify as production. That
 * over-includes: a genuine pre-production environment is refused too. For a
 * control over irreversible operations, over-refusal is the correct direction
 * to be wrong in, and a project that needs the distinction names its
 * environments so the word does not appear.
 */
const PRODUCTION_SUBSTRING = "prod";

/** Whole segments that mark production without containing the substring. */
const PRODUCTION_SEGMENTS = Object.freeze(["prd", "live"]);

/**
 * Values that carry no environment identity.
 *
 * Each of these is something a resolver returns when it failed, and every one
 * of them classifies as `unresolved`, which the guard then treats exactly as it
 * treats production.
 */
const UNRESOLVED_SENTINELS = new Set([
  "",
  "unknown",
  "unresolved",
  "undefined",
  "null",
  "n/a",
  "na",
  "none",
  "-",
]);

/** Flags that explicitly opt out of the mandatory dry run. */
const EXECUTE_FLAGS = Object.freeze(["--no-dry-run", "--execute"]);

/**
 * Normalize an environment identity for comparison.
 * @param {unknown} value - Candidate environment identity
 * @returns {string} Lowercased, trimmed text, or "" when there is no text
 */
function normalize(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/**
 * Classify a server-resolved environment identity.
 *
 * Returns `unresolved` rather than guessing whenever the value is not text, is
 * blank, or is one of the sentinels a failed resolver produces. Callers must
 * treat `unresolved` as production; this function does not make that decision
 * for them so that the two cases stay separately reportable.
 * @param {unknown} value - The environment identity to classify
 * @returns {"production"|"non-production"|"unresolved"} The classification
 */
export function classifyEnvironment(value) {
  const text = normalize(value);
  if (typeof value !== "string" || UNRESOLVED_SENTINELS.has(text)) {
    return "unresolved";
  }
  const segments = text.split(/[^a-z0-9]+/u).filter(Boolean);
  if (segments.length === 0) {
    return "unresolved";
  }
  const production = segments.some(
    segment =>
      segment.includes(PRODUCTION_SUBSTRING) ||
      PRODUCTION_SEGMENTS.includes(segment)
  );
  return production ? "production" : "non-production";
}

/**
 * Whether a run mutates persistent state.
 *
 * True when the capability is destructive by name, and also when a run of any
 * capability reports rows deleted or created — a read-only adapter that mutated
 * is still a mutation, and the guard should not depend on it being named
 * honestly.
 * @param {object} fields - An envelope or envelope-shaped object
 * @returns {boolean} True when the run is destructive
 */
export function isDestructive(fields) {
  const capability = normalize(fields?.capability);
  if (DESTRUCTIVE_CAPABILITIES.includes(capability)) {
    return true;
  }
  const summary = fields?.summary ?? {};
  return Number(summary.deleted) > 0 || Number(summary.created) > 0;
}

/**
 * Build the denial for a resolved environment, or null when it is permitted.
 * @param {unknown} environment - Server-resolved environment identity
 * @returns {{code: string, message: string}|null} The denial, if any
 */
function denyByEnvironment(environment) {
  const classification = classifyEnvironment(environment);
  if (classification === "unresolved") {
    return {
      code: "unresolved-environment",
      message:
        "the server-resolved environment could not be read, which fails closed exactly as production does — resolve the environment from deployment identity before any destructive operation",
    };
  }
  if (classification === "production") {
    return {
      code: "production-forbidden",
      message: `production is refused by the reset-seed contract with no override, and "${normalize(environment)}" classifies as production — a dry run is not an exemption`,
    };
  }
  return null;
}

/**
 * The denial implied by an envelope, or null when the envelope is permitted.
 *
 * This is the check the command envelope itself applies, so a destructive
 * production run cannot be *reported* as a success by any adapter in any repo.
 * @param {object} fields - An envelope or envelope-shaped object
 * @returns {{code: string, message: string}|null} The denial, if any
 */
export function destructiveDenial(fields) {
  return isDestructive(fields) ? denyByEnvironment(fields?.environment) : null;
}

/**
 * Decide whether a destructive invocation may proceed.
 *
 * Adapter-time counterpart of {@link destructiveDenial}, adding the two checks
 * that need the caller's request alongside the resolved identity. The requested
 * stage is never trusted: it is compared against server-resolved identity, and
 * a production request is refused even when the resolver disagrees, because the
 * disagreement itself means one of the two is wrong.
 * @param {object} request - capability, summary, resolvedEnvironment, requestedStage, dryRun
 * @returns {{allowed: boolean, denial: ({code: string, message: string}|null)}} The decision
 */
export function assertDestructiveAllowed(request) {
  if (!isDestructive(request)) {
    return { allowed: true, denial: null };
  }
  const resolved = request?.resolvedEnvironment;
  const environmentDenial = denyByEnvironment(resolved);
  if (environmentDenial) {
    return { allowed: false, denial: environmentDenial };
  }
  const requested = request?.requestedStage;
  if (requested === undefined || requested === null) {
    return { allowed: true, denial: null };
  }
  if (classifyEnvironment(requested) === "production") {
    return {
      allowed: false,
      denial: {
        code: "production-requested",
        message: `the caller requested "${normalize(requested)}", which classifies as production; a requested stage never authorizes a destructive operation`,
      },
    };
  }
  if (normalize(requested) !== normalize(resolved)) {
    return {
      allowed: false,
      denial: {
        code: "stage-mismatch",
        message: `the caller requested "${normalize(requested)}" but deployment identity resolved to "${normalize(resolved)}"; a stage is a request to be checked, never the source of truth`,
      },
    };
  }
  return { allowed: true, denial: null };
}

/**
 * Read one `--flag value` / `--flag=value` option out of argv.
 * @param {readonly string[]} argv - Arguments after the script name
 * @param {string} flag - The long flag to read, including leading dashes
 * @returns {string|null} The value, or null when the flag is absent or empty
 */
function readOption(argv, flag) {
  const inline = argv.find(entry => entry.startsWith(`${flag}=`));
  if (inline) {
    return inline.slice(flag.length + 1) || null;
  }
  const index = argv.indexOf(flag);
  return index === -1 ? null : (argv[index + 1] ?? null);
}

/**
 * Parse the arguments every destructive adapter accepts.
 *
 * `--dry-run` is the default rather than an opt-in: an adapter that forgets to
 * parse anything, or is handed arguments it does not understand, enumerates
 * instead of mutating. Mutating requires an explicit `--no-dry-run` or
 * `--execute`, and passing `--dry-run` alongside either one keeps the dry run,
 * so a stray flag can never silently upgrade a rehearsal into a real run.
 * @param {readonly string[]} argv - Arguments after the script name
 * @returns {{dryRun: boolean, requestedStage: (string|null), idempotencyKey: (string|null)}} Parsed arguments
 */
export function parseDestructiveArgs(argv) {
  const args = [...(argv ?? [])];
  const optedOut = EXECUTE_FLAGS.some(flag => args.includes(flag));
  return {
    dryRun: args.includes("--dry-run") || !optedOut,
    requestedStage: readOption(args, "--stage"),
    idempotencyKey: readOption(args, "--idempotency-key"),
  };
}

#!/usr/bin/env node
/**
 * The single path for PROPAGATING a secret into a second store.
 *
 * Propagation is copying a value from the provider it lives in into a
 * *different* store that cannot read the provider — today, a GitHub Actions
 * organization or repository secret. It is neither a read (the value leaves the
 * resolution path and lands somewhere else) nor a rotation (the source value is
 * unchanged), so it gets its own program and its own contract, exactly as
 * `rotate-secret.mjs` does.
 *
 * The failure this exists to prevent is a **vacuous green**. A workflow gate
 * that needs a credential and cannot find one warn-skips and reports success
 * while verifying nothing: four repositories in this fleet ran
 * `🔗 Work-Item Traceability` with `tracker: linear` and no `LINEAR_API_KEY`
 * mapped, so the gate passed without checking a single work item. The
 * credential existed in Bitwarden the whole time. Nothing described how to move
 * it, so it was done by whatever pipeline shape someone reached for first —
 * which is where the leaks are.
 *
 * Five properties, none of them optional:
 *
 * 1. **Refuse on an empty or absent value.** Piping empty into `gh secret set`
 *    overwrites a good secret with an empty one and reports success. Absence
 *    must never read as a pass.
 * 2. **The value moves only through a pipe.** Never an argument — process
 *    arguments are visible to anything that can list processes on the host —
 *    never a temp file, never echoed. Only its length may be logged. This
 *    program accepts no value input at all; it reads the provider itself, so
 *    the value never passes through a shell.
 * 3. **Verify by metadata, never by reading back.** GitHub cannot return a
 *    secret value. Confirmation is the destination *name* appearing in the
 *    store's own listing.
 * 4. **Declared, never inferred.** Only a name in `secrets.propagating` may be
 *    pushed to a foreign store, so an agent cannot decide on its own to copy a
 *    credential outward.
 * 5. **One-way.** Nothing is ever read back *from* the destination. The
 *    provider stays the single source of truth; the destination copy is
 *    expected to drift and is re-pushed, never reconciled.
 *
 * Usage:
 *   sync-secret-to-ci.mjs push NAME TARGET [DEST]   # propagate, then verify
 *   sync-secret-to-ci.mjs verify NAME TARGET [DEST] # metadata check, no write
 *   sync-secret-to-ci.mjs list TARGET               # destination names only
 *
 * TARGET is `<org>` or `<owner>/<repo>`. DEST defaults to NAME.
 * @module sync-secret-to-ci
 */

import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";

import { ENV_KEY, fetchNamed } from "./providers.mjs";
import { readConfig } from "./surfaces.mjs";

import { boundedChildOutput } from "../../lisa-setup-workstation/scripts/bounded-child.mjs";

/**
 * How many secrets to ask for per listing page.
 *
 * Pagination is load-bearing rather than tidiness. GitHub returns 30 secrets
 * per page by default, so a verification that read only the first page would
 * report FAILURE for a write that had in fact succeeded, on any organization
 * with more than 30 secrets. That is the same class of bug as a listing parsed
 * at the wrong key: a malformed verification that fails a successful write is
 * worse than none, because it invites someone to write again and again.
 */
const PAGE_SIZE = 100;

/** Ceiling on listing pages, so a paging bug cannot loop forever. */
const MAX_PAGES = 100;

/**
 * Visibility applied to an organization secret when the operator names none.
 *
 * The narrow option on purpose. `all` exposes the credential to every public
 * repository in the organization as well, and a default that widens exposure is
 * a default nobody reviews. Widening is a decision, so it is spelled on the
 * command line.
 */
const DEFAULT_VISIBILITY = "private";

/** Visibilities the GitHub API accepts for an organization secret. */
const VISIBILITIES = new Set(["all", "private", "selected"]);

/**
 * Assert a name is declared propagating, and that this destination is allowed.
 *
 * Declaration is config, never inference from a note: the note lives
 * provider-side, is editable outside review, and a read-only account cannot
 * correct a wrong one. Config is the surface where "this credential may leave
 * its store" is reviewable.
 *
 * Two declaration shapes, and the difference matters. A bare string mirrors
 * `secrets.rotating` and pins the *credential* only — any target may receive
 * it. An object with `targets` additionally pins *where it may go*, which is
 * the stronger statement and the one worth making for anything that is not
 * already fleet-wide.
 * @param {string} name Requested source name.
 * @param {string} target Destination target, `<org>` or `<owner>/<repo>`.
 * @param {object} cfg Resolved configuration.
 */
export function assertPropagating(name, target, cfg) {
  const entries = (cfg.propagating ?? []).map(entry =>
    typeof entry === "string" ? { name: entry } : (entry ?? {})
  );
  const declared = entries.find(entry => entry.name === name);
  if (!declared) {
    throw new Error(
      `${name} is not declared in secrets.propagating.\n` +
        `Only a declared credential may be copied into a foreign store. ` +
        `Propagation moves a value out of the store that owns it, so which ` +
        `credentials may leave is a reviewed decision, not one this program ` +
        `makes for you.`
    );
  }
  const targets = declared.targets;
  if (Array.isArray(targets) && !targets.includes(target)) {
    throw new Error(
      `${name} is declared propagating, but not to "${target}".\n` +
        `Declared targets: ${targets.join(", ") || "(none)"}.`
    );
  }
}

/**
 * Refuse a value that would overwrite a live secret with nothing.
 *
 * This is the property most worth having and the easiest to omit, because the
 * unsafe path *succeeds*: piping an empty string into `gh secret set` stores an
 * empty secret and exits 0, so the destination reports a healthy, present,
 * useless credential. Every consumer downstream then behaves exactly as it does
 * when the secret was never set — which, for a warn-skipping gate, is a green
 * check that verified nothing.
 *
 * Absence is checked with `trim()` because whitespace is the shape absence
 * actually arrives in: a provider row set to `""`, a heredoc that contributed
 * only a newline, a variable that expanded to nothing.
 * @param {string} name The name being propagated, for the message.
 * @param {unknown} value Candidate value.
 * @returns {string} The value, unchanged, when it is safe to send.
 */
export function assertValue(name, value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(
      `${name} resolved to an empty value; refusing to propagate it.\n` +
        `Writing empty would overwrite a working destination secret and report ` +
        `success. Absence must never read as a pass.`
    );
  }
  return value;
}

/**
 * Parse a destination target into the API surface that describes it.
 *
 * `<org>` and `<owner>/<repo>` are different stores with different listings, so
 * the ambiguity is resolved once, here, rather than at each call site. Anything
 * else is refused outright: a target is interpolated into an API path, and a
 * silently mis-parsed one would push a credential somewhere nobody named.
 * @param {string} raw Target as typed.
 * @returns {{kind: string, slug: string, listPath: string, scopeArgs: string[]}} Parsed target.
 */
export function parseTarget(raw) {
  const target = String(raw ?? "").trim();
  const segment = "[A-Za-z0-9][A-Za-z0-9._-]*";
  if (new RegExp(`^${segment}$`).test(target)) {
    return {
      kind: "org",
      slug: target,
      listPath: `orgs/${target}/actions/secrets`,
      scopeArgs: ["--org", target],
    };
  }
  if (new RegExp(`^${segment}/${segment}$`).test(target)) {
    return {
      kind: "repo",
      slug: target,
      listPath: `repos/${target}/actions/secrets`,
      scopeArgs: ["--repo", target],
    };
  }
  throw new Error(
    `target "${raw}" is neither an organization nor an owner/repo.\n` +
      `Expected "<org>" or "<owner>/<repo>".`
  );
}

/**
 * Reject a destination name the store could never expose as a variable.
 * @param {string} dest Destination secret name.
 * @returns {string} The name, unchanged, when valid.
 */
export function assertDestName(dest) {
  if (!ENV_KEY.test(dest)) {
    throw new Error(
      `destination name "${dest}" is not a valid environment-variable name.\n` +
        `A workflow reads it as \${{ secrets.${dest} }}, so it must be one.`
    );
  }
  return dest;
}

/**
 * Pull the secret NAMES out of whatever shape a listing arrives in.
 *
 * This function is the one that was wrong first, and it is worth stating what
 * it got wrong. `GET /orgs/{org}/actions/secrets` does **not** return an array
 * — it returns `{ total_count, secrets: [...] }`. A filter written against a
 * bare array finds nothing, so the verification printed a WARNING for a write
 * that had already succeeded. A verification that fails a successful write
 * teaches operators to ignore it, which costs more than having no verification
 * at all.
 *
 * So every shape the client can hand us is accepted: the documented envelope, a
 * bare array of secret objects, an already-normalized array of names, and an
 * array of pages from a paginated read.
 * None of them can be confused for one another, and the alternative is a parser
 * that is silently correct only for the shape its author happened to test.
 * @param {unknown} payload A parsed listing response, or an array of them.
 * @returns {string[]} Every secret name present.
 */
export function extractSecretNames(payload) {
  if (Array.isArray(payload)) {
    return payload.flatMap(entry =>
      typeof entry === "string"
        ? [entry]
        : entry && typeof entry === "object" && !("name" in entry)
          ? extractSecretNames(entry)
          : typeof entry?.name === "string"
            ? [entry.name]
            : []
    );
  }
  if (payload && typeof payload === "object") {
    return extractSecretNames(payload.secrets ?? []);
  }
  return [];
}

/**
 * The store's own count of secrets, when it reported one.
 * @param {unknown} payload A parsed listing response.
 * @returns {number|null} The count, or null when the shape carries none.
 */
export function totalCount(payload) {
  const count = payload?.total_count;
  return typeof count === "number" ? count : null;
}

/**
 * Decide whether a destination name is present in a listing.
 *
 * Split from the read so the decision is testable without a network, a token,
 * or a real organization — which is the only way to prove the case that matters:
 * that a *successful* write verifies as successful.
 * @param {unknown} payload A parsed listing response, or pages of them.
 * @param {string} dest Destination secret name.
 * @returns {boolean} Whether the store lists that name.
 */
export function confirmPresent(payload, dest) {
  return extractSecretNames(payload).includes(dest);
}

/**
 * Run `gh`, keeping its output off any shared stream.
 * @param {string[]} args Arguments.
 * @param {{input?: string}} [options] Optional stdin payload.
 * @returns {string} Captured stdout.
 */
function gh(args, options = {}) {
  try {
    return boundedChildOutput("gh", args, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      ...options,
    });
  } catch (err) {
    const detail = String(err.stderr || err.message)
      .split("\n")
      .filter(Boolean)[0];
    throw new Error(`gh ${args[0]} failed: ${detail ?? "unknown error"}`);
  }
}

/**
 * Read every secret name the destination store holds, following pages.
 *
 * Names only. This is the *only* thing ever read from a destination, and it is
 * metadata rather than content — GitHub cannot return a secret value even to a
 * caller entitled to write one. Nothing here is compared against the provider
 * or written back to it: propagation is one-way by construction, so a
 * destination copy that has drifted is re-pushed, never reconciled.
 * @param {{listPath: string}} target Parsed target.
 * @returns {string[]} Destination secret names.
 */
export function listDestination(target) {
  const names = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const raw = gh([
      "api",
      "-H",
      "Accept: application/vnd.github+json",
      `${target.listPath}?per_page=${PAGE_SIZE}&page=${page}`,
    ]);
    const payload = JSON.parse(raw || "{}");
    const batch = extractSecretNames(payload);
    names.push(...batch);
    const total = totalCount(payload);
    if (!batch.length) break;
    if (total === null || names.length >= total) break;
  }
  return names;
}

/**
 * Resolve the value to propagate, from the provider and nowhere else.
 *
 * The exact propagating name is the allowlist for this specialized consumer;
 * ordinary `secrets.require` still controls resolution and materialization and
 * is intentionally not widened. A name the provider does not grant this
 * account is refused. An `excludeKeys` entry is reported on its own terms
 * rather than as "not available": excluding a name and declaring it
 * propagating are contradictory instructions, and guessing which one the
 * operator meant is how a credential ends up somewhere nobody chose. The
 * rotation path waives an exclusion because a credential it cannot see is one
 * it cannot write *back* to its own record; there is no equivalent argument for
 * copying one outward, so this path refuses instead.
 * @param {string} name Requested source name.
 * @param {object} cfg Resolved configuration.
 * @returns {string} The value.
 */
export function readValue(name, cfg) {
  if ((cfg.narrow?.excludeKeys ?? []).includes(name)) {
    throw new Error(
      `${name} is in secrets.narrow.excludeKeys and in secrets.propagating.\n` +
        `Those say opposite things about the same credential. Resolve it in ` +
        `config; this program will not choose for you.`
    );
  }
  const hit = fetchNamed(cfg, [name]).get(name);
  return assertValue(name, hit.value);
}

/**
 * Build the write command's arguments — every one of which excludes the value.
 *
 * Separated from the call so the property can be *proved* rather than asserted
 * in a comment: the value is not a parameter here, so no future edit can add it
 * to the argument vector without changing this function's signature. Process
 * arguments are visible to anything that can list processes on the host, which
 * is why the rotation path reads its replacement from stdin and why this one
 * writes its value there.
 * @param {{scopeArgs: string[], kind: string}} target Parsed target.
 * @param {string} dest Destination secret name.
 * @param {{visibility?: string, repos?: string}} [options] Exposure controls.
 * @returns {string[]} Arguments for `gh`.
 */
export function pushArgs(target, dest, options = {}) {
  const args = ["secret", "set", dest, ...target.scopeArgs];
  if (target.kind === "org") {
    args.push("--visibility", options.visibility ?? DEFAULT_VISIBILITY);
    if (options.repos) args.push("--repos", options.repos);
  }
  return args;
}

/**
 * Send the value to the destination store through the child's stdin.
 *
 * `input` rather than an argument, and no temp file either — a value on disk is
 * a copy that outlives the operation that needed it.
 * @param {{scopeArgs: string[], kind: string}} target Parsed target.
 * @param {string} dest Destination secret name.
 * @param {string} value The value.
 * @param {{visibility?: string, repos?: string}} options Exposure controls.
 */
function pushValue(target, dest, value, options) {
  gh(pushArgs(target, dest, options), { input: value });
}

/**
 * Parse the optional flags, leaving positionals in order.
 * @param {string[]} argv Arguments after the operation.
 * @returns {{positional: string[], options: object}} Split arguments.
 */
export function parseArgs(argv) {
  const positional = [];
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--visibility" || arg === "--repos") {
      const value = argv[i + 1];
      if (!value) throw new Error(`${arg} needs a value`);
      options[arg.slice(2)] = value;
      i += 1;
      continue;
    }
    positional.push(arg);
  }
  if (options.visibility && !VISIBILITIES.has(options.visibility)) {
    throw new Error(
      `--visibility must be one of ${[...VISIBILITIES].join(", ")}`
    );
  }
  if (options.visibility === "selected" && !options.repos) {
    throw new Error(`--visibility selected needs --repos`);
  }
  return { positional, options };
}

/**
 * Describe a value without disclosing it.
 * @param {string} value The value.
 * @returns {string} A length, and nothing else.
 */
function describeValue(value) {
  return `${Buffer.byteLength(value, "utf8")} bytes`;
}

function main() {
  const [op, ...rest] = process.argv.slice(2);
  const { positional, options } = parseArgs(rest);
  const cfg = readConfig();

  if (op === "list") {
    const [rawTarget] = positional;
    if (!rawTarget) throw new Error("usage: sync-secret-to-ci.mjs list TARGET");
    const target = parseTarget(rawTarget);
    const names = listDestination(target);
    console.log(`${target.slug} (${target.kind}) holds ${names.length}:`);
    for (const name of names.sort()) console.log(`  ${name}`);
    return;
  }

  if (op !== "push" && op !== "verify") {
    throw new Error(
      "usage: sync-secret-to-ci.mjs push|verify NAME TARGET [DEST]\n" +
        "       sync-secret-to-ci.mjs list TARGET"
    );
  }

  const [name, rawTarget, rawDest] = positional;
  if (!name || !rawTarget) {
    throw new Error(`usage: sync-secret-to-ci.mjs ${op} NAME TARGET [DEST]`);
  }
  const target = parseTarget(rawTarget);
  const dest = assertDestName(rawDest || name);

  if (op === "verify") {
    if (!confirmPresent(listDestination(target), dest)) {
      throw new Error(
        `${dest} is not present in ${target.slug}. Nothing consumes it there.`
      );
    }
    console.log(`${dest}: present in ${target.slug} (${target.kind})`);
    return;
  }

  // Declaration first, so an undeclared name never reaches the provider — the
  // refusal should not depend on whether the credential happens to resolve.
  assertPropagating(name, target.slug, cfg);
  const value = readValue(name, cfg);
  pushValue(target, dest, value, options);

  // Verified against the store's own listing, because the write reporting
  // success is not evidence the store accepted it, and the value can never be
  // read back to compare.
  if (!confirmPresent(listDestination(target), dest)) {
    throw new Error(
      `${dest} was written to ${target.slug} but does not appear in its ` +
        `secrets listing. Treat the propagation as failed.`
    );
  }
  console.log(
    `${name} → ${target.slug} (${target.kind}) as ${dest}: ` +
      `${describeValue(value)} pushed and confirmed present`
  );
}

/**
 * Whether this module is the one node was asked to run.
 *
 * Both sides are realpath'd: a raw URL comparison answers "no" through a
 * symlinked checkout, a git worktree, or a /tmp path on macOS, so the module
 * loads, runs nothing and exits 0 — a silent no-op that reads as success.
 *
 * A local copy rather than an import: plugin payload scripts ship standalone,
 * with no `lib/` sibling to import from once installed.
 * @param {string} moduleUrl - The caller's own `import.meta.url`.
 * @param {string | undefined} [argv1] - Entry path; defaults to `process.argv[1]`.
 * @returns {boolean} Whether the caller should run its CLI body.
 */
function invokedAsScript(moduleUrl, argv1 = process.argv[1]) {
  if (!argv1) return false;
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

if (invokedAsScript(import.meta.url)) {
  try {
    main();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

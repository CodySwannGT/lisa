#!/usr/bin/env node
// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * Prove a version reached the npm registry, rather than trusting the exit code
 * of the command that was supposed to put it there.
 *
 * Measured incident (CodySwannGT/lisa#3684): `v4.33.7` was tagged, a GitHub
 * Release was cut for it, and a provenance statement was written to the sigstore
 * transparency log — and `registry.npmjs.org/@codyswann/lisa/4.33.7` returned
 * 404, and still did a day later. Three artifacts asserted the release had
 * happened; the registry, the only one a consumer can install from, disagreed.
 * Nothing retried it and nothing flagged it: the version counter moved on to
 * 4.33.8, which makes the hole invisible in every downstream view.
 *
 * The publish itself had failed with `E401 Unauthorized` from npm's OIDC
 * trusted-publisher exchange. There is no long-lived token in that path to
 * rotate — the credential is minted per run — and the next release published
 * fine 17 minutes later through the identical code path. So the failure is
 * INTERMITTENT, and that is exactly why it needs a check: a permanently broken
 * credential announces itself on the next release, while one that fails once in
 * N produces a permanently skipped version with no signal at all.
 *
 * ## The exact-version endpoint, never `dist-tags.latest`
 *
 * `<registry>/<name>/<version>` answers about the version in hand.
 * `<registry>/<name>` → `dist-tags.latest` answers about whichever version the
 * registry currently considers newest, and it lags a successful publish by
 * several minutes (CodySwannGT/lisa#3685). Verifying against `latest` would
 * report a false 404 for a publish that actually landed, which trains everyone
 * to ignore the check — the failure mode that ends with the check deleted.
 *
 * ## Three verdicts, because two would hide one of them
 *
 * - `published` — the registry served this exact version. Exit 0.
 * - `missing` — the registry answered, and said 404. Exit 1.
 * - `unprovable` — the registry could not be asked: transport error, 5xx, or a
 *   200 whose body names a different version. Exit 1.
 *
 * `unprovable` blocks. It is not a pass, because nothing was proved, and a
 * check that returns success for an input it never examined is the defect this
 * script exists to catch, one layer up. It is not `missing` either: drafting a
 * GitHub Release or alarming a human on a registry blip would be a false
 * accusation, so the caller gets to tell the two apart and act differently.
 * That distinction is the whole reason the verdict is a word on stdout and not
 * just an exit code.
 * @module scripts/check-npm-publish-landed
 */
import process from "node:process";

import { invokedAsScript } from "./lib/invoked-as-script.mjs";

/** Public npm registry, the default for every Lisa release. */
const DEFAULT_REGISTRY = "https://registry.npmjs.org";

/** How many times to ask before settling on an answer. */
const DEFAULT_ATTEMPTS = 5;

/** Pause between attempts, in milliseconds. */
const DEFAULT_DELAY_MS = 3000;

/** The line a caller greps for. Never printed without a real verdict behind it. */
const VERDICT_PREFIX = "npm-publish-landed:";

/**
 * The URL that answers "is this exact version on the registry".
 *
 * Deliberately the only URL this module ever builds. A packument read
 * (`<registry>/<name>`) would carry `dist-tags`, and having that object in hand
 * is all it takes for someone to start consulting it — so the shape that could
 * regress is simply never fetched.
 * @param {string} registry - Registry origin, no trailing slash.
 * @param {string} name - Package name, scope included.
 * @param {string} version - Exact version, no range syntax.
 * @returns {string} The exact-version manifest URL.
 */
export function exactVersionUrl(registry, name, version) {
  return `${registry.replace(/\/+$/u, "")}/${name}/${version}`;
}

/**
 * Ask the registry once.
 * @param {string} url - The exact-version manifest URL.
 * @param {typeof fetch} fetchImpl - Injected for tests.
 * @param {string} version - The version the answer must name.
 * @returns {Promise<{verdict: string, detail: string}>} One attempt's outcome.
 */
async function askOnce(url, fetchImpl, version) {
  let response;
  try {
    response = await fetchImpl(url, {
      headers: { accept: "application/json" },
    });
  } catch (error) {
    return { verdict: "unprovable", detail: `network: ${error.message}` };
  }
  if (response.status === 404) {
    return { verdict: "missing", detail: "registry returned 404" };
  }
  if (!response.ok) {
    return { verdict: "unprovable", detail: `HTTP ${response.status}` };
  }
  let manifest;
  try {
    manifest = await response.json();
  } catch (error) {
    return {
      verdict: "unprovable",
      detail: `unparseable body: ${error.message}`,
    };
  }
  // A 200 that names a different version is not this version being present. The
  // registry is not expected to do this; treating it as proof anyway is how a
  // surprise becomes a silent pass.
  if (manifest?.version !== version) {
    return {
      verdict: "unprovable",
      detail: `HTTP 200 but the body names version ${String(manifest?.version)}`,
    };
  }
  return { verdict: "published", detail: "registry served this exact version" };
}

/**
 * Whether an attempt's verdict is worth another try.
 *
 * Both non-published verdicts are retried, for different reasons. `missing` is
 * retried because a publish that just succeeded may not have propagated yet;
 * `unprovable` because a 5xx or a dropped connection says nothing about the
 * package. Neither is allowed to become `published` — a retry can only confirm
 * or replace a non-answer, never upgrade one.
 * @param {string} verdict - The attempt's verdict.
 * @returns {boolean} Whether to ask again.
 */
const worthRetrying = verdict => verdict !== "published";

/**
 * Prove, or fail to prove, that one version is on the registry.
 * @param {object} options - Everything the check needs.
 * @param {string} options.packageName - Package name, scope included.
 * @param {string} options.version - Exact version to look for.
 * @param {string} [options.registry] - Registry origin.
 * @param {number} [options.attempts] - How many times to ask.
 * @param {number} [options.delayMs] - Pause between attempts.
 * @param {typeof fetch} [options.fetchImpl] - Injected for tests.
 * @param {(ms: number) => Promise<void>} [options.sleep] - Injected for tests.
 * @returns {Promise<{verdict: string, detail: string, urls: string[]}>} Outcome.
 */
export async function verifyPublish({
  packageName,
  version,
  registry = DEFAULT_REGISTRY,
  attempts = DEFAULT_ATTEMPTS,
  delayMs = DEFAULT_DELAY_MS,
  fetchImpl = fetch,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
}) {
  const url = exactVersionUrl(registry, packageName, version);
  const urls = [];
  let outcome = { verdict: "unprovable", detail: "no attempt was made" };
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    urls.push(url);
    outcome = await askOnce(url, fetchImpl, version);
    if (!worthRetrying(outcome.verdict)) break;
    if (attempt < attempts) await sleep(delayMs);
  }
  return { ...outcome, urls };
}

/** Return a required CLI option, or exit naming it. */
function requiredOption(argv, name) {
  const index = argv.indexOf(name);
  const value = index === -1 ? undefined : argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Missing required option ${name}`);
  }
  return value;
}

/** Return an optional CLI option. */
function option(argv, name, fallback) {
  const index = argv.indexOf(name);
  const value = index === -1 ? undefined : argv[index + 1];
  return value === undefined || value.startsWith("--") ? fallback : value;
}

/**
 * Run the check and report, for a caller that is a workflow step.
 * @param {string[]} argv - Arguments after the script path.
 * @param {object} [injected] - Test seams forwarded to {@link verifyPublish}.
 * @returns {Promise<number>} Process exit code.
 */
export async function main(argv, injected = {}) {
  const packageName = requiredOption(argv, "--package");
  const version = requiredOption(argv, "--version");
  const registry = option(argv, "--registry", DEFAULT_REGISTRY);
  const attempts = Number(option(argv, "--attempts", String(DEFAULT_ATTEMPTS)));
  const delayMs = Number(option(argv, "--delay-ms", String(DEFAULT_DELAY_MS)));

  const { verdict, detail, urls } = await verifyPublish({
    packageName,
    version,
    registry,
    attempts,
    delayMs,
    ...injected,
  });

  process.stdout.write(
    `${VERDICT_PREFIX} ${verdict} package=${packageName} version=${version}\n`
  );
  if (verdict === "published") {
    process.stdout.write(`✅ ${packageName}@${version} is on ${registry}.\n`);
    return 0;
  }
  const asked = urls[0] ?? exactVersionUrl(registry, packageName, version);
  process.stderr.write(
    verdict === "missing"
      ? `❌ ${packageName}@${version} is NOT on the registry.\n` +
          `   ${asked} → 404 after ${urls.length} attempt(s).\n` +
          `   A tag, a GitHub Release and a provenance statement can all exist\n` +
          `   for a version consumers cannot install. This is that state.\n`
      : `❌ Could not prove ${packageName}@${version} reached the registry.\n` +
          `   ${asked} → ${detail} (after ${urls.length} attempt(s)).\n` +
          `   This is NOT a clean result and NOT a confirmed miss — nothing was\n` +
          `   proved either way, so it blocks rather than reporting a verdict it\n` +
          `   does not have.\n`
  );
  return 1;
}

/* c8 ignore start -- CLI wiring, exercised through main() in tests */
if (invokedAsScript(import.meta.url)) {
  main(process.argv.slice(2))
    .then(code => {
      process.exitCode = code;
    })
    .catch(error => {
      process.stderr.write(`❌ ${error.message}\n`);
      process.exitCode = 1;
    });
}
/* c8 ignore stop */

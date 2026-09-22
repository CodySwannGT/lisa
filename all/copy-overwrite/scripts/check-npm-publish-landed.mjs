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

/**
 * How many times to ask before settling on an answer.
 *
 * WHY THIS IS 150 AND NOT FIVE.
 *
 * npm accepts a publish and makes it fetchable some minutes later. Its own
 * notice says so, in the same log as the publish: "Your package is being
 * processed and may take a few minutes to become available." The lag is
 * recorded independently in CodySwannGT/lisa#3685.
 *
 * The previous defaults asked 5 times, 3s apart — about 15 seconds of wall
 * time, against a delay npm describes in minutes. Every release run went red on
 * a publish that had worked. Measured on this repository: 4.64.5 through 4.65.0
 * all failed this check and all reached the registry.
 *
 * Two propagations were timed end to end, and the spread is the point:
 *
 *   4.64.9  published 19:35:42Z  visible 19:42:21Z   6m39s
 *   4.65.0  published 16:38:57Z  visible 16:57:00Z  18m03s
 *
 * A window sized to the first would have failed the second — this is not a
 * hypothetical, it happened: a 14m45s window was written against the 6m39s
 * figure and the very next release took 18m03s. Three "did not reach npm"
 * tickets were filed automatically for these false misses and closed again.
 *
 * The damage is not the red tick, it is the lost signal. A release that
 * genuinely fails to publish now looks exactly like the four that succeeded —
 * and that state was live here: 4.65.0 was tagged while its publish job was
 * skipped, and nothing distinguished it from the false alarms.
 *
 * So the window is sized to the worst measurement with margin, not guessed:
 * 150 attempts, 15s apart, is 37m15s of sleeping — 2.06x the 18m03s observed.
 * The margin is the part that matters. The distribution is wide and only two
 * points of it are known, so a window sized to the exact worst case is a window
 * that fails on the next release slightly worse than it.
 *
 * Widening costs nothing on the normal path, because the loop exits on the
 * first `published` verdict. It costs only on a publish that genuinely failed,
 * which is rare, and waiting is the correct thing to do there: the alternative
 * is the state this replaces, where a real miss and a slow success printed the
 * same red tick.
 * @see DEFAULT_DELAY_MS
 */
const DEFAULT_ATTEMPTS = 150;

/** Pause between attempts, in milliseconds. @see DEFAULT_ATTEMPTS */
const DEFAULT_DELAY_MS = 15_000;

/** Maximum wall time for one registry attempt, including body parsing. */
const DEFAULT_ATTEMPT_TIMEOUT_MS = 10_000;

/**
 * Wall time the shipped defaults spend SLEEPING before settling on a miss.
 *
 * Exported so the window is a checkable property rather than two numbers
 * nobody multiplies. The defaults were the one thing the tests never exercised
 * — every case passed `attempts` and `delayMs` explicitly — which is how a
 * 15-second window survived against a delay measured in minutes.
 *
 * This is the figure to compare against a PROPAGATION measurement, because
 * propagation is what the sleeping is for. It is NOT the figure to compare
 * against a job timeout — see {@link DEFAULT_MAX_RUNTIME_MS}.
 */
export const DEFAULT_WINDOW_MS = (DEFAULT_ATTEMPTS - 1) * DEFAULT_DELAY_MS;

/**
 * Longest the shipped defaults can RUN before returning a verdict.
 *
 * Sleeping is not the only thing this check spends time on. Every attempt also
 * gets up to {@link DEFAULT_ATTEMPT_TIMEOUT_MS} of its own, and a registry that
 * hangs rather than answering burns all of it — a timed-out attempt returns
 * `unprovable`, which is retryable, so the slow path is the one that runs every
 * attempt to its deadline AND sleeps between them.
 *
 * 150 × 10s + 149 × 15s = 62m15s, against 37m15s of sleeping alone. The two
 * differ by 25 minutes, and the smaller one is the seductive number because it
 * is the one the widening was about.
 *
 * Caught in review on the pull request that introduced it: the job cap was set
 * to 50 minutes against `DEFAULT_WINDOW_MS`, so a hanging registry would have
 * had the job killed 12 minutes before the checker could answer — the inert
 * control that same change was written to prevent, reproduced one field over.
 * The test bound the cap to the sleeping figure, so it could not have caught
 * it: it measured the wrong quantity and passed.
 *
 * This is the figure a job timeout must clear. Bind a cap to this, never to
 * {@link DEFAULT_WINDOW_MS}.
 */
export const DEFAULT_MAX_RUNTIME_MS =
  DEFAULT_ATTEMPTS * DEFAULT_ATTEMPT_TIMEOUT_MS + DEFAULT_WINDOW_MS;

/**
 * Longest publish-to-visible propagation measured on this package.
 *
 * `@codyswann/lisa@4.65.0`, 2026-09-22: publish step finished 16:38:57Z, the
 * exact-version URL first answered 200 at 16:57:00Z — 18m03s. The previous
 * release, 4.64.9, took 6m39s, so this figure is 2.7x its predecessor and the
 * distribution is plainly wide.
 *
 * Exported so a test can require {@link DEFAULT_WINDOW_MS} to clear it with
 * margin, and so a future reader can re-measure and contradict it rather than
 * trusting a bare number. Raise it when a longer propagation is OBSERVED, never
 * to make a failing release green.
 */
export const MEASURED_PROPAGATION_MS = 1_083_000;

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
  // Trailing slashes trimmed without a regex: `/\/+$/` is a super-linear
  // pattern the shipped ruleset rejects outright, and an origin arriving from
  // configuration is exactly the kind of attacker-adjacent input that rule
  // exists for.
  let origin = registry;
  while (origin.endsWith("/")) origin = origin.slice(0, -1);
  return `${origin}/${name}/${version}`;
}

/**
 * Ask the registry once.
 * @param {string} url - The exact-version manifest URL.
 * @param {typeof fetch} fetchImpl - Injected for tests.
 * @param {string} version - The version the answer must name.
 * @param {object} timeout - Per-attempt deadline dependencies.
 * @param {number} timeout.attemptTimeoutMs - Deadline in milliseconds.
 * @param {() => AbortController} timeout.createAbortController - Controller factory.
 * @param {typeof setTimeout} timeout.setAttemptTimer - Timer scheduler.
 * @param {typeof clearTimeout} timeout.clearAttemptTimer - Timer clearer.
 * @returns {Promise<{verdict: string, detail: string}>} One attempt's outcome.
 */
async function askOnce(url, fetchImpl, version, timeout) {
  const controller = timeout.createAbortController();
  const timer = timeout.setAttemptTimer(
    () => controller.abort(),
    timeout.attemptTimeoutMs
  );
  try {
    const response = await fetchImpl(url, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (response.status === 404) {
      return { verdict: "missing", detail: "registry returned 404" };
    }
    if (!response.ok) {
      return { verdict: "unprovable", detail: `HTTP ${response.status}` };
    }
    const manifest = await response.json();
    // A 200 that names a different version is not this version being present.
    if (manifest?.version !== version) {
      return {
        verdict: "unprovable",
        detail: `HTTP 200 but the body names version ${String(manifest?.version)}`,
      };
    }
    return {
      verdict: "published",
      detail: "registry served this exact version",
    };
  } catch (error) {
    return {
      verdict: "unprovable",
      detail: controller.signal.aborted
        ? `attempt exceeded ${String(timeout.attemptTimeoutMs)}ms deadline`
        : `network or body: ${error.message}`,
    };
  } finally {
    timeout.clearAttemptTimer(timer);
  }
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
 * @param {number} [options.attemptTimeoutMs] - Deadline for each attempt.
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
  attemptTimeoutMs = DEFAULT_ATTEMPT_TIMEOUT_MS,
  fetchImpl = fetch,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  createAbortController = () => new AbortController(),
  setAttemptTimer = setTimeout,
  clearAttemptTimer = clearTimeout,
}) {
  const url = exactVersionUrl(registry, packageName, version);
  const urls = [];
  let outcome = { verdict: "unprovable", detail: "no attempt was made" };
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    urls.push(url);
    outcome = await askOnce(url, fetchImpl, version, {
      attemptTimeoutMs,
      createAbortController,
      setAttemptTimer,
      clearAttemptTimer,
    });
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

  if (!Number.isSafeInteger(attempts) || attempts <= 0) {
    throw new Error("--attempts must be a positive safe integer");
  }

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

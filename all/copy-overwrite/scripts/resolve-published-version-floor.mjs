#!/usr/bin/env node
// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * Answer "what is the highest release already on the registry", from a source
 * that is not minutes behind reality.
 *
 * A release workflow that computes a candidate version has to know what it must
 * exceed. Asking `npm view <pkg> version` looks like the obvious way to find
 * out and is the wrong one: that answer comes from the registry's cached
 * mutable pointer, and it lags a successful publish. Measured
 * (CodySwannGT/lisa#3685) immediately after `4.33.8` published — the cached
 * views said `4.33.6` for roughly THIRTEEN minutes while the uncached ones
 * already said `4.33.8`.
 *
 * That is not a reporting inconvenience. It is fed to a guard whose entire job
 * is to keep the next release above the last one, so a release cut inside the
 * lag window compares against a version that is no longer the newest, the guard
 * under-corrects, and it under-corrects SILENTLY — it still reports having
 * checked. Releases here run minutes apart, so the window is routinely open.
 *
 * ## What is asked instead
 *
 * `<registry>/<name>?write=true`. The `write=true` parameter is what makes the
 * read authoritative: it is served from the source of truth rather than the
 * read-through cache, and in the same measurement it named `4.33.8` seconds
 * after the publish while three cached endpoints still named `4.33.6`.
 *
 * The answer is then computed from the packument's full `versions` map — the
 * set of versions that actually exist — and never from its mutable pointer.
 * Both live in the same document, so the pointer is deliberately not read even
 * though it is sitting right there: an authoritative fetch of a field that is
 * still a pointer to "whatever is currently considered newest" would answer a
 * different question from the one the caller asked.
 *
 * ## Three verdicts, because "no answer" is not "nothing published"
 *
 * - `resolved` — the registry answered and named a highest release. Exit 0.
 * - `unpublished` — the registry answered 404: this package has no releases at
 *   all, so there is no floor to clear. Exit 0.
 * - `unprovable` — the registry could not be asked, or answered with something
 *   this module cannot read. Exit 1.
 *
 * `unprovable` is the whole point of the module having a verdict rather than
 * just a value. The defect being fixed is a guard that treated an unreadable
 * registry as "nothing is published" and proceeded to choose a version anyway;
 * two releases choosing a version from evidence neither of them could read is
 * how they collide. A caller that cannot get an answer must refuse, not guess.
 *
 * ## Prereleases are excluded from the floor, on purpose
 *
 * The floor answers "what clean `X.Y.Z` must the next clean `X.Y.Z` exceed", so
 * only stable versions count. Two reasons, and the second one is newer than the
 * first:
 *
 * 1. `4.6.0-beta.1` sorts ABOVE `4.5.9`, so letting a prerelease set the floor
 *    would push the next stable release to `4.6.0` because somebody cut a beta.
 * 2. Release tags are now environment-scoped (CodySwannGT/lisa#3741): every
 *    non-production environment cuts `vX.Y.Z-<environment>.<epoch>` and only
 *    production cuts a clean `vX.Y.Z`. That suffix lives in the git tag and not
 *    in `package.json`, so it should never reach the registry — but "should
 *    never" is not a guard. Filtering here means a suffixed version arriving on
 *    the registry by any route cannot drag production's floor upward.
 * @module scripts/resolve-published-version-floor
 */
import process from "node:process";

import { invokedAsScript } from "./lib/invoked-as-script.mjs";

/** Public npm registry, the default for every Lisa release. */
const DEFAULT_REGISTRY = "https://registry.npmjs.org";

/** How many times to ask before settling on an answer. */
const DEFAULT_ATTEMPTS = 3;

/** Pause between attempts, in milliseconds. */
const DEFAULT_DELAY_MS = 2000;

/** Maximum wall time for one registry attempt, including body parsing. */
const DEFAULT_ATTEMPT_TIMEOUT_MS = 20_000;

/** The single stdout line a caller parses. Never printed without a verdict. */
const VERDICT_PREFIX = "npm-published-floor:";

/** What the verdict line reports when there is no floor to clear. */
const NO_FLOOR = "none";

/**
 * The URL that answers "which versions exist", bypassing the read-through cache.
 *
 * Deliberately the only URL this module builds, and it always carries
 * `write=true`. Dropping that parameter would still return a packument and
 * still parse — it would just be the stale one, which is the defect.
 * @param {string} registry - Registry origin, no trailing slash.
 * @param {string} name - Package name, scope included.
 * @returns {string} The uncached packument URL.
 */
export function packumentUrl(registry, name) {
  // Trailing slashes trimmed without a regex: `/\/+$/` is a super-linear
  // pattern the shipped ruleset rejects outright, and an origin arriving from
  // configuration is exactly the kind of attacker-adjacent input that rule
  // exists for.
  let origin = registry;
  while (origin.endsWith("/")) origin = origin.slice(0, -1);
  // A scoped name carries one slash, which the registry accepts percent-encoded
  // and which keeps the scope from reading as a path segment.
  const escaped = name.startsWith("@") ? name.replace("/", "%2f") : name;
  return `${origin}/${escaped}?write=true`;
}

/**
 * Whether a version string is a plain `X.Y.Z` release.
 *
 * Scanned character by character rather than matched, because the shipped
 * ruleset rejects backtracking-prone quantifiers and anchoring does not clear
 * it. A prerelease (`-`) or build-metadata (`+`) suffix disqualifies the string
 * before the digits are ever examined.
 * @param {unknown} value - Candidate version.
 * @returns {boolean} True when the value is a stable three-part release.
 */
export function isStableRelease(value) {
  if (typeof value !== "string" || value.length === 0) return false;
  if (value.includes("-") || value.includes("+")) return false;
  const parts = value.split(".");
  if (parts.length !== 3) return false;
  for (const part of parts) {
    if (part.length === 0) return false;
    for (const character of part) {
      if (character < "0" || character > "9") return false;
    }
  }
  return true;
}

/**
 * Compare two stable `X.Y.Z` releases numerically.
 * @param {string} left - A stable release.
 * @param {string} right - A stable release.
 * @returns {number} Negative when left is lower, positive when higher, 0 equal.
 */
function compareStable(left, right) {
  const a = left.split(".");
  const b = right.split(".");
  for (let index = 0; index < 3; index += 1) {
    const difference = Number(a[index]) - Number(b[index]);
    if (difference !== 0) return difference;
  }
  return 0;
}

/**
 * The highest stable release named by a packument's `versions` map.
 * @param {unknown} versions - The packument's `versions` object.
 * @returns {string | null} Highest stable release, or null when there is none.
 */
export function highestStableVersion(versions) {
  if (typeof versions !== "object" || versions === null) return null;
  let highest = null;
  for (const candidate of Object.keys(versions)) {
    if (!isStableRelease(candidate)) continue;
    if (highest === null || compareStable(candidate, highest) > 0) {
      highest = candidate;
    }
  }
  return highest;
}

/**
 * Ask the registry once.
 * @param {string} url - The uncached packument URL.
 * @param {typeof fetch} fetchImpl - Injected for tests.
 * @param {object} timeout - Per-attempt deadline dependencies.
 * @param {number} timeout.attemptTimeoutMs - Deadline in milliseconds.
 * @param {() => AbortController} timeout.createAbortController - Controller factory.
 * @param {typeof setTimeout} timeout.setAttemptTimer - Timer scheduler.
 * @param {typeof clearTimeout} timeout.clearAttemptTimer - Timer clearer.
 * @returns {Promise<{verdict: string, version: string | null, detail: string}>} One attempt.
 */
async function askOnce(url, fetchImpl, timeout) {
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
      return {
        verdict: "unpublished",
        version: null,
        detail: "registry returned 404: the package has no releases",
      };
    }
    if (!response.ok) {
      return {
        verdict: "unprovable",
        version: null,
        detail: `HTTP ${response.status}`,
      };
    }
    const packument = await response.json();
    // A 200 with no `versions` map is not "nothing is published" — it is a body
    // this module cannot read, and reporting an empty floor for it would be the
    // silent under-correction the module exists to remove.
    if (
      typeof packument?.versions !== "object" ||
      packument.versions === null
    ) {
      return {
        verdict: "unprovable",
        version: null,
        detail: "HTTP 200 but the body carries no versions map",
      };
    }
    const highest = highestStableVersion(packument.versions);
    if (highest === null) {
      return {
        verdict: "unpublished",
        version: null,
        detail: "registry answered, and names no stable release",
      };
    }
    return {
      verdict: "resolved",
      version: highest,
      detail: "highest stable release named by the uncached packument",
    };
  } catch (error) {
    return {
      verdict: "unprovable",
      version: null,
      detail: controller.signal.aborted
        ? `attempt exceeded ${String(timeout.attemptTimeoutMs)}ms deadline`
        : `network or body: ${error.message}`,
    };
  } finally {
    timeout.clearAttemptTimer(timer);
  }
}

/**
 * Resolve the version floor the next release must clear.
 * @param {object} options - Everything the resolution needs.
 * @param {string} options.packageName - Package name, scope included.
 * @param {string} [options.registry] - Registry origin.
 * @param {number} [options.attempts] - How many times to ask.
 * @param {number} [options.delayMs] - Pause between attempts.
 * @param {number} [options.attemptTimeoutMs] - Deadline for each attempt.
 * @param {typeof fetch} [options.fetchImpl] - Injected for tests.
 * @param {(ms: number) => Promise<void>} [options.sleep] - Injected for tests.
 * @param {() => AbortController} [options.createAbortController] - Injected for tests.
 * @param {typeof setTimeout} [options.setAttemptTimer] - Injected for tests.
 * @param {typeof clearTimeout} [options.clearAttemptTimer] - Injected for tests.
 * @returns {Promise<{verdict: string, version: string | null, detail: string, url: string}>} Outcome.
 */
export async function resolvePublishedFloor({
  packageName,
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
  const url = packumentUrl(registry, packageName);
  let outcome = {
    verdict: "unprovable",
    version: null,
    detail: "no attempt was made",
  };
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    outcome = await askOnce(url, fetchImpl, {
      attemptTimeoutMs,
      createAbortController,
      setAttemptTimer,
      clearAttemptTimer,
    });
    // Only a non-answer is retried. A registry that answered has answered, and
    // asking again could only replace a real answer with a different one.
    if (outcome.verdict !== "unprovable") break;
    if (attempt < attempts) await sleep(delayMs);
  }
  return { ...outcome, url };
}

/**
 * Return a required CLI option, or throw naming it.
 * @param {string[]} argv - Arguments after the script path.
 * @param {string} name - Option flag.
 * @returns {string} The option's value.
 */
function requiredOption(argv, name) {
  const index = argv.indexOf(name);
  const value = index === -1 ? undefined : argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Missing required option ${name}`);
  }
  return value;
}

/**
 * Return an optional CLI option.
 * @param {string[]} argv - Arguments after the script path.
 * @param {string} name - Option flag.
 * @param {string} fallback - Value when the flag is absent.
 * @returns {string} The option's value or the fallback.
 */
function option(argv, name, fallback) {
  const index = argv.indexOf(name);
  const value = index === -1 ? undefined : argv[index + 1];
  return value === undefined || value.startsWith("--") ? fallback : value;
}

/**
 * Run the resolution and report, for a caller that is a workflow step.
 *
 * stdout carries exactly one line so a shell can take the text after the last
 * `version=` without a parser; everything a human reads goes to stderr.
 * @param {string[]} argv - Arguments after the script path.
 * @param {object} [injected] - Test seams forwarded to {@link resolvePublishedFloor}.
 * @returns {Promise<number>} Process exit code.
 */
export async function main(argv, injected = {}) {
  const packageName = requiredOption(argv, "--package");
  const registry = option(argv, "--registry", DEFAULT_REGISTRY);
  const attempts = Number(option(argv, "--attempts", String(DEFAULT_ATTEMPTS)));
  const delayMs = Number(option(argv, "--delay-ms", String(DEFAULT_DELAY_MS)));

  if (!Number.isSafeInteger(attempts) || attempts <= 0) {
    throw new Error("--attempts must be a positive safe integer");
  }

  const { verdict, version, detail, url } = await resolvePublishedFloor({
    packageName,
    registry,
    attempts,
    delayMs,
    ...injected,
  });

  if (verdict === "unprovable") {
    process.stderr.write(
      `❌ Could not read the published version floor for ${packageName}.\n` +
        `   ${url} → ${detail}\n` +
        `   Nothing was proved either way. An unreadable registry is NOT\n` +
        `   evidence that nothing is published, so no version is chosen from\n` +
        `   it — two releases guessing from evidence neither could read is how\n` +
        `   they collide.\n`
    );
    return 1;
  }

  process.stdout.write(
    `${VERDICT_PREFIX} ${verdict} package=${packageName} version=${version ?? NO_FLOOR}\n`
  );
  process.stderr.write(
    verdict === "resolved"
      ? `✅ ${packageName} floor is ${String(version)} (${detail}).\n`
      : `✅ ${packageName} has no published floor to clear (${detail}).\n`
  );
  return 0;
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

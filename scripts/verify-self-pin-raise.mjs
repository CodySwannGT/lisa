#!/usr/bin/env node
/**
 * Prove a self-pin raise changes the one line it claims to, and nothing else
 * (CodySwannGT/lisa#4951).
 *
 * The deploy workflow raises Lisa's own `@codyswann/lisa` pin in a job with
 * no secrets: that job runs `bun install`, the build and the checks, all of
 * which execute dependency code, the just-published Lisa included. A SEPARATE
 * job then pushes the result with the ruleset-bypassing deploy key. That job
 * runs no dependency code and trusts nothing the unprivileged job produced:
 *
 * 1. **package.json** (`manifest` mode, the default): the candidate is accepted
 *    only when it is main's text with exactly the self-pin value replaced by
 *    `^<published version>`.
 * 2. **bun.lock** (`lockfile` mode): the push job does NOT take the candidate
 *    lockfile on trust, and it cannot be checked entry by entry either — a
 *    major raise legitimately changes other entries (the self-dependency's own
 *    transitive tree moves). Instead the push job regenerates the lockfile
 *    itself with `bun install --lockfile-only --ignore-scripts`, from main's
 *    lockfile plus the verified package.json. That reads registry manifests
 *    only: no tarball is downloaded and no package code runs. This mode then
 *    requires the candidate the prepare job TESTED to be byte-identical to the
 *    lockfile the push job GENERATED, so what was tested is what is pushed, and
 *    a lockfile rewritten by dependency code in the prepare job is refused. On
 *    top of that, the `@codyswann/lisa` entry must name exactly the published
 *    version with the integrity the npm registry reports for it, fetched here
 *    with a deadline and failing closed.
 *
 * 3. **Exact resolution** (`spec` mode): a caret range can resolve a NEWER
 *    release than the one being raised to — a retried 7.0.0 raise after 7.0.1
 *    shipped would lock 7.0.1 and fail the lockfile check. So both jobs resolve
 *    with the pin set to the exact published version (`spec --form exact`),
 *    then write the committed caret range back into package.json and the
 *    lockfile's workspace specifier (`spec --form caret`). Bun keeps a locked
 *    version that satisfies the declared range, so the resulting pair passes
 *    `--frozen-lockfile` and locks exactly the published release.
 *
 * Deliberately dependency-free (no `semver`, no repository imports), because
 * the privileged job has no `node_modules` and must not need any.
 * @module scripts/verify-self-pin-raise
 */
import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";

import { invokedAsScript } from "./lib/invoked-as-script.mjs";

/** The package whose pin is raised. */
const SELF_PACKAGE = "@codyswann/lisa";

/** A plain release version: no range operators, no prerelease, no build. */
const RELEASE_VERSION = /^\d+\.\d+\.\d+$/;

/** The line a caller greps for. */
const VERDICT_PREFIX = "verify-self-pin-raise:";

/** Public npm registry, the source of truth for the published tarball. */
const DEFAULT_REGISTRY = "https://registry.npmjs.org";

/** How long the registry may take before the push is refused. */
const REGISTRY_TIMEOUT_MS = 30_000;

/** How many times a transient registry failure is tried before refusing. */
const REGISTRY_ATTEMPTS = 3;

/** Base delay between registry attempts; attempt n waits n times this. */
const REGISTRY_RETRY_DELAY_MS = 2_000;

/** How much of a differing lockfile line a refusal prints. */
const EXCERPT_LENGTH = 160;

/**
 * The self-dependency's package entry in a bun.lock: the resolved version and
 * its integrity. Anchored to the four-space `packages` indentation, so the
 * `@codyswann/lisa/<nested>` entries and the workspace's declared range never
 * match.
 */
const SELF_LOCK_ENTRY =
  /^ {4}"@codyswann\/lisa": \["@codyswann\/lisa@([^"]+)", "", \{.*\}, "(sha512-[A-Za-z0-9+/=]+)"\],$/gm;

/**
 * The root workspace's declared self-pin in a bun.lock, eight spaces deep
 * under `workspaces[""].devDependencies`. Package entries sit at four spaces
 * and start with `[`, so they never match.
 * @param {string} spec - The exact specifier text expected on the line.
 * @returns {RegExp} A global, multiline matcher for that line.
 */
function workspaceSpecLine(spec) {
  const escaped = spec.replace(/[.^]/g, character => `\\${character}`);
  return new RegExp(`^( {8}"@codyswann/lisa": )"${escaped}"(,?)$`, "gm");
}

/**
 * Serialize a manifest the way the raise script writes it.
 * @param {object} manifest - Parsed package.json.
 * @returns {string} Two-space JSON with a trailing newline.
 */
function serialize(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/**
 * Switch the self-pin between the exact published version (to resolve) and
 * the committed caret range (to commit).
 *
 * `exact` requires the manifest to declare `^version` and sets it to
 * `version`; the lockfile is left for the install to rewrite. `caret` requires
 * the manifest AND the lockfile's workspace specifier to declare exactly
 * `version` — proof the exact resolution ran — and sets both to `^version`.
 * @param {object} input - The current texts and the requested form.
 * @param {string} input.manifestText - package.json text.
 * @param {string} input.lockText - bun.lock text.
 * @param {string} input.version - The published release version.
 * @param {"exact" | "caret"} input.form - Which specifier to write.
 * @returns {{ok: boolean, detail: string, manifestText?: string, lockText?: string}} The verdict and, when ok, the new texts.
 */
export function setSelfSpec({ manifestText, lockText, version, form }) {
  if (!RELEASE_VERSION.test(version)) {
    return { ok: false, detail: `"${version}" is not a release version` };
  }
  if (form !== "exact" && form !== "caret") {
    return { ok: false, detail: `"${form}" is not exact or caret` };
  }
  const manifest = JSON.parse(manifestText);
  const from = form === "exact" ? `^${version}` : version;
  const to = form === "exact" ? version : `^${version}`;
  const declared = manifest?.devDependencies?.[SELF_PACKAGE];
  if (declared !== from) {
    return {
      ok: false,
      detail: `package.json declares ${SELF_PACKAGE} ${JSON.stringify(declared)}, not "${from}"`,
    };
  }
  const nextManifest = serialize({
    ...manifest,
    devDependencies: { ...manifest.devDependencies, [SELF_PACKAGE]: to },
  });
  if (form === "exact") {
    return {
      ok: true,
      detail: `resolving ${SELF_PACKAGE} at exactly ${version}`,
      manifestText: nextManifest,
      lockText,
    };
  }
  const lines = [...lockText.matchAll(workspaceSpecLine(from))];
  if (lines.length !== 1) {
    return {
      ok: false,
      detail: `bun.lock has ${lines.length} workspace specifiers "${from}" for ${SELF_PACKAGE}, not exactly one`,
    };
  }
  return {
    ok: true,
    detail: `committing ${SELF_PACKAGE} as ^${version}, locked at ${version}`,
    manifestText: nextManifest,
    lockText: lockText.replace(workspaceSpecLine(from), `$1"${to}"$2`),
  };
}

/**
 * Decide whether the candidate manifest is the base with only the pin raised.
 * @param {string} baseText - main's package.json, as text.
 * @param {string} candidateText - The raised package.json, as text.
 * @param {string} version - The version the release published.
 * @returns {{ok: boolean, detail: string}} The verdict.
 */
export function verifySelfPinRaise(baseText, candidateText, version) {
  if (!RELEASE_VERSION.test(version)) {
    return { ok: false, detail: `"${version}" is not a release version` };
  }
  const base = JSON.parse(baseText);
  const spec = base?.devDependencies?.[SELF_PACKAGE];
  if (typeof spec !== "string") {
    return {
      ok: false,
      detail: `main's package.json declares no devDependencies["${SELF_PACKAGE}"]`,
    };
  }
  const expected = JSON.stringify(
    {
      ...base,
      devDependencies: {
        ...base.devDependencies,
        [SELF_PACKAGE]: `^${version}`,
      },
    },
    null,
    2
  );
  if (`${expected}\n` !== candidateText) {
    return {
      ok: false,
      detail: `the candidate is not main's package.json with only "${SELF_PACKAGE}" set to ^${version}`,
    };
  }
  if (spec === `^${version}`) {
    return { ok: false, detail: `main already pins ^${version}` };
  }
  return {
    ok: true,
    detail: `only ${SELF_PACKAGE} changes: ${spec} → ^${version}`,
  };
}

/**
 * Require the lockfile the prepare job tested to be the one this job generated.
 * @param {string} regeneratedText - bun.lock as regenerated in the push job.
 * @param {string} candidateText - bun.lock the prepare job tested.
 * @returns {{ok: boolean, detail: string}} The verdict.
 */
export function verifyLockfileMatch(regeneratedText, candidateText) {
  if (regeneratedText === candidateText) {
    return { ok: true, detail: "the tested bun.lock is the regenerated one" };
  }
  const regenerated = regeneratedText.split("\n");
  const candidate = candidateText.split("\n");
  const length = Math.max(regenerated.length, candidate.length);
  const line = Array.from({ length }, (_unused, index) => index).find(
    index => regenerated[index] !== candidate[index]
  );
  const excerpt = value =>
    value === undefined
      ? "<end of file>"
      : JSON.stringify(value.slice(0, EXCERPT_LENGTH));
  return {
    ok: false,
    detail:
      `the tested bun.lock differs from the one regenerated from main at line ${(line ?? 0) + 1}: ` +
      `regenerated ${excerpt(regenerated[line ?? 0])}, tested ${excerpt(candidate[line ?? 0])}`,
  };
}

/**
 * Require the self-dependency's lock entry to be the published tarball.
 * @param {string} lockText - bun.lock text.
 * @param {string} version - The version the release published.
 * @param {string} registryIntegrity - `dist.integrity` the registry reports.
 * @returns {{ok: boolean, detail: string}} The verdict.
 */
export function verifySelfLockEntry(lockText, version, registryIntegrity) {
  const entries = [...lockText.matchAll(SELF_LOCK_ENTRY)];
  if (entries.length !== 1) {
    return {
      ok: false,
      detail: `bun.lock has ${entries.length} "${SELF_PACKAGE}" package entries, not exactly one`,
    };
  }
  const [, locked, integrity] = entries[0];
  if (locked !== version) {
    return {
      ok: false,
      detail: `bun.lock resolves ${SELF_PACKAGE}@${locked}, not the published ${version}`,
    };
  }
  if (integrity !== registryIntegrity) {
    return {
      ok: false,
      detail: `bun.lock's integrity for ${SELF_PACKAGE}@${version} is not the registry's`,
    };
  }
  return {
    ok: true,
    detail: `${SELF_PACKAGE}@${version} is locked at the registry's integrity`,
  };
}

/**
 * One registry request. `retry` is true only for a failure that says nothing
 * about the document — a network error, a deadline, or a 5xx. A 404, any other
 * 4xx, and a document that does not describe the version are answers, and an
 * answer is never asked again.
 * @param {string} url - The exact-version registry URL.
 * @param {string} version - The version the document must describe.
 * @param {typeof fetch} fetchImpl - The fetch seam.
 * @param {number} timeoutMs - The per-request deadline.
 * @returns {Promise<{integrity: string | null, detail: string, retry: boolean}>} The answer.
 */
async function requestIntegrity(url, version, fetchImpl, timeoutMs) {
  try {
    const response = await fetchImpl(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      return {
        integrity: null,
        detail: `HTTP ${response.status} from ${url}`,
        retry: response.status >= 500,
      };
    }
    const body = await response.json();
    const integrity = body?.dist?.integrity;
    if (body?.version !== version || typeof integrity !== "string") {
      return {
        integrity: null,
        detail: `${url} did not describe ${version} with a dist.integrity`,
        retry: false,
      };
    }
    return { integrity, detail: "ok", retry: false };
  } catch (error) {
    return { integrity: null, detail: `${url}: ${error.message}`, retry: true };
  }
}

/**
 * Ask the registry for the published tarball's integrity, failing closed.
 *
 * A transient failure (network error, deadline, 5xx) is retried a bounded
 * number of times; when every attempt fails the answer is still `null`, so the
 * push is refused. A 404 or a wrong document is returned at once.
 * @param {object} options - Version, registry, fetch seam, deadline, attempts and sleep seam.
 * @returns {Promise<{integrity: string | null, detail: string}>} The answer.
 */
export async function fetchRegistryIntegrity({
  version,
  registry = DEFAULT_REGISTRY,
  fetchImpl = fetch,
  timeoutMs = REGISTRY_TIMEOUT_MS,
  attempts = REGISTRY_ATTEMPTS,
  sleep = milliseconds =>
    new Promise(resolve => {
      setTimeout(resolve, milliseconds);
    }),
}) {
  const url = `${registry}/${SELF_PACKAGE}/${version}`;
  const attempt = async number => {
    const answer = await requestIntegrity(url, version, fetchImpl, timeoutMs);
    if (!answer.retry || number >= attempts) {
      const suffix =
        answer.retry && attempts > 1 ? ` (after ${attempts} attempts)` : "";
      return {
        integrity: answer.integrity,
        detail: `${answer.detail}${suffix}`,
      };
    }
    await sleep(number * REGISTRY_RETRY_DELAY_MS);
    return attempt(number + 1);
  };
  return attempt(1);
}

/**
 * Print a verdict line and turn it into an exit code.
 * @param {{ok: boolean, detail: string}} verdict - The verdict.
 * @returns {number} 0 only for ok.
 */
function report(verdict) {
  process.stdout.write(
    `${VERDICT_PREFIX} ${verdict.ok ? "ok" : "refused"} — ${verdict.detail}\n`
  );
  return verdict.ok ? 0 : 1;
}

/**
 * Return a required CLI option.
 * @param {string[]} argv - Arguments after the script path.
 * @param {string} name - Option name, `--` included.
 * @returns {string | undefined} The option's value.
 */
function option(argv, name) {
  const index = argv.indexOf(name);
  const value = index === -1 ? undefined : argv[index + 1];
  return value === undefined || value.startsWith("--") ? undefined : value;
}

/**
 * Run the verification for a workflow step.
 * @param {string[]} argv - `--base <file> --candidate <file> --version <v>`.
 * @returns {number} Process exit code: 0 only for a proven one-line raise.
 */
export function main(argv) {
  const base = option(argv, "--base");
  const candidate = option(argv, "--candidate");
  const version = option(argv, "--version");
  if (base === undefined || candidate === undefined || version === undefined) {
    process.stderr.write(
      "❌ usage: verify-self-pin-raise.mjs --base <file> --candidate <file> --version <version>\n"
    );
    return 1;
  }
  return report(
    verifySelfPinRaise(
      readFileSync(base, "utf8"),
      readFileSync(candidate, "utf8"),
      version
    )
  );
}

/**
 * Run the lockfile verification for a workflow step.
 * @param {string[]} argv - `--regenerated <file> --candidate <file> --version <v>`.
 * @param {object} [injected] - Test seams forwarded to {@link fetchRegistryIntegrity}.
 * @returns {Promise<number>} Process exit code: 0 only when both checks pass.
 */
export async function mainLockfile(argv, injected = {}) {
  const regenerated = option(argv, "--regenerated");
  const candidate = option(argv, "--candidate");
  const version = option(argv, "--version");
  if (
    regenerated === undefined ||
    candidate === undefined ||
    version === undefined ||
    !RELEASE_VERSION.test(version)
  ) {
    process.stderr.write(
      "❌ usage: verify-self-pin-raise.mjs lockfile --regenerated <file> --candidate <file> --version <release version>\n"
    );
    return 1;
  }
  const regeneratedText = readFileSync(regenerated, "utf8");
  const match = verifyLockfileMatch(
    regeneratedText,
    readFileSync(candidate, "utf8")
  );
  if (!match.ok) return report(match);
  const registry = option(argv, "--registry") ?? DEFAULT_REGISTRY;
  const answer = await fetchRegistryIntegrity({
    version,
    registry,
    ...injected,
  });
  if (answer.integrity === null) {
    return report({
      ok: false,
      detail: `could not read the registry's integrity, so nothing is pushed: ${answer.detail}`,
    });
  }
  return report(
    verifySelfLockEntry(regeneratedText, version, answer.integrity)
  );
}

/**
 * Switch the pin between exact and caret for a workflow step, in place.
 * @param {string[]} argv - `--form exact|caret --version <v> [--manifest <file>] [--lockfile <file>]`.
 * @returns {number} Process exit code: 0 only when the switch was written.
 */
export function mainSpec(argv) {
  const form = option(argv, "--form");
  const version = option(argv, "--version");
  if (form === undefined || version === undefined) {
    process.stderr.write(
      "❌ usage: verify-self-pin-raise.mjs spec --form exact|caret --version <version> [--manifest <file>] [--lockfile <file>]\n"
    );
    return 1;
  }
  const manifest = option(argv, "--manifest") ?? "package.json";
  const lockfile = option(argv, "--lockfile") ?? "bun.lock";
  const result = setSelfSpec({
    manifestText: readFileSync(manifest, "utf8"),
    lockText: readFileSync(lockfile, "utf8"),
    version,
    form,
  });
  if (result.ok) {
    writeFileSync(manifest, result.manifestText);
    writeFileSync(lockfile, result.lockText);
  }
  return report(result);
}

/* c8 ignore start -- CLI wiring, exercised through main() in tests */
if (invokedAsScript(import.meta.url)) {
  try {
    const argv = process.argv.slice(2);
    if (argv[0] === "spec") {
      process.exitCode = mainSpec(argv.slice(1));
    } else if (argv[0] === "lockfile") {
      mainLockfile(argv.slice(1))
        .then(code => {
          process.exitCode = code;
        })
        .catch(error => {
          process.stderr.write(`❌ ${error.message}\n`);
          process.exitCode = 1;
        });
    } else {
      process.exitCode = main(argv);
    }
  } catch (error) {
    process.stderr.write(`❌ ${error.message}\n`);
    process.exitCode = 1;
  }
}
/* c8 ignore stop */

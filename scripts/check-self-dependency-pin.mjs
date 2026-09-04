#!/usr/bin/env node
/**
 * Report when Lisa's own `@codyswann/lisa` pin has stopped tracking the
 * package it pins (CodySwannGT/lisa#3768).
 *
 * ## The hole this fills
 *
 * `lisa apply` rewrites a stale `@codyswann/lisa` pin in every host
 * repository. It deliberately does not do so here: applying to a manifest whose
 * own `name` is `@codyswann/lisa` is restricted to security pins, so the
 * self-pin phase never runs. That exemption is right — a package should not
 * acquire a dependency on a published copy of itself as a side effect of
 * applying to itself — and it has a consequence nobody wrote down: **the one
 * repository whose pin no automation will ever correct is the one that ships
 * the automation.**
 *
 * The result was measured twice. #2279 (2026-08-04) moved the floor to
 * `^2.328.0` because it was 130 releases behind. #3662 (2026-09-03) moved it
 * off that same `^2.328.0`, by then two majors behind, after drifting for about
 * a month with nothing reporting it. Both fixes were bumps by a human who
 * happened to read a version string. This is the thing that reads it instead.
 *
 * It is not cosmetic. A stale self-pin held `push-collects-integration-tree-once`
 * green for a month: the 2.328.0 work-item gate tolerated running outside a git
 * repository and 4.33+ does not, so the old fixture was the only reason that
 * test passed (#3662).
 *
 * ## The threshold, and why it needs no tuning
 *
 * **The declared range must admit the newest installable release.** A caret
 * floor that can no longer resolve the current release has, by construction,
 * stopped tracking — no distance to agree on, no knob to set loose. That is
 * exactly the state both #2279 and #3662 found, and it is the first moment the
 * pin becomes incapable of following on its own.
 *
 * ## Which surface, stated rather than assumed
 *
 * Three surfaces disagree about which version of Lisa is in force and only one
 * of them answers "what can a consumer install": a running session executes a
 * version-pinned plugin cache (observed on `4.32.2` while npm was on
 * `4.33.14`), the marketplace clone is a third answer again, and the registry
 * is the fourth. This check compares against **the npm registry, and says so in
 * its verdict line** — the plugin cache and the marketplace clone are never
 * consulted, because neither is what `bun install` resolves.
 *
 * ## A version existing is not a version being installable
 *
 * `v4.33.7` was tagged, GitHub-released and provenance-attested and never
 * reached npm (#3684) — the only gap in eleven consecutive tags. A pin can
 * therefore be "behind" something no consumer can resolve. The packument's
 * `versions` map contains only what was published, so such a version is absent
 * by construction; on top of that the newest candidate is confirmed through the
 * shipped exact-version prover before it is used as the yardstick, and a
 * candidate the registry 404s is dropped in favour of the next one rather than
 * treated as a gap in the check.
 *
 * ## Which tree, stated because two now exist
 *
 * This reads the **declared spec in the root `package.json`** and nothing else.
 * It is deliberately not a lockfile audit: `bun.lock` carries a NESTED
 * `@codyswann/lisa` subtree — its own `fs-extra` and `semver` resolve at
 * versions the root does not — so "what is installed" has more than one answer
 * here while "what is declared" has exactly one. The declared floor is what
 * rotted twice and what a human had to read, so that is the thing watched. A
 * nested tree diverging from the root is a different property with a different
 * prover (`check-duplicate-versions.mjs`, `check-security-floors.mjs`), and
 * conflating them would produce a check that answers neither question cleanly.
 * @module scripts/check-self-dependency-pin
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import semver from "semver";

import { verifyPublish } from "../all/copy-overwrite/scripts/check-npm-publish-landed.mjs";
import { invokedAsScript } from "./lib/invoked-as-script.mjs";

/** The package whose pin this checks — this repository's own name. */
export const SELF_PACKAGE = "@codyswann/lisa";

/** Public npm registry: the surface a consumer's install actually reads. */
const DEFAULT_REGISTRY = "https://registry.npmjs.org";

/** Sections a self-pin may legitimately live in, most specific first. */
const PIN_SECTIONS = ["dependencies", "devDependencies"];

/** The line a caller greps for. Never printed without a real verdict behind it. */
const VERDICT_PREFIX = "self-dependency-pin:";

/**
 * How many published versions to confirm before giving up.
 *
 * Bounded on purpose: #3684 was one skipped version, not a run of them, and a
 * check that walked backwards indefinitely would quietly convert a broken
 * registry into a green pass against an ancient release.
 */
const MAX_CANDIDATES = 5;

/** Specs naming a LOCATION rather than a registry version. */
const NON_REGISTRY_SPEC =
  /^(?:file|link|portal|workspace|git|git\+[a-z]+|github|https?|npm):/i;

/**
 * Where this manifest declares its self-pin, and what it says.
 * @param {Record<string, unknown>} manifest - Parsed package.json.
 * @returns {{section: string, spec: string} | null} The declaration, or null.
 */
export function locateSelfPin(manifest) {
  const found = PIN_SECTIONS.map(section => ({
    section,
    spec: manifest?.[section]?.[SELF_PACKAGE],
  })).find(entry => typeof entry.spec === "string");
  return found === undefined ? null : found;
}

/**
 * Published, non-prerelease versions, newest first.
 *
 * Read off the packument's `versions` map, which is the set the registry will
 * actually serve — a tagged-but-unpublished version never appears in it, which
 * is why the #3684 shape cannot reach the comparison at all.
 * @param {Record<string, unknown>} packument - Parsed packument document.
 * @returns {string[]} Versions in descending semver order.
 */
export function publishedVersionsDescending(packument) {
  return Object.keys(packument?.versions ?? {})
    .filter(version => semver.valid(version) !== null)
    .filter(version => semver.prerelease(version) === null)
    .sort(semver.rcompare);
}

/**
 * Compare one declared spec against one installable version.
 * @param {string} spec - The spec the manifest declares.
 * @param {string} newest - Newest installable version.
 * @returns {{verdict: string, detail: string}} The comparison's outcome.
 */
export function compareSpec(spec, newest) {
  if (NON_REGISTRY_SPEC.test(spec)) {
    return {
      verdict: "local-checkout",
      detail: `the spec "${spec}" names a location, not a release, so there is no registry version for it to fall behind`,
    };
  }
  if (semver.validRange(spec) === null) {
    return { verdict: "unprovable", detail: `"${spec}" is not a valid range` };
  }
  if (semver.satisfies(newest, spec)) {
    return { verdict: "current", detail: `${spec} still admits ${newest}` };
  }
  const floor = semver.minVersion(spec);
  const majors = floor === null ? "?" : semver.major(newest) - floor.major;
  return {
    verdict: "stale",
    detail: `${spec} cannot resolve ${newest} — ${majors} major(s) behind`,
  };
}

/**
 * One packument read.
 * @param {string} url - The packument URL.
 * @param {typeof fetch} fetchImpl - Injected for tests.
 * @returns {Promise<{packument: object | null, detail: string}>} The outcome.
 */
async function readPackumentOnce(url, fetchImpl) {
  try {
    const response = await fetchImpl(url, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      return { packument: null, detail: `HTTP ${response.status} from ${url}` };
    }
    return { packument: await response.json(), detail: "ok" };
  } catch (error) {
    return { packument: null, detail: `network: ${error.message} (${url})` };
  }
}

/**
 * Ask the registry for the packument, retrying transport failures.
 * @param {object} options - Registry, package, fetch seam and retry budget.
 * @returns {Promise<{packument: object | null, detail: string}>} The document.
 */
async function fetchPackument({
  registry,
  packageName,
  fetchImpl,
  attempts,
  sleep,
}) {
  const url = `${registry}/${packageName}`;
  const tries = Array.from({ length: attempts }, (_unused, index) => index);
  return tries.reduce(
    async (previous, index) => {
      const settled = await previous;
      if (settled.packument !== null) return settled;
      if (index > 0) await sleep();
      return readPackumentOnce(url, fetchImpl);
    },
    Promise.resolve({ packument: null, detail: "no attempt was made" })
  );
}

/**
 * Confirm one candidate through the shipped exact-version prover.
 * @param {object} options - Candidate, registry and the prover's seams.
 * @returns {Promise<{version: string | null, detail: string, halt: boolean}>} Outcome.
 */
async function confirmCandidate({ version, registry, injected }) {
  const proof = await verifyPublish({
    packageName: SELF_PACKAGE,
    version,
    registry,
    attempts: 2,
    delayMs: 0,
    ...injected,
  });
  if (proof.verdict === "published") {
    return { version, detail: proof.detail, halt: true };
  }
  // `missing` is the #3684 shape — a version that exists everywhere except the
  // registry. It is dropped in favour of the next candidate. `unprovable` is a
  // registry that could not answer, which stops the walk rather than sliding
  // the yardstick backwards to a version chosen by a network fault.
  return {
    version: null,
    detail:
      proof.verdict === "missing"
        ? `${version} is listed in the packument but the registry 404s it`
        : `${version}: ${proof.detail}`,
    halt: proof.verdict === "unprovable",
  };
}

/**
 * The newest version the registry will actually serve.
 * @param {object} options - Candidates, registry and the prover's seams.
 * @returns {Promise<{version: string | null, detail: string}>} The yardstick.
 */
async function newestInstallable({ candidates, registry, injected }) {
  if (candidates.length === 0) {
    return {
      version: null,
      detail: "the packument listed no published version",
    };
  }
  return candidates.slice(0, MAX_CANDIDATES).reduce(
    async (previous, version) => {
      const settled = await previous;
      if (settled.halt) return settled;
      return confirmCandidate({ version, registry, injected });
    },
    Promise.resolve({
      version: null,
      detail: "no candidate was confirmed",
      halt: false,
    })
  );
}

/**
 * Decide the verdict for one manifest.
 * @param {object} options - Manifest, registry origin and injected seams.
 * @returns {Promise<{verdict: string, detail: string, newest: string | null, spec: string | null}>} Outcome.
 */
export async function checkSelfPin({
  manifest,
  registry = DEFAULT_REGISTRY,
  fetchImpl = fetch,
  attempts = 3,
  sleep = () => new Promise(resolve => setTimeout(resolve, 2000)),
  injected = {},
}) {
  const declared = locateSelfPin(manifest);
  if (declared === null) {
    return {
      verdict: "no-pin",
      detail: `this manifest declares no ${SELF_PACKAGE} dependency, so there is no pin to keep fresh`,
      newest: null,
      spec: null,
    };
  }
  const { packument, detail } = await fetchPackument({
    registry,
    packageName: SELF_PACKAGE,
    fetchImpl,
    attempts,
    sleep,
  });
  if (packument === null) {
    return { verdict: "unprovable", detail, newest: null, spec: declared.spec };
  }
  const found = await newestInstallable({
    candidates: publishedVersionsDescending(packument),
    registry,
    injected: { fetchImpl, ...injected },
  });
  if (found.version === null) {
    return {
      verdict: "unprovable",
      detail: found.detail,
      newest: null,
      spec: declared.spec,
    };
  }
  return {
    ...compareSpec(declared.spec, found.version),
    newest: found.version,
    spec: declared.spec,
  };
}

/** Exit code for each verdict. `unprovable` blocks: nothing was proved. */
const FAILING_VERDICTS = new Set(["stale", "unprovable"]);

/**
 * The default manifest: this repository's own package.json.
 * @returns {string} Absolute path.
 */
function defaultManifestPath() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.join(here, "..", "package.json");
}

/**
 * Return an optional CLI option.
 * @param {string[]} argv - Arguments after the script path.
 * @param {string} name - Option name, `--` included.
 * @param {string} fallback - Value when the option is absent.
 * @returns {string} The option's value.
 */
function option(argv, name, fallback) {
  const index = argv.indexOf(name);
  const value = index === -1 ? undefined : argv[index + 1];
  return value === undefined || value.startsWith("--") ? fallback : value;
}

/**
 * Render the failing verdicts, which is where the reader needs the detail.
 * @param {{verdict: string, detail: string, spec: string | null}} outcome - Result.
 * @param {string} registry - The surface that was compared against.
 * @returns {string} Text for stderr.
 */
function failureReport(outcome, registry) {
  if (outcome.verdict === "stale") {
    return (
      `❌ ${SELF_PACKAGE} is pinned at "${outcome.spec}" and ${outcome.detail}.\n` +
      `   Compared against ${registry} — NOT the session plugin cache and NOT\n` +
      `   the marketplace clone, both of which can name a different version.\n` +
      `   Nothing corrects this pin automatically: apply skips the self-pin\n` +
      `   phase on Lisa's own manifest (#3768). Raise the floor by hand.\n`
    );
  }
  return (
    `❌ Could not prove ${SELF_PACKAGE}'s pin is current: ${outcome.detail}.\n` +
    `   This is not a pass — nothing was measured, so it blocks rather than\n` +
    `   reporting a verdict it does not have.\n`
  );
}

/**
 * Run the check for a caller that is a workflow step.
 * @param {string[]} argv - Arguments after the script path.
 * @param {object} [injected] - Test seams forwarded to {@link checkSelfPin}.
 * @returns {Promise<number>} Process exit code.
 */
export async function main(argv, injected = {}) {
  const registry = option(argv, "--registry", DEFAULT_REGISTRY);
  const manifestPath = option(argv, "--manifest", defaultManifestPath());
  const outcome = await checkSelfPin({
    manifest: JSON.parse(readFileSync(manifestPath, "utf8")),
    registry,
    ...injected,
  });
  process.stdout.write(
    `${VERDICT_PREFIX} ${outcome.verdict} package=${SELF_PACKAGE} ` +
      `declared=${outcome.spec ?? "none"} newest-installable=${outcome.newest ?? "unknown"} ` +
      `surface=npm-registry:${registry}\n`
  );
  if (!FAILING_VERDICTS.has(outcome.verdict)) {
    process.stdout.write(`✅ ${outcome.detail}.\n`);
    return 0;
  }
  process.stderr.write(failureReport(outcome, registry));
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

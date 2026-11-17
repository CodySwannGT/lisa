#!/usr/bin/env node
/**
 * Raise Lisa's own `@codyswann/lisa` pin when a release leaves it behind
 * (CodySwannGT/lisa#4951).
 *
 * ## Why this exists beside the check
 *
 * `check-self-dependency-pin.mjs` (#3768) reports a self-pin that can no longer
 * resolve the newest release, and it is wired into a required status check. On
 * its own that turned every major release into a red required check on every
 * open pull request until somebody raised the floor by hand — 6.0.0 did exactly
 * that. A report whose only remedy is a person is half a control.
 *
 * This is the other half. The release workflow runs it right after the publish
 * lands, with the version it just published, and pushes the result to `main`
 * with the same deploy key the release commit itself uses. The check and this
 * script share one definition of "stale" (`compareSpec`), so the script raises
 * the floor in exactly the cases the check fails on and in no others: a release
 * the declared range already admits changes nothing, which is also what keeps
 * the bump from chasing its own releases.
 *
 * ## Why it rewrites the manifest itself instead of calling `bun add`
 *
 * `bun add` re-sorts the whole dependency section, turning a one-line pin raise
 * into a diff that touches unrelated lines. Parsing and re-serialising with the
 * repository's own two-space format keeps key order and changes one value.
 * @module scripts/raise-self-dependency-pin
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import semver from "semver";

import {
  compareSpec,
  locateSelfPin,
  SELF_PACKAGE,
} from "./check-self-dependency-pin.mjs";
import { invokedAsScript } from "./lib/invoked-as-script.mjs";

/** The line a caller greps for. */
const VERDICT_PREFIX = "raise-self-dependency-pin:";

/**
 * Decide what the manifest's self-pin should become for one published version.
 * @param {Record<string, unknown>} manifest - Parsed package.json.
 * @param {string} version - The version the release just published.
 * @returns {{verdict: "raised" | "current" | "local-checkout" | "unprovable" | "no-pin", detail: string, manifest: Record<string, unknown>}} Outcome and the manifest to write.
 */
export function raiseSelfPin(manifest, version) {
  if (semver.valid(version) === null || semver.prerelease(version) !== null) {
    throw new Error(
      `"${version}" is not a published release version; refusing to pin to it`
    );
  }
  const declared = locateSelfPin(manifest);
  if (declared === null) {
    return {
      verdict: "no-pin",
      detail: `this manifest declares no ${SELF_PACKAGE} dependency`,
      manifest,
    };
  }
  const { verdict, detail } = compareSpec(declared.spec, version);
  if (verdict !== "stale") {
    return { verdict, detail, manifest };
  }
  const raised = `^${version}`;
  return {
    verdict: "raised",
    detail: `${declared.section}["${SELF_PACKAGE}"] ${declared.spec} → ${raised}`,
    manifest: {
      ...manifest,
      [declared.section]: {
        ...manifest[declared.section],
        [SELF_PACKAGE]: raised,
      },
    },
  };
}

/**
 * Return an optional CLI option.
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
 * The default manifest: this repository's own package.json.
 * @returns {string} Absolute path.
 */
function defaultManifestPath() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.join(here, "..", "package.json");
}

/**
 * Run the raise for a caller that is a workflow step.
 *
 * Exit 0 for `raised`, `current`, `local-checkout` and `no-pin` — the same
 * verdicts the check passes — and the workflow commits only on `raised`. Exit 1
 * on `unprovable` (a spec that is not a valid range), because the check fails
 * on it too and leaving it alone silently would hand the next pull request a
 * red check.
 * @param {string[]} argv - Arguments after the script path.
 * @returns {number} Process exit code.
 */
export function main(argv) {
  const version = option(argv, "--version");
  if (version === undefined) {
    process.stderr.write("❌ --version <published version> is required\n");
    return 1;
  }
  const manifestPath = option(argv, "--manifest") ?? defaultManifestPath();
  const outcome = raiseSelfPin(
    JSON.parse(readFileSync(manifestPath, "utf8")),
    version
  );
  if (outcome.verdict === "raised") {
    writeFileSync(
      manifestPath,
      `${JSON.stringify(outcome.manifest, null, 2)}\n`
    );
  }
  process.stdout.write(
    `${VERDICT_PREFIX} ${outcome.verdict} package=${SELF_PACKAGE} published=${version} — ${outcome.detail}\n`
  );
  return outcome.verdict === "unprovable" ? 1 : 0;
}

/* c8 ignore start -- CLI wiring, exercised through main() in tests */
if (invokedAsScript(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`❌ ${error.message}\n`);
    process.exitCode = 1;
  }
}
/* c8 ignore stop */

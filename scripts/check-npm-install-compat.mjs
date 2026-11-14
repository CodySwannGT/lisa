#!/usr/bin/env node
/**
 * Prove the packed `@codyswann/lisa` tarball installs under every npm version
 * a host may run (CodySwannGT/lisa#4871).
 *
 * Measured defect: a plain `npm install @codyswann/lisa` under npm 10.9.9
 * crashed with `Cannot read properties of null (reading 'edgesOut')`. npm 10's
 * arborist resolves peer dependencies in a scratch tree that ignores the
 * installing package's own pins; a Vitest 4 dependency reached Vitest 5 there
 * through vite's optional devtools peer chain, a Vitest 4 browser package then
 * orphaned that node, and arborist dereferenced its null parent. npm 11 handles
 * the same graph, so a check run only under npm 11 would never have seen it.
 *
 * The check installs the real tarball into a fresh empty directory once per
 * npm version and refuses on any signal that the install did not happen as
 * claimed, because each alone has a gap:
 * - the npm that ran is not the npm requested (a silent fallback to the
 *   runner's own npm would test the wrong resolver);
 * - a non-zero exit, or a spawn that never produced one;
 * - the `edgesOut` crash text, in case a future npm logs it without failing;
 * - no installed manifest, or one whose version is not the tarball's (an exit
 *   0 that installed nothing, or something else, is not this install).
 *
 * Usage: `node scripts/check-npm-install-compat.mjs [--tarball <tgz>]
 * [--npm 10.9.9,11.6.2]`. With no tarball the repository is packed with
 * `npm pack --ignore-scripts` into a temporary directory.
 * @module scripts/check-npm-install-compat
 */
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { boundedSpawnSync } from "./lib/bounded-spawn.mjs";
import { invokedAsScript } from "./lib/invoked-as-script.mjs";

/** npm versions every Lisa release must install under. */
export const DEFAULT_NPM_VERSIONS = Object.freeze(["10.9.9", "11.6.2"]);

/** The crash signature of npm 10's arborist peer-set defect. */
const CRASH_SIGNATURE = "edgesOut";

/** Installed manifest whose presence proves the install placed Lisa. */
const INSTALLED_MANIFEST = "node_modules/@codyswann/lisa/package.json";

/** A cold install of Lisa's dependency tree takes minutes, not seconds. */
const INSTALL_BUDGET_MS = 15 * 60_000;

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

/**
 * Read one CLI option's value, refusing a flag left without one.
 * @param {readonly string[]} argv - CLI arguments
 * @param {string} name - Flag name
 * @returns {string | undefined} The value, or undefined when absent
 */
function optionValue(argv, name) {
  const index = argv.indexOf(name);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} needs a value`);
  }
  return value;
}

/**
 * Parse the CLI arguments.
 * @param {readonly string[]} argv - CLI arguments
 * @returns {{tarball: string | undefined, npmVersions: string[]}} Options
 */
export function parseArgs(argv) {
  const versions = optionValue(argv, "--npm");
  const npmVersions =
    versions === undefined
      ? [...DEFAULT_NPM_VERSIONS]
      : versions
          .split(",")
          .map(version => version.trim())
          .filter(Boolean);
  if (npmVersions.length === 0) {
    // An empty list would check nothing and report success.
    throw new Error("--npm needs at least one version");
  }
  return { tarball: optionValue(argv, "--tarball"), npmVersions };
}

/**
 * The most useful npm error line in an install transcript.
 * @param {string} output - Combined install stdout and stderr
 * @returns {string} The crash line, else the first `npm error` line, else ""
 */
function errorLine(output) {
  const lines = output.split("\n").map(line => line.trim());
  return (
    lines.find(line => line.includes(CRASH_SIGNATURE)) ??
    lines.find(line => line.startsWith("npm error")) ??
    ""
  );
}

/**
 * @typedef {object} InstallOutcome
 * @property {string} npmReported - What `npm --version` printed for the npx-run npm
 * @property {number | null} status - Install exit status; null when spawn failed
 * @property {string} output - Combined install stdout and stderr
 * @property {string} [error] - Spawn error message, when the child never ran
 * @property {string | null} installedVersion - Installed Lisa version, or null when absent
 */

/**
 * Ordered refusal rules; the first that returns a reason decides.
 * @type {readonly ((expected: {npmVersion: string, packageVersion: string}, outcome: InstallOutcome) => string)[]}
 */
const RULES = Object.freeze([
  (expected, outcome) =>
    outcome.npmReported === expected.npmVersion
      ? ""
      : `npx ran npm ${outcome.npmReported || "(nothing)"}, not the requested npm ${expected.npmVersion}`,
  (_expected, outcome) => {
    if (outcome.status === 0) return "";
    const quoted = errorLine(outcome.output) || outcome.error;
    const detail = [`npm install exited ${outcome.status}`, quoted];
    return detail.filter(Boolean).join(": ");
  },
  (_expected, outcome) =>
    outcome.output.includes(CRASH_SIGNATURE)
      ? `install output contains "${CRASH_SIGNATURE}": ${errorLine(outcome.output)}`
      : "",
  (_expected, outcome) =>
    outcome.installedVersion === null
      ? `install exited 0 but ${INSTALLED_MANIFEST} is missing`
      : "",
  (expected, outcome) =>
    outcome.installedVersion === expected.packageVersion
      ? ""
      : `installed @codyswann/lisa ${outcome.installedVersion}, but the tarball is ${expected.packageVersion}`,
]);

/**
 * Decide whether one install proves compatibility.
 * @param {{npmVersion: string, packageVersion: string}} expected - Requested npm and the tarball's version
 * @param {InstallOutcome} outcome - What the install did
 * @returns {{npmVersion: string, ok: boolean, reason: string}} Verdict
 */
export function evaluateInstall(expected, outcome) {
  const reason = RULES.map(rule => rule(expected, outcome)).find(Boolean) ?? "";
  return { npmVersion: expected.npmVersion, ok: reason === "", reason };
}

/**
 * Install the tarball under each npm version and judge each install.
 * @param {{tarball: string, packageVersion: string}} candidate - Tarball and its version
 * @param {readonly string[]} npmVersions - npm versions to try
 * @param {(tarball: string, npmVersion: string) => InstallOutcome} install - Installer
 * @returns {{npmVersion: string, ok: boolean, reason: string}[]} Verdicts
 */
export function runChecks(candidate, npmVersions, install) {
  return npmVersions.map(npmVersion =>
    evaluateInstall(
      { npmVersion, packageVersion: candidate.packageVersion },
      install(candidate.tarball, npmVersion)
    )
  );
}

/**
 * Render verdicts for an operator.
 * @param {readonly {npmVersion: string, ok: boolean, reason: string}[]} results - Verdicts
 * @returns {string} One line per npm version, plus a summary
 */
export function formatReport(results) {
  const lines = results.map(result =>
    result.ok
      ? `PASS npm ${result.npmVersion}: @codyswann/lisa installed\n`
      : `FAIL npm ${result.npmVersion}: ${result.reason}\n`
  );
  const failed = results.filter(result => !result.ok).length;
  const summary =
    failed === 0
      ? "Lisa installs cleanly under every checked npm version.\n"
      : `Lisa does not install under ${failed} of ${results.length} npm version(s). A host on that npm cannot install Lisa; fix the published dependency graph before release.\n`;
  return [...lines, summary].join("");
}

/**
 * Run `npx -y npm@<version>` with arguments in a directory.
 * @param {string} directory - Working directory
 * @param {string} npmVersion - npm version npx should fetch
 * @param {readonly string[]} args - npm arguments
 * @returns {import("node:child_process").SpawnSyncReturns<string>} Result
 */
function npx(directory, npmVersion, args) {
  return boundedSpawnSync("npx", ["-y", `npm@${npmVersion}`, ...args], {
    cwd: directory,
    encoding: "utf8",
    timeout: INSTALL_BUDGET_MS,
  });
}

/**
 * Read the installed Lisa version, if any.
 * @param {string} directory - Install directory
 * @returns {string | null} Installed version, or null when not installed
 */
function installedVersionIn(directory) {
  const manifest = path.join(directory, INSTALLED_MANIFEST);
  if (!existsSync(manifest)) return null;
  return JSON.parse(readFileSync(manifest, "utf8")).version ?? "";
}

/**
 * Install a tarball into a fresh empty directory with one npm version.
 * @param {string} tarball - Packed tarball path
 * @param {string} npmVersion - npm version to run through npx
 * @returns {InstallOutcome} Outcome
 */
function installWithNpm(tarball, npmVersion) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "lisa-npm-compat-"));
  try {
    const reported = npx(directory, npmVersion, ["--version"]);
    const result = npx(directory, npmVersion, [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      tarball,
    ]);
    return {
      npmReported: (reported.stdout ?? "").trim(),
      status: result.status,
      output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
      error: result.error?.message,
      installedVersion: installedVersionIn(directory),
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/**
 * Read the version a packed tarball declares.
 * @param {string} tarball - Packed tarball path
 * @returns {string} The tarball's package.json version
 */
function tarballVersion(tarball) {
  const result = boundedSpawnSync(
    "tar",
    ["-xOzf", tarball, "package/package.json"],
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }
  );
  if (result.status !== 0) {
    throw new Error(`cannot read package.json from ${tarball}`);
  }
  return JSON.parse(result.stdout).version;
}

/**
 * Pack this repository into a temporary directory.
 * @returns {string} Path of the packed tarball
 */
function packRepository() {
  const destination = mkdtempSync(path.join(os.tmpdir(), "lisa-npm-pack-"));
  const result = boundedSpawnSync(
    "npm",
    ["pack", "--ignore-scripts", "--pack-destination", destination],
    { cwd: REPO_ROOT, encoding: "utf8", timeout: INSTALL_BUDGET_MS }
  );
  const tarball = readdirSync(destination).find(name => name.endsWith(".tgz"));
  if (result.status !== 0 || !tarball) {
    throw new Error(`npm pack failed: ${result.stderr ?? ""}`.trim());
  }
  return path.join(destination, tarball);
}

/**
 * Run the check.
 * @param {readonly string[]} argv - CLI arguments
 * @param {{install?: typeof installWithNpm, pack?: () => string, readVersion?: (tarball: string) => string, write?: (text: string) => void}} [deps] - Injected effects
 * @returns {number} Process exit code
 */
export function main(argv, deps = {}) {
  const {
    install = installWithNpm,
    pack = packRepository,
    readVersion = tarballVersion,
    write = text => process.stdout.write(text),
  } = deps;
  const options = parseArgs(argv);
  const tarball = options.tarball ?? pack();
  const candidate = { tarball, packageVersion: readVersion(tarball) };
  const results = runChecks(candidate, options.npmVersions, install);
  write(formatReport(results));
  return results.every(result => result.ok) ? 0 : 1;
}

if (invokedAsScript(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`check-npm-install-compat: ${error.message}\n`);
    process.exitCode = 1;
  }
}

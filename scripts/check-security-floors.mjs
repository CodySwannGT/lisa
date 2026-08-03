#!/usr/bin/env node
/**
 * Verify no force-pinned version floor permits a known-vulnerable release.
 *
 * A floor in a `force` section does not merely fail to protect when it goes
 * stale — it OVERWRITES whatever the downstream project had. A project that
 * pinned correctly gets moved back onto the vulnerable range by `lisa apply`,
 * silently, and the only signal is a suspicious line in a diff nobody is
 * looking for. That is how `brace-expansion >=5.0.7` survived: it was written
 * to match GHSA-3jxr-9vmj-r5cp, whose first_patched_version genuinely is
 * 5.0.7, and GHSA-mh99-v99m-4gvg later moved the floor to 5.0.8.
 *
 * The floors are therefore checked against the advisory database rather than
 * against what npm happens to resolve. Resolution drifts as new advisories
 * land; `first_patched_version` does not. Deriving floors from resolution is
 * the specific mistake this exists to catch — it produced the same defect
 * three times (fast-uri, js-yaml, and the three fixed in #2168).
 *
 * Usage:
 *   check-security-floors.mjs [--strict] [--json]
 *
 * Exits non-zero only with --strict, so the job can report before it gates.
 * @module scripts/check-security-floors
 */

import { readFileSync } from "node:fs";
import { globSync } from "node:fs";

/** Sections whose entries are version constraints worth checking. */
const CONSTRAINT_SECTIONS = [
  "overrides",
  "resolutions",
  "dependencies",
  "devDependencies",
  "peerDependencies",
];

/** Governance groups in a package.lisa.json. */
const GOVERNANCE_GROUPS = ["force", "defaults", "merge"];

/** Severities that gate. Medium and low advisories are ignored by this check. */
const GATING_SEVERITIES = new Set(["high", "critical"]);

const ADVISORY_ENDPOINT = "https://api.github.com/advisories";

/**
 * Every version constraint declared across the template manifests.
 * @returns {Map<string, Array<{file: string, path: string, spec: string}>>} By package name.
 */
function collectFloors() {
  const found = new Map();
  const files = globSync("*/package-lisa/package.lisa.json").filter(
    file => !file.includes("node_modules") && !file.includes(".worktrees")
  );
  for (const file of files) {
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(file, "utf8"));
    } catch (error) {
      throw new Error(`${file} is not valid JSON: ${error.message}`);
    }
    for (const group of GOVERNANCE_GROUPS) {
      const block = manifest[group];
      if (!block || typeof block !== "object") continue;
      for (const section of CONSTRAINT_SECTIONS) {
        const entries = block[section];
        if (!entries || typeof entries !== "object") continue;
        for (const [name, spec] of Object.entries(entries)) {
          // `$name` self-references defer to the project's own pin and carry
          // no floor of their own; a literal like "workspace:*" likewise.
          if (typeof spec !== "string" || !/\d/.test(spec)) continue;
          if (spec.startsWith("$")) continue;
          if (!found.has(name)) found.set(name, []);
          found.get(name).push({ file, path: `${group}.${section}`, spec });
        }
      }
    }
  }
  return found;
}

/**
 * Lowest version a spec permits, as a comparable tuple.
 * @param {string} spec A range like ">=5.0.7", "^1.2.3", "~2.0.0".
 * @returns {number[]|null} [major, minor, patch], or null if unparseable.
 */
export function lowestPermitted(spec) {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(spec);
  if (!match) return null;
  return match.slice(1, 4).map(Number);
}

/**
 * Compare two version tuples.
 * @param {number[]} left First version.
 * @param {number[]} right Second version.
 * @returns {number} Negative, zero, or positive.
 */
function compare(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

/**
 * Whether a version falls inside an advisory's vulnerable range.
 * @param {number[]} version Candidate version.
 * @param {string} range e.g. ">= 4.0.0, < 5.0.8".
 * @returns {boolean} True when the version is vulnerable.
 */
export function withinRange(version, range) {
  if (!range) return false;
  let inside = true;
  for (const clause of range.split(",")) {
    const match = /(>=|<=|<|>|=)\s*(\d+)\.(\d+)\.(\d+)/.exec(clause.trim());
    if (!match) continue;
    const bound = match.slice(2, 5).map(Number);
    const delta = compare(version, bound);
    switch (match[1]) {
      case ">=":
        inside &&= delta >= 0;
        break;
      case ">":
        inside &&= delta > 0;
        break;
      case "<=":
        inside &&= delta <= 0;
        break;
      case "<":
        inside &&= delta < 0;
        break;
      default:
        inside &&= delta === 0;
    }
  }
  return inside;
}

/**
 * Advisories affecting one package.
 *
 * Distinguishes "no advisories" from "could not ask", because conflating them
 * is how a check like this goes quietly blind. The anonymous advisory limit is
 * 60 requests/hour and these manifests declare roughly 200 packages, so an
 * unauthenticated run answers for the first 60 and silently reports the other
 * 140 as clean unless the difference is tracked.
 * @param {string} name npm package name.
 * @returns {Promise<{advisories: Array}|{error: string}>} Result or reason.
 */
async function advisoriesFor(name) {
  const url = `${ADVISORY_ENDPOINT}?ecosystem=npm&affects=${encodeURIComponent(name)}&per_page=100`;
  const headers = { accept: "application/vnd.github+json" };
  // Authenticated calls get 5000/hour instead of 60. CI supplies the token via
  // the standard GITHUB_TOKEN; locally, `gh auth token` covers it.
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (token) headers.authorization = `Bearer ${token}`;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    let response;
    try {
      response = await fetch(url, { headers });
    } catch (error) {
      return { error: `network: ${error.message}` };
    }
    if (response.ok) return { advisories: await response.json() };

    const remaining = response.headers.get("x-ratelimit-remaining");
    const limited =
      response.status === 429 || (response.status === 403 && remaining === "0");
    if (!limited) return { error: `HTTP ${response.status}` };

    // Honour Retry-After when given, otherwise back off. A rate-limited run
    // cannot demonstrate anything, so it is worth waiting rather than
    // reporting a clean sheet that was never checked.
    const retryAfter = Number(response.headers.get("retry-after"));
    const waitSeconds =
      Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter, 30)
        : 2 ** attempt;
    await new Promise(resolve => setTimeout(resolve, waitSeconds * 1000));
  }
  return { error: "rate limited" };
}

/**
 * Audit every collected floor.
 * @returns {Promise<{problems: Array, unreachable: string[], checked: number}>} Findings.
 */
async function audit() {
  const floors = collectFloors();
  const problems = [];
  const unreachable = [];
  for (const [name, sites] of floors) {
    const result = await advisoriesFor(name);
    if (result.error) {
      unreachable.push({ name, reason: result.error });
      continue;
    }
    const { advisories } = result;
    for (const advisory of advisories) {
      if (!GATING_SEVERITIES.has(advisory.severity)) continue;
      for (const vulnerability of advisory.vulnerabilities ?? []) {
        if (vulnerability.package?.name !== name) continue;
        for (const site of sites) {
          const lowest = lowestPermitted(site.spec);
          if (!lowest) continue;
          if (!withinRange(lowest, vulnerability.vulnerable_version_range)) {
            continue;
          }
          problems.push({
            package: name,
            ...site,
            advisory: advisory.ghsa_id,
            severity: advisory.severity,
            vulnerableRange: vulnerability.vulnerable_version_range,
            patched: vulnerability.first_patched_version,
          });
        }
      }
    }
  }
  return { problems, unreachable, checked: floors.size };
}

async function main() {
  const strict = process.argv.includes("--strict");
  const asJson = process.argv.includes("--json");
  const { problems, unreachable, checked } = await audit();

  if (asJson) {
    console.log(JSON.stringify({ problems, unreachable, checked }, null, 2));
  } else if (problems.length === 0) {
    console.log(
      `## Security floors\n\nNo force-pinned floor permits a high or critical vulnerable release. ${checked} package(s) checked.`
    );
  } else {
    console.log("## Security floors\n");
    console.log(
      "These pins permit a release the advisory database marks vulnerable. Because they sit in governance sections, a stale floor **overwrites** a downstream project that pinned correctly.\n"
    );
    console.log("| package | pinned | permits | advisory | patched | site |");
    console.log("|---|---|---|---|---|---|");
    for (const problem of problems) {
      console.log(
        `| \`${problem.package}\` | \`${problem.spec}\` | ${problem.vulnerableRange} | ${problem.advisory} (${problem.severity}) | **${problem.patched}** | ${problem.file} ${problem.path} |`
      );
    }
    console.log(
      "\nRaise each floor to the advisory's `first_patched_version`, then confirm the new value actually resolves on npm — a floor nothing satisfies is its own breakage."
    );
  }

  if (unreachable.length > 0) {
    const limited = unreachable.filter(entry =>
      entry.reason.includes("rate limited")
    );
    console.log(
      `\n> **Inconclusive for ${unreachable.length} of ${checked} package(s).** Their floors were NOT verified — this is not a clean result for them.`
    );
    if (limited.length > 0) {
      console.log(
        "> Cause is rate limiting. The anonymous advisory limit is 60 requests/hour; set `GITHUB_TOKEN` for 5000."
      );
    }
    console.log(
      `> Affected: ${unreachable.map(entry => entry.name).join(", ")}`
    );
  }

  // Deliberately exit 0 without --strict. An advisory landing overnight would
  // otherwise fail a PR that changed nothing, and a check that cries wolf gets
  // disabled rather than fixed.
  //
  // Under --strict an inconclusive run also fails: it proves nothing, and
  // treating "could not check" as "checked and clean" is exactly the silent
  // degradation this script exists to prevent.
  if (strict && (problems.length > 0 || unreachable.length > 0)) {
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  await main();
}

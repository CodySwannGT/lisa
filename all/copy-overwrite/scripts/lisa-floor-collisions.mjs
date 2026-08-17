#!/usr/bin/env node
// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * @file Fail when a security override can be collapsed into a weaker floor.
 *
 * npm and bun both let an override be written as `$name`, meaning "use whatever
 * the root package pins this to". bun does not merely permit that form — it
 * REWRITES to it, on every `bun install`, whenever an override names a package
 * the project also depends on directly. The override stops carrying its own
 * floor and adopts the dependency line's.
 *
 * That is fine when the two agree. It is a silent security regression when the
 * dependency line is lower, which is the normal case: an override exists
 * *because* the direct range was too permissive. Observed in
 * acmeorgc/frontend on bun 1.3.11, from a clean tree:
 *
 *   "postcss": ">=8.5.18"  ->  "$postcss"   with devDependencies ^8.5.0
 *   "prettier": "3.8.3"    ->  "$prettier"  with devDependencies ^3.3.3
 *
 * postcss 8.5.0 is inside the range GHSA patches at 8.5.18. The rewrite reads
 * as a tidy-up in the diff, recurs on every install, and defeats any attempt to
 * restore the floor by hand.
 *
 * This check is deliberately OFFLINE and deterministic. It asks one structural
 * question — can this override be collapsed into something weaker? — and needs
 * no advisory lookup to answer it, so it runs in every project's CI in
 * milliseconds and cannot go quiet when a network call fails. Whether a given
 * floor is high enough for current advisories is a separate question, answered
 * by check-security-floors.mjs against the advisory database.
 *
 * The fix it asks for is always the same: raise the dependency line to the
 * floor. Removing the override is the wrong move — it is what carries the floor
 * to transitive copies, which is the case it was written for.
 *
 * Usage:
 *   lisa-floor-collisions.mjs [--manifest package.json] [--json]
 *
 * Exit 1 when any override would collapse to a weaker range.
 */

import { readFileSync } from "node:fs";

const OVERRIDE_SECTIONS = ["overrides", "resolutions"];
const DEPENDENCY_SECTIONS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];

/**
 * Lowest version a single disjunction branch permits.
 *
 * An upper-bound-only branch (`<2.0.0`, `<=2.0.0`) has no floor: it permits
 * everything beneath the bound, so its lower bound is zero. Every other form
 * used in practice (`>=1.2.3`, `^1.2.3`, `~1.2.3`, `1.2.3`, `>=1.2.3 <2`)
 * leads with its lower bound.
 * @param {string} branch One branch of a `||` range.
 * @returns {number[]|null} [major, minor, patch], or null when there is none.
 */
function branchLowerBound(branch) {
  const trimmed = branch.trim();
  if (trimmed === "") return null;
  if (/^<=?\s*\d/.test(trimmed)) return [0, 0, 0];
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(trimmed);
  return match ? match.slice(1, 4).map(Number) : null;
}

/**
 * Lowest version a range permits, as a comparable tuple.
 *
 * Reading only the first version in the spec was wrong in a direction that
 * matters: for `^2.0.0 || ^1.9.0` it reported 2.0.0, a floor HIGHER than the
 * range actually permits, and the caller's `compare(target, floor) >= 0` then
 * skipped a genuine collision. A floor read too high is a false negative in a
 * security check, so every branch is measured and the lowest wins.
 *
 * An alias spec (`npm:other-pkg@^1.2.3`) versions a different package
 * entirely; its number cannot be compared against a floor for this name, so it
 * returns null rather than a misleading answer. A spec carrying no version —
 * `*`, `workspace:*`, `latest` — has no floor either.
 * @param {string} spec A version range.
 * @returns {number[]|null} [major, minor, patch], or null when there is none.
 */
export function lowestPermitted(spec) {
  const raw = spec ?? "";
  if (/^\s*npm:/i.test(raw)) return null;
  const bounds = raw
    .split("||")
    .map(branchLowerBound)
    .filter(bound => bound !== null);
  if (bounds.length === 0) return null;
  return bounds.reduce((lowest, bound) =>
    compare(bound, lowest) < 0 ? bound : lowest
  );
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
 * Every direct dependency range, flattened across sections.
 *
 * Later sections do not overwrite earlier ones: the FIRST declaration wins, and
 * a package declared twice is a different problem this check does not own.
 * @param {object} manifest A parsed package.json.
 * @returns {Map<string, {spec: string, section: string}>} By package name.
 */
export function directDependencies(manifest) {
  const found = new Map();
  for (const section of DEPENDENCY_SECTIONS) {
    for (const [name, spec] of Object.entries(manifest[section] ?? {})) {
      if (typeof spec === "string" && !found.has(name)) {
        found.set(name, { spec, section });
      }
    }
  }
  return found;
}

/**
 * Overrides that a package manager could collapse into a weaker floor.
 *
 * Only INTACT overrides are judged. A `$name` override is skipped, and the
 * reason is that the evidence is already gone: once collapsed, the manifest no
 * longer records what the floor used to be, so there is nothing to compare the
 * dependency line against. Reporting every collapsed override instead would
 * fire on the correct end state — an override collapsed onto a dependency that
 * already carries the floor is exactly what a fixed project looks like after
 * its next install — and a check that fails on the fix is one that gets
 * skipped rather than heeded.
 *
 * That leaves a genuine gap for a project whose floor was lost before this
 * check ever ran. Nothing offline can recover it; the advisory-database check
 * is what covers that case, by asking whether the surviving range is high
 * enough rather than whether it changed.
 * @param {object} manifest A parsed package.json.
 * @returns {Array<{name: string, override: string, dependency: string,
 *   section: string, from: string}>} Collisions found.
 */
export function collisions(manifest) {
  const direct = directDependencies(manifest);
  const found = [];

  for (const from of OVERRIDE_SECTIONS) {
    for (const [name, spec] of Object.entries(manifest[from] ?? {})) {
      if (typeof spec !== "string" || spec.startsWith("$")) continue;
      const dependency = direct.get(name);
      if (!dependency) continue;

      const floor = lowestPermitted(spec);
      const target = lowestPermitted(dependency.spec);
      if (!floor || !target) continue;
      if (compare(target, floor) >= 0) continue;

      found.push({
        name,
        override: spec,
        dependency: dependency.spec,
        section: dependency.section,
        from,
      });
    }
  }
  return found;
}

function main() {
  const argv = process.argv.slice(2);
  const asJson = argv.includes("--json");
  const manifestIndex = argv.indexOf("--manifest");
  const manifestPath =
    manifestIndex >= 0 ? argv[manifestIndex + 1] : "package.json";

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    process.stderr.write(`${manifestPath} is not readable: ${error.message}\n`);
    process.exit(2);
  }

  const found = collisions(manifest);

  if (asJson) {
    console.log(JSON.stringify({ manifest: manifestPath, found }, null, 2));
  } else if (found.length === 0) {
    console.log(
      "## Floor collisions\n\nNo override can be collapsed into a weaker range."
    );
  } else {
    console.log("## Floor collisions\n");
    console.log(
      "Each override below names a package this project also depends on directly, whose range permits a LOWER version. `bun install` rewrites such an override to `$name`, at which point the floor becomes the dependency line and the protection is gone.\n"
    );
    console.log("| package | override | direct dependency |");
    console.log("|---|---|---|");
    for (const row of found) {
      console.log(
        `| \`${row.name}\` | \`${row.override}\` (${row.from}) | \`${row.dependency}\` (${row.section}) |`
      );
    }
    console.log(
      "\nRaise the direct dependency to the floor. Do not delete the override — it is what carries the floor to transitive copies, which is the case it was written for."
    );
  }

  if (found.length > 0) process.exitCode = 1;
}

if (import.meta.main) main();

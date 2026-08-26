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
 * The version triple leading a range branch, anchored.
 *
 * Anchored with a `\D*` prefix rather than searched with a bare
 * `/(\d+)\.(\d+)\.(\d+)/`. An UNANCHORED search re-attempts at every position,
 * and `\d+` inside it gives the engine something to give back at each one, so
 * runtime is super-linear in the length of the input — S5852. `\D*` cannot
 * match a digit, so it has exactly one viable length and the whole match is
 * one left-to-right pass.
 *
 * The prefix it skips is the comparator, which is the only thing that ever
 * precedes the number in a branch: `>=1.2.3`, `^1.2.3`, `~1.2.3`, `1.2.3`,
 * `>=1.2.3 <2`.
 *
 * The prefix is a CLOSED class of comparator characters rather than "anything
 * that is not a digit", because `\D*` made every digit-bearing string look like
 * a range. `file:../pkg2` parsed as a floor of `2.0.0`, and `collisions()`
 * applies {@link isIncomparable} to the DEPENDENCY line only — so a protocol
 * override carrying a digit invented a floor and reported a collision that does
 * not exist. A false alarm in this check is the failure that gets it switched
 * off, which costs the false negatives it was written to prevent.
 *
 * Minor and patch are OPTIONAL, and that is load-bearing rather than tidy.
 * Demanding a full `x.y.z` made `^8` and `~1.2` read as carrying no floor at
 * all, which is not a near-miss — it is the opposite of the truth. `^8` permits
 * `>=8.0.0`, and calling that floorless broke this check in both directions at
 * once: an override written `^8` was skipped on the reasoning that it had
 * nothing to lose, and a dependency written `~1.2` was compared as `0.0.0` and
 * lost to everything. The first is a false negative in a security check, which
 * this file's own comments name as the failure mode it is built to avoid.
 *
 * A partial version's absent parts are zero because that is what the range
 * means: `^8` is `>=8.0.0 <9.0.0` and `1.x` is `>=1.0.0 <2.0.0`. Only the lower
 * bound is read here, so the upper half costs nothing to ignore.
 *
 * This parser deliberately uses no version-shaped regular expression. The
 * collision gate consumes dependency text supplied by a repository, so even a
 * bounded-looking optional-group expression becomes an avoidable ReDoS review
 * burden. A tiny left-to-right scanner is both clearer and constant-work per
 * input character.
 */
function parseBranchVersion(branch) {
  let cursor = branch.trimStart();
  while (cursor.startsWith("v")) cursor = cursor.slice(1);

  const operator = [">=", ">", "=", "^", "~"].find(candidate =>
    cursor.startsWith(candidate)
  );
  if (operator) cursor = cursor.slice(operator.length);
  cursor = cursor.trimStart();

  let end = 0;
  while (end < cursor.length) {
    const character = cursor[end];
    const digit = character >= "0" && character <= "9";
    const next = cursor[end + 1];
    const componentSeparator = character === "." && next >= "0" && next <= "9";
    if (!digit && !componentSeparator) break;
    end += 1;
  }

  const parts = cursor.slice(0, end).split(".");
  if (
    parts.length > 3 ||
    parts.some(
      part =>
        part === "" ||
        [...part].some(character => character < "0" || character > "9")
    )
  ) {
    return null;
  }
  return { operator, parts };
}

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
  const upperOperand = trimmed
    .slice(trimmed.startsWith("<=") ? 2 : 1)
    .trimStart();
  if (
    trimmed.startsWith("<") &&
    upperOperand[0] >= "0" &&
    upperOperand[0] <= "9"
  ) {
    return [0, 0, 0];
  }
  const parsed = parseBranchVersion(trimmed);
  if (!parsed) return null;
  // An absent minor or patch is zero, not missing: `^8` is `>=8.0.0`. Number()
  // of undefined is NaN, which would compare as neither higher nor lower than
  // anything and quietly disable the comparison it feeds.
  const lower = [...parsed.parts, "0", "0"].slice(0, 3).map(Number);
  if (parsed.operator !== ">") return lower;

  // npm expands a STRICT comparator on a partial version before comparing:
  // `>1` is `>=2.0.0` and `>1.2` is `>=1.3.0`. Reading either as merely
  // 1.0.0/1.2.0 invents versions the range does not permit and can report an
  // adequate dependency line as weaker than its override.
  const lastSpecified = parsed.parts.length - 1;
  lower[lastSpecified] += 1;
  for (let index = lastSpecified + 1; index < lower.length; index += 1) {
    lower[index] = 0;
  }
  return lower;
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
 * returns null rather than a misleading answer. A spec carrying no version at
 * all — `*`, `latest` — has no floor either.
 *
 * A PARTIAL version is not one of those. `^8` and `~1.2` carry floors of
 * `8.0.0` and `1.2.0`; this list used to name `^8` as floorless and the code
 * agreed with it, which is how an override written that way went unchecked.
 *
 * `null` therefore means only "no floor was read here", and callers must not
 * read it as "nothing to check". Those are opposite answers: a range with no
 * floor permits EVERYTHING, which is the weakest state a dependency line can
 * be in. {@link isIncomparable} is what separates the two.
 * @param {string} spec A version range.
 * @returns {number[]|null} [major, minor, patch], or null when there is none.
 */
export function lowestPermitted(spec) {
  const raw = spec ?? "";
  if (/^\s*npm:/i.test(raw)) return null;
  // A floorless branch is not a branch to skip — it decides the answer. A
  // disjunction permits the union of its branches, so `latest || ^8` permits
  // everything `latest` does, and reading the range as `8.0.0` reports a floor
  // the range does not have. Filtering the null out made the strongest branch
  // speak for the weakest one, which is a floor read TOO HIGH: the caller's
  // `compare(target, floor) >= 0` then skips a genuine collision, and a false
  // negative in a security check is the one direction this file must not fail.
  const bounds = raw.split("||").map(branchLowerBound);
  if (bounds.some(bound => bound === null)) return null;
  return bounds.reduce((lowest, bound) =>
    compare(bound, lowest) < 0 ? bound : lowest
  );
}

/**
 * The floor of a range that declares none: zero, i.e. it permits everything.
 *
 * Not a sentinel for "unknown". A range with no lower bound is fully known —
 * it is the weakest one expressible — and comparing it as zero is what makes
 * it lose against any override that carries a floor.
 */
const NO_FLOOR = Object.freeze([0, 0, 0]);

/**
 * Protocols that point a dependency name at something other than a registry
 * version of that same package.
 *
 * `npm:` and the shorthand `org/repo` form alias a different package; `file:`,
 * `link:`, `portal:` and `workspace:` resolve to a checkout on disk; git and
 * http specs fetch a tree. None of them carries a registry range this check
 * can weigh against a floor, and none is rewritten to `$name` in the way the
 * check exists to catch.
 */
const INCOMPARABLE_PROTOCOL =
  /^\s*(?:npm|workspace|file|link|portal|github|gitlab|bitbucket|https?|git|git\+[a-z]+):/iu;

/**
 * Whether a dependency spec versions something this check cannot weigh.
 *
 * Separating this from "carries no version number" is the whole point. Both
 * used to arrive as `null` from {@link lowestPermitted} and both were skipped,
 * so `"*"` — the weakest range there is — read exactly like an alias to another
 * package and reported clean. An alias genuinely cannot be compared; `"*"`
 * compares perfectly well and loses.
 * @param {string} spec A dependency range.
 * @returns {boolean} True when no comparison is meaningful.
 */
export function isIncomparable(spec) {
  const raw = typeof spec === "string" ? spec : "";
  return INCOMPARABLE_PROTOCOL.test(raw) || raw.includes("/");
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
      // An override with no floor of its own has nothing to lose to a collapse.
      if (!floor) continue;
      // A dependency line that names another package cannot be weighed. One
      // that merely omits a version number CAN be, and permits everything.
      if (isIncomparable(dependency.spec)) continue;
      const target = lowestPermitted(dependency.spec) ?? NO_FLOOR;
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

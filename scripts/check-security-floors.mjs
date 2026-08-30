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

import { existsSync, readFileSync } from "node:fs";
import { globSync } from "node:fs";

import { boundedExecFileSync } from "./lib/bounded-spawn.mjs";

/**
 * Fixed absolute git locations, tried in order rather than a bare command name
 * so a writeable directory early on `PATH` cannot decide which binary runs.
 *
 * Order within that constraint is set by measurement, not by convention. On
 * macOS `/usr/bin/git` is not git: it is Apple's `xcrun` shim, which locates a
 * developer directory and re-executes the real binary there. Dispatching
 * through it costs a **median 33 ms against 15 ms** for either
 * developer-directory git, and **100 ms against 21 ms at p90** — randomized
 * call order, fixed inter-call gaps, `git rev-parse --show-toplevel`, n=30 each
 * (lisa#2898). The call does no work at all; the difference is the dispatch.
 *
 * The two entries promoted ahead of it are the developer-directory gits the
 * shim itself re-executes. Both are `root:wheel` files in system locations, so
 * this is the same trust class as `/usr/bin/git` and not a relaxation: the
 * user-writable `/usr/local` and Homebrew entries stay behind it, exactly where
 * they already were. Neither promoted path exists on Linux, so every CI runner
 * resolves precisely what it resolved before.
 */
const GIT_LOCATIONS = [
  "/Library/Developer/CommandLineTools/usr/bin/git",
  "/Applications/Xcode.app/Contents/Developer/usr/bin/git",
  "/usr/bin/git",
  "/usr/local/bin/git",
  "/opt/homebrew/bin/git",
];

/** Absolute git path: the first candidate that exists. */
const GIT_BIN = GIT_LOCATIONS.find(candidate => existsSync(candidate)) ?? "git";

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
 * Resolve a `$name` self-reference to the range the manifest pins it to.
 *
 * Searches the dependency sections of every governance group, because a
 * template may declare the target in `force`, `defaults` or `merge` and the
 * reference means the same thing in each. Constraint sections that are
 * themselves override maps are skipped, so a `$name` cannot resolve to another
 * `$name` and loop.
 * @param {object} manifest A parsed package.lisa.json.
 * @param {string} name The referenced package.
 * @returns {string|null} The pinned range, or null when nothing declares it.
 */
export function resolveSelfReference(manifest, name) {
  const DEPENDENCY_SECTIONS = [
    "dependencies",
    "devDependencies",
    "peerDependencies",
  ];
  for (const group of GOVERNANCE_GROUPS) {
    const block = manifest[group];
    if (!block || typeof block !== "object") continue;
    for (const section of DEPENDENCY_SECTIONS) {
      const spec = block[section]?.[name];
      if (typeof spec === "string" && !spec.startsWith("$")) return spec;
    }
  }
  return null;
}

/**
 * Where the governance manifests live.
 *
 * The root entry is listed separately because the per-stack pattern is one
 * level deep and never matched it. That miss cost nine floors — the root
 * manifest is the one whose force/defaults/merge sections decide what every
 * project's package.json becomes — and the audit reported clean for all of
 * them, because a floor nobody looked at is indistinguishable in the output
 * from a floor that passed.
 */
const MANIFEST_PATTERNS = Object.freeze([
  "package.lisa.json",
  "*/package-lisa/package.lisa.json",
]);

/** Paths that are copies of a manifest rather than a manifest. */
const NOT_A_MANIFEST = [
  "node_modules",
  ".worktrees",
  "dist/",
  "tests/fixtures",
];

/**
 * Every manifest git tracks, so the glob can be checked against reality.
 *
 * Returns null when the question cannot be asked — outside a checkout, with no
 * git, or with the child killed at its deadline. A null is reported as "not
 * reconciled", never folded into "nothing missing": the whole defect being
 * fixed here is a scan that narrowed silently.
 *
 * The swallow is therefore KEPT for a timeout rather than kept by inheritance.
 * A kill is one more way the question cannot be asked, and this function
 * already routes "cannot ask" to the safe answer — so re-raising would trade a
 * correct report for a crash and gain nothing.
 * @returns {string[]|null} Tracked manifest paths, or null when unknowable.
 */
function trackedManifests() {
  try {
    return boundedExecFileSync(
      GIT_BIN,
      ["ls-files", "-z", "*package.lisa.json"],
      {
        encoding: "utf8",
        maxBuffer: 8 * 1024 * 1024,
        stdio: ["ignore", "pipe", "ignore"],
      }
    )
      .split("\0")
      .filter(Boolean)
      .filter(
        file => !NOT_A_MANIFEST.some(fragment => file.includes(fragment))
      );
  } catch {
    return null;
  }
}

/**
 * Every version constraint declared across the template manifests.
 * @returns {{found: Map<string, Array<{file: string, path: string, spec: string,
 *   lowest: number[]}>>,
 *   unresolved: Array<{file: string, path: string, name: string, spec: string}>,
 *   unparseable: Array<{file: string, path: string, name: string, spec: string,
 *   reason: string}>, scanned: string[], unscanned: string[]|null}}
 *   Constraints by package name with their resolved floors, self-references
 *   pointing at nothing, floors that resolve to no lower bound, the manifests
 *   read, and any tracked manifest the patterns did not reach.
 */
export function collectFloors() {
  const found = new Map();
  /** `$name` references pointing at nothing this manifest declares. */
  const unresolved = [];
  /** Floors carrying a version that resolves to no lower bound. */
  const unparseable = [];
  const files = globSync(MANIFEST_PATTERNS).filter(
    file => !NOT_A_MANIFEST.some(fragment => file.includes(fragment))
  );
  // What the patterns reach, against what the repository actually carries. A
  // glob is exactly the kind of thing that narrows by one level and keeps
  // reporting a clean sheet for the files it stopped opening.
  const tracked = trackedManifests();
  const scanned = new Set(files);
  const unscanned =
    tracked === null ? null : tracked.filter(file => !scanned.has(file));
  /**
   * File one floor: comparable ones under their package, the rest as gaps.
   *
   * Resolved HERE, at collection, rather than in the audit loop, for two
   * reasons beyond tidiness. It runs before any network call, so a floor with
   * no lower bound is reported even on a run that is entirely rate-limited —
   * the case where a silent skip is hardest to notice. And it makes every site
   * in `found` carry a resolved floor, which removes the audit's null check
   * instead of leaving a `continue` that a later reader has to re-litigate.
   * @param {string} name npm package name.
   * @param {string} file Manifest the floor was declared in.
   * @param {string} path Governance group and section, dotted.
   * @param {string} spec The version constraint to resolve.
   */
  const record = (name, file, path, spec) => {
    const { version, reason } = resolveLowerBound(spec);
    if (version === null) {
      unparseable.push({ file, path, name, spec, reason });
      return;
    }
    if (!found.has(name)) found.set(name, []);
    found.get(name).push({ file, path, spec, lowest: version });
  };

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
          if (typeof spec !== "string") continue;
          // A `$name` self-reference carries no floor of its own — it adopts
          // whatever the manifest pins that package to elsewhere. Resolve it
          // and check THAT, rather than skipping.
          //
          // Skipping was safe only by coincidence: every `$name` in the
          // templates today happens to target a package also declared as a
          // literal in a scanned group, so the range got checked under its own
          // entry. Nothing enforces that. The first `$name` whose target is
          // declared only downstream — or not at all — would be a floor
          // nothing checks, reported as clean, which is worse than no check.
          if (spec.startsWith("$")) {
            const target = resolveSelfReference(manifest, spec.slice(1));
            if (target === null) {
              unresolved.push({
                file,
                path: `${group}.${section}`,
                name,
                spec,
              });
              continue;
            }
            if (!/\d/.test(target)) continue;
            record(name, file, `${group}.${section}`, target);
            continue;
          }
          // A literal carrying no digits — "workspace:*", "latest" — is not a
          // floor and there is nothing to compare. Kept ahead of `record` so
          // these stay a deliberate non-floor rather than becoming a gap
          // report: they are not failed attempts to state a floor.
          if (!/\d/.test(spec)) continue;
          record(name, file, `${group}.${section}`, spec);
        }
      }
    }
  }
  return { found, unresolved, unparseable, scanned: files, unscanned };
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

/** The comparator an npm term may lead with. */
const TERM_OPERATOR = /^(>=|<=|>|<|=|\^|~)/;

/**
 * The version half of a term, anchored end to end.
 *
 * Anchored deliberately. The predecessor was an unanchored
 * `/(\d+)\.(\d+)\.(\d+)/` scan, and a scan cannot tell a version from a number
 * that merely follows one: on `^1.2.3-alpha.4` a global sweep finds `1.2.3`
 * and then finds `4` in the prerelease tag and reads it as a second term. An
 * anchored match either consumes the whole thing or rejects it, which is the
 * property that lets a rejection mean "report this" instead of "guess".
 *
 * The operator and any prerelease or build tag are removed before this runs,
 * rather than being alternatives inside it. Splitting the three concerns keeps
 * each pattern simple enough to read, and the tag is discarded regardless
 * because every comparison in this file is on the [major, minor, patch] tuple.
 */
const TERM_VERSION = /^v?(\d+)(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?$/;

/**
 * Lower bound of one comparator term.
 *
 * Three outcomes, kept distinct because collapsing any two of them is how a
 * floor goes unchecked:
 *
 * - `bound` — the term states a lowest permitted version.
 * - `floorless` — the term is an upper bound (`<8`, `<=2.0.0`). It states no
 *   floor at all; it permits every release beneath it.
 * - `unreadable` — this check cannot tell which of the two it is.
 * @param {string} term A single comparator, e.g. ">=1.2.3" or "^8".
 * @returns {{kind: string, version?: number[]}} The classification.
 */
function termLowerBound(term) {
  const operator = TERM_OPERATOR.exec(term)?.[1] ?? "";
  if (operator === "<" || operator === "<=") return { kind: "floorless" };
  // A prerelease or build tag is the only place a `-` or `+` survives this
  // far: hyphen RANGES were split before the term was formed. Taking the head
  // is what stops `-alpha.4` contributing a `4` to the version.
  const [core] = term.slice(operator.length).split(/[-+]/);

  const match = TERM_VERSION.exec(core);
  if (!match) return { kind: "unreadable" };
  // `x` and `*` are wildcards, so they and everything after them are
  // unspecified. `1.x.5` is not a version anyone means; truncating at the
  // first wildcard is what makes `1.x` and `1` resolve identically.
  const specified = [];
  for (const part of [match[1], match[2], match[3]]) {
    if (part === undefined || /^[xX*]$/.test(part)) break;
    specified.push(Number(part));
  }
  // An absent minor or patch is zero, not missing: `^8` is `>=8.0.0`. Leaving
  // them undefined would put NaN into the tuple, and NaN compares as neither
  // higher nor lower than anything — it disables the comparison it feeds
  // rather than failing it.
  const lower = [...specified, 0, 0].slice(0, 3);
  if (operator !== ">") return { kind: "bound", version: lower };

  // npm expands a STRICT comparator before comparing: `>1` is `>=2.0.0` and
  // `>1.2` is `>=1.3.0`. Reading either as merely 1.0.0 or 1.2.0 invents
  // versions the range does not permit, which in this file means comparing a
  // release the floor already excludes.
  const lastSpecified = specified.length - 1;
  lower[lastSpecified] += 1;
  for (let index = lastSpecified + 1; index < 3; index += 1) lower[index] = 0;
  return { kind: "bound", version: lower };
}

/**
 * Lower bound of one `||` branch: the HIGHEST floor its terms state.
 *
 * A branch is a conjunction — `>=1.2.3 <2.0.0` permits a version only if every
 * term admits it — so the binding floor is the strongest one present. Terms
 * that state no floor (`<2.0.0`) constrain the ceiling and are passed over;
 * a branch made only of those has no floor.
 * @param {string} branch One branch of a `||` range.
 * @returns {{kind: string, version?: number[]}} The classification.
 */
function branchLowerBound(branch) {
  const trimmed = branch.trim();
  if (trimmed === "") return { kind: "unreadable" };
  // A hyphen range's floor is its LEFT side. Both sides are bare versions, so
  // measuring every term and keeping the highest would return `2.0.0` for
  // `1.2.3 - 2.0.0` — the ceiling reported as the floor, which is the one
  // direction that clears a vulnerable release instead of flagging it.
  const [beneathAnyCeiling] = trimmed.split(/\s+-\s+/);
  // semver permits whitespace between an operator and its version, so `>= 8`
  // is `>=8`. Closing the gap before splitting on whitespace stops a legal
  // range being split into a bare operator plus a bare version — which would
  // read as unreadable and report a floor that is in fact perfectly clear.
  const terms = beneathAnyCeiling
    .replace(/(>=|<=|>|<|=|\^|~)\s+/g, "$1")
    .split(/\s+/)
    .filter(Boolean);
  let strongest = null;
  for (const term of terms) {
    const resolved = termLowerBound(term);
    if (resolved.kind === "unreadable") return { kind: "unreadable" };
    if (resolved.kind === "floorless") continue;
    if (strongest === null || compare(resolved.version, strongest) > 0) {
      strongest = resolved.version;
    }
  }
  return strongest === null
    ? { kind: "floorless" }
    : { kind: "bound", version: strongest };
}

/**
 * Lowest version a spec permits, with the reason when there is none.
 *
 * The reason is produced here rather than by a second pass, so the message a
 * reader sees and the decision the audit makes come from the same parse and
 * cannot disagree.
 *
 * Note what `[0, 0, 0]` would mean if this returned it for an upper-bound-only
 * spec, which is how the sibling collision checker in the templates models a
 * floorless range: {@link withinRange} would compare 0.0.0 against an advisory
 * range like `>= 4.0.0, < 5.0.8`, find it outside, and report the floor CLEAN.
 * A spec that permits every vulnerable release would come back green. The two
 * files are therefore deliberately NOT unified — there, zero means "weakest
 * possible, loses every comparison"; here, no comparison at that end exists,
 * so a floorless spec has to be reported instead of compared.
 * @param {string} spec A range like ">=5.0.7", "^8", "~2.0", "^7 || ^8".
 * @returns {{version: number[]|null, reason: string|null}} Bound, or reason.
 */
function resolveLowerBound(spec) {
  const raw = typeof spec === "string" ? spec.trim() : "";
  if (raw === "") return { version: null, reason: "is empty" };
  // An alias versions a DIFFERENT package. Its number cannot be compared
  // against advisories filed for this name, and comparing it anyway would
  // answer confidently about the wrong package.
  if (/^npm:/i.test(raw)) {
    return {
      version: null,
      reason:
        "is an alias, so its version belongs to another package and cannot be compared against this one's advisories",
    };
  }

  const branches = raw.split("||").map(branchLowerBound);
  if (branches.some(branch => branch.kind === "unreadable")) {
    return {
      version: null,
      reason: "is not a version range this check knows how to read",
    };
  }
  // A disjunction permits the union of its branches, so one floorless branch
  // makes the whole spec floorless: `<8 || ^9` permits everything below 8.
  // Filtering that branch out would let the strongest branch speak for the
  // weakest, reporting a floor the spec does not have.
  if (branches.some(branch => branch.kind === "floorless")) {
    return {
      version: null,
      reason:
        "sets only an upper bound, so it permits every earlier release including vulnerable ones",
    };
  }
  return {
    version: branches.reduce(
      (lowest, branch) =>
        compare(branch.version, lowest) < 0 ? branch.version : lowest,
      branches[0].version
    ),
    reason: null,
  };
}

/**
 * Lowest version a spec permits, as a comparable tuple.
 *
 * Partial and wildcard constraints resolve to their floor — `^8` is `8.0.0`,
 * `~8.2` is `8.2.0`, `5.x` is `5.0.0` — rather than to null. Requiring all
 * three components meant every such floor came back null, and the audit's
 * `if (!lowest) continue` then skipped it in silence (lisa#3438).
 *
 * `null` now means only "no floor was read here" and never "nothing to
 * check". Callers must report it; {@link lowerBoundGap} supplies the wording.
 * @param {string} spec A range like ">=5.0.7", "^8", "~2.0", "^7 || ^8".
 * @returns {number[]|null} [major, minor, patch], or null when there is none.
 */
export function lowestPermitted(spec) {
  return resolveLowerBound(spec).version;
}

/**
 * Why a spec has no comparable floor, in words an operator can act on.
 * @param {string} spec A version constraint.
 * @returns {string|null} The reason, or null when the spec does resolve.
 */
export function lowerBoundGap(spec) {
  return resolveLowerBound(spec).reason;
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
 * @returns {Promise<{problems: Array, unreachable: Array, unresolved: Array,
 *   unparseable: Array, unscanned: string[]|null, manifests: number,
 *   checked: number}>} Findings.
 */
async function audit() {
  const {
    found: floors,
    unresolved,
    unparseable,
    scanned,
    unscanned,
  } = collectFloors();
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
          // No null check here, deliberately. This loop used to open with
          // `const lowest = lowestPermitted(site.spec); if (!lowest) continue;`
          // — the skip that made an unreadable floor indistinguishable from a
          // floor that passed. Every site in `found` now carries a floor
          // resolved at collection time, and the ones that resolve to nothing
          // are in `unparseable`, where they are reported and gate `--strict`.
          if (
            !withinRange(site.lowest, vulnerability.vulnerable_version_range)
          ) {
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
  return {
    problems,
    unreachable,
    unresolved,
    unparseable,
    unscanned,
    manifests: scanned.length,
    checked: floors.size,
  };
}

async function main() {
  const strict = process.argv.includes("--strict");
  const asJson = process.argv.includes("--json");
  const {
    problems,
    unreachable,
    unresolved,
    unparseable,
    unscanned,
    manifests,
    checked,
  } = await audit();

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          problems,
          unreachable,
          unresolved,
          unparseable,
          unscanned,
          manifests,
          checked,
        },
        null,
        2
      )
    );
  } else if (problems.length === 0) {
    console.log(
      `## Security floors\n\nNo force-pinned floor permits a high or critical vulnerable release. ${checked} package(s) across ${manifests} manifest(s) checked.`
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

  // Markdown notes belong to the human report only. Printed in --json mode
  // they follow the document and break every parser reading it; the same
  // facts are already fields in the JSON.
  if (!asJson && unresolved.length > 0) {
    console.log(
      `\n> **${unresolved.length} self-reference(s) resolve to nothing.** A \`$name\` adopts whatever the manifest pins that package to; when nothing pins it, there is no floor to check and no floor to enforce. Reported rather than skipped, because silence here is indistinguishable from a clean result.`
    );
    for (const entry of unresolved) {
      console.log(
        `> - \`${entry.name}: ${entry.spec}\` in ${entry.file} ${entry.path}`
      );
    }
    console.log(
      "> Fix by declaring the target in a governance dependency section, or by replacing the reference with an explicit floor."
    );
  }

  // A floor whose version cannot be resolved to a lowest permitted release is
  // a floor this audit did not compare. It used to be passed over in silence,
  // which put it in the output as nothing at all — and nothing at all is what
  // a floor that passed also looks like.
  if (!asJson && unparseable.length > 0) {
    console.log(
      `\n> **${unparseable.length} floor(s) could NOT be checked.** Each states a version this audit could not read as a lowest permitted release, so none of them were compared against the advisory database. This is not a clean result for them.`
    );
    for (const entry of unparseable) {
      console.log(
        `> - \`${entry.name}: ${entry.spec}\` in ${entry.file} ${entry.path} — ${entry.reason}`
      );
    }
    console.log(
      "> Fix by rewriting each one as a constraint with a lower bound — `>=x.y.z`, `^x.y.z`, `~x.y.z`, or an exact version."
    );
  }

  // A manifest the patterns never opened is the same failure as a package the
  // advisory API never answered for: unexamined, and reported clean unless the
  // difference is stated. Printed whether or not anything else went wrong.
  if (!asJson && unscanned === null) {
    console.log(
      "\n> **Manifest coverage was not reconciled.** `git ls-files` could not be consulted, so nothing confirms the patterns reached every tracked manifest."
    );
  }
  if (!asJson && unscanned !== null && unscanned.length > 0) {
    console.log(
      `\n> **${unscanned.length} tracked manifest(s) were NOT scanned.** Their floors are audited by nothing, which reads as clean: ${unscanned.join(", ")}.`
    );
    console.log(
      "> Fix by widening `MANIFEST_PATTERNS` in this script and the `paths:` trigger in `.github/workflows/security-floors.yml` to match."
    );
  }

  if (!asJson && unreachable.length > 0) {
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
  // An unresolved self-reference gates for the same reason an inconclusive one
  // does: it is a floor nobody checked, and letting it pass reports it clean.
  // An unscanned tracked manifest gates for the same reason an inconclusive
  // lookup does: it is a floor nobody checked, and passing reports it clean.
  // A floor with no readable lower bound gates for that reason a fourth time.
  if (
    strict &&
    (problems.length > 0 ||
      unreachable.length > 0 ||
      unresolved.length > 0 ||
      unparseable.length > 0 ||
      (unscanned !== null && unscanned.length > 0))
  ) {
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  await main();
}

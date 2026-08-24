/**
 * The one resolver for "what version of this plugin is installed right now".
 *
 * It lives here rather than in either caller because there used to be two of
 * them, and the second one was invisible. `plugin-routing-validate.mjs`
 * imported `compareSemver` and `isValidSemver` from `plugin-parity-drift.mjs`
 * and then walked the cache itself — so the two scripts LOOKED like one
 * implementation, shared a module, and disagreed about the answer.
 *
 * That is worse than an ordinary duplicate. When the orphan defect was fixed in
 * the detector (CodySwannGT/lisa#3085), the fix did not reach the validator, and
 * the next person to hit it would have found a detector whose orphan handling
 * was correct and tested, an import linking the failing script to it, and a
 * failure the fix was supposed to have prevented. **The remedy appears to have
 * been applied.** A fix that is present, correct, and unreachable costs more
 * than no fix at all, because it argues the cause is somewhere else
 * (CodySwannGT/lisa#3093).
 *
 * So: one implementation, one place to fix, and the import stops being
 * misleading. The single genuine difference between the two callers is now a
 * NAMED option rather than an accidental divergence — see `dirNameFallback`.
 *
 * ## What the cache actually is
 *
 * Append-mostly. Uninstalling a plugin does not delete its version directories;
 * it stamps each one with `.orphaned_at`. The directories on disk are a record
 * of every version ever fetched, not of what is installed now, and reading them
 * as the latter is how a pin came to be compared against ten-day-old leftovers.
 *
 * Determinism: Node built-ins only, no network, no `Date`, no `Math.random`.
 * @module scripts/lib/plugin-cache-resolution
 */
import fs from "node:fs";
import path from "node:path";

// Literals named once — each was repeated enough times that a typo in one
// copy would diverge silently.
const NOT_INSTALLED = "not-installed";

/**
 * Semver 2.0.0 grammar, one clause per name. Build metadata (`+...`) is
 * accepted but ignored in comparison; prerelease (`-...`) is accepted and sorts
 * below its release.
 *
 * Assembled from fragments rather than written as one literal because the
 * literal was unreadable — this is the semver.org grammar verbatim, and the
 * composed `.source` is byte-identical to the literal it replaced.
 */
const SEMVER_NUMERIC = "0|[1-9]\\d*";
const SEMVER_PRERELEASE_ID = `(?:${SEMVER_NUMERIC}|\\d*[A-Za-z-][0-9A-Za-z-]*)`;
const SEMVER_PRERELEASE = `(?:-(${SEMVER_PRERELEASE_ID}(?:\\.${SEMVER_PRERELEASE_ID})*))?`;
const SEMVER_BUILD = "(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?";
const SEMVER_RE = new RegExp(
  `^(${SEMVER_NUMERIC})\\.(${SEMVER_NUMERIC})\\.(${SEMVER_NUMERIC})${SEMVER_PRERELEASE}${SEMVER_BUILD}$`
);

/** A plugin name / marketplace token: `1*(ALPHA / DIGIT / "-" / "_")`. */
/**
 * A single path token: no `.`, no `/`, so it cannot escape the cache root.
 *
 * Exported because both callers validate the same shape before building a cache
 * path, and two copies of a path-traversal guard is exactly the duplication
 * this module exists to end.
 */
export const TOKEN_RE = /^[A-Za-z0-9_-]+$/;

/**
 * True iff `value` is a valid semver 2.0.0 string.
 *
 * @param {unknown} value - candidate version string.
 * @returns {boolean} whether `value` parses as semver.
 */
export function isValidSemver(value) {
  if (typeof value !== "string") {
    return false;
  }
  return SEMVER_RE.test(value);
}

/**
 * Split a semver string into its numeric `[major, minor, patch]` core and the
 * raw prerelease string (build metadata stripped).
 *
 * @param {string} version - a valid semver string.
 * @returns {{ core: readonly number[], prerelease: string }} parsed parts.
 */
function splitSemver(version) {
  const withoutBuild = version.split("+", 1)[0];
  const dashIndex = withoutBuild.indexOf("-");
  const coreStr =
    dashIndex === -1 ? withoutBuild : withoutBuild.slice(0, dashIndex);
  const prerelease = dashIndex === -1 ? "" : withoutBuild.slice(dashIndex + 1);
  const core = coreStr.split(".").map(part => Number.parseInt(part, 10));
  return { core, prerelease };
}

/**
 * Compare two prerelease strings per semver precedence rules.
 *
 * @param {string} a - first prerelease (may be empty = "is a release").
 * @param {string} b - second prerelease (may be empty = "is a release").
 * @returns {number} -1, 0, or 1.
 */
function comparePrerelease(a, b) {
  if (a === b) {
    return 0;
  }
  if (a === "") {
    return 1; // a is a full release; it outranks any prerelease b.
  }
  if (b === "") {
    return -1;
  }
  const aIds = a.split(".");
  const bIds = b.split(".");
  for (let i = 0; i < Math.max(aIds.length, bIds.length); i++) {
    const ai = aIds[i];
    const bi = bIds[i];
    if (ai === undefined) {
      return -1; // shorter set of identifiers has lower precedence.
    }
    if (bi === undefined) {
      return 1;
    }
    const aNum = /^\d+$/.test(ai);
    const bNum = /^\d+$/.test(bi);
    if (aNum && bNum) {
      const diff = Number.parseInt(ai, 10) - Number.parseInt(bi, 10);
      if (diff !== 0) {
        return diff < 0 ? -1 : 1;
      }
      continue;
    }
    if (aNum !== bNum) {
      return aNum ? -1 : 1; // numeric identifiers rank below alphanumeric.
    }
    if (ai !== bi) {
      return ai < bi ? -1 : 1;
    }
  }
  return 0;
}

/**
 * Compare two semver strings. Build metadata is ignored; a prerelease sorts
 * below its associated release.
 *
 * @param {string} a - first valid semver string.
 * @param {string} b - second valid semver string.
 * @returns {number} -1 if a < b, 0 if equal precedence, 1 if a > b.
 */
export function compareSemver(a, b) {
  const pa = splitSemver(a);
  const pb = splitSemver(b);
  for (let i = 0; i < 3; i++) {
    const diff = pa.core[i] - pb.core[i];
    if (diff !== 0) {
      return diff < 0 ? -1 : 1;
    }
  }
  return comparePrerelease(pa.prerelease, pb.prerelease);
}

/**
 * True iff `target` is an existing directory.
 *
 * @param {string} target - filesystem path.
 * @returns {boolean} whether `target` resolves to a directory.
 */
export function isDirectory(target) {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Read a plugin manifest's `version` field, or `null` if unreadable / invalid.
 *
 * @param {string} manifestPath - path to a `.claude-plugin/plugin.json`.
 * @returns {string | null} the manifest version string, or `null`.
 */
function readManifestVersion(manifestPath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    return typeof parsed.version === "string" ? parsed.version : null;
  } catch {
    return null;
  }
}

/**
 * Whether a cached version directory has been ORPHANED — the plugin manager's
 * marker for a version that is no longer installed or served.
 *
 * The cache is append-mostly: uninstalling a plugin does not delete its version
 * directories, it stamps each one with `.orphaned_at`. So the directories on
 * disk are a record of every version ever fetched, not of what is installed
 * now, and reading them as the latter is how this script came to compare a pin
 * against ten-day-old leftovers.
 *
 * @param {string} versionDir - absolute path to one cached version directory.
 * @returns {boolean} true when the directory carries an orphan marker.
 */
function isOrphanedVersion(versionDir) {
  return fs.existsSync(path.join(versionDir, ".orphaned_at"));
}

/**
 * Resolve the current upstream version of `name@marketplace` purely from the
 * cache tree: the MAX valid semver across the immediate version subdirs that
 * are still LIVE, read from each subdir's `.claude-plugin/plugin.json`
 * `version` field. Non-semver dirs (`unknown`, git hashes) are skipped because
 * the manifest version is what counts, and orphaned dirs are skipped because
 * they are not installed.
 *
 * Orphans are filtered BEFORE the max, and the order is load-bearing.
 * "Filter, then take the max" and "take the max, then check whether it is
 * orphaned" are different functions, and they disagree exactly when the newest
 * live version is older than an orphan:
 *
 *     live 1.0.6  +  orphaned 2.0.4
 *       filter-then-max  -> 1.0.6          (correct: 1.0.6 IS installed)
 *       max-then-check   -> not-installed  (wrong)
 *
 * When nothing live remains, this reports `not-installed` — a status this
 * script already has and already handles — rather than manufacturing a current
 * version out of orphans. That is `core/apply-receipt`'s principle: an
 * unresolvable state reports unresolvable, not half-understood.
 *
 * The failure this closes was not theoretical. Every one of the ten cached
 * `safety-net` versions was orphaned in a single sweep, and the resulting
 * manufactured comparison blocked every push from the checkout — in one
 * direction, and then, after a pin was moved to satisfy it, in the other.
 * A defect that produces two opposite plausible remedies is one where the
 * remedy is in neither direction.
 *
 * ## The one difference between the two callers, named
 *
 * `dirNameFallback` exists because the routing validator has always accepted a
 * semver DIRECTORY NAME when a live version's manifest carries no usable
 * `version` — some plugins ship no manifest version but a semver-named dir —
 * while the drift detector deliberately reads the manifest and nothing else,
 * because a `synced-from` pin is compared against what the manifest declares.
 *
 * That difference is real and worth keeping. What was not worth keeping is that
 * it lived in two separate directory walks, where nobody could see it was the
 * ONLY difference. A named option can be read; an accidental divergence has to
 * be discovered by diffing two functions, which is what
 * CodySwannGT/lisa#3093 was filed about.
 *
 * The fallback applies only to LIVE directories. An orphaned `2.0.4` with no
 * manifest is still not installed, whatever its name says.
 * @param {string} cacheRoot - the installed-plugin cache root.
 * @param {string} name - plugin name.
 * @param {string} marketplace - marketplace id.
 * @param {{ dirNameFallback?: boolean }} [options] - resolution options.
 * @returns {{ status: "ok" | "not-installed" | "unresolved", version: string | null }}
 *   the resolution outcome.
 */
export function resolveCurrentVersion(
  cacheRoot,
  name,
  marketplace,
  options = {}
) {
  const dirNameFallback = options.dirNameFallback === true;
  // Defense-in-depth path-traversal guard: only single-token names/marketplaces
  // (no `.`, `/`, `..`) can map to a cache subdir. parseSyncedFrom already
  // enforces this, but resolveCurrentVersion is a public export that no longer
  // co-locates with its validating caller.
  if (!TOKEN_RE.test(name) || !TOKEN_RE.test(marketplace)) {
    return { status: NOT_INSTALLED, version: null };
  }
  const dir = path.join(cacheRoot, marketplace, name);
  if (!isDirectory(dir)) {
    return { status: NOT_INSTALLED, version: null };
  }
  const versions = [];
  // Counted separately from `versions`, because "nothing is installed" and
  // "something is installed but I cannot read its version" are different
  // answers and must not collapse into one. A live directory with an
  // unparseable manifest is `unresolved`; no live directory at all is
  // `not-installed`.
  let liveDirs = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const versionDir = path.join(dir, entry.name);
    // Before the manifest is even read: an orphaned directory is not an
    // installed version, whatever its manifest claims.
    if (isOrphanedVersion(versionDir)) {
      continue;
    }
    liveDirs += 1;
    const manifest = path.join(versionDir, ".claude-plugin", "plugin.json");
    const version = readManifestVersion(manifest);
    if (version !== null && isValidSemver(version)) {
      versions.push(version);
    } else if (dirNameFallback && isValidSemver(entry.name)) {
      versions.push(entry.name);
    }
  }
  if (versions.length === 0) {
    // No live directory at all means the plugin is not installed — a known,
    // answerable state, and the one the whole orphan filter exists to reach.
    // But a live directory whose manifest would not parse is still INSTALLED
    // and merely unreadable, which is what `unresolved` has always meant.
    // Collapsing the two would answer "I cannot read this version" with "this
    // is not here", and an operator would go looking for the wrong thing.
    return liveDirs === 0
      ? { status: NOT_INSTALLED, version: null }
      : { status: "unresolved", version: null };
  }
  // `versions` is non-empty (guarded above), so seeding with the first element
  // is exactly what the no-seed form did — and it cannot throw if that guard is
  // ever moved.
  const max = versions.reduce(
    (acc, v) => (compareSemver(v, acc) > 0 ? v : acc),
    versions[0]
  );
  return { status: "ok", version: max };
}

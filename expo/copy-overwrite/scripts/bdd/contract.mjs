/**
 * Shared vocabulary for the BDD behavior contract gate.
 *
 * Everything a project may vary — platform names, runner names, tracker
 * prefixes — is read from `bdd/coverage-map.json`. Nothing in this module
 * names a test runner or a tracker vendor: that is the point of the contract
 * (see Lisa rule `bdd-e2e-coverage`).
 *
 * @module scripts/bdd/contract
 */

/** Report/envelope schema emitted by the gate. See docs/bdd-coverage-schema.md. */
export const REPORT_SCHEMA_VERSION = 2;

/** Coverage-map schema versions this gate can read. */
export const SUPPORTED_MAP_SCHEMA_VERSIONS = [1, 2];

/** Stable scenario identity. Never renumbered, never reused. */
export const ID_PATTERN = /^BDD-[A-Z][A-Z0-9]*-\d{3,}$/;

/** Lifecycle tags that remove a scenario from the coverage denominator. */
export const LIFECYCLE_TAGS = ["blocked", "reference-only", "superseded"];

/** Provenance tags tying a scenario to the authority it came from. */
export const PROVENANCE_PATTERN = /^(?:figma-|ratified-)/;

/**
 * THE portfolio tracker-tag grammar (one grammar, two schemes).
 *
 * 1. Key style — `@<KEY>-<number>`, for key-based trackers (Jira, Linear).
 *    `@TUN-123`, `@SE-6833`. KEY is 2-10 uppercase alphanumerics starting
 *    with a letter.
 * 2. Repo-issue style — `@gh-<number>` for an issue in this repo, or
 *    `@gh-<repo-slug>-<number>` for a sibling repo in the same org.
 *    `@gh-2394`, `@gh-wiki-124`.
 *
 * The allowed KEYs and repo slugs are PER-REPO CONFIGURATION (`trackers` in
 * the coverage map), never a list baked into this script: a global
 * enumeration would mean a new project key could not be referenced until a
 * new Lisa release shipped, which inverts the pinning contract (Lisa A5).
 *
 * Validation is SYNTACTIC plus membership in the repo's own declared sets.
 * The gate never contacts a tracker — issue liveness must not be a merge
 * dependency.
 */
export const TRACKER_KEY_PATTERN = /^([A-Z][A-Z0-9]{1,9})-(\d+)$/;

/** Repo-issue style tracker tag. Group 1 is an optional repo slug. */
export const TRACKER_GH_PATTERN = /^gh-(?:([a-z0-9]+(?:-[a-z0-9]+)*)-)?(\d+)$/;

/** Adoption states. The ruleset context is required ONLY in `enforced`. */
export const ADOPTION_STATES = ["not-adopted", "bootstrap", "enforced"];

/**
 * Classify a raw tag as a tracker reference, if it is one.
 *
 * A tag is *shaped like* a tracker reference independently of whether the
 * repo declared it — that is what makes an orphan tag detectable rather than
 * silently ignored as "some other tag".
 * @param {string} tag - Raw tag text with the leading `@` already stripped.
 * @returns {{scheme: string, key?: string, repo: string|null, number: number}|null} Parsed reference, or null when the tag is not tracker-shaped.
 */
export function parseTrackerTag(tag) {
  const gh = TRACKER_GH_PATTERN.exec(tag);
  if (gh) {
    return { scheme: "gh", repo: gh[1] ?? null, number: Number(gh[2]) };
  }
  const key = TRACKER_KEY_PATTERN.exec(tag);
  if (key) {
    return { scheme: "key", key: key[1], repo: null, number: Number(key[2]) };
  }
  return null;
}

/**
 * Render a tracker reference as a URL from the repo's declared templates.
 *
 * Emitting the link is a convenience; it is never fetched.
 * @param {object} reference - Parsed reference from {@link parseTrackerTag}.
 * @param {object} trackers - The `trackers` block of the coverage map.
 * @returns {string|null} An absolute URL, or null when no template is declared.
 */
export function trackerUrl(reference, trackers) {
  if (reference.scheme === "gh") {
    const org = trackers?.github?.org;
    const repo = reference.repo ?? trackers?.github?.defaultRepo;
    if (!org || !repo) return null;
    return `https://github.com/${org}/${repo}/issues/${reference.number}`;
  }
  const template = trackers?.keyUrlTemplate;
  if (!template) return null;
  return template
    .replace("{key}", reference.key)
    .replace("{number}", String(reference.number))
    .replace("{id}", `${reference.key}-${reference.number}`);
}

/**
 * Invert `runnerPlatforms` into platform → runners.
 * @param {Record<string, readonly string[]>} runnerPlatforms - Declared runner coverage.
 * @returns {Map<string, string[]>} Platform to the runners configured for it.
 */
export function runnersByPlatform(runnerPlatforms) {
  const index = new Map();
  for (const [runner, platforms] of Object.entries(runnerPlatforms ?? {})) {
    for (const platform of platforms ?? []) {
      index.set(platform, [...(index.get(platform) ?? []), runner]);
    }
  }
  for (const runners of index.values()) runners.sort();
  return index;
}

/**
 * The project's own platform vocabulary, derived from its runner declaration.
 * @param {Record<string, readonly string[]>} runnerPlatforms - Declared runner coverage.
 * @returns {Set<string>} Every platform some configured runner covers.
 */
export function declaredPlatforms(runnerPlatforms) {
  return new Set(runnersByPlatform(runnerPlatforms).keys());
}

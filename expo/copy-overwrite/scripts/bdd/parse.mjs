/**
 * Gherkin feature parsing and repo-safe file resolution for the BDD gate.
 *
 * The parser is deliberately hand-rolled and dependency-free: the gate must
 * run in a bare `node scripts/check-bdd-coverage.mjs` with no install step, in
 * every repo, at a pinned Lisa revision.
 *
 * @module scripts/bdd/parse
 */
import * as fs from "node:fs";
import * as path from "node:path";

import {
  ID_PATTERN,
  LIFECYCLE_TAGS,
  PROVENANCE_PATTERN,
  byCodeUnit,
  parseTrackerTag,
} from "./contract.mjs";

const LIFECYCLE = new Set(LIFECYCLE_TAGS);

/** Normalize a path to posix separators so reports are OS-independent. */
export const posix = value => value.split(path.sep).join("/");

/**
 * Resolve a coverage-map path inside the repo, refusing every escape.
 *
 * A coverage map is repo data that an author edits, so it is treated as
 * untrusted input: absolute paths, `..` traversal, and symlinks that resolve
 * outside the repo are rejected rather than followed. Refusing beats
 * following — a mapping that reads a file outside the repo could "prove"
 * coverage from anything on the runner.
 * @param {string} root - Repo root.
 * @param {string} relative - Repo-relative path from the coverage map.
 * @returns {{path: string|null, error: string|null}} Absolute path, or the reason it was refused.
 */
export function resolveInsideRepo(root, relative) {
  if (typeof relative !== "string" || relative.length === 0) {
    return { path: null, error: "path is missing" };
  }
  if (path.isAbsolute(relative) || /^[a-zA-Z]:/.test(relative)) {
    return { path: null, error: "path must be repo-relative" };
  }
  const resolvedRoot = fs.realpathSync(root);
  const candidate = path.resolve(resolvedRoot, relative);
  if (!isInside(resolvedRoot, candidate)) {
    return { path: null, error: "path escapes the repository" };
  }
  if (!fs.existsSync(candidate)) return { path: null, error: "file not found" };
  const real = fs.realpathSync(candidate);
  if (!isInside(resolvedRoot, real)) {
    return { path: null, error: "symlink resolves outside the repository" };
  }
  return { path: real, error: null };
}

/**
 * True when `child` is `parent` or lives under it.
 * @param {string} parent - Containing directory.
 * @param {string} child - Candidate path.
 * @returns {boolean} Whether the candidate is contained.
 */
function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

/**
 * List files under a directory without following symlinked directories out
 * of the tree, sorted for deterministic output.
 * @param {string} directory - Directory to walk.
 * @param {(file: string) => boolean} predicate - Filter on absolute paths.
 * @returns {string[]} Matching absolute paths, sorted.
 */
export function listFiles(directory, predicate) {
  if (!fs.existsSync(directory)) return [];
  const found = [];
  const stack = [directory];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile() && predicate(full)) found.push(full);
    }
  }
  return found.sort(byCodeUnit);
}

/**
 * Split one tag line into bare tag names.
 * @param {string} trimmed - A trimmed source line beginning with `@`.
 * @returns {string[]} Tag names without their leading `@`.
 */
function tagsOf(trimmed) {
  return trimmed
    .split(/\s+/)
    .filter(token => token.startsWith("@"))
    .map(token => token.slice(1))
    .filter(Boolean);
}

/**
 * Bucket a scenario's pending tags into the contract's categories.
 * @param {readonly string[]} tags - Raw tag names.
 * @param {ReadonlySet<string>} platforms - The project's declared platform vocabulary.
 * @returns {object} Categorized tags, including tracker-shaped references.
 */
function categorize(tags, platforms) {
  const trackers = [];
  for (const tag of tags) {
    const reference = parseTrackerTag(tag);
    if (reference) trackers.push({ tag, ...reference });
  }
  return {
    ids: tags.filter(tag => ID_PATTERN.test(tag)),
    platforms: tags.filter(tag => platforms.has(tag)),
    lifecycle: tags.filter(tag => LIFECYCLE.has(tag)),
    provenance: tags.filter(tag => PROVENANCE_PATTERN.test(tag)),
    trackers,
  };
}

/**
 * Parse one `.feature` source into scenarios.
 *
 * Tags accumulate until a `Feature:` or `Scenario:` consumes them, matching
 * Gherkin's own tag scoping. `Scenario Outline` is treated as one scenario:
 * the contract counts behaviors, not example rows.
 *
 * `Background:` steps are Gherkin's way of saying "every scenario in this
 * feature starts here", so they SEED each scenario's primary steps. Ignoring
 * them made a conforming feature file — Given in the Background, When/Then in
 * each scenario — report `scenario-steps` defects it did not have, which in
 * enforced mode fails a repo for writing correct Gherkin.
 * @param {string} source - File contents.
 * @param {string} file - Repo-relative path, for error locations.
 * @param {ReadonlySet<string>} platforms - The project's declared platform vocabulary.
 * @returns {object[]} Parsed scenarios in source order.
 */
export function parseFeatureSource(source, file, platforms) {
  const scenarios = [];
  const lines = source.split(/\r?\n/);
  let feature = null;
  let featureTags = [];
  let featureIdTags = [];
  let featureLine = 0;
  let pending = [];
  let current = null;
  let background = null;
  let backgroundSteps = [];
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (trimmed.startsWith("#")) continue;
    if (trimmed.startsWith("@")) {
      pending.push(...tagsOf(trimmed));
      continue;
    }
    const featureMatch = /^Feature:\s*(.+)$/.exec(trimmed);
    if (featureMatch) {
      feature = featureMatch[1].trim();
      // Gherkin inherits Feature-level tags down to every scenario in the
      // file. Dropping them made an inherited @web or @ratified-* read as
      // missing, so a conforming feature file failed on defects it did not
      // have. Scenario IDs are deliberately NOT inherited — a feature-level
      // @BDD-* would hand every scenario the same ID, which is a duplicate,
      // so it is reported instead.
      featureTags = pending.filter(tag => !ID_PATTERN.test(tag));
      featureIdTags = pending.filter(tag => ID_PATTERN.test(tag));
      featureLine = index + 1;
      pending = [];
      current = null;
      background = null;
      backgroundSteps = [];
      continue;
    }
    if (/^Background:/.test(trimmed)) {
      // Background is per-Feature, so it replaces any previous one rather than
      // accumulating, and its steps are collected instead of a scenario's.
      backgroundSteps = [];
      background = backgroundSteps;
      current = null;
      continue;
    }
    const scenarioMatch = /^Scenario(?: Outline| Template)?:\s*(.+)$/.exec(
      trimmed
    );
    if (scenarioMatch) {
      // Inherited tags come first so a scenario's own tags read last, and
      // duplicates are collapsed: a scenario repeating an inherited @web must
      // not look like it declared the platform twice.
      const effective = [...new Set([...featureTags, ...pending])];
      const grouped = categorize(effective, platforms);
      current = {
        id: grouped.ids[0] ?? null,
        name: scenarioMatch[1].trim(),
        feature: feature ?? "Unknown feature",
        file,
        line: index + 1,
        tags: effective,
        ownTags: [...pending],
        inheritedTags: [...featureTags],
        featureIdTags,
        featureLine,
        ...grouped,
        required: grouped.lifecycle.length === 0,
        primarySteps: [...backgroundSteps],
      };
      scenarios.push(current);
      background = null;
      pending = [];
      continue;
    }
    const step = /^(Given|When|Then)\b/.exec(trimmed);
    if (!step) continue;
    if (background) background.push(step[1]);
    else if (current) current.primarySteps.push(step[1]);
  }
  return scenarios;
}

/**
 * Load every scenario declared under `bdd/features`.
 * @param {string} root - Repo root.
 * @param {ReadonlySet<string>} platforms - The project's declared platform vocabulary.
 * @returns {object[]} Every parsed scenario, in stable file order.
 */
export function loadScenarios(root, platforms) {
  const featureRoot = path.join(root, "bdd", "features");
  return listFiles(featureRoot, file => file.endsWith(".feature")).flatMap(
    file =>
      parseFeatureSource(
        fs.readFileSync(file, "utf8"),
        posix(path.relative(root, file)),
        platforms
      )
  );
}

/**
 * Extract the scenario IDs present in a raw set of feature sources.
 *
 * Used against a base revision to detect scenarios deleted rather than
 * `@superseded` — the denominator-gaming move the contract forbids.
 * @param {readonly string[]} sources - Feature file contents.
 * @returns {Set<string>} Every `BDD-*` ID found.
 */
export function scenarioIdsIn(sources) {
  const ids = new Set();
  for (const source of sources) {
    for (const line of source.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("@")) continue;
      for (const tag of tagsOf(trimmed)) if (ID_PATTERN.test(tag)) ids.add(tag);
    }
  }
  return ids;
}

// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * Threshold ratchet — watched file families and value extractors.
 *
 * Pure extraction layer: given file contents, produce comparable constraint
 * maps. No filesystem or git access. See threshold-ratchet.mjs for the CLI
 * and threshold-ratchet-compare.mjs for the comparison rules.
 */

/**
 * File families the ratchet watches. `kind` selects the extractor;
 * `direction` applies to numeric-leaf kinds ("min" values may only rise,
 * "max" values may only fall).
 *
 * PER-FAMILY POLICY, reviewed 2026-08-12. A family keeps its ratchet unless a
 * NAMED deterministic non-regression invariant replaces the property the
 * ratchet was providing — deleting a ratchet deletes that property with it, so
 * "this generates churn" is a reason to find a replacement, never a reason to
 * delete on its own:
 *
 *   coverage / simplecov / e2e   KEPT. Here the ratchet IS the non-regression
 *     invariant, and no per-item equivalent exists short of committing a
 *     per-file coverage baseline — an artifact that only ever accumulates.
 *     Revisit if one appears.
 *   stryker                      KEPT. `thresholds.break` is an absolute floor,
 *     kept outright; the mutate-list comparison detects EXEMPTION ADDITIONS
 *     rather than creep, and has no number for a pull request to nudge.
 *   eslint / rubocop / k6 / lisa-config   KEPT, unchanged.
 *
 * Exactly one family was replaced, and it is not watched here and never was:
 * the BDD traceability floor, whose numeric ratchet gave way to per-obligation
 * checks. See `expo/copy-overwrite/scripts/bdd/baseline.mjs`.
 *
 * Retiring a family is SEQUENCED: the replacement invariant lands, then a
 * `thresholdRatchet.allow` entry merges from the base side, then the mechanism
 * changes. Never the reverse — this checker is precisely what stops a change
 * granting itself the exception that permits it.
 */
export const FAMILIES = [
  {
    id: "coverage",
    match: /(^|\/)(vitest|jest)\.thresholds\.json$/,
    kind: "json-num",
    direction: "min",
  },
  {
    id: "simplecov",
    match: /(^|\/)simplecov\.thresholds\.json$/,
    kind: "json-num",
    direction: "min",
  },
  {
    id: "e2e",
    match: /(^|\/)e2e\.thresholds\.json$/,
    kind: "json-num",
    direction: "min",
  },
  {
    id: "eslint",
    match: /(^|\/)eslint\.thresholds\.json$/,
    kind: "json-num",
    direction: "max",
  },
  {
    id: "rubocop",
    match: /(^|\/)rubocop\.thresholds\.yml$/,
    kind: "rubocop-yaml",
    direction: "max",
  },
  { id: "stryker", match: /(^|\/)stryker\.conf\.json$/, kind: "stryker" },
  {
    id: "k6",
    match: /(^|\/)\.github\/k6\/thresholds\/[^/]+\.json$/,
    kind: "k6",
  },
  {
    // #3992. The always-on eager rule tier is concatenated into every session
    // AND every subagent start, so its byte ceiling is a quality threshold like
    // any other. `max` because the number is a ceiling: lowering it tightens the
    // gate and is free, raising it re-authorises context the cleanup removed and
    // is the change a human has to see. The tier was cut to 26,540 bytes once
    // and regrew to 201,083 in fourteen weeks with nothing watching it.
    id: "eager-rules",
    match: /(^|\/)eager-rules\.thresholds\.json$/,
    kind: "json-num",
    direction: "max",
  },
  {
    id: "lisa-config",
    match: /(^|\/)\.lisa\.config\.json$/,
    kind: "allow-list",
  },
  {
    // The #3811 quarantine. `allow-list` is exactly right here: the list may
    // shrink freely, and ADDING a file — re-authorising type debt that the
    // gate would otherwise refuse — is the change that needs a human to see it.
    id: "typecheck-quarantine",
    match: /(^|\/)typecheck-quarantine\.json$/,
    kind: "allow-list",
  },
  {
    id: "lighthouse",
    match: /(^|\/)(?:lighthouserc-config|lighthouserc|\.lighthouserc)\.json$/,
    kind: "lighthouse",
  },
];

/**
 * Which way each Lighthouse assertion key ratchets.
 *
 * Lighthouse mixes floors and ceilings in one file, so assigning one direction
 * to the whole family would silently approve half of the possible weakenings.
 * Unknown keys stay unwatched until their direction is explicit here.
 * @type {Readonly<Record<string, "min"|"max">>}
 */
export const LIGHTHOUSE_ASSERTION_DIRECTIONS = Object.freeze({
  minScore: "min",
  maxNumericValue: "max",
  maxLength: "max",
});

const LIGHTHOUSE_LEVELS = Object.freeze({ off: 0, warn: 1, error: 2 });

/**
 * Extract numeric Lighthouse assertions with a direction chosen per key.
 *
 * A malformed array is deliberately ignored instead of being walked as an
 * object whose numeric indices look like audit names.
 * @param {unknown} conf Parsed lighthouserc-config.json
 * @returns {Map<string, { value: number, direction: "min"|"max" }>} Dotted
 *   `assertion.key` path to numeric constraint
 */
export function extractLighthouseAssertions(conf) {
  const out = new Map();
  const root =
    conf && typeof conf === "object" && !Array.isArray(conf)
      ? /** @type {Record<string, unknown>} */ (conf)
      : undefined;
  const ci =
    root?.ci && typeof root.ci === "object" && !Array.isArray(root.ci)
      ? /** @type {Record<string, unknown>} */ (root.ci)
      : undefined;
  const assert =
    ci?.assert && typeof ci.assert === "object" && !Array.isArray(ci.assert)
      ? /** @type {Record<string, unknown>} */ (ci.assert)
      : undefined;
  // Lighthouse CI's canonical shape is `ci.assert.assertions`. Keep the
  // historical top-level shape as a compatibility lane for already-generated
  // project configs, but never merge the two into an ambiguous hybrid.
  const assertions = assert?.assertions ?? root?.assertions;
  if (
    !assertions ||
    typeof assertions !== "object" ||
    Array.isArray(assertions)
  ) {
    return out;
  }
  for (const [audit, spec] of Object.entries(assertions)) {
    const level = Array.isArray(spec) ? spec[0] : spec;
    if (typeof level === "string" && Object.hasOwn(LIGHTHOUSE_LEVELS, level)) {
      out.set(`${audit}.$level`, {
        value: LIGHTHOUSE_LEVELS[level],
        direction: "min",
      });
    }
    const options =
      Array.isArray(spec) &&
      spec.length >= 2 &&
      spec[1] &&
      typeof spec[1] === "object" &&
      !Array.isArray(spec[1])
        ? /** @type {Record<string, unknown>} */ (spec[1])
        : spec && typeof spec === "object" && !Array.isArray(spec)
          ? /** @type {Record<string, unknown>} */ (spec)
          : undefined;
    if (!options) continue;
    for (const [key, value] of Object.entries(options)) {
      const direction = Object.hasOwn(LIGHTHOUSE_ASSERTION_DIRECTIONS, key)
        ? LIGHTHOUSE_ASSERTION_DIRECTIONS[key]
        : undefined;
      if (direction && typeof value === "number" && Number.isFinite(value)) {
        out.set(`${audit}.${key}`, { value, direction });
      }
    }
  }
  return out;
}

/**
 * Find the family a repo-relative path belongs to.
 * @param {string} relPath Repo-relative path (forward slashes)
 * @returns {(typeof FAMILIES)[number] | undefined} The matching family, or
 *   undefined when the path is not a watched gate file
 */
export function familyFor(relPath) {
  return FAMILIES.find(f => f.match.test(relPath));
}

/**
 * Safe JSON parse.
 * @param {string | null | undefined} text JSON text
 * @returns {unknown | undefined} Parsed value, or undefined on failure
 */
export function parseJson(text) {
  if (typeof text !== "string") return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Walk a JSON object and collect numeric leaves as dotted-path constraints.
 * Keys starting with "_" (e.g. `_comment`) are documentation, not thresholds.
 * @param {unknown} node Parsed JSON value
 * @param {"min"|"max"} direction Ratchet direction for every leaf
 * @param {string} [prefix] Dotted path accumulated so far
 * @returns {Map<string, { value: number, direction: "min"|"max" }>} Dotted
 *   path → numeric constraint for every finite numeric leaf
 */
export function extractNumericLeaves(node, direction, prefix = "") {
  const out = new Map();
  if (node === null || typeof node !== "object" || Array.isArray(node)) {
    return out;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith("_")) continue;
    const p = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "number" && Number.isFinite(value)) {
      out.set(p, { value, direction });
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const [cp, c] of extractNumericLeaves(value, direction, p)) {
        out.set(cp, c);
      }
    }
  }
  return out;
}

/**
 * Minimal parser for rubocop.thresholds.yml — a two-level document of
 * `Section:` headers with indented `Key: <number>` scalars (comments and
 * blank lines ignored). Deliberately NOT a general YAML parser: the file is
 * Lisa-authored with this exact shape, and hand-parsing keeps the gate
 * dependency-free with no backtracking-prone regexes.
 * @param {string} text File contents
 * @param {"min"|"max"} direction Ratchet direction for every scalar
 * @returns {Map<string, { value: number, direction: "min"|"max" }>} Dotted
 *   `Section.Key` path → numeric constraint
 */
export function extractRubocopThresholds(text, direction) {
  const out = new Map();
  const state = { section: "" };
  for (const rawLine of text.split("\n")) {
    const hash = rawLine.indexOf("#");
    const line = (hash >= 0 ? rawLine.slice(0, hash) : rawLine).trimEnd();
    if (!line.trim()) continue;
    const indented = line.startsWith(" ") || line.startsWith("\t");
    if (!indented && line.endsWith(":")) {
      state.section = line.slice(0, -1).trim();
      continue;
    }
    const colon = line.indexOf(":");
    if (!indented || colon < 0 || !state.section) continue;
    const key = line.slice(0, colon).trim();
    const rawValue = line.slice(colon + 1).trim();
    // Number("") is 0, so an empty value (e.g. a nested `Exclude:` list
    // header) must be skipped, not recorded as a zero threshold.
    const value = Number(rawValue);
    if (key && rawValue !== "" && Number.isFinite(value)) {
      out.set(`${state.section}.${key}`, { value, direction });
    }
  }
  return out;
}

/**
 * Extract the gating constraint from stryker.conf.json: only
 * `thresholds.break` fails a run (`high`/`low` are reporting bands).
 * @param {unknown} conf Parsed stryker.conf.json
 * @returns {Map<string, { value: number, direction: "min"|"max" }>} The
 *   `thresholds.break` constraint when present, otherwise an empty map
 */
export function extractStrykerConstraints(conf) {
  const out = new Map();
  const breakValue = conf?.thresholds?.break;
  if (typeof breakValue === "number" && Number.isFinite(breakValue)) {
    out.set("thresholds.break", { value: breakValue, direction: "min" });
  }
  return out;
}

/**
 * Split a stryker `mutate` array into positive globs and negations.
 * @param {unknown} conf Parsed stryker.conf.json
 * @returns {{ positives: Set<string>, negations: Set<string> }} Globs that
 *   include files vs. `!`-prefixed globs that exclude them
 */
export function extractStrykerMutate(conf) {
  const positives = new Set();
  const negations = new Set();
  const mutate = Array.isArray(conf?.mutate) ? conf.mutate : [];
  for (const glob of mutate) {
    if (typeof glob !== "string") continue;
    if (glob.startsWith("!")) negations.add(glob);
    else positives.add(glob);
  }
  return { positives, negations };
}

/**
 * Parse one k6 threshold expression (`p(95)<1000`, `rate>=0.99`, …) into a
 * ratchet constraint. Upper bounds (`<`, `<=`) may only decrease; lower
 * bounds (`>`, `>=`) may only increase. Hand-parsed — no regex.
 * @param {string} expr Threshold expression
 * @returns {{ value: number, direction: "min"|"max" } | undefined} The bound
 *   as a constraint, or undefined when the expression has no numeric bound
 */
export function parseK6Expression(expr) {
  for (const op of ["<=", ">=", "<", ">"]) {
    const idx = expr.indexOf(op);
    if (idx < 0) continue;
    const value = Number(expr.slice(idx + op.length).trim());
    if (!Number.isFinite(value)) return undefined;
    return { value, direction: op.startsWith("<") ? "max" : "min" };
  }
  return undefined;
}

/**
 * Extract constraints from a k6 thresholds file. Each metric contributes its
 * expression bound(s) plus (when present) `abortOnFail` boolean constraints —
 * turning abortOnFail off makes the gate advisory, which is a weakening.
 * Handles every documented k6 shape: a bare expression string, a single long
 * form `{ threshold, abortOnFail }` object, and arrays mixing both.
 * @param {unknown} conf Parsed k6 thresholds JSON
 * @returns {{
 *   numeric: Map<string, { value: number, direction: "min"|"max" }>,
 *   booleans: Map<string, boolean>,
 * }} Numeric bounds keyed by `<metric>.threshold[i]` and abortOnFail flags
 *   keyed by `<metric>.abortOnFail` (`[i]`-suffixed for array items)
 */
export function extractK6Constraints(conf) {
  const numeric = new Map();
  const booleans = new Map();
  const thresholds = conf?.thresholds;
  if (thresholds && typeof thresholds === "object") {
    for (const [metric, spec] of Object.entries(thresholds)) {
      const isArray = Array.isArray(spec);
      const items = isArray ? spec : [spec];
      items.forEach((item, i) => {
        const expr =
          typeof item === "string"
            ? item
            : item && typeof item === "object" && !Array.isArray(item)
              ? item.threshold
              : undefined;
        if (typeof expr === "string") {
          const c = parseK6Expression(expr);
          if (c) numeric.set(`${metric}.threshold[${i}]`, c);
        }
        if (
          item &&
          typeof item === "object" &&
          !Array.isArray(item) &&
          typeof item.abortOnFail === "boolean"
        ) {
          booleans.set(
            isArray ? `${metric}.abortOnFail[${i}]` : `${metric}.abortOnFail`,
            item.abortOnFail
          );
        }
      });
    }
  }
  return { numeric, booleans };
}

/**
 * Extract thresholdRatchet.allow entries from parsed .lisa.config.json.
 * @param {unknown} config Parsed config (may be undefined)
 * @returns {Array<{ file: string, key: string, reason?: string }>} The
 *   well-formed allow entries; malformed entries are dropped
 */
export function extractAllowEntries(config) {
  const raw = config?.thresholdRatchet?.allow;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    e => e && typeof e.file === "string" && typeof e.key === "string"
  );
}

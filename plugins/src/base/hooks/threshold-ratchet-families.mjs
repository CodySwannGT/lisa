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
    id: "audit-ignore",
    match: /(^|\/)audit\.ignore\.(config|local)\.json$/,
    kind: "exemption-list",
  },
  {
    id: "lisa-config",
    match: /(^|\/)\.lisa\.config\.json$/,
    kind: "allow-list",
  },
];

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
 * Flatten an exemption file (audit ignore list) into a set of entry tokens.
 * Arrays contribute their string items; objects contribute their keys.
 * @param {unknown} conf Parsed JSON
 * @returns {Set<string>} One token per exemption entry
 */
export function extractExemptionEntries(conf) {
  const out = new Set();
  if (Array.isArray(conf)) {
    for (const item of conf) {
      if (typeof item === "string") out.add(item);
      else if (item && typeof item === "object") out.add(JSON.stringify(item));
    }
  } else if (conf && typeof conf === "object") {
    for (const [key, value] of Object.entries(conf)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          out.add(
            `${key}:${typeof item === "string" ? item : JSON.stringify(item)}`
          );
        }
      } else {
        out.add(key);
      }
    }
  }
  return out;
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

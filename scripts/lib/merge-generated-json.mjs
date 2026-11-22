/**
 * merge-generated-json — the pointwise three-way merge for Lisa's JSON
 * generated artifacts (`src/core/upstream-evidence-manifest.json`,
 * `src/core/lisa-owned-hash-ledger.json`).
 *
 * Same semantics as the line-based merge in `scripts/merge-generated-artifact.mjs`,
 * which this module is dispatched from, on a parsed model instead of source
 * lines: JSON has no trailing commas, so a line-level merge that appends an
 * entry after the last one would emit an invalid file. Parsing first removes
 * that hazard, and re-rendering with `formatGeneratedJson` reproduces the
 * generators' exact bytes because both generators render through it, with
 * keys and array elements already sorted.
 *
 * The accepted shape is deliberately narrow — a top-level object whose every
 * value is a RECORD of `key -> scalar | scalar[]` — because pointwise merging
 * is only sound for an accumulator keyed by one input. A top-level scalar (a
 * count, a description) or a nested record is refused, so an artifact outside
 * that shape conflicts rather than merging into something plausible and wrong.
 *
 * @module scripts/lib/merge-generated-json
 */

/** Identity standing for "this side does not have this entry". */
const ABSENT = "\u0000absent";

/**
 * Compare two keys the way both generators sort theirs (UTF-16 code units).
 * @param {string} left - First key
 * @param {string} right - Second key
 * @returns {number} Negative, zero, or positive per the comparator contract
 */
function compareKeys(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/**
 * Whether a value is a plain JSON object (not an array, not null).
 * @param {unknown} value - Candidate
 * @returns {boolean} True for a plain object
 */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Whether a value is a JSON scalar.
 * @param {unknown} value - Candidate
 * @returns {boolean} True for a string, number, boolean, or null
 */
function isScalar(value) {
  return (
    value === null || ["string", "number", "boolean"].includes(typeof value)
  );
}

/**
 * Whether a text looks like a JSON artifact rather than a TypeScript module.
 * @param {string} text - Artifact contents
 * @returns {boolean} True when the first non-space character opens an object
 */
export function isJsonArtifact(text) {
  return text.trimStart().startsWith("{");
}

/**
 * Parse a JSON artifact into named records of entries.
 * @param {string} text - Artifact contents
 * @returns {{ok: true, records: Map<string, Map<string, unknown>>} | {ok: false, reason: string}} Parse result
 */
export function parseJsonArtifact(text) {
  let document;
  try {
    document = JSON.parse(text);
  } catch (error) {
    return { ok: false, reason: `not valid JSON (${error.message})` };
  }
  if (!isRecord(document))
    return { ok: false, reason: "the top level is not an object" };
  const records = new Map();
  for (const [name, record] of Object.entries(document)) {
    if (!isRecord(record))
      return {
        ok: false,
        reason: `top-level value ${name} is not a record of entries`,
      };
    for (const [key, value] of Object.entries(record)) {
      const flat =
        isScalar(value) || (Array.isArray(value) && value.every(isScalar));
      if (!flat)
        return {
          ok: false,
          reason: `entry ${name}.${key} is nested, not a scalar or a list of scalars`,
        };
    }
    records.set(name, new Map(Object.entries(record)));
  }
  return { ok: true, records };
}

/**
 * A record entry whose value is a string, on one line as `JSON.stringify` puts it.
 * The key and value are JSON string literals, so neither can contain an
 * unescaped quote and the pattern cannot match across entries.
 */
const STRING_ENTRY_LINE = /^( +)("(?:[^"\\]|\\.)*"): ("(?:[^"\\]|\\.)*")(,?)$/u;

/**
 * Serialize a generated artifact the one way every writer of it agrees on.
 *
 * Two-space `JSON.stringify` output, except that an entry whose value is a
 * string puts the value on its own line under the key. The evidence manifest
 * maps file paths to SHA-256 digests, and a path that names a key, token or
 * secret next to a 64-character hex digest on one line is indistinguishable
 * from `api_key: <credential>` to a generic secret scanner. Splitting the pair
 * keeps the scanner pointed at real credentials without an ignore list, and it
 * is still plain JSON, so every reader stays `JSON.parse`.
 * @param {unknown} document - The artifact's parsed form
 * @returns {string} JSON text, newline-terminated
 */
export function formatGeneratedJson(document) {
  const text = JSON.stringify(document, null, 2)
    .split("\n")
    .map(line => line.replace(STRING_ENTRY_LINE, "$1$2:\n$1  $3$4"))
    .join("\n");
  return `${text}\n`;
}

/**
 * Re-emit parsed records exactly as the generators write them.
 * @param {Map<string, Map<string, unknown>>} records - Named records, in file order
 * @returns {string} JSON text, newline-terminated
 */
export function renderJsonArtifact(records) {
  const document = Object.fromEntries(
    [...records].map(([name, entries]) => [
      name,
      Object.fromEntries(
        [...entries].sort(([left], [right]) => compareKeys(left, right))
      ),
    ])
  );
  return formatGeneratedJson(document);
}

/**
 * Stable identity of an entry value, or its absence.
 * @param {unknown} value - Entry value
 * @returns {string} Comparison key
 */
const identity = value =>
  value === undefined ? ABSENT : JSON.stringify(value);

/**
 * Union two append-only list entries that both grew from the same base.
 *
 * Only sound when neither side REMOVED an element: append-only is the ledger
 * generator's own invariant, so a side that dropped one is not an append.
 * @param {unknown} base - Merge-base value, undefined when absent there
 * @param {boolean} hasBase - Whether merge-base information exists at all
 * @param {unknown} ours - Our value
 * @param {unknown} theirs - Their value
 * @returns {unknown[] | undefined} Sorted union, when the union is sound
 */
function unionLists(base, hasBase, ours, theirs) {
  if (!Array.isArray(ours) || !Array.isArray(theirs)) return undefined;
  if (hasBase && base !== undefined) {
    if (!Array.isArray(base)) return undefined;
    const kept = base.every(
      item => ours.includes(item) && theirs.includes(item)
    );
    if (!kept) return undefined;
  }
  return [...new Set([...ours, ...theirs])].sort((left, right) =>
    compareKeys(String(left), String(right))
  );
}

/**
 * Merge one entry three ways.
 * @param {{hasBase: boolean, base: unknown, ours: unknown, theirs: unknown, resolveDerived: boolean}} sides - The entry on each side
 * @returns {{kind: "value" | "derived", value: unknown} | {kind: "conflict"}} Outcome
 */
function mergeEntry({ hasBase, base, ours, theirs, resolveDerived }) {
  if (identity(ours) === identity(theirs))
    return { kind: "value", value: ours };
  if (hasBase && identity(ours) === identity(base))
    return { kind: "value", value: theirs };
  if (hasBase && identity(theirs) === identity(base))
    return { kind: "value", value: ours };
  if (ours === undefined || theirs === undefined) return { kind: "conflict" };
  const unioned = unionLists(base, hasBase, ours, theirs);
  if (unioned !== undefined) return { kind: "value", value: unioned };
  if (resolveDerived) return { kind: "derived", value: ours };
  return { kind: "conflict" };
}

/**
 * Merge one named record.
 * @param {Map<string, unknown> | undefined} base - Merge-base entries
 * @param {Map<string, unknown>} ours - Our entries
 * @param {Map<string, unknown>} theirs - Their entries
 * @param {boolean} resolveDerived - Whether a contested entry may take our side
 * @returns {{ok: true, entries: Map<string, unknown>, resolved: string[]} | {ok: false, reason: string}} Merged record
 */
function mergeRecord(base, ours, theirs, resolveDerived) {
  const entries = new Map();
  const resolved = [];
  const keys = [
    ...new Set([...(base?.keys() ?? []), ...ours.keys(), ...theirs.keys()]),
  ].sort(compareKeys);
  for (const key of keys) {
    const outcome = mergeEntry({
      hasBase: base !== undefined,
      base: base?.get(key),
      ours: ours.get(key),
      theirs: theirs.get(key),
      resolveDerived,
    });
    if (outcome.kind === "conflict")
      return {
        ok: false,
        reason: `both sides changed the entry for ${key} in incompatible ways`,
      };
    if (outcome.kind === "derived") resolved.push(key);
    if (outcome.value !== undefined) entries.set(key, outcome.value);
  }
  return { ok: true, entries, resolved };
}

/**
 * Merge three versions of one JSON generated artifact.
 * @param {string} base - `%O` contents ("" when the file is new on both sides)
 * @param {string} ours - `%A` contents
 * @param {string} theirs - `%B` contents
 * @param {boolean} resolveDerived - Whether a contested entry may take our side
 * @returns {{ok: true, text: string, resolved: string[]} | {ok: false, reason: string}} Merge result
 */
export function mergeJsonArtifact(base, ours, theirs, resolveDerived) {
  const parsedOurs = parseJsonArtifact(ours);
  const parsedTheirs = parseJsonArtifact(theirs);
  if (!parsedOurs.ok)
    return { ok: false, reason: `ours: ${parsedOurs.reason}` };
  if (!parsedTheirs.ok)
    return { ok: false, reason: `theirs: ${parsedTheirs.reason}` };
  const parsedBase = base === "" ? undefined : parseJsonArtifact(base);
  if (parsedBase !== undefined && !parsedBase.ok)
    return { ok: false, reason: `base: ${parsedBase.reason}` };
  const shape = records => [...records.keys()].join(",");
  if (shape(parsedOurs.records) !== shape(parsedTheirs.records))
    return {
      ok: false,
      reason: "the two sides have different block structures",
    };
  const baseRecords =
    parsedBase !== undefined &&
    shape(parsedBase.records) === shape(parsedOurs.records)
      ? parsedBase.records
      : undefined;
  const merged = new Map();
  const resolved = [];
  for (const [name, ourEntries] of parsedOurs.records) {
    const result = mergeRecord(
      baseRecords?.get(name),
      ourEntries,
      parsedTheirs.records.get(name),
      resolveDerived
    );
    if (!result.ok) return result;
    resolved.push(...result.resolved);
    merged.set(name, result.entries);
  }
  return { ok: true, text: renderJsonArtifact(merged), resolved };
}

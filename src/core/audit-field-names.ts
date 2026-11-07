/**
 * Classify the field names an audit exclusion carries (#4521).
 *
 * Only five fields decide what an exclusion excuses: `id`, `cve`, `package`,
 * `versions` and `paths`. A misspelling of one of those (`path`, `Paths`,
 * `pathes`, `version`) used to be ignored, which silently turned a scoped entry
 * into an advisory- or package-wide one, so a near-miss of a scope-bearing
 * field fails closed. Any other unrecognized key (`url`, `title`, `expires`) is
 * harmless documentation: the audit ignores it, exactly as before, and doctor
 * mentions it so nobody believes it does something.
 * @module core/audit-field-names
 */

/** The fields whose values decide what an exclusion excuses. */
const SCOPE_FIELDS = ["id", "cve", "package", "versions", "paths"] as const;

/** Fields an exclusion is documented to carry: scope plus decision record. */
const KNOWN_FIELDS: ReadonlySet<string> = new Set([
  ...SCOPE_FIELDS,
  "active",
  "reason",
  "notes",
  "justification",
  "decision",
  "rationale",
  "comment",
  "owner",
  "tracking",
  "review_by",
  "expiry_enforced",
]);

/**
 * Lowercase and drop separators, so `Paths`, `pa_ths` and `PATHS` compare equal.
 * @param key - A field name
 * @returns The normalized name
 */
function normalize(key: string): string {
  return key.toLowerCase().replace(/[\s_.-]/gu, "");
}

/** Two previous rows of the edit-distance table. */
interface DistanceRows {
  readonly beforeLast: readonly number[];
  readonly last: readonly number[];
}

/**
 * Optimal-string-alignment (restricted Damerau-Levenshtein) distance.
 * @param a - First string
 * @param b - Second string
 * @returns Single-character edits, counting an adjacent swap as one
 */
function editDistance(a: string, b: string): number {
  const first = Array.from({ length: b.length + 1 }, (_, j) => j);
  const { last } = [...a].reduce<DistanceRows>(
    ({ beforeLast, last: above }, aChar, aIndex) => {
      const i = aIndex + 1;
      const row = [...b].reduce<readonly number[]>(
        (cells, bChar, bIndex) => {
          const j = bIndex + 1;
          const substitution = (above[j - 1] ?? 0) + (aChar === bChar ? 0 : 1);
          const best = Math.min(
            (above[j] ?? 0) + 1,
            (cells[j - 1] ?? 0) + 1,
            substitution
          );
          const swapped =
            i > 1 && j > 1 && aChar === b[j - 2] && a[i - 2] === bChar
              ? (beforeLast[j - 2] ?? 0) + 1
              : Number.POSITIVE_INFINITY;
          return [...cells, Math.min(best, swapped)];
        },
        [i]
      );
      return { beforeLast: above, last: row };
    },
    { beforeLast: first, last: first }
  );
  return last[b.length] ?? 0;
}

/**
 * The scope field an unknown key was probably meant to be, if any.
 *
 * A near-miss is a case or separator variant, a singular/plural swap, or an
 * edit distance of at most 2 — at most 1 for the two-letter `id` and the
 * three-letter `cve`, where distance 2 would capture unrelated short keys such
 * as `by` or `pr`.
 * @param key - An unrecognized field name
 * @returns The scope field it nearly matches, or undefined
 */
function nearScopeField(key: string): string | undefined {
  const name = normalize(key);
  return SCOPE_FIELDS.find(field => {
    const stem = field.endsWith("s") ? field.slice(0, -1) : field;
    const pluralSwap = [stem, `${stem}s`, `${stem}es`, `${field}s`];
    return (
      name === field ||
      pluralSwap.includes(name) ||
      editDistance(name, field) <= (field.length <= 3 ? 1 : 2)
    );
  });
}

/** One unrecognized key that nearly matches a scope field. */
export interface MisspelledScopeField {
  readonly key: string;
  readonly meant: string;
}

/** How an exclusion's unrecognized fields are classified. */
export interface UnknownFields {
  /** Near-misses of a scope field: each one fails closed. */
  readonly misspelledScope: readonly MisspelledScopeField[];
  /** Other unrecognized keys: ignored by the audit, noted by doctor. */
  readonly ignored: readonly string[];
}

/**
 * Classify every key the documented contract does not name.
 * Keys starting with `//` are the JSON comment convention and are skipped.
 * @param entry - Exclusion fields
 * @returns The near-miss scope fields and the ignored keys
 */
export function classifyUnknownFields(
  entry: Readonly<Record<string, unknown>>
): UnknownFields {
  const unknown = Object.keys(entry).filter(
    key => !KNOWN_FIELDS.has(key) && !key.startsWith("//")
  );
  const misspelledScope = unknown.flatMap(key => {
    const meant = nearScopeField(key);
    return meant === undefined ? [] : [{ key, meant }];
  });
  return {
    misspelledScope,
    ignored: unknown.filter(
      key => !misspelledScope.some(near => near.key === key)
    ),
  };
}

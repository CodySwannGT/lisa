/**
 * Audit-allowlist reading for the dependencies/supply-chain readiness producer
 * (B5, PRD #1739, #1896).
 *
 * An audit allowlist is a list of vulnerabilities somebody decided not to fix.
 * B5 asks the only question that keeps such a list honest: is the decision
 * written down next to the exception? Two failure directions matter equally and
 * this module is shaped by both.
 *
 * Reporting too much fabricates findings — audit-ci's own `.nsprc` carries
 * `$schema` and other configuration at the same level as advisory ids, so a
 * naive walk reports the schema pointer as an undocumented exclusion. Reporting
 * too little is worse: an entry with no `id` field, or a bare string in the
 * list, is still a live exception with no written decision, and dropping it
 * turns the one finding this dimension exists for into silence. Identity
 * therefore degrades (advisory id → package name → position) rather than
 * disappearing.
 * @module cli/doctor-readiness-audit-allowlist
 */
import { isRecord, readFileOrNull } from "./doctor-readiness-shared.js";

/** Audit allowlists whose entries must each carry a decision record. */
const ALLOWLIST_FILES: readonly string[] = [
  "audit.ignore.config.json",
  "audit.ignore.local.json",
  ".nsprc",
];

/** Keys that count as the written decision behind an audit exception. */
const DECISION_KEYS: readonly string[] = [
  "reason",
  "notes",
  "justification",
  "decision",
  "rationale",
  "comment",
];

/**
 * Keys whose value holds audit exceptions. Everything outside these containers
 * is configuration, not an exception — walking a whole document as if every
 * top-level key were an advisory id turns audit-ci's own `.nsprc` (`$schema`,
 * `exceptions`, …) into fabricated findings.
 */
const EXCEPTION_CONTAINERS: readonly string[] = [
  "exclusions",
  "exceptions",
  "advisories",
  "allowlist",
];

/**
 * Whether a top-level `.nsprc`-style key names an advisory rather than config.
 * @param key - The key to classify
 * @returns True when the key may name an advisory
 */
function isAdvisoryKey(key: string): boolean {
  return !key.startsWith("$") && !key.startsWith("//");
}

/** One audit exception, normalized across every allowlist shape. */
interface ExceptionEntry {
  /** Operator-facing identity: an advisory id, a package name, or a position. */
  readonly id: string;
  /** The entry's fields, or null when the entry was a bare string. */
  readonly fields: Record<string, unknown> | null;
}

/**
 * Name one array-shaped exception for an operator.
 *
 * An entry with no `id` must never be dropped — a live exception with no written
 * decision is precisely what B5 exists to surface, and a missing field is not a
 * reason to suppress it. So the identity degrades: advisory id, then package
 * name, then the entry's position in the list.
 * @param entry - The entry's fields
 * @param index - Zero-based position in the container
 * @returns The operator-facing identity
 */
function describeException(
  entry: Record<string, unknown>,
  index: number
): string {
  if (typeof entry.id === "string" && entry.id.trim() !== "") {
    return entry.id;
  }
  return typeof entry.package === "string" && entry.package.trim() !== ""
    ? entry.package
    : `entry #${index + 1}`;
}

/**
 * Normalize one array-shaped exception container.
 *
 * A bare string entry IS the advisory id, and it carries no fields at all — so
 * there is nowhere for a decision to live, which makes it undocumented by
 * construction rather than something to skip over.
 * @param container - The array of entries
 * @returns The normalized exceptions
 */
function arrayEntries(
  container: readonly unknown[]
): readonly ExceptionEntry[] {
  return container.flatMap((entry, index): readonly ExceptionEntry[] => {
    if (typeof entry === "string" && entry.trim() !== "") {
      return [{ id: entry.trim(), fields: null }];
    }
    return isRecord(entry)
      ? [{ id: describeException(entry, index), fields: entry }]
      : [];
  });
}

/**
 * Take the object-valued, non-config entries out of an exception map.
 * @param container - A candidate exception map
 * @returns The entries that are genuinely exceptions
 */
function mapEntries(
  container: Record<string, unknown>
): readonly ExceptionEntry[] {
  return Object.entries(container).flatMap(([key, entry]) =>
    isAdvisoryKey(key) && isRecord(entry) ? [{ id: key, fields: entry }] : []
  );
}

/**
 * Normalize one allowlist document into exception entries.
 *
 * Two shapes exist in the wild: a named container holding an array or a map of
 * entries, and audit-ci's `.nsprc`, whose top level maps advisory id to entry.
 * In the map shape only OBJECT-valued entries are exceptions — a string, a
 * boolean, or a `$schema` pointer at the top level is configuration.
 * @param parsed - The parsed allowlist document
 * @returns The exception entries
 */
function exceptionEntries(parsed: unknown): readonly ExceptionEntry[] {
  if (!isRecord(parsed)) {
    return [];
  }
  const containers = EXCEPTION_CONTAINERS.flatMap(key =>
    parsed[key] === undefined ? [] : [parsed[key]]
  );
  if (containers.length > 0) {
    return containers.flatMap(container =>
      Array.isArray(container)
        ? arrayEntries(container)
        : isRecord(container)
          ? mapEntries(container)
          : []
    );
  }
  // No recognized container: fall back to the `.nsprc` id → entry map. If
  // nothing there is an object-valued advisory key, this document establishes
  // nothing and reports nothing.
  return mapEntries(parsed);
}

/**
 * Read one audit allowlist and report the exceptions carrying no decision.
 *
 * An entry with `active: false` is skipped: audit-ci never applies it, so there
 * is no live exception for anybody to justify.
 * @param file - Repo-relative allowlist path
 * @param parsed - The parsed allowlist document
 * @returns Evidence lines, one per undocumented exception
 */
function undocumentedExceptions(
  file: string,
  parsed: unknown
): readonly string[] {
  return exceptionEntries(parsed).flatMap(({ id, fields }) => {
    if (fields?.active === false) {
      return [];
    }
    const documented =
      fields !== null &&
      DECISION_KEYS.some(
        decisionKey =>
          typeof fields[decisionKey] === "string" &&
          (fields[decisionKey] as string).trim() !== ""
      );
    return documented
      ? []
      : [
          `\`${file}\` excludes advisory \`${id}\` from the dependency audit ` +
            "with no written decision (no reason/notes/justification field), so " +
            "nobody can tell whether the exception is still true",
        ];
  });
}

/**
 * Collect the undocumented audit exceptions across every allowlist file.
 * @param root - Repository root
 * @returns Evidence lines, one per undocumented exception
 */
export async function auditExceptionViolations(
  root: string
): Promise<readonly string[]> {
  const perFile = await Promise.all(
    ALLOWLIST_FILES.map(async file => {
      const source = await readFileOrNull(root, file);
      if (source === null) {
        return [];
      }
      try {
        return undocumentedExceptions(file, JSON.parse(source));
      } catch {
        // An unparseable allowlist establishes nothing about its entries, so it
        // is passed over rather than reported as an undocumented exception.
        return [];
      }
    })
  );
  return perFile.flat();
}

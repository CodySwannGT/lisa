import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validRange } from "semver";
import type { AuditExclusion } from "./audit-types.js";

/**
 * Whether an unknown JSON value is an object.
 * @param value - Untrusted input value to validate
 * @returns The validated result described above
 */
export function auditRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Fields an exclusion may carry: identity, scope, and decision record. */
const KNOWN_FIELDS: ReadonlySet<string> = new Set([
  // identity and scope — the only fields the matcher reads
  "id",
  "cve",
  "package",
  "versions",
  "paths",
  "active",
  // the written decision (doctor's B5 keys) and its bookkeeping
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

/** The scope field a likely misspelling was meant to be. */
const SCOPE_SPELLINGS: Readonly<Record<string, string>> = {
  path: "paths",
  version: "versions",
  packages: "package",
  pkg: "package",
  range: "versions",
  ranges: "versions",
};

/**
 * Reject fields the matcher does not know.
 *
 * A misspelled scope (`path`, `version`) used to be ignored, which turned the
 * entry into an advisory- or package-wide exclusion — the opposite of what its
 * author wrote. An unknown field therefore fails closed. Keys starting with
 * `//` are the JSON comment convention and carry no meaning.
 * @param entry - Exclusion fields to validate
 * @returns One problem per unknown field
 */
function unknownFieldProblems(entry: Record<string, unknown>): string[] {
  return Object.keys(entry)
    .filter(key => !KNOWN_FIELDS.has(key) && !key.startsWith("//"))
    .map(key => {
      const meant = SCOPE_SPELLINGS[key.toLowerCase()];
      const hint = meant ? ` (did you mean "${meant}"?)` : "";
      return (
        `unknown field "${key}"${hint}; ` +
        "an unrecognized field may be a misspelled scope, so the exclusion is " +
        "rejected rather than applied more widely than written"
      );
    });
}

/** The two scope fields only lockfile copies can satisfy. */
interface LockfileScopeFields {
  readonly paths?: unknown;
  readonly versions?: unknown;
}

/**
 * Whether an exclusion's scope can only be checked against lockfile copies.
 * @param entry - Exclusion fields
 * @returns True when `paths` or `versions` is present
 */
export function requiresLockfileScope(entry: LockfileScopeFields): boolean {
  return entry.paths !== undefined || entry.versions !== undefined;
}

/**
 * Validate the optional scope without changing legacy advisory-only meaning.
 * @param entry - Exclusion fields to validate or match
 * @returns The validated result described above
 */
export function auditScopeProblems(entry: Record<string, unknown>): string[] {
  return [
    ...unknownFieldProblems(entry),
    ...(Object.hasOwn(entry, "package") &&
    (typeof entry.package !== "string" || !entry.package.trim())
      ? ["package must be a non-empty package name"]
      : []),
    ...(Object.hasOwn(entry, "versions") &&
    (typeof entry.versions !== "string" ||
      !entry.versions.trim() ||
      validRange(entry.versions) === null)
      ? ["versions must be a non-empty valid semver range"]
      : []),
    ...(Object.hasOwn(entry, "paths") &&
    (!Array.isArray(entry.paths) ||
      entry.paths.length === 0 ||
      entry.paths.some(value => typeof value !== "string" || !value.trim()))
      ? ["paths must be a non-empty array of lockfile key paths"]
      : []),
  ];
}

/**
 * Read both exclusion files; a broken decision file cannot produce a pass.
 * @param root - Project root containing the exact lockfile and exclusion documents
 * @returns The validated result described above
 */
export function readAuditExclusions(root: string): AuditExclusion[] {
  return ["audit.ignore.config.json", "audit.ignore.local.json"].flatMap(
    file => {
      const source = readExclusionFile(root, file);
      if (source === null) return [];
      const parsed: unknown = JSON.parse(source);
      if (!auditRecord(parsed) || !Array.isArray(parsed.exclusions)) {
        throw new Error(`${file}: exclusions must be an array`);
      }
      return parsed.exclusions.flatMap((entry: unknown, index: number) => {
        if (auditRecord(entry) && entry.active === false) return [];
        if (
          !auditRecord(entry) ||
          !["string", "number"].includes(typeof entry.id) ||
          !String(entry.id).trim()
        ) {
          throw new Error(
            `${file}: exclusion #${index + 1} has no advisory id`
          );
        }
        const problems = auditScopeProblems(entry);
        if (problems.length)
          throw new Error(
            `${file}: ${String(entry.id)}: ${problems.join("; ")}`
          );
        return [
          { ...entry, id: String(entry.id) } as unknown as AuditExclusion,
        ];
      });
    }
  );
}

/**
 * Read an optional exclusion document while preserving access failures.
 * @param root - Project root
 * @param file - Exclusion filename
 * @returns The source text, or null for an absent file
 */
function readExclusionFile(root: string, file: string): string | null {
  try {
    return readFileSync(join(root, file), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error(`Cannot read audit exclusions ${file}`, { cause: error });
  }
}

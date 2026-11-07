import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validRange } from "semver";
import { classifyUnknownFields } from "./audit-field-names.js";
import type { AuditExclusion } from "./audit-types.js";

/**
 * Whether an unknown JSON value is an object.
 * @param value - Untrusted input value to validate
 * @returns The validated result described above
 */
export function auditRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Reject near-misses of a scope field.
 *
 * A misspelled scope (`path`, `Paths`, `version`) used to be ignored, which
 * turned the entry into an advisory- or package-wide exclusion — the opposite
 * of what its author wrote — so it fails closed. Any other unrecognized key is
 * harmless documentation and keeps its existing meaning: ignored.
 * @param entry - Exclusion fields to validate
 * @returns One problem per misspelled scope field
 */
function misspelledScopeProblems(entry: Record<string, unknown>): string[] {
  return classifyUnknownFields(entry).misspelledScope.map(
    ({ key, meant }) =>
      `unknown field "${key}" (did you mean "${meant}"?); a misspelled scope ` +
      "field would otherwise be ignored and excuse more copies than written, " +
      "so the exclusion is rejected"
  );
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
    ...misspelledScopeProblems(entry),
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

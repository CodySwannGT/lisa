/**
 * Scope assessment for audit exclusions, shared by the B5 readiness producer
 * (#4521).
 *
 * The doctor validates every exclusion with the gate's own validator rather
 * than a second grammar, so the doctor and the gate cannot disagree about what
 * an entry means. What the gate accepts but an operator should still hear about
 * — an exclusion that hides every copy of a package, or a wide entry the gate
 * sets aside because a narrower one exists — is returned as a non-blocking
 * observation in plain language, never as a console line nobody reads.
 * @module cli/doctor-readiness-audit-scope
 */
import {
  auditScopeProblems,
  classifyUnknownFields,
  detectAuditManager,
  requiresLockfileScope,
} from "../core/audit.js";
import { readAuditCopies } from "../core/audit-lockfile.js";

/** One exclusion as the doctor found it, with the file it came from. */
export interface LocatedExclusion {
  /** Repository-relative allowlist filename. */
  readonly file: string;
  /** Operator-facing identity: an advisory id, a package name, or a position. */
  readonly id: string;
  /** The entry's fields, or null when the entry was a bare string. */
  readonly fields: Record<string, unknown> | null;
}

/** What the doctor established about exclusion scopes. */
export interface ScopeAssessment {
  /** Invalid or unprovable scopes: each one fails B5. */
  readonly violations: readonly string[];
  /** Valid but wide or shadowed exclusions: reported, never blocking. */
  readonly observations: readonly string[];
}

/** One live exclusion's assessment, plus whether its scope was valid. */
interface EntryAssessment extends ScopeAssessment {
  readonly exclusion: LocatedExclusion;
  readonly valid: boolean;
}

/** The fix every wide-exclusion observation recommends. */
const NARROW_IT =
  "If the risky copy is only used by development tools, add `versions` and " +
  "`paths` so only that copy is excused.";

/**
 * Explain an exclusion that hides every copy, in words an operator can act on.
 *
 * Legal (legacy files keep working) but exactly the case #4521 exists for: a
 * later vulnerable copy used in production would be hidden too.
 * @param exclusion - The located exclusion
 * @param pkg - The package it names, if any
 * @returns One operator-language observation
 */
function wideObservation(exclusion: LocatedExclusion, pkg: unknown): string {
  const scope =
    typeof pkg === "string"
      ? `every copy of \`${pkg}\`: the entry for \`${exclusion.id}\` names no version range or lockfile path`
      : `every copy of the affected package: the entry for \`${exclusion.id}\` names no package, version range or lockfile path`;
  return (
    `\`${exclusion.file}\` hides this advisory for ${scope}, so a later copy ` +
    `used in production would also be hidden. ${NARROW_IT}`
  );
}

/**
 * Read the lockfile once, and report why scoped coverage cannot be established.
 * @param root - Project root
 * @returns The read failure message, or null when the lockfile is readable
 */
function lockfileFailure(root: string): string | null {
  try {
    readAuditCopies(root, detectAuditManager(root));
    return null;
  } catch (error) {
    return (error as Error).message;
  }
}

/**
 * Whether a narrower entry for the same advisory and package sets a wide one aside.
 * @param wide - Fields of an entry without paths/versions
 * @param other - Fields of a candidate narrower entry
 * @returns True when the matcher would let `other` decide instead of `wide`
 */
function narrows(
  wide: Record<string, unknown>,
  other: Record<string, unknown>
): boolean {
  return (
    String(other.id) === String(wide.id) &&
    requiresLockfileScope(other) &&
    (wide.package === undefined ||
      other.package === undefined ||
      other.package === wide.package)
  );
}

/**
 * Name wide entries the gate sets aside because a narrower one exists.
 *
 * The matcher lets only paths/versions entries decide an advisory once one
 * exists for that package, so a package-wide or advisory-wide entry for the
 * same advisory no longer excuses anything. That is safe, but an operator who
 * expects the wide entry to apply should be told why it does not.
 * @param valid - Active exclusions whose scope is valid
 * @returns One observation per shadowed wide entry
 */
function shadowObservations(
  valid: readonly LocatedExclusion[]
): readonly string[] {
  return valid.flatMap(wide => {
    const wideFields = wide.fields ?? {};
    if (requiresLockfileScope(wideFields)) return [];
    const narrower = valid.find(
      other => other !== wide && narrows(wideFields, other.fields ?? {})
    );
    return narrower
      ? [
          `\`${wide.file}\` excuses advisory \`${wide.id}\` for every copy, but ` +
            `\`${narrower.file}\` lists the specific copies that were reviewed, ` +
            "so the audit uses only that narrower entry and ignores the wider " +
            "one. Remove the wider entry, or widen the narrower one, if that is " +
            "not what you meant.",
        ]
      : [];
  });
}

/**
 * Assess one live exclusion.
 * @param exclusion - The located exclusion
 * @param lockfile - The single lockfile read's failure message, or null
 * @returns The entry's violations and observations
 */
function assessOne(
  exclusion: LocatedExclusion,
  lockfile: string | null
): EntryAssessment {
  const fields = exclusion.fields ?? {};
  const where = `${exclusion.file}: ${exclusion.id}`;
  const problems = auditScopeProblems(fields);
  if (problems.length)
    return {
      exclusion,
      valid: false,
      violations: problems.map(problem => `${where}: ${problem}`),
      observations: [],
    };
  const ignored = classifyUnknownFields(fields).ignored.map(
    key =>
      `\`${exclusion.file}\`: the entry for \`${exclusion.id}\` has an ` +
      `unrecognized field \`${key}\`, which the audit ignores. It changes ` +
      "nothing about what is excused; use `reason` or `notes` for the decision."
  );
  if (!requiresLockfileScope(fields))
    return {
      exclusion,
      valid: true,
      violations: [],
      observations: [wideObservation(exclusion, fields.package), ...ignored],
    };
  return {
    exclusion,
    valid: true,
    violations: lockfile === null ? [] : [`${where}: ${lockfile}`],
    observations: ignored,
  };
}

/**
 * Assess every located exclusion's scope with the gate's own validator.
 * @param root - Project root containing the exact lockfile
 * @param exclusions - Exclusions from the doctor's allowlist files
 * @returns Violations (fail B5) and observations (reported, non-blocking)
 */
export function assessExclusionScopes(
  root: string,
  exclusions: readonly LocatedExclusion[]
): ScopeAssessment {
  const live = exclusions.filter(
    entry => entry.fields !== null && entry.fields.active !== false
  );
  // Read the lockfile once per doctor run, and only when some entry needs it.
  const lockfile = live.some(entry => requiresLockfileScope(entry.fields ?? {}))
    ? lockfileFailure(root)
    : null;
  const assessed = live.map(exclusion => assessOne(exclusion, lockfile));
  return {
    violations: assessed.flatMap(entry => entry.violations),
    observations: [
      ...assessed.flatMap(entry => entry.observations),
      ...shadowObservations(
        assessed.filter(entry => entry.valid).map(entry => entry.exclusion)
      ),
    ],
  };
}

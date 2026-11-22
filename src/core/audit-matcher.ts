import { satisfies, validRange } from "semver";
import { requiresLockfileScope } from "./audit-exclusions.js";
import type {
  AuditCopy,
  AuditExclusion,
  AuditFinding,
  AuditVerdict,
} from "./audit-types.js";

/**
 * Match advisory identity, package, installed version and path together.
 * @param entry - Exclusion fields to validate or match
 * @param finding - Normalized provider advisory
 * @param copies - Resolved lockfile copies with real package identities
 * @returns The validated result described above
 */
function matchExclusion(
  entry: AuditExclusion,
  finding: AuditFinding,
  copies: readonly AuditCopy[]
): AuditVerdict {
  if (entry.package !== undefined && entry.package !== finding.name) {
    return {
      passed: false,
      messages: [
        `${finding.ids[0]}: package ${finding.name} is outside exclusion package ${entry.package}`,
      ],
    };
  }
  if (entry.paths === undefined && entry.versions === undefined)
    return { passed: true, messages: [] };
  if (!finding.range || validRange(finding.range) === null) {
    throw new Error(
      `${finding.ids[0]}: cannot determine vulnerable versions for scoped exclusion`
    );
  }
  const affected = copies.filter(
    copy =>
      copy.name === finding.name &&
      satisfies(copy.version, finding.range ?? "", { includePrerelease: true })
  );
  if (!affected.length)
    throw new Error(
      `${finding.ids[0]}: no resolved vulnerable copies found for ${finding.name}; scope cannot be established`
    );
  const outside = affected.filter(
    copy =>
      (entry.paths !== undefined && !entry.paths.includes(copy.path)) ||
      (entry.versions !== undefined &&
        !satisfies(copy.version, entry.versions, { includePrerelease: true }))
  );
  const outsidePaths = outside
    .map(copy => `${copy.path} (${copy.name}@${copy.version})`)
    .join(", ");
  return {
    passed: outside.length === 0,
    messages: outside.length
      ? [
          `${finding.ids[0]}: vulnerable paths outside exclusion: ${outsidePaths}`,
        ]
      : [
          `excluded ${finding.ids[0]} for ${affected.map(copy => copy.path).join(", ")} (${entry.reason ?? "no reason recorded"})`,
        ],
  };
}

/**
 * Choose which exclusions may decide a finding.
 *
 * A paths/versions entry records that someone reviewed particular copies. An
 * advisory-wide entry for the same advisory and package — typically a managed,
 * shared decision — must not quietly accept the copies that review rejected,
 * so once a scoped entry applies to this package only scoped entries decide.
 * A scoped entry for a DIFFERENT package says nothing about this one.
 * @param candidates - Active exclusions whose id or CVE names the finding
 * @param finding - Normalized provider advisory
 * @returns The entries that decide, and the wide ones set aside
 */
function narrowestCandidates(
  candidates: readonly AuditExclusion[],
  finding: AuditFinding
): { applied: readonly AuditExclusion[]; shadowed: readonly AuditExclusion[] } {
  const samePackage = (entry: AuditExclusion) =>
    entry.package === undefined || entry.package === finding.name;
  const scoped = candidates.filter(
    entry => samePackage(entry) && requiresLockfileScope(entry)
  );
  if (!scoped.length) return { applied: candidates, shadowed: [] };
  return {
    applied: candidates.filter(entry => requiresLockfileScope(entry)),
    shadowed: candidates.filter(
      entry => samePackage(entry) && !requiresLockfileScope(entry)
    ),
  };
}

/**
 * Evaluate every finding; an unmatched finding remains a finding.
 * @param findings - All normalized high and critical advisories
 * @param exclusions - Validated active exclusions from both decision files
 * @param copies - Resolved lockfile copies with real package identities
 * @returns The validated result described above
 */
export function matchAuditFindings(
  findings: readonly AuditFinding[],
  exclusions: readonly AuditExclusion[],
  copies: readonly AuditCopy[]
): AuditVerdict {
  const outcomes = findings.map(finding => {
    const candidates = exclusions.filter(
      entry =>
        entry.active !== false &&
        (finding.ids.includes(entry.id) ||
          (entry.cve !== undefined && finding.ids.includes(entry.cve)))
    );
    const { applied, shadowed } = narrowestCandidates(candidates, finding);
    const notes = shadowed.length
      ? [
          `${finding.ids[0]}: advisory-wide exclusion was not applied because a narrower paths/versions exclusion exists for ${finding.name}`,
        ]
      : [];
    const matches = applied.map(entry =>
      matchExclusion(entry, finding, copies)
    );
    const accepted = matches.find(match => match.passed);
    if (accepted)
      return { passed: true, messages: [...notes, ...accepted.messages] };
    return {
      passed: false,
      messages: matches.length
        ? [...notes, ...matches.flatMap(match => match.messages)]
        : [
            `${finding.ids[0]}: unresolved high/critical advisory for ${finding.name}`,
          ],
    };
  });
  return {
    passed: outcomes.every(outcome => outcome.passed),
    messages: outcomes.flatMap(outcome => outcome.messages),
  };
}

import {
  readAuditExclusions,
  requiresLockfileScope,
} from "./audit-exclusions.js";
import { readAuditCopies } from "./audit-lockfile.js";
import { detectAuditManager } from "./audit-manager.js";
import { matchAuditFindings } from "./audit-matcher.js";
import { parseAuditReport } from "./audit-report.js";
import {
  decidePatchedFindings,
  type AuditPatchOptions,
} from "./audit-patches.js";
import { unappliedPatchHints } from "./audit-patch-hints.js";
import {
  AuditCaptureError,
  captureAudit,
  type AuditCaptureOptions,
} from "./audit-capture.js";
import type {
  AuditCopy,
  AuditExclusion,
  AuditFinding,
  AuditManager,
  AuditVerdict,
} from "./audit-types.js";

export {
  auditScopeProblems,
  requiresLockfileScope,
} from "./audit-exclusions.js";
export { classifyUnknownFields } from "./audit-field-names.js";
export { AuditCaptureError } from "./audit-capture.js";
export type { AuditPatchOptions, PublishedVersions } from "./audit-patches.js";
export type {
  AuditCopy,
  AuditExclusion,
  AuditFinding,
  AuditManager,
  AuditVerdict,
} from "./audit-types.js";

export { detectAuditManager };

/**
 * Evaluate a captured report against exclusions only.
 *
 * It cannot ask the registry whether a fixed version exists, so it never
 * credits a project's own advisory patch: such a finding stays a failure here.
 * Use verifyCapturedAudit for the full gate.
 * @param root - Project root containing the exact lockfile and exclusion documents
 * @param manager - Package manager whose report and lockfile are evaluated
 * @param source - Complete provider report or lockfile text
 * @returns The validated result described above
 */
export function evaluateAuditReport(
  root: string,
  manager: AuditManager,
  source: string
): AuditVerdict {
  const exclusions = readAuditExclusions(root);
  const scoped = exclusions.some(requiresLockfileScope);
  const copies = scoped ? readAuditCopies(root, manager) : [];
  return matchAuditFindings(parseCaptured(source, manager), exclusions, copies);
}

/**
 * Parse a report someone else captured; an unusable one audited nothing.
 * @param source - Complete provider report text
 * @param manager - Package manager whose report is parsed
 * @returns The normalized findings
 */
function parseCaptured(source: string, manager: AuditManager) {
  try {
    return parseAuditReport(source, manager);
  } catch (error) {
    throw new AuditCaptureError(
      `${(error as Error).message}; nothing was audited. This is NOT a clean result.`
    );
  }
}

/**
 * The normal live gate used by hooks, registry and CI.
 * @param root - Project root containing the exact lockfile and exclusion documents
 * @param manager - Package manager whose report and lockfile are evaluated
 * @param options - Retry knobs passed by the calling CLI
 * @returns The validated result described above
 */
export async function runDependencyAudit(
  root: string,
  manager = detectAuditManager(root),
  options: AuditCaptureOptions & AuditPatchOptions = {}
): Promise<AuditVerdict> {
  const exclusions = readAuditExclusions(root);
  // Validate scope before the network call, even when the report would be {}.
  const scoped = exclusions.some(requiresLockfileScope);
  const copies = scoped ? readAuditCopies(root, manager) : [];
  const findings = await captureAudit(root, manager, options);
  return decideFindings(root, manager, findings, exclusions, copies, options);
}

/**
 * The full gate for a report someone else captured (the pre-push hook).
 * @param root - Project root containing the exact lockfile and exclusion documents
 * @param manager - Package manager whose report and lockfile are evaluated
 * @param source - Complete provider report text
 * @param options - Registry lookup override
 * @returns The validated result described above
 */
export async function verifyCapturedAudit(
  root: string,
  manager: AuditManager,
  source: string,
  options: AuditPatchOptions = {}
): Promise<AuditVerdict> {
  const exclusions = readAuditExclusions(root);
  const scoped = exclusions.some(requiresLockfileScope);
  const copies = scoped ? readAuditCopies(root, manager) : [];
  const findings = parseCaptured(source, manager);
  return decideFindings(root, manager, findings, exclusions, copies, options);
}

/**
 * A verified advisory patch decides the findings it names; exclusions decide the rest.
 * @param root - Project root
 * @param manager - Package manager whose lockfile lists the copies
 * @param findings - Normalized high/critical advisories
 * @param exclusions - Validated active exclusions
 * @param copies - Lockfile copies already read for scoped exclusions
 * @param options - Registry lookup override
 * @returns The combined verdict
 */
async function decideFindings(
  root: string,
  manager: AuditManager,
  findings: readonly AuditFinding[],
  exclusions: readonly AuditExclusion[],
  copies: readonly AuditCopy[],
  options: AuditPatchOptions
): Promise<AuditVerdict> {
  const lockCopies = () =>
    copies.length ? copies : readAuditCopies(root, manager);
  const patched = await decidePatchedFindings(
    root,
    findings,
    lockCopies,
    options
  );
  const matched = matchAuditFindings(patched.remaining, exclusions, copies);
  const rest = matched.passed
    ? matched
    : {
        passed: false,
        messages: [
          ...matched.messages,
          ...unappliedPatchHints(root, manager, patched.remaining),
        ],
      };
  const verdicts = [...patched.verdicts, rest];
  return {
    passed: verdicts.every(verdict => verdict.passed),
    messages: verdicts.flatMap(verdict => verdict.messages),
  };
}

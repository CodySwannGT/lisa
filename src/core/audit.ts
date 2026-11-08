import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  readAuditExclusions,
  requiresLockfileScope,
} from "./audit-exclusions.js";
import { readAuditCopies } from "./audit-lockfile.js";
import { matchAuditFindings } from "./audit-matcher.js";
import { parseAuditReport } from "./audit-report.js";
import {
  AuditCaptureError,
  captureAudit,
  type AuditCaptureOptions,
} from "./audit-capture.js";
import type { AuditManager, AuditVerdict } from "./audit-types.js";

export {
  auditScopeProblems,
  requiresLockfileScope,
} from "./audit-exclusions.js";
export { classifyUnknownFields } from "./audit-field-names.js";
export { AuditCaptureError } from "./audit-capture.js";
export type {
  AuditCopy,
  AuditExclusion,
  AuditFinding,
  AuditManager,
  AuditVerdict,
} from "./audit-types.js";

/**
 * Select the manager using the same lockfile priority as the shipped hook.
 * @param root - Project root containing the exact lockfile and exclusion documents
 * @returns The validated result described above
 */
export function detectAuditManager(root: string): AuditManager {
  for (const [file, manager] of [
    ["bun.lock", "bun"],
    ["bun.lockb", "bun"],
    ["yarn.lock", "yarn"],
    ["package-lock.json", "npm"],
  ] as const) {
    if (existsSync(join(root, file))) return manager;
  }
  throw new Error(
    "No supported audit lockfile found (bun.lock, package-lock.json or yarn.lock)"
  );
}

/**
 * One canonical evaluator for captured reports and project-owned audit provers.
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
  options: AuditCaptureOptions = {}
): Promise<AuditVerdict> {
  const exclusions = readAuditExclusions(root);
  // Validate scope before the network call, even when the report would be {}.
  const scoped = exclusions.some(requiresLockfileScope);
  const copies = scoped ? readAuditCopies(root, manager) : [];
  const findings = await captureAudit(root, manager, options);
  return matchAuditFindings(findings, exclusions, copies);
}

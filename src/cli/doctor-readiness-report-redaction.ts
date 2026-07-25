/**
 * Persistence-only redaction for `.lisa/readiness.json`.
 * @module cli/doctor-readiness-report-redaction
 */
import { createHash } from "node:crypto";
import { CONTEXT_ROUTING_DIMENSION_ID } from "./doctor-readiness-context.js";
import type { ReadinessReport } from "./doctor-readiness.js";

/** Evidence strings for B6 include source-doc excerpts; persist hashes instead. */
const DOC_EXCERPT_PATTERN = /: "([^"]+)"/g;

/**
 * Remove source-document prose excerpts from the persisted report while keeping
 * the in-memory blocker decision untouched. The console detail already names
 * the blocker; `.lisa/readiness.json` should not become a second committed copy
 * of potentially sensitive docs text.
 * @param report - Full readiness report computed for this run
 * @returns Report safe to serialize to `.lisa/readiness.json`
 */
export function sanitizeReadinessReportForPersistence(
  report: ReadinessReport
): ReadinessReport {
  return {
    ...report,
    blockers: report.blockers.map(blocker =>
      blocker.id === "B6"
        ? {
            ...blocker,
            evidence: redactDocExcerpts(blocker.evidence),
          }
        : blocker
    ),
    dimensions: report.dimensions.map(dimension =>
      dimension.id === CONTEXT_ROUTING_DIMENSION_ID
        ? {
            ...dimension,
            findings: dimension.findings.map(sanitizeContextFinding),
          }
        : dimension
    ),
  };
}

/**
 * Redact B6 finding strings that can contain quoted documentation excerpts.
 * @param value - One untyped finding
 * @returns Finding with prose excerpts redacted, or the original value
 */
function sanitizeContextFinding(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      typeof entry === "string" ? redactDocExcerpts(entry) : entry,
    ])
  );
}

/**
 * Replace quoted documentation excerpts with a short stable digest.
 * @param text - Evidence text
 * @returns Evidence text without the raw excerpt
 */
function redactDocExcerpts(text: string): string {
  return text.replace(DOC_EXCERPT_PATTERN, (_match, excerpt: string) => {
    const digest = createHash("sha256")
      .update(excerpt)
      .digest("hex")
      .slice(0, 12);
    return `: [doc excerpt redacted sha256:${digest}]`;
  });
}

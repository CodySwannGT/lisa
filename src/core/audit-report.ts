import { auditRecord } from "./audit-exclusions.js";
import type { AuditFinding, AuditManager } from "./audit-types.js";

/**
 * Normalize the provider's advisory identity without trusting its display title.
 * @param name - Provider package name for the advisory
 * @param value - Untrusted input value to validate
 * @param severity - Severity inherited from an npm vulnerability record
 * @returns The validated result described above
 */
function finding(
  name: string,
  value: unknown,
  severity?: unknown
): AuditFinding[] {
  if (!auditRecord(value)) throw new Error("Unknown advisory record");
  const level = value.severity ?? severity;
  if (typeof level !== "string") throw new Error("Unknown advisory severity");
  if (!["high", "critical"].includes(level)) return [];
  const urlId =
    typeof value.url === "string" ? value.url.split("/").at(-1) : undefined;
  const ids = [
    urlId,
    value.github_advisory_id,
    value.id,
    value.source,
    value.cve,
    ...(Array.isArray(value.cves) ? value.cves : []),
  ]
    .filter(
      (id): id is string | number =>
        typeof id === "string" || typeof id === "number"
    )
    .map(String);
  if (!ids.length) throw new Error("High/critical advisory has no identity");
  const range = value.vulnerable_versions ?? value.range;
  return [
    {
      ids,
      name: typeof value.name === "string" ? value.name : name,
      ...(typeof range === "string" ? { range } : {}),
    },
  ];
}

/**
 * Bun's report is an object mapping real package names to advisory arrays.
 * @param value - Untrusted input value to validate
 * @returns The validated result described above
 */
function bunFindings(value: unknown): AuditFinding[] {
  if (
    !auditRecord(value) ||
    Object.values(value).some(entry => !Array.isArray(entry))
  ) {
    throw new Error("Unknown bun audit report shape");
  }
  return Object.entries(value).flatMap(([name, advisories]) =>
    (advisories as unknown[]).flatMap(advisory => finding(name, advisory))
  );
}

/**
 * npm v7+ reports concrete advisories in via objects; strings reference peers.
 * @param value - Untrusted input value to validate
 * @returns The validated result described above
 */
function npmFindings(value: unknown): AuditFinding[] {
  if (!auditRecord(value) || !auditRecord(value.vulnerabilities)) {
    throw new Error("Unknown npm audit report shape");
  }
  const result = Object.entries(value.vulnerabilities).flatMap(
    ([name, row]) => {
      if (!auditRecord(row) || !Array.isArray(row.via))
        throw new Error(`Unknown npm advisory for ${name}`);
      return row.via.flatMap((via: unknown) =>
        typeof via === "string" ? [] : finding(name, via, row.severity)
      );
    }
  );
  if (
    !result.length &&
    Object.values(value.vulnerabilities).some(
      row =>
        auditRecord(row) && ["high", "critical"].includes(String(row.severity))
    )
  ) {
    throw new Error(
      "npm reported high/critical findings without concrete advisory data"
    );
  }
  return result;
}

/**
 * Yarn classic emits newline-delimited advisories followed by its summary.
 * @param source - Complete provider report or lockfile text
 * @returns The validated result described above
 */
function yarnFindings(source: string): AuditFinding[] {
  const lines: unknown[] = source
    .trim()
    .split(/\r?\n/u)
    .map(line => JSON.parse(line) as unknown);
  const summaries = lines.filter(
    line => auditRecord(line) && line.type === "auditSummary"
  );
  if (
    summaries.length !== 1 ||
    lines.some(line => auditRecord(line) && line.type === "error")
  ) {
    throw new Error("Unknown yarn audit report shape (missing auditSummary)");
  }
  const reportedHigh = yarnSummaryHigh(summaries[0]);
  const result = lines.flatMap(line => {
    if (!auditRecord(line) || line.type !== "auditAdvisory") return [];
    if (!auditRecord(line.data) || !auditRecord(line.data.advisory))
      throw new Error("Unknown yarn advisory data");
    const advisory = line.data.advisory;
    return finding(
      typeof advisory.module_name === "string" ? advisory.module_name : "",
      advisory
    );
  });
  if (reportedHigh && result.length === 0) {
    throw new Error(
      "Yarn reported high/critical findings without concrete advisory data; nothing was audited completely"
    );
  }
  return result;
}

/**
 * Validate the provider's summary before treating an advisory-free stream as clean.
 * @param value - The single Yarn summary record
 * @returns Whether Yarn reports high or critical vulnerabilities
 */
function yarnSummaryHigh(value: unknown): boolean {
  const data = auditRecord(value) ? value.data : undefined;
  const counts = auditRecord(data) ? data.vulnerabilities : undefined;
  if (!auditRecord(counts))
    throw new Error("Unknown Yarn audit summary vulnerability counts");
  const levels = [counts.high, counts.critical];
  if (
    levels.some(
      count =>
        typeof count !== "number" || !Number.isSafeInteger(count) || count < 0
    )
  ) {
    throw new Error("Unknown Yarn audit summary high/critical counts");
  }
  return levels.some(count => (count as number) > 0);
}

/**
 * Parse a complete provider report. Empty/error payloads are never clean reports.
 * @param source - Complete provider report or lockfile text
 * @param manager - Package manager whose report and lockfile are evaluated
 * @returns The validated result described above
 */
export function parseAuditReport(
  source: string,
  manager: AuditManager
): AuditFinding[] {
  if (!source.trim()) throw new Error(`${manager} audit produced no output`);
  if (manager === "yarn") return yarnFindings(source);
  const parsed: unknown = JSON.parse(source);
  return manager === "bun" ? bunFindings(parsed) : npmFindings(parsed);
}

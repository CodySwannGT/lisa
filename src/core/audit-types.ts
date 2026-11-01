/** The package managers whose production audits Lisa understands. */
export type AuditManager = "bun" | "npm" | "yarn";

/** An exclusion's optional scope is conjunctive, never advisory-wide fallback. */
export interface AuditExclusion {
  readonly id: string;
  readonly cve?: string;
  readonly package?: string;
  readonly versions?: string;
  readonly paths?: readonly string[];
  readonly reason?: string;
  readonly active?: boolean;
}

/** One resolved copy, identified by the lockfile key rather than basename. */
export interface AuditCopy {
  readonly path: string;
  readonly name: string;
  readonly version: string;
}

/** A normalized high/critical advisory from a package manager's own report. */
export interface AuditFinding {
  readonly ids: readonly string[];
  readonly name: string;
  readonly range?: string;
}

/** A determinate audit verdict and the operator-facing explanation. */
export interface AuditVerdict {
  readonly passed: boolean;
  readonly messages: readonly string[];
}

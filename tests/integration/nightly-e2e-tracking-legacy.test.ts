/**
 * RED byte and parsed-contract lock for the legacy #2448 per-suite reporter.
 */
import yaml from "js-yaml";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".."
);
const LEGACY_REL = ".github/workflows/nightly-e2e-report.yml";
const LEGACY_CALLER_REL =
  "expo/create-only/.github/workflows/nightly-e2e-report.yml";

/** Partial workflow shape needed by the compatibility lock. */
interface Workflow {
  readonly on?: Record<string, unknown>;
  readonly true?: Record<string, unknown>;
  readonly permissions?: Record<string, string>;
  readonly jobs: Record<
    string,
    { readonly uses?: string; readonly with?: Record<string, unknown> }
  >;
}

/**
 * Reads a repository-relative artifact.
 *
 * @param relative - Repository-relative path
 * @returns UTF-8 bytes as text
 */
function read(relative: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relative), "utf8");
}

/**
 * Parses a legacy workflow.
 *
 * @param relative - Repository-relative workflow path
 * @returns Parsed workflow
 */
function workflow(relative: string): Workflow {
  return yaml.load(read(relative)) as Workflow;
}

/**
 * Returns the trigger map despite YAML 1.1 `on` coercion.
 *
 * @param value - Parsed workflow
 * @returns Trigger map
 */
function triggers(value: Workflow): Record<string, unknown> {
  return value.on ?? value.true ?? {};
}

/**
 * Computes one artifact's byte identity.
 *
 * @param relative - Repository-relative path
 * @returns Lowercase SHA-256 digest
 */
function sha256(relative: string): string {
  return createHash("sha256").update(read(relative)).digest("hex");
}

describe("legacy #2448 compatibility", () => {
  it("preserves the exact released reusable and caller bytes", () => {
    expect(sha256(LEGACY_REL)).toBe(
      "004608a42aadd6610dd80fac18f4d31589840b0041e5ce15ff00321300d8bdc3"
    );
    expect(sha256(LEGACY_CALLER_REL)).toBe(
      "4e53365efa0c6fc065a2026a0dcda604c1180e9cb96fec4d0148219b2d760f14"
    );
  });

  it("retains its schedule and exact per-suite input cardinality", () => {
    const reusable = workflow(LEGACY_REL);
    const caller = workflow(LEGACY_CALLER_REL);
    const inputs = (
      triggers(reusable).workflow_call as {
        inputs?: Record<string, unknown>;
      }
    ).inputs;
    expect(
      Object.keys(inputs ?? {}).sort((left, right) => left.localeCompare(right))
    ).toEqual(
      [
        "api_max_attempts",
        "api_max_pages",
        "api_retry_max_seconds",
        "branch",
        "bypass_label",
        "expected_contract_major",
        "freshness_hours",
        "gate_context",
        "guard_script",
        "issue_label",
        "node_version",
        "pin_issues",
        "suites",
        "timeout_minutes",
      ].sort((left, right) => left.localeCompare(right))
    );
    expect(triggers(caller)).toHaveProperty("schedule");
    expect(triggers(caller)).not.toHaveProperty("workflow_run");
  });

  it("retains exact permissions, caller inputs and reusable job use", () => {
    const reusable = workflow(LEGACY_REL);
    const caller = workflow(LEGACY_CALLER_REL);
    expect(reusable.permissions).toEqual({
      contents: "read",
      actions: "read",
      "pull-requests": "read",
      issues: "write",
    });
    expect(caller.jobs.report?.uses).toContain(
      "CodySwannGT/lisa/.github/workflows/nightly-e2e-report.yml@"
    );
    expect(
      Object.keys(caller.jobs.report?.with ?? {}).sort((left, right) =>
        left.localeCompare(right)
      )
    ).toEqual([
      "branch",
      "bypass_label",
      "gate_context",
      "pin_issues",
      "suites",
    ]);
    expect(read(LEGACY_REL)).toContain("--report-issues");
    expect(read(LEGACY_REL)).toContain(
      "Exactly ONE open tracking issue per suite"
    );
  });
});

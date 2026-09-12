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
  // These digests track whatever the legacy reporter is on main, and are
  // refreshed only when main deliberately changes it under its own review --
  // most recently the `@main` staleness handshake, which gave the reusable an
  // `expected_workflow_contract_major` input plus the job that asserts it, and
  // seeded the matching value beside the caller's `uses:`. Before that, "track
  // @main in every seeded template" repointed that same `uses:` from
  // `@v3.35.0`. Neither touched the reporting logic these cases lock: the
  // handshake job runs before the report and reads none of its state, and the
  // three parsed-contract cases below are what prove a refreshed digest still
  // describes the same reporter.
  // The lock they enforce is that the CONFIGURABLE tracking work on this branch
  // leaves the legacy per-suite reporter untouched, so a digest that moves
  // because of a commit on this branch is the failure it exists to catch. The
  // three parsed-contract cases below are what prove a refreshed digest still
  // describes the same reporter.
  it("preserves the exact released reusable and caller bytes", () => {
    expect(sha256(LEGACY_REL)).toBe(
      "e534f08d95f07fdac3d8b2951f0af7e8ad70c84ee23e5d7d816947aeda9217c2"
    );
    expect(sha256(LEGACY_CALLER_REL)).toBe(
      "002f9a3bb88e1ff964195f413e385313c6d6f868e6d003b787663903d6bbd3a9"
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
        "expected_workflow_contract_major",
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
      "expected_workflow_contract_major",
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

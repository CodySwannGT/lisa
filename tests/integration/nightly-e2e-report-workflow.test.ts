/**
 * Contract tests for the nightly e2e gate's REPORTING half (§10 of
 * `docs/nightly-e2e-gate.md`).
 *
 * The decision logic — what to file, refresh and close — is proven in
 * `tests/unit/scripts/nightly-e2e-health-issues.test.ts`. This file proves the
 * wiring that no unit test can see, and every assertion here defends one
 * property: **filing an issue is reporting, and reporting must never be able to
 * fail a required check.**
 *
 * If issue writes lived inside the gate, a GitHub Issues API that was down,
 * throttled or newly forbidden would turn a green nightly into a red required
 * check on every open pull request — an outage in a notification channel
 * becoming an outage in the merge queue. The isolation is structural (two
 * workflows, no `issues:` scope on the gate, no writes on the gate path), and
 * structure is exactly the kind of thing that erodes silently between reviews.
 */
import yaml from "js-yaml";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

const GATE_REUSABLE_REL = ".github/workflows/nightly-e2e-health.yml";
const GATE_CALLER_REL =
  "expo/create-only/.github/workflows/nightly-e2e-health.yml";
const REPORT_REUSABLE_REL = ".github/workflows/nightly-e2e-report.yml";
const REPORT_CALLER_REL =
  "expo/create-only/.github/workflows/nightly-e2e-report.yml";
const RULESET_REL = "expo/github-rulesets/nightly-e2e-health.json";
const GUARD_REL =
  "typescript/copy-overwrite/scripts/check-nightly-e2e-health.mjs";
const DOC_REL = "docs/nightly-e2e-gate.md";

/** A concurrency block, on a workflow or on a job. */
interface Concurrency {
  readonly group?: string;
  readonly "cancel-in-progress"?: boolean;
}

/** One job in a workflow. */
interface WorkflowJob {
  readonly name?: string;
  readonly uses?: string;
  readonly concurrency?: Concurrency;
  readonly steps?: readonly { readonly run?: string }[];
}

/** A workflow, as much of it as these tests read. */
interface Workflow {
  readonly permissions?: Record<string, string>;
  readonly concurrency?: Concurrency;
  readonly jobs: Record<string, WorkflowJob>;
}

/** A GitHub ruleset template. */
interface Ruleset {
  readonly rules: readonly {
    type: string;
    parameters?: { required_status_checks?: readonly { context: string }[] };
  }[];
}

/**
 * Reads a repo-relative text file.
 *
 * @param relative - Repo-relative path
 * @returns File contents
 */
function read(relative: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relative), "utf-8");
}

/**
 * Parses a repo-relative workflow.
 *
 * @param relative - Repo-relative path
 * @returns The parsed workflow
 */
function workflow(relative: string): Workflow {
  return yaml.load(read(relative)) as Workflow;
}

/**
 * The `on:` key, which js-yaml resolves to the boolean `true` under YAML 1.1.
 *
 * @param parsed - A parsed workflow
 * @returns The triggers map
 */
function triggers(parsed: Workflow): Record<string, unknown> {
  const record = parsed as unknown as Record<string, unknown>;
  return (record.on ?? record["true"] ?? {}) as Record<string, unknown>;
}

describe("the reporting half cannot fail the merge gate (§10.4)", () => {
  const gate = workflow(GATE_REUSABLE_REL);
  const report = workflow(REPORT_REUSABLE_REL);
  const reportCaller = workflow(REPORT_CALLER_REL);

  it("the gate holds NO `issues:` scope — it could not file if its code tried", () => {
    // A called workflow's `permissions:` is a CEILING, so this is not a
    // convention the guard has to honour; it is a capability it does not have.
    expect(gate.permissions).not.toHaveProperty("issues");
  });

  it("the reporter is the only half that writes", () => {
    expect(report.permissions).toEqual({
      contents: "read",
      actions: "read",
      issues: "write",
    });
  });

  it("the reporting context is NEVER a required status check", () => {
    // Requiring it would re-couple the two halves through the ruleset — the one
    // route the permission split cannot close.
    const ruleset = JSON.parse(read(RULESET_REL)) as Ruleset;
    const required =
      ruleset.rules.find(rule => rule.type === "required_status_checks")
        ?.parameters?.required_status_checks ?? [];
    for (const check of required) {
      expect(check.context).not.toContain(reportCaller.jobs.report.name);
    }
    expect(read(REPORT_CALLER_REL)).toContain("never make it a required check");
  });

  it("the reporter invokes the guard's reporting flag, and the gate does not", () => {
    expect(read(REPORT_REUSABLE_REL)).toContain("--report-issues");
    expect(read(GATE_REUSABLE_REL)).not.toContain("--report-issues");
  });

  it("the reporter runs on a SCHEDULE, not on pull requests", () => {
    const on = triggers(reportCaller);
    expect(on).toHaveProperty("schedule");
    expect(on).not.toHaveProperty("pull_request");
  });

  it("the report caller pins an immutable ref, like the gate caller", () => {
    const uses = reportCaller.jobs.report.uses ?? "";
    expect(uses).toContain(
      "CodySwannGT/lisa/.github/workflows/nightly-e2e-report.yml@"
    );
    const ref = uses.split("@")[1];
    expect(ref).not.toBe("main");
    expect(ref).toMatch(/^(v\d+\.\d+\.\d+|[0-9a-f]{40})$/);
  });

  it("the reporter asserts the guard's contract major, like the gate", () => {
    const assertion = (report.jobs.report.steps ?? []).find(step =>
      step.run?.includes("--contract-version")
    );
    expect(assertion?.run).toContain("contract mismatch");
    expect(assertion?.run).toContain("exit 1");
  });
});

describe("cancel a read, queue a write", () => {
  const report = workflow(REPORT_REUSABLE_REL);
  const reportCaller = workflow(REPORT_CALLER_REL);
  const gateCaller = workflow(GATE_CALLER_REL);

  it("the filing job's concurrency group is NON-cancelling", () => {
    // Two overlapping reports would both read "no open issue for this suite"
    // and both file one. Cancelling the older one would be worse still: it can
    // be half way through updating an issue set.
    expect(report.jobs.report.concurrency?.["cancel-in-progress"]).toBe(false);
    // Repository-wide, not per-ref: two runs on different refs still write to
    // the same issues.
    expect(report.jobs.report.concurrency?.group).toContain(
      "github.repository"
    );
  });

  it("the group lives in the REUSABLE, where an adopter cannot forget it", () => {
    // A forgotten concurrency group produces exactly the duplicates that "one
    // issue per suite" exists to prevent, so it is not left to the caller.
    expect(reportCaller.concurrency).toBeUndefined();
    expect(reportCaller.jobs.report.concurrency).toBeUndefined();
  });

  it("the GATE caller keeps its per-PR CANCELLING group", () => {
    // The gate is a stateless read with no shared state, so a superseded
    // evaluation is pure waste. Same word, opposite settings, opposite reasons.
    expect(gateCaller.concurrency?.["cancel-in-progress"]).toBe(true);
  });
});

describe("the contract document and the reporting code stay together", () => {
  const doc = read(DOC_REL);
  const guard = read(GUARD_REL);

  it("rows 27-31 are stated as a table, not left to the code", () => {
    expect(doc).toContain("## 10. The tracking issue");
    for (const row of ["| 27 |", "| 28 |", "| 29 |", "| 30 |", "| 31 |"]) {
      expect(doc).toContain(row);
    }
  });

  it("states the two properties that make this a state mirror, not a mailbox", () => {
    expect(doc).toContain("One issue per SUITE, not per red night");
    expect(doc).toContain(
      "Closing an issue is a stronger claim than letting a pull request through"
    );
  });

  it("records that completeness is REUSED from row 26, never re-derived", () => {
    expect(doc).toContain(
      "Completeness is not re-derived here; row 26's `incomplete_run` token *is* the"
    );
    // The guard asks the question through the named predicate rather than
    // testing the state alone, which is what survives a future loosening of
    // row 26.
    expect(guard).toContain("isCompleteEvidence");
    expect(guard).toContain("INCOMPLETE_EVIDENCE_REASON");
  });

  it("records the reporting half as a MINOR contract bump", () => {
    // The claim is "this shipped inside major 1", not "the guard is pinned at
    // the version this half shipped as". Asserting the exact current version
    // would make every LATER minor — rows 32-35 shipped the next one — fail a
    // case about a bump that already happened, so the durable assertions are
    // the MAJOR plus the history the doc records.
    expect(guard).toMatch(/NIGHTLY_E2E_CONTRACT_VERSION = "1\.\d+\.\d+"/);
    expect(doc).toContain("adding a surface that gates nothing");
    expect(doc).toContain("1.1.0 → 1.2.0");
  });

  it("the bypass report no longer promises an artefact Lisa never creates", () => {
    // The dangling reference this closed: the guard told readers "the tracking
    // issue stays open until a green run lands" while nothing ever filed one.
    expect(guard).toContain("the tracking issue");
    expect(guard).toContain("nightly-e2e-report");
  });

  it("names the seams the neighbouring work units attach to", () => {
    // Scope discipline in writing: the next unit should find its attachment
    // point rather than re-litigating this design.
    expect(doc).toContain("Seams left open on purpose");
  });
});

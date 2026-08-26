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

/** The flag that is the ONLY entry point to any write in the guard. */
const REPORT_FLAG = "--report-issues";

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
      "pull-requests": "read",
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
    expect(read(REPORT_REUSABLE_REL)).toContain(REPORT_FLAG);
    expect(read(GATE_REUSABLE_REL)).not.toContain(REPORT_FLAG);
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

describe("the blocking claim is wired end to end (§10.7)", () => {
  const reusable = workflow(REPORT_REUSABLE_REL);
  const doc = read(DOC_REL);
  const guard = read(GUARD_REL);

  /**
   * The reusable's `workflow_call` inputs.
   *
   * @returns The declared inputs
   */
  function inputs(): Record<string, { default?: unknown; type?: string }> {
    const on = triggers(reusable) as {
      workflow_call?: { inputs?: Record<string, never> };
    };
    return (on.workflow_call?.inputs ?? {}) as Record<
      string,
      { default?: unknown; type?: string }
    >;
  }

  it("the three new inputs exist, and the two optional ones default to today's behaviour", () => {
    const declared = inputs();
    // Pinning is a NEW capability, so it defaults off — an adopter who does
    // nothing gets byte-identical behaviour.
    expect(declared.pin_issues?.default).toBe(false);
    expect(declared.pin_issues?.type).toBe("boolean");
    // These two carry the values Lisa's own templates already use, so an
    // adopter who does nothing gets the correct measurement rather than an
    // opt-in they will never find.
    expect(declared.gate_context?.default).toBe(
      "🌙 Nightly E2E Health / 🌙 Gate"
    );
    expect(declared.bypass_label?.default).toBe("nightly-e2e-bypass");
  });

  it("no existing input was renamed or retyped — consumers pin these", () => {
    // §8: inputs are never repurposed. Three consumers call this workflow by
    // name, and a renamed input is a startup failure on their next nightly.
    const declared = inputs();
    for (const name of [
      "suites",
      "branch",
      "freshness_hours",
      "issue_label",
      "guard_script",
      "expected_contract_major",
      "node_version",
      "api_max_attempts",
      "api_max_pages",
      "api_retry_max_seconds",
      "timeout_minutes",
    ]) {
      expect(declared[name]).toBeDefined();
    }
    expect(declared.issue_label?.default).toBe("nightly-e2e");
    expect(declared.expected_contract_major?.default).toBe(1);
  });

  it("every new input reaches the guard as an environment variable", () => {
    // An input the workflow accepts and never passes on is a knob wired to
    // nothing — the caller believes it configured something and did not.
    const step = reusable.jobs.report?.steps?.find(one =>
      one.run?.includes(REPORT_FLAG)
    );
    expect(step).toBeDefined();
    const env = (step as unknown as { env: Record<string, string> }).env;
    expect(env.NIGHTLY_GATE_CONTEXT).toContain("inputs.gate_context");
    expect(env.NIGHTLY_BYPASS_LABEL).toContain("inputs.bypass_label");
    expect(env.NIGHTLY_PIN_ISSUES).toContain("inputs.pin_issues");
    // And the guard reads exactly those names.
    for (const name of [
      "NIGHTLY_GATE_CONTEXT",
      "NIGHTLY_BYPASS_LABEL",
      "NIGHTLY_PIN_ISSUES",
    ]) {
      expect(guard).toContain(`env.${name}`);
    }
  });

  it("the reporter has only the issue write and PR-state read scopes it uses", () => {
    // The report creates or updates the issue and reads the pull request whose
    // bypass-label state it reports. Neither capability belongs to the blocking
    // gate half.
    expect(reusable.permissions).toEqual({
      contents: "read",
      actions: "read",
      issues: "write",
      "pull-requests": "read",
    });
  });

  it("the doc states all three states and the 404 rule", () => {
    expect(doc).toContain("The blocking claim is MEASURED");
    for (const state of ["`required`", "`not_required`", "`unknown`"]) {
      expect(doc).toContain(state);
    }
    expect(doc).toContain("A `404` is `unknown`, never `not_required`");
    expect(doc).toContain("Pinning is opt-in");
  });

  it("the doc records the measured falsehood this replaced", () => {
    // The reason has to travel with the change. Without it, the next person to
    // read a `not_required` issue concludes the reporter is broken and
    // hardcodes the sentence back.
    expect(doc).toContain("measurably false");
    expect(doc).toContain("AcmeOrgB/frontend");
  });

  it("the guard reads the EFFECTIVE rules endpoint, never one ruleset by id", () => {
    expect(guard).toContain("/rules/branches/");
    expect(guard).toContain("required_status_checks");
  });

  it("the caller template documents the measurement rather than hiding it", () => {
    const caller = read(REPORT_CALLER_REL);
    expect(caller).toContain("gate_context");
    expect(caller).toContain("pin_issues: false");
    expect(caller).toContain('"gated": false');
  });
});

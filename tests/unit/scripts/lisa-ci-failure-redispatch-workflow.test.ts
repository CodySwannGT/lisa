/**
 * Structural contract of `.github/workflows/lisa-ci-failure-redispatch.yml`.
 *
 * `workflow_run` runs in the base repository with a write-capable token, even
 * for a run a PR triggered. The safety property is therefore structural and is
 * asserted here: the job checks out only the default branch (no `ref`, nothing
 * derived from the run's head), never runs PR code, holds only the four
 * permissions the ticket names, and passes event data through `env:` rather
 * than interpolating it into a shell script.
 * @module tests/unit/scripts/lisa-ci-failure-redispatch-workflow
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const PATH = ".github/workflows/lisa-ci-failure-redispatch.yml";
const workflow = parse(readFileSync(PATH, "utf8"));
const job = workflow.jobs.redispatch;
const steps: any[] = job.steps;

describe("trigger", () => {
  it("fires when either workflow carrying required checks on main completes", () => {
    expect(workflow.on.workflow_run).toEqual({
      workflows: ["🔍 CI Quality Checks", "🧩 Plugins Sync"],
      types: ["completed"],
    });
  });

  it("names workflows that exist under exactly those names", () => {
    const names = [
      ".github/workflows/ci.yml",
      ".github/workflows/plugins-sync.yml",
    ].map(file => parse(readFileSync(file, "utf8")).name);
    expect(names).toEqual(workflow.on.workflow_run.workflows);
  });

  it("offers a manual dispatch by run id or head SHA that defaults to a dry run", () => {
    // Exactly one of the two is required; the script enforces that at run time.
    expect(workflow.on.workflow_dispatch.inputs.run_id).toMatchObject({
      type: "string",
      required: false,
    });
    expect(workflow.on.workflow_dispatch.inputs.head_sha).toMatchObject({
      type: "string",
      required: false,
    });
    expect(workflow.on.workflow_dispatch.inputs.dry_run).toMatchObject({
      type: "boolean",
      default: true,
    });
  });
});

describe("third-party required checks (CodySwannGT/lisa#4678)", () => {
  it("also fires when any check run completes or any commit status changes", () => {
    expect(workflow.on.check_run).toEqual({ types: ["completed"] });
    expect("status" in workflow.on).toBe(true);
  });

  it("drops pending statuses and Actions-owned check runs before the job starts", () => {
    expect(job.if).toContain(
      "!(github.event_name == 'status' && github.event.state == 'pending')"
    );
    expect(job.if).toContain(
      "!(github.event_name == 'check_run' && github.event.check_run.app.slug == 'github-actions')"
    );
  });

  it("hard-codes no required context: the script reads them from the ruleset", () => {
    const text = readFileSync(PATH, "utf8")
      .split("\n")
      .filter(line => !line.trimStart().startsWith("#"))
      .join("\n");
    expect(text).not.toMatch(/CodeRabbit|GitGuardian/u);
  });

  it("serialises every trigger on the head SHA it concerns", () => {
    const group: string = workflow.concurrency.group;
    for (const source of [
      "github.event.workflow_run.head_sha",
      "github.event.check_run.head_sha",
      "github.event.sha",
      "inputs.head_sha",
    ])
      expect(group).toContain(source);
    expect(group.startsWith("lisa-ci-failure-redispatch-")).toBe(true);
  });

  it("hands the manual head SHA to the script through env only", () => {
    const step = steps.find(s => typeof s.run === "string" && s.env?.HEAD_SHA);
    expect(step?.env.HEAD_SHA).toBe("${{ inputs.head_sha }}");
    expect(step?.run).toContain('--head-sha "$HEAD_SHA"');
    expect(step?.run).toContain('--payload "$GITHUB_EVENT_PATH"');
  });
});

describe("permissions", () => {
  it("defaults the workflow to read-only contents", () => {
    expect(workflow.permissions).toEqual({ contents: "read" });
  });

  it("grants the job exactly the metadata scopes it needs", () => {
    expect(job.permissions).toEqual({
      contents: "read",
      issues: "write",
      "pull-requests": "read",
      checks: "read",
      actions: "read",
    });
  });

  it("runs only in the Lisa repository and serialises per head without cancelling", () => {
    expect(job.if).toContain("github.repository == 'CodySwannGT/lisa'");
    expect(workflow.concurrency.group).toContain("head_sha");
    expect(workflow.concurrency["cancel-in-progress"]).toBe(false);
  });
});

describe("never runs the PR's code", () => {
  const checkouts = steps.filter(step =>
    String(step.uses ?? "").startsWith("actions/checkout@")
  );

  it("checks out only the default branch, without persisted credentials", () => {
    expect(checkouts).toHaveLength(1);
    expect(checkouts[0].with?.ref).toBeUndefined();
    expect(checkouts[0].with?.repository).toBeUndefined();
    expect(checkouts[0].with?.["persist-credentials"]).toBe(false);
  });

  it("references no head ref or head SHA anywhere a step could fetch or run it", () => {
    for (const step of steps) {
      const text = JSON.stringify({ with: step.with, run: step.run });
      expect(text).not.toMatch(/head_sha|head_branch|head\.ref|head_ref/u);
    }
  });

  it("interpolates no expression inside a shell script", () => {
    for (const step of steps.filter(s => typeof s.run === "string")) {
      expect(step.run).not.toContain("${{");
    }
  });

  it("installs no dependencies and runs only the default-branch script", () => {
    const scripts = steps
      .filter(s => typeof s.run === "string")
      .map(s => s.run)
      .join("\n");
    expect(scripts).not.toMatch(/\b(bun|npm|yarn|pnpm) (install|ci|run)\b/u);
    expect(scripts).toContain("node scripts/lisa-ci-failure-redispatch.mjs");
  });

  it("pins every non-actions/ action to a full commit SHA", () => {
    for (const step of steps.filter(s => typeof s.uses === "string")) {
      if (step.uses.startsWith("actions/")) continue;
      expect(step.uses).toMatch(/@[0-9a-f]{40}$/u);
    }
  });
});

describe("a failure is reported", () => {
  it("files a deduplicated issue when the job fails", () => {
    const report = workflow.jobs.create_issue_on_failure;
    expect(report.needs).toBe("redispatch");
    expect(report.if).toContain("failure()");
    expect(report.uses).toBe(
      "./.github/workflows/create-github-issue-on-failure.yml"
    );
  });
});

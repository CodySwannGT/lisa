import * as fs from "fs-extra";
import yaml from "js-yaml";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const WORKFLOWS_DIR = path.join(REPO_ROOT, ".github", "workflows");
const CREATE_ISSUE_DISPATCH_YML = path.join(
  WORKFLOWS_DIR,
  "create-issue-on-failure.yml"
);
const CREATE_JIRA_ISSUE_YML = path.join(
  WORKFLOWS_DIR,
  "create-jira-issue-on-failure.yml"
);
const CREATE_SENTRY_ISSUE_YML = path.join(
  WORKFLOWS_DIR,
  "create-sentry-issue-on-failure.yml"
);
const CREATE_LINEAR_ISSUE_YML = path.join(
  WORKFLOWS_DIR,
  "create-linear-issue-on-failure.yml"
);
const CREATE_GITHUB_ISSUE_YML = path.join(
  WORKFLOWS_DIR,
  "create-github-issue-on-failure.yml"
);
const CLAUDE_CI_AUTO_FIX_YML = path.join(
  WORKFLOWS_DIR,
  "reusable-claude-ci-auto-fix.yml"
);

/** Shape of a single step inside a workflow job's `steps:` list. */
interface WorkflowStep {
  id?: string;
  name?: string;
  run?: string;
  uses?: string;
  if?: string;
  env?: Record<string, unknown>;
  with?: Record<string, unknown>;
}

/** Shape of a single job inside a workflow's `jobs:` map. */
interface WorkflowJob {
  steps?: WorkflowStep[];
  if?: string;
  uses?: string;
  with?: Record<string, unknown>;
  outputs?: Record<string, string>;
}

/** Root shape of the parsed failure issue workflows. */
interface FailureIssueWorkflow {
  jobs: Record<string, WorkflowJob>;
}

/**
 * Parses a workflow YAML file into the shape the assertions consume.
 * @param workflowPath Absolute path to the workflow file.
 * @returns The parsed workflow.
 */
function loadWorkflow(workflowPath: string): FailureIssueWorkflow {
  return yaml.load(
    fs.readFileSync(workflowPath, "utf8")
  ) as FailureIssueWorkflow;
}

/**
 * Flattens every job's steps into a single list.
 * @param workflow The parsed workflow.
 * @returns All steps across all jobs.
 */
function stepsOf(workflow: FailureIssueWorkflow): WorkflowStep[] {
  return Object.values(workflow.jobs).flatMap(job => job.steps ?? []);
}

describe("failure issue workflows", () => {
  it.each([
    ["Jira", CREATE_JIRA_ISSUE_YML, "create_jira_issue"],
    ["Sentry", CREATE_SENTRY_ISSUE_YML, "create_sentry_issue"],
    ["Linear", CREATE_LINEAR_ISSUE_YML, "create_linear_issue"],
  ])(
    "%s passes commit messages through env instead of shell interpolation",
    (_label, workflowPath, stepId) => {
      const workflow = loadWorkflow(workflowPath);
      const createIssue = stepsOf(workflow).find(step => step.id === stepId);
      const run = createIssue?.run ?? "";

      expect(createIssue).toBeDefined();
      expect(createIssue?.env?.COMMIT_MESSAGE).toBe(
        "${{ github.event.head_commit.message || 'N/A' }}"
      );
      expect(run).toContain('COMMIT_MESSAGE="${COMMIT_MESSAGE:-N/A}"');
      expect(run).toContain('--arg commit_message "${COMMIT_MESSAGE}"');
      expect(run).not.toContain("github.event.head_commit.message");
    }
  );

  it("keeps head_commit.message out of workflow shell scripts", () => {
    for (const workflowPath of [
      CREATE_JIRA_ISSUE_YML,
      CREATE_SENTRY_ISSUE_YML,
      CREATE_LINEAR_ISSUE_YML,
    ]) {
      const workflow = loadWorkflow(workflowPath);

      for (const [jobName, job] of Object.entries(workflow.jobs)) {
        for (const step of job.steps ?? []) {
          expect(
            step.run ?? "",
            `${path.basename(workflowPath)} ${jobName}: ${step.name ?? step.id}`
          ).not.toContain("github.event.head_commit.message");
        }
      }
    }
  });
});

describe("config-driven issue dispatcher", () => {
  const dispatcher = loadWorkflow(CREATE_ISSUE_DISPATCH_YML);

  it("reads the declared tracker from .lisa.config.json", () => {
    const dispatch = dispatcher.jobs.dispatch;
    expect(dispatch).toBeDefined();
    const checkout = (dispatch.steps ?? []).find(step =>
      (step.uses ?? "").startsWith("actions/checkout")
    );
    expect(checkout).toBeDefined();

    const check = (dispatch.steps ?? []).find(step => step.id === "check");
    expect(check?.run).toContain(".lisa.config.json");
    expect(check?.run).toContain("jq -r '.tracker // empty'");
    expect(check?.run).toContain("jq -r '.linear.teamKey // empty'");
  });

  it("routes to jira, github, and linear legs — never sentry", () => {
    expect(dispatcher.jobs.create_jira_issue?.uses).toContain(
      "create-jira-issue-on-failure.yml"
    );
    expect(dispatcher.jobs.create_github_issue?.uses).toContain(
      "create-github-issue-on-failure.yml"
    );
    expect(dispatcher.jobs.create_linear_issue?.uses).toContain(
      "create-linear-issue-on-failure.yml"
    );
    expect(dispatcher.jobs.create_sentry_issue).toBeUndefined();
    for (const job of Object.values(dispatcher.jobs)) {
      expect(job.uses ?? "").not.toContain(
        "create-sentry-issue-on-failure.yml"
      );
    }
  });

  it("reports misconfiguration loudly through the GitHub leg instead of silently falling back", () => {
    const check = (dispatcher.jobs.dispatch.steps ?? []).find(
      step => step.id === "check"
    );
    expect(check?.run).toContain('MODE="misconfiguration"');

    const githubLeg = dispatcher.jobs.create_github_issue;
    expect(githubLeg?.with?.mode).toBe("${{ needs.dispatch.outputs.mode }}");
    expect(githubLeg?.with?.misconfig_missing).toBe(
      "${{ needs.dispatch.outputs.missing }}"
    );
  });

  it("names both possible causes for a missing secret (unset vs not propagated)", () => {
    const check = (dispatcher.jobs.dispatch.steps ?? []).find(
      step => step.id === "check"
    );
    expect(check?.run).toContain("secrets: inherit");
  });
});

describe("issue deduplication", () => {
  it("GitHub leg comments on an existing open issue instead of filing a duplicate", () => {
    const workflow = loadWorkflow(CREATE_GITHUB_ISSUE_YML);
    const script = String(
      stepsOf(workflow).find(step =>
        (step.uses ?? "").startsWith("actions/github-script")
      )?.with?.script ?? ""
    );
    expect(script).toContain("search.issuesAndPullRequests");
    expect(script).toContain("issue.title === title");
    expect(script).toContain("createComment");
  });

  it("GitHub leg supports the misconfiguration mode with its own label", () => {
    const workflow = loadWorkflow(CREATE_GITHUB_ISSUE_YML);
    const script = String(
      stepsOf(workflow).find(step =>
        (step.uses ?? "").startsWith("actions/github-script")
      )?.with?.script ?? ""
    );
    expect(script).toContain("mode === 'misconfiguration'");
    expect(script).toContain("lisa-misconfiguration");
  });

  it("Jira leg searches for an existing non-Done issue before creating", () => {
    const workflow = loadWorkflow(CREATE_JIRA_ISSUE_YML);
    const run =
      stepsOf(workflow).find(step => step.id === "create_jira_issue")?.run ??
      "";
    expect(run).toContain("statusCategory != Done");
    expect(run).toContain(".fields.summary == $summary");
    expect(run).toContain("/comment");
  });

  it("Linear leg searches for an existing non-terminal issue before creating", () => {
    const workflow = loadWorkflow(CREATE_LINEAR_ISSUE_YML);
    const run =
      stepsOf(workflow).find(step => step.id === "create_linear_issue")?.run ??
      "";
    expect(run).toContain("title: { eq: $title }");
    expect(run).toContain("commentCreate");
  });
});

describe("claude ci auto-fix ownership and fix detection", () => {
  const workflow = loadWorkflow(CLAUDE_CI_AUTO_FIX_YML);
  const autoFixSteps = workflow.jobs["auto-fix"]?.steps ?? [];

  it("captures the pre-fix SHA before Claude runs and compares the remote against it", () => {
    const PRE_CLAUDE_STEP_ID = "pre-claude";
    const claudeIndex = autoFixSteps.findIndex(
      step => step.id === "claude-fix"
    );
    const preClaudeIndex = autoFixSteps.findIndex(
      step => step.id === PRE_CLAUDE_STEP_ID
    );

    expect(preClaudeIndex).toBeGreaterThanOrEqual(0);
    expect(preClaudeIndex).toBeLessThan(claudeIndex);

    const checkFix = autoFixSteps.find(step => step.id === "check-fix");
    expect(checkFix?.run).toContain("steps.pre-claude.outputs.pre_sha");
    // The old logic compared post-commit local HEAD to the remote — always
    // equal after a successful push, misreporting every fix as a failure.
    expect(checkFix?.run).not.toContain("CURRENT_SHA=$(git rev-parse HEAD)");
  });

  it("stands down for a fresh babysitter lease or activity during the quiet period", () => {
    const guard = autoFixSteps.find(step => step.id === "ownership-guard");
    expect(guard).toBeDefined();
    expect(guard?.run).toContain("lease_is_fresh");
    expect(guard?.run).toContain("QUIET_PERIOD_MINUTES");
    expect(guard?.env?.LEASE_LABEL).toBe("${{ inputs.lease_label }}");
  });

  it("works on a side branch and never pushes to the failing branch", () => {
    const preClaude = autoFixSteps.find(step => step.id === "pre-claude");
    expect(preClaude?.run).toContain("claude-auto-fix-");

    const claudeFix = autoFixSteps.find(step => step.id === "claude-fix");
    const prompt = String(claudeFix?.with?.prompt ?? "");
    expect(prompt).toContain("NEVER push to");

    const ensurePr = autoFixSteps.find(
      step => step.name === "Ensure fix PR exists"
    );
    expect(ensurePr).toBeDefined();
  });

  it("falls back to a non-frozen install so lockfile failures still reach Claude", () => {
    const install = autoFixSteps.find(
      step => step.name === "Install dependencies"
    );
    expect(install?.run).toContain("npm ci ||");
    expect(install?.run).toContain("bun install --frozen-lockfile ||");
    expect(install?.run).toContain("yarn install --frozen-lockfile ||");
  });

  it("files escalation tickets with honest titles about whether Claude ran", () => {
    const createIssue = workflow.jobs["create-issue"];
    expect(createIssue?.if).toContain("skipped_ownership != 'true'");
    const failedJob = String(createIssue?.with?.failed_job ?? "");
    expect(failedJob).toContain("Claude auto-fix ran and could not fix");
    expect(failedJob).toContain("Auto-fix harness failed before Claude ran");

    const fixPrEscalation = workflow.jobs["create-issue-for-failed-fix-pr"];
    expect(fixPrEscalation?.if).toContain("claude-auto-fix-");
  });
});

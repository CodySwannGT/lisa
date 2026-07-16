import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { loadWorkflow, stepsOf } from "../helpers/workflow-test-utils.js";

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

  it("names both possible causes for a missing secret (unset vs not passed through)", () => {
    const check = (dispatcher.jobs.dispatch.steps ?? []).find(
      step => step.id === "check"
    );
    expect(check?.run).toContain(
      "(unset, or not passed through by the calling workflow's secrets mapping)"
    );
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
    // Terminal issues must not swallow recurrences — only open issues dedupe.
    expect(script).toContain("is:issue is:open in:title");
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
    // Terminal issues must not swallow recurrences — completed/canceled
    // Linear states are excluded from the dedupe search.
    expect(run).toContain(
      'state: { type: { nin: [\\"completed\\", \\"canceled\\"] } }'
    );
    expect(run).toContain("commentCreate");
  });
});

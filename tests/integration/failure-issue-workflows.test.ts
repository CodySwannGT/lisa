import * as fs from "fs-extra";
import yaml from "js-yaml";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CREATE_JIRA_ISSUE_YML = path.join(
  REPO_ROOT,
  ".github",
  "workflows",
  "create-jira-issue-on-failure.yml"
);
const CREATE_SENTRY_ISSUE_YML = path.join(
  REPO_ROOT,
  ".github",
  "workflows",
  "create-sentry-issue-on-failure.yml"
);

/** Shape of a single step inside a workflow job's `steps:` list. */
interface WorkflowStep {
  id?: string;
  name?: string;
  run?: string;
  env?: Record<string, unknown>;
}

/** Shape of a single job inside a workflow's `jobs:` map. */
interface WorkflowJob {
  steps?: WorkflowStep[];
}

/** Root shape of the parsed failure issue workflows. */
interface FailureIssueWorkflow {
  jobs: Record<string, WorkflowJob>;
}

describe("failure issue workflows", () => {
  it.each([
    ["Jira", CREATE_JIRA_ISSUE_YML, "create_jira_issue"],
    ["Sentry", CREATE_SENTRY_ISSUE_YML, "create_sentry_issue"],
  ])(
    "%s passes commit messages through env instead of shell interpolation",
    (_label, workflowPath, stepId) => {
      const workflow = yaml.load(
        fs.readFileSync(workflowPath, "utf8")
      ) as FailureIssueWorkflow;
      const steps = Object.values(workflow.jobs).flatMap(
        job => job.steps ?? []
      );
      const createIssue = steps.find(step => step.id === stepId);
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
    ]) {
      const workflow = yaml.load(
        fs.readFileSync(workflowPath, "utf8")
      ) as FailureIssueWorkflow;

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

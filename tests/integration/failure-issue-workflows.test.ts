import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { loadWorkflow, stepsOf } from "../helpers/workflow-test-utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GITHUB_SCRIPT_ACTION = "actions/github-script";
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
/**
 * The `actions/github-script` step's inline script, as text.
 *
 * Three suites read the same step to assert on what it contains. Each used to
 * re-find it by the same `uses` prefix, which is one literal repeated until the
 * duplicate-literal rule refused it — and, more to the point, three chances for
 * the readers to disagree about which step they mean.
 * @param workflowPath - Absolute path of the workflow to read.
 * @returns The step's script body, or the empty string when there is no such step.
 */
function githubScriptBody(workflowPath: string): string {
  const step = stepsOf(loadWorkflow(workflowPath)).find(candidate =>
    String(candidate.uses ?? "").startsWith(GITHUB_SCRIPT_ACTION)
  );
  return String(step?.with?.script ?? "");
}

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
    const script = githubScriptBody(CREATE_GITHUB_ISSUE_YML);
    expect(script).toContain("search.issuesAndPullRequests");
    // Terminal issues must not swallow recurrences — only open issues dedupe.
    expect(script).toContain("is:issue is:open in:title");
    expect(script).toContain("issue.title === title");
    expect(script).toContain("createComment");
  });

  it("GitHub leg supports the misconfiguration mode with its own label", () => {
    const script = githubScriptBody(CREATE_GITHUB_ISSUE_YML);
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

  describe("the GitHub writer cannot change the verdict it publishes", () => {
    // This job is the reporting half of whatever it reports on. A repo that
    // migrated to another tracker commonly DISABLES GitHub Issues, and every
    // misconfiguration branch of the dispatcher routes here anyway — this is the
    // report of last resort. Without a guard the write throws, the job fails, and
    // a green check goes red for a reason unrelated to the code under test.
    const script = (): string => githubScriptBody(CREATE_GITHUB_ISSUE_YML);

    it("checks has_issues before attempting the write", () => {
      const run = script();
      expect(run).toContain("repos.get");
      expect(run).toContain("has_issues");
      // The disabled case returns instead of falling through to the write.
      expect(run).toMatch(/if\s*\(!issuesEnabled\)/);
    });

    it("degrades to a warning plus job summary rather than failing", () => {
      const run = script();
      expect(run).toContain("core.warning");
      expect(run).toContain("core.summary");
      // The report itself must survive, not just the complaint about it.
      expect(run).toContain("Unpublished failure report");
      // Never fail the job on a publish problem.
      expect(run).not.toContain("core.setFailed");
    });

    it("catches a rejected write, not only a disabled repository", () => {
      const run = script();
      // has_issues can be true and the write still rejected — missing PAT scope,
      // rate limit, org policy, or Issues disabled between check and write.
      expect(run).toContain("catch");
      expect(run).toContain("the GitHub Issues API rejected the write");
      // The create/comment calls must sit inside the guarded block.
      expect(run).toMatch(/try\s*{[\s\S]*issues\.create\([\s\S]*}\s*catch/);
    });
  });
});

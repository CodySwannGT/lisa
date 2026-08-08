import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { loadWorkflow } from "../helpers/workflow-test-utils.js";

/** Step id of the loop guard in both auto-fix workflows. */
const LOOP_GUARD_ID = "loop-guard";
/** Absolute interpreter path; resolving `bash` via PATH is not permitted. */
const BASH = "/bin/bash";
/** Commit identity every CI automation shares; not auto-fix's own. */
const BOT_AUTHOR = "github-actions[bot]";
/** The commit identity auto-fix itself writes under. */
const AUTOFIX_AUTHOR = "claude[bot]";

/**
 * A bash function declaration shadows the external command of the same name,
 * so declaring `git` ahead of the step body makes the head commit's author
 * and subject controllable without a PATH shim or an on-disk executable.
 */
const GIT_STUB = [
  "git() {",
  '  if [[ "$*" == *"%an"* ]]; then',
  '    printf "%s\\n" "$STUB_AUTHOR"',
  "  else",
  '    printf "%s\\n" "$STUB_SUBJECT"',
  "  fi",
  "}",
].join("\n");

/**
 * Execute a loop-guard step body against a synthetic head commit.
 *
 * Returns the `skip=` value the step wrote to GITHUB_OUTPUT, which is the
 * only thing the downstream `if:` conditions consume.
 * @param run The step's `run` script
 * @param author Value `git log -1 --format='%an'` should report
 * @param subject Value `git log -1 --format='%s'` should report
 * @returns "true" or "false" as written to the step output, else "unset"
 */
function runLoopGuard(run: string, author: string, subject: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-loop-guard-"));
  try {
    const outFile = path.join(dir, "github-output");
    fs.writeFileSync(outFile, "");
    execFileSync(BASH, ["-c", `${GIT_STUB}\n${run}`], {
      env: {
        ...process.env,
        GITHUB_OUTPUT: outFile,
        STUB_AUTHOR: author,
        STUB_SUBJECT: subject,
      },
      stdio: "pipe",
    });
    return (
      /skip=(true|false)/.exec(fs.readFileSync(outFile, "utf8"))?.[1] ?? "unset"
    );
  } finally {
    fs.rmSync(dir, { force: true, recursive: true });
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const WORKFLOWS_DIR = path.join(REPO_ROOT, ".github", "workflows");
const CLAUDE_CI_AUTO_FIX_YML = path.join(
  WORKFLOWS_DIR,
  "reusable-claude-ci-auto-fix.yml"
);
const CLAUDE_DEPLOY_AUTO_FIX_YML = path.join(
  WORKFLOWS_DIR,
  "reusable-claude-deploy-auto-fix.yml"
);
const CODE_REVIEW_RESPONSE_YML = path.join(
  WORKFLOWS_DIR,
  "reusable-claude-code-review-response.yml"
);
const INSTALL_STEP_NAME = "Install dependencies";
const NPM_FALLBACK_PATTERN =
  /npm ci \|\| \{[^}]*npm install --no-audit --no-fund/;
const BUN_FALLBACK_PATTERN =
  /bun install --frozen-lockfile \|\| \{[^}]*bun install/;
const YARN_FALLBACK_PATTERN =
  /yarn install --frozen-lockfile \|\| \{[^}]*yarn install/;

describe("claude ci auto-fix ownership and fix detection", () => {
  const workflow = loadWorkflow(CLAUDE_CI_AUTO_FIX_YML);
  const autoFixSteps = workflow.jobs["auto-fix"]?.steps ?? [];

  it("skips only previous fix attempts, not branches authored by github-actions[bot]", () => {
    const guard = autoFixSteps.find(step => step.id === LOOP_GUARD_ID);
    // Parity with reusable-claude-deploy-auto-fix.yml: a merge of the
    // `claude-auto-fix-*` side branch is a loop; any other bot commit is not.
    expect(guard?.run).toContain('"$SUBJECT" == *"claude-auto-fix-"*');
    // The old blanket bot-author check exempted every bot-authored branch
    // (content pipelines, release bots) from auto-fix entirely, short-
    // circuiting before the ownership guard could apply lease rules.
    expect(guard?.run).not.toContain(
      '"$AUTHOR" == "github-actions[bot]" || "$AUTHOR" == "claude[bot]"'
    );
  });

  it("resolves every author/subject pair to the right loop-guard outcome", () => {
    const run = autoFixSteps.find(step => step.id === LOOP_GUARD_ID)?.run ?? "";
    expect(run).not.toBe("");

    // Own identity: a previous auto-fix commit, whatever the subject.
    expect(runLoopGuard(run, AUTOFIX_AUTHOR, "fix: repair failing lint")).toBe(
      "true"
    );
    // A merge of the side branch is the other shape a previous attempt takes.
    expect(
      runLoopGuard(
        run,
        BOT_AUTHOR,
        "Merge pull request #12 from o/claude-auto-fix-feature-x"
      )
    ).toBe("true");
    // Unrelated bot commits must reach the ownership guard, not stand down.
    // This is the case that regressed: a content pipeline authoring a branch.
    expect(runLoopGuard(run, BOT_AUTHOR, "feat(blog): publish a post")).toBe(
      "false"
    );
    expect(
      runLoopGuard(run, BOT_AUTHOR, "chore(release): 1.2.3 [skip ci]")
    ).toBe("false");
    // Humans always proceed.
    expect(runLoopGuard(run, "Cody Swann", "feat: add a feature")).toBe(
      "false"
    );
  });

  it("captures the pre-fix SHA before Claude runs and compares the remote against it", () => {
    const claudeIndex = autoFixSteps.findIndex(
      step => step.id === "claude-fix"
    );
    const preClaudeIndex = autoFixSteps.findIndex(
      step => step.id === "pre-claude"
    );

    expect(preClaudeIndex).toBeGreaterThanOrEqual(0);
    expect(preClaudeIndex).toBeLessThan(claudeIndex);

    const checkFix = autoFixSteps.find(step => step.id === "check-fix");
    expect(checkFix?.env?.PRE_SHA).toBe(
      "${{ steps.pre-claude.outputs.pre_sha }}"
    );
    // A stale side branch from an earlier attempt must not count as a fix.
    expect(checkFix?.env?.PRE_SIDE_SHA).toBe(
      "${{ steps.pre-claude.outputs.pre_side_sha }}"
    );
    expect(checkFix?.run).toContain('"$SIDE_SHA" != "$PRE_SIDE_SHA"');
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
    const run =
      autoFixSteps.find(step => step.name === INSTALL_STEP_NAME)?.run ?? "";
    // Each frozen install must fall back to the real non-frozen command,
    // not merely tolerate failure.
    expect(run).toMatch(NPM_FALLBACK_PATTERN);
    expect(run).toMatch(BUN_FALLBACK_PATTERN);
    expect(run).toMatch(YARN_FALLBACK_PATTERN);
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

describe("code review response ownership and lifecycle guards", () => {
  const workflow = loadWorkflow(CODE_REVIEW_RESPONSE_YML);
  const steps = workflow.jobs["respond-to-review"]?.steps ?? [];

  it("guards before checkout: open PR, existing head ref, unleased branch", () => {
    const guardIndex = steps.findIndex(step => step.id === "guard");
    const checkoutIndex = steps.findIndex(step =>
      (step.uses ?? "").startsWith("actions/checkout")
    );

    expect(guardIndex).toBeGreaterThanOrEqual(0);
    // A merged PR usually means a deleted head ref; checking out a missing
    // ref fails the job red instead of skipping cleanly.
    expect(guardIndex).toBeLessThan(checkoutIndex);

    const guard = steps[guardIndex];
    expect(guard?.run).toContain('"$PR_STATE" != "open"');
    expect(guard?.run).toContain("git/ref/heads/$HEAD_REF");
    expect(guard?.run).toContain("LEASE_LABEL");
    expect(guard?.env?.LEASE_LABEL).toBe("${{ inputs.lease_label }}");

    expect(steps[checkoutIndex]?.if).toContain(
      "steps.guard.outputs.skip != 'true'"
    );
  });

  it("falls back to a non-frozen install on lockfile drift", () => {
    const run = steps.find(step => step.name === INSTALL_STEP_NAME)?.run ?? "";
    expect(run).toMatch(NPM_FALLBACK_PATTERN);
    expect(run).toMatch(BUN_FALLBACK_PATTERN);
    expect(run).toMatch(YARN_FALLBACK_PATTERN);
  });
});

describe("deploy auto-fix escalation and loop guard", () => {
  const workflow = loadWorkflow(CLAUDE_DEPLOY_AUTO_FIX_YML);
  const autoFixSteps = workflow.jobs["auto-fix"]?.steps ?? [];

  it("skips only previous fix attempts, not release commits by github-actions[bot]", () => {
    const guard = autoFixSteps.find(step => step.id === LOOP_GUARD_ID);
    expect(guard?.run).toContain('"$SUBJECT" == *"claude/deploy-fix-"*');
    // The old blanket bot-author check disabled self-healing on every
    // deploy that followed a release commit.
    expect(guard?.run).not.toContain(
      '"$AUTHOR" == "github-actions[bot]" || "$AUTHOR" == "claude[bot]"'
    );
  });

  it("falls back to a non-frozen install in both jobs", () => {
    for (const jobName of ["auto-fix", "escalate-to-ticket"]) {
      const run =
        (workflow.jobs[jobName]?.steps ?? []).find(
          step => step.name === INSTALL_STEP_NAME
        )?.run ?? "";
      expect(run, jobName).toMatch(NPM_FALLBACK_PATTERN);
    }
  });

  it("files a deterministic dispatcher issue when Claude escalation is dead or absent", () => {
    const fallback = workflow.jobs["escalate-fallback"];
    expect(fallback?.uses).toContain("create-issue-on-failure.yml");
    expect(fallback?.if).toContain(
      "needs.check_claude_setup.outputs.has_claude_token != 'true'"
    );
    expect(fallback?.if).toContain(
      "needs.escalate-to-ticket.result == 'failure'"
    );
    expect(fallback?.if).toContain(
      "needs.escalate-to-ticket.outputs.ticketed != 'true'"
    );
    expect(fallback?.if).toContain("needs.auto-fix.outputs.fixed != 'true'");

    const escalate = workflow.jobs["escalate-to-ticket"];
    expect(escalate?.outputs?.ticketed).toBe(
      "${{ steps.create-ticket.outcome == 'success' }}"
    );
  });
});

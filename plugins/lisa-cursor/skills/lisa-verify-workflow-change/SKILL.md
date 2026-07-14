---
name: lisa-verify-workflow-change
description: "Use when a GitHub Actions workflow file changed and you need pre-merge runtime proof. Classifies default-branch-only triggers, dispatches a safe workflow_dispatch sibling on the branch ref when possible, observes the exact step under test, cancels before side effects, and proves cleanup."
allowed-tools: ["Bash", "Read"]
---

# Verify Workflow Change

## When to use

Use this skill when a pull request changes files under `.github/workflows/` and the change needs empirical GitHub Actions proof before merge.

This verifies workflow behavior, not product behavior. For product behavior, use `lisa-verify`. For PR merge driving, use `lisa-drive-pr-to-merge` after this skill has produced workflow evidence or a clear unverifiable verdict.

## Required Inputs

- Repository: `<org>/<repo>`.
- Branch ref containing the workflow change.
- Changed workflow path(s), usually `.github/workflows/<name>.yml`.
- The specific step, input, reusable workflow, or job behavior under test.
- Any known gate variable, secret, or repository variable that controls the dispatch path.

## Core Trap

GitHub evaluates `workflow_run`, `schedule`, `issue_comment`, and `pull_request_review` workflows from the default branch copy of the workflow file. A run fired by one of those triggers does not prove a pull request branch's copy of that workflow works.

Name this trap explicitly in the verification report. Do not cite a run fired by one of those triggers as evidence for branch changes.

## Procedure

1. **Establish the baseline**

   Capture the repository default branch, current open PR count, branch list, issue count, and any relevant repo variable state before dispatch:

   ```bash
   gh repo view <org>/<repo> --json defaultBranchRef
   gh pr list --repo <org>/<repo> --state open --json number,headRefName
   gh issue list --repo <org>/<repo> --state open --json number,title --limit 100
   gh variable list --repo <org>/<repo>
   ```

   If a gate variable may need to be changed, record whether it is set and its exact value. "Unset" is a distinct state and must be restored as unset, not as `false`.

2. **Classify each changed workflow trigger**

   Read the changed workflow file from the branch and list its `on:` triggers. If it uses `workflow_run`, `schedule`, `issue_comment`, or `pull_request_review`, state that the workflow's own trigger cannot exercise the branch copy pre-merge.

   A default-branch-only trigger is not a blocker by itself. It means direct trigger evidence is invalid and a dispatchable sibling is required.

3. **Find a dispatchable sibling**

   Search for a `workflow_dispatch` workflow that reaches the same reusable workflow, job, step, or input under test:

   ```bash
   rg -n "workflow_dispatch|uses:|<input-or-step-name>" .github/workflows
   gh workflow list --repo <org>/<repo>
   ```

   The sibling must exercise the same behavior, not merely run a nearby job. For reusable workflow caller changes, prove that the sibling reaches the same reusable and the same consumed input or install step.

   If no sibling can exercise the behavior, report `UNVERIFIABLE_PRE_MERGE` and stop. Do not fabricate passing evidence from lint, YAML parsing, or a default-branch-triggered run.

4. **Prepare gate variables exactly**

   If the sibling is gated by a repo variable, capture the prior state first:

   ```bash
   gh variable get <NAME> --repo <org>/<repo> || true
   gh variable set <NAME> --repo <org>/<repo> --body true
   ```

   Use a cleanup trap in shell scripts so restoration runs on success, failure, or cancellation. Restore to the exact prior state:

   - Previously unset: `gh variable delete <NAME> --repo <org>/<repo> --yes`
   - Previously set: `gh variable set <NAME> --repo <org>/<repo> --body "$PRIOR_VALUE"`

5. **Dispatch on the branch ref**

   Dispatch the sibling against the branch under test:

   ```bash
   gh workflow run <workflow-file-or-name> --repo <org>/<repo> --ref <branch>
   ```

   Then locate the run whose `headBranch` and `workflowName` match:

   ```bash
   gh run list --repo <org>/<repo> --workflow <workflow-file-or-name> --branch <branch> --json databaseId,status,conclusion,headBranch,headSha,createdAt --limit 10
   ```

6. **Poll only until the step under test is observable**

   Watch the run until the target job/step has completed or failed:

   ```bash
   gh run view <run-id> --repo <org>/<repo> --json status,conclusion,jobs
   gh run view <run-id> --repo <org>/<repo> --log
   ```

   Capture the smallest log excerpt that proves the step under test used the branch behavior. Keep quotes short; prefer summarized evidence with exact job, step, run id, and conclusion.

7. **Cancel before side effects**

   As soon as the target step is observed, cancel the run before any expensive or side-effectful stage starts:

   ```bash
   gh run cancel <run-id> --repo <org>/<repo>
   ```

   Side-effectful stages include opening pull requests, pushing branches, creating issues, publishing packages, deploying, running AI agents, or mutating external systems. If the run reaches a side-effectful stage before cancellation, the verification failed even if the target step passed.

8. **Assert zero side effects**

   Re-read and compare against the baseline:

   ```bash
   gh pr list --repo <org>/<repo> --state open --json number,headRefName
   gh issue list --repo <org>/<repo> --state open --json number,title --limit 100
   gh api -X GET repos/<org>/<repo>/branches --paginate
   gh variable list --repo <org>/<repo>
   ```

   Confirm no branches were created, no PRs were opened, no issues were filed, and every temporary gate variable is restored to its exact prior state, including unset.

## Verdicts

- `VERIFIED`: The branch-ref dispatch reached the exact behavior under test, the observed step passed, the run was cancelled before side effects, and cleanup was proven.
- `FAILED`: The branch-ref dispatch reached the behavior under test and the observed step failed, or side effects occurred.
- `UNVERIFIABLE_PRE_MERGE`: No dispatchable branch-ref path can exercise the behavior before merge.
- `BLOCKED`: GitHub auth, permissions, missing variables, or Actions availability prevent a reliable run.

## Output

Return a concise report with:

- Changed workflow(s) and trigger classification.
- Whether the default-branch execution trap applied.
- Dispatchable sibling selected, or why none exists.
- Exact `gh workflow run ... --ref <branch>` command used.
- Run id, branch, head SHA, job, and step observed.
- Observed outcome of the step under test.
- Cancellation point and proof that side-effectful stages did not start.
- Gate variable restoration proof, including unset restoration when applicable.
- Zero-side-effect readback for branches, PRs, and issues.
- Final verdict.

## Rules

- Never treat a `workflow_run`, `schedule`, `issue_comment`, or `pull_request_review` run as branch-copy evidence for the changed workflow.
- Always dispatch with `--ref <branch>` when using a sibling workflow for pre-merge proof.
- Cancel as soon as the step under test has produced evidence.
- Restore gate variables exactly; unset must return to unset.
- A verification that leaves new branches, PRs, issues, deployments, package publishes, or external mutations behind is failed verification.
- If no branch-ref dispatch path exists, say `UNVERIFIABLE_PRE_MERGE` and stop.

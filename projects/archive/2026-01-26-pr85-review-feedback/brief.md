# Implement PR Review Feedback for PR #85

**PR Link**: https://github.com/CodySwannGT/lisa/pull/85

## PR Overview

- **Title**: fix(ci): allow SonarCloud failures due to organization line limits
- **Description**: Allow SonarCloud CI step failures (organization has hit the 100k line limit), refactor PR review command to use project:bootstrap workflow, bump version to 1.0.9

## Review Comments to Address (ordered by file)

### 1. `.github/workflows/quality.yml:1042-1069` (Comment ID: 2727707212)

**Reviewer**: coderabbitai[bot]
**Comment**: Don't blanket-ignore all SonarCloud failures. The current validation unconditionally exits 0 on any failure, which masks real quality-gate failures and misconfigurations. If the goal is only to allow quota/line-limit failures, gate on the specific error from SonarCloud's API and fail otherwise.
**Action Required**: Update the validation step to:

1. Check for `.scannerwork/report-task.txt` file
2. Extract `serverUrl` and `ceTaskId` from the report
3. Query SonarCloud CE task API to get the actual error message
4. Only exit 0 if error contains "maximum allowed lines limit"
5. Exit 1 for all other failures

### 2. `typescript/copy-overwrite/.github/workflows/quality.yml:1042-1069` (Comment ID: 2727707222)

**Reviewer**: coderabbitai[bot]
**Comment**: Don't blanket-ignore SonarCloud failures—enforce the quality gate explicitly. The current code with continue-on-error: true and validation step exiting 0 on any failure silently bypasses quality checks.
**Action Required**: Same fix as #1 - update validation to detect specific line-limit errors via CE task API and fail for other errors

### 3. `.claude/commands/pull-request/review.md:33` (Comment ID: 2728023630)

**Reviewer**: coderabbitai[bot]
**Comment**: Add a language to the fenced code block. This fails markdownlint MD040 and reduces readability in editors.
**Action Required**: Change the opening ``` to ```markdown at line 33

### 4. `all/copy-overwrite/.claude/commands/pull-request/review.md:33` (Comment ID: 2728023639)

**Reviewer**: coderabbitai[bot]
**Comment**: Add a language to the fenced code block. This fails markdownlint MD040 and reduces readability in editors.
**Action Required**: Change the opening ``` to ```markdown at line 33

## Implementation Guidelines

- All review comments are valid and should be implemented
- The workflow file changes must be applied to both the project file AND the template file
- Ensure changes follow project coding standards (note: PROJECT_RULES.md says "Never parse JSON in shell scripts using grep/sed/cut/awk - always use jq for robust JSON handling")
- Run relevant tests to verify changes work

## Acceptance Criteria

- All 4 review comments addressed
- SonarCloud validation only allows line-limit quota errors, fails on other errors
- Markdown files have language specifiers on all fenced code blocks
- Tests pass after changes
- `bun run lint` passes

## Verification

Command: `bun run lint && bun run test`
Expected: All checks pass

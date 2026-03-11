# Plan: Multi-Repo Jira Triage Workflow Updates

## Context

The initial implementation of the Claude Nightly Jira Triage workflow used a single `claude-triaged` label. This breaks in multi-repo setups where multiple repositories (e.g., frontend, backend, infrastructure) share a single Jira project -- the first repo to triage would mark the ticket, causing other repos to skip it. Each repo has a unique codebase perspective, and tickets may be relevant to one repo, multiple repos, or none.

This plan updates the already-implemented workflow files to support multi-repo Jira triage.

## Design Decisions

- **Repo-scoped labels**: `claude-triaged-<repo-name>` (e.g., `claude-triaged-frontend-v2`) instead of a single `claude-triaged`. Each repo only filters by its own label via JQL. Repo name comes from `github.event.repository.name` (already available, no new config needed).
- **Relevance-first gating**: Before any triage work, Claude searches the local codebase for code related to the ticket. If nothing relevant is found, it adds the label and skips -- no noise posted to the ticket.
- **Cross-repo awareness**: Before posting comments, Claude reads existing comments on the ticket. If another repo already posted triage findings, Claude reads them and posts only additive findings from its own codebase perspective.
- **Scoped comment headers**: Every comment is prefixed with the repo name so humans can distinguish which repo's analysis produced each finding. E.g., `*[frontend-v2] Ambiguity detected (automated triage):*`
- **No feature flag** -- auto-enables when Jira auth vars/secrets are configured (`JIRA_BASE_URL`, `JIRA_USER_EMAIL`, `JIRA_PROJECT_KEY`, `JIRA_API_TOKEN`)
- **Jira REST API via curl** in the Claude prompt (not MCP plugin) -- more portable and avoids MCP auth complexity in CI
- **Caller templates** in `typescript` and `rails` create-only directories
- **Jira comments only** for verification methodology (no repo scripts committed)
- **Cron at 6 AM UTC weekdays** -- continues the staggering pattern (3AM test improvement, 4AM coverage, 5AM complexity)

## Files to Modify

All 4 workflow files and the documentation file already exist from the initial implementation. This plan only modifies them.

### 1. `.github/workflows/reusable-claude-nightly-jira-triage.yml` (MODIFY)

Changes to the reusable workflow:

**New env var**: Add `REPO_NAME: ${{ github.event.repository.name }}` to the Claude Code Action step's `env:` block. This is automatically available from GitHub context -- no new input or config needed.

**Claude prompt changes** (update the prompt passed to the Claude Code Action):

```
Step 0: Determine tickets to triage
  - Repository name: "$REPO_NAME" (used for repo-scoped labels and comment headers)
  - Triage label for this repo: "claude-triaged-$REPO_NAME"
  - If ticket_key is provided, use it directly
  - Otherwise, search via JQL -- filter by THIS REPO'S label:
    project="KEY" AND labels NOT IN ("claude-triaged-$REPO_NAME") AND status != Done ORDER BY created DESC

Step 1: For each ticket, fetch full details + existing comments
  - GET /rest/api/2/issue/{key}
  - GET /rest/api/2/issue/{key}/comment  (to read existing triage comments from other repos)
  - Extract: summary, description, acceptance criteria, labels, existing comments

Step 1.5 (NEW): Relevance check
  - Search the LOCAL codebase (Grep/Glob) for code related to the ticket's subject
  - If NO relevant code is found in this repo:
    - Add the repo-scoped label (so this ticket is not re-examined by this repo)
    - Output "Ticket {key} is not relevant to {REPO_NAME} -- skipping"
    - Move to the next ticket
  - If relevant code IS found, proceed to triage phases

Step 1.75 (NEW): Cross-repo awareness
  - Parse existing comments for triage headers from OTHER repos (e.g., "[backend-v2]")
  - Note which phases other repos have already covered
  - In subsequent phases, do NOT duplicate findings already posted by other repos
  - DO add supplementary findings specific to THIS repo's codebase

Step 2: Phase 1 - Ambiguity Detection (scoped)
  - Same analysis as before, but:
  - Comment header: "*[$REPO_NAME] Ambiguity detected (automated triage):*"
  - Skip ambiguities already raised by another repo's triage comments

Step 3: Phase 2 - Edge Case Analysis (scoped)
  - Same analysis, but scoped to THIS repo's codebase
  - Comment header: "*[$REPO_NAME] Edge cases identified (automated triage):*"
  - Reference only files in THIS repo
  - Acknowledge edge cases from other repos if relevant, but don't duplicate

Step 4: Phase 3 - Verification Methodology (scoped)
  - Same analysis, but scoped to THIS repo's capabilities
  - Comment header: "*[$REPO_NAME] Verification methodology (automated triage):*"
  - Verification methods should reflect what THIS repo can test
    (e.g., frontend repo suggests Playwright tests, backend repo suggests API curl commands)

Step 5: Label ticket with REPO-SCOPED label
  - Append "claude-triaged-$REPO_NAME" (NOT generic "claude-triaged")

Step 6: Output summary (unchanged)
```

**System prompt update**: Add instruction about multi-repo awareness: "Multiple repositories may triage the same Jira ticket. Read existing comments before posting to avoid duplication. Prefix all comments with [$REPO_NAME]. Only post findings relevant to the code in THIS repository."

### 2. `.github/workflows/claude-nightly-jira-triage.yml` (NO CHANGES)

Lisa's own caller workflow -- no changes needed. The repo name is derived automatically from `github.event.repository.name`.

### 3. `typescript/create-only/.github/workflows/claude-nightly-jira-triage.yml` (NO CHANGES)

Downstream caller template -- no changes needed.

### 4. `rails/create-only/.github/workflows/claude-nightly-jira-triage.yml` (NO CHANGES)

Same -- no changes needed.

### 5. `.github/GITHUB_ACTIONS.md` (MODIFY)

Update the workflow description section (already added) to mention:
- Multi-repo support: each repo triages independently using repo-scoped labels
- Cross-repo awareness: reads existing triage comments to avoid duplicates
- Relevance gating: skips tickets that don't relate to the repo's codebase

## Reference Files

- `.github/workflows/reusable-claude-nightly-jira-triage.yml` -- the file we're modifying (current implementation)
- `.github/workflows/create-jira-issue-on-failure.yml` -- Jira REST API auth pattern (curl with Basic auth, `github.event.repository.name` usage at line 128)
- `.github/workflows/reusable-claude-code-review-response.yml` -- pattern for passing `repo_name` via `github.event.repository.name`

## Verification

1. **Syntax check**: `actionlint` on the modified reusable workflow
2. **Single-repo test**: Manual dispatch with a known `ticket_key` -- verify:
   - Relevance check runs (searches codebase)
   - If relevant: comments are posted with `[lisa]` prefix (since the repo is `lisa`)
   - Label added is `claude-triaged-lisa` (not generic `claude-triaged`)
3. **Multi-repo test**: Run from two different repos pointing at the same Jira project:
   - First repo triages and posts comments with `[repo-1]` prefix
   - Second repo triages the SAME ticket: reads repo-1's comments, posts only additive `[repo-2]` findings
   - Both repos add their own repo-scoped labels
4. **Irrelevant ticket test**: Run against a ticket that has no related code in the repo -- verify it adds the label and skips without posting comments
5. **Format check**: `prettier --check` on modified files

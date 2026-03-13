# Plan: Create `/jira:triage` skill from CI workflow

## Files to create

- **`plugins/lisa/skills/jira-triage/SKILL.md`** — Skill implementation
  - Accept `$ARGUMENTS` as ticket URL (`https://...atlassian.net/browse/SE-3979`) or key (`SE-3979`)
  - Parse ticket key from URL if full URL provided
  - Fetch ticket details via Atlassian MCP (`mcp__atlassian__getJiraIssue`) or curl fallback
  - Run same 6-phase triage logic from the workflow (relevance check → ambiguity → edge cases → verification → label → summary)
  - Use Grep/Glob for local codebase search (not bash grep/find)
  - Post comments via MCP (`mcp__atlassian__createJiraIssueComment`) or curl with ADF format
  - Add `claude-triaged-$REPO_NAME` label via MCP or curl
  - Reference `allowed-tools: ["mcp__atlassian__*", "Bash", "Read", "Glob", "Grep"]`
  - Reuse cross-repo awareness logic (parse existing triage comments, skip duplicates)

- **`plugins/lisa/commands/jira/triage.md`** — Command pass-through
  - `argument-hint: "<TICKET-ID-OR-URL>"`
  - Delegates to `/lisa:jira-triage` skill with `$ARGUMENTS`

## Key differences from CI workflow

- Uses Atlassian MCP tools instead of curl+Basic auth (MCP available locally, not in CI)
- Operates on a single ticket (no batch search/count mode)
- `REPO_NAME` derived from current directory's git remote or folder name
- No `JIRA_BASE_URL`/`JIRA_USER_EMAIL`/`JIRA_API_TOKEN` env vars needed when MCP is configured

## Verification

```bash
# Confirm files exist and skill is loadable
cat plugins/lisa/skills/jira-triage/SKILL.md
cat plugins/lisa/commands/jira/triage.md
```

---
name: notion-to-jira
description: >
  Break down a Notion PRD into JIRA epics, stories, and sub-tasks. Use this skill whenever the user
  shares a Notion PRD URL and wants it converted into JIRA tickets, or asks to "break down a PRD",
  "create tickets from a PRD", "turn this PRD into JIRA", or similar. Also trigger when the user
  mentions creating epics/stories/tasks from a Notion document. This skill handles the full pipeline:
  fetching the PRD, analyzing comments, researching the codebase, identifying blockers, and creating
  all tickets with empirical verification plans.
---

# Notion PRD to JIRA Breakdown

Convert a Notion PRD into a structured JIRA ticket hierarchy: Epics > Stories > Sub-tasks.
Each sub-task is scoped to exactly one repo and includes an empirical verification plan.

## Input

A Notion PRD URL. The PRD is expected to have:
- A main page with context, problems, and links to Epic sub-pages
- Epic sub-pages with User Stories and functional/non-functional requirements
- Comments/discussions on each page with engineering notes and product decisions

## Configuration

This skill reads project-specific configuration from environment variables. If these are not set,
ask the user for the values before proceeding.

| Variable | Purpose | Example |
|----------|---------|---------|
| `JIRA_PROJECT` | JIRA project key for ticket creation | `SE` |
| `JIRA_SERVER` | Atlassian instance URL (site host) | `mycompany.atlassian.net` |
| `E2E_TEST_PHONE` | Test user phone number for verification plans | `0000000099` |
| `E2E_TEST_OTP` | Test user OTP code | `555555` |
| `E2E_TEST_ORG` | Test organization name | `Arsenal` |
| `E2E_BASE_URL` | Frontend base URL for Playwright tests | `https://dev.example.io/` |
| `E2E_GRAPHQL_URL` | GraphQL API URL for curl verification | `https://gql.dev.example.io/graphql` |

If env vars are not available, ask the user to provide them explicitly before proceeding.
Do not retrieve credentials from repository files or local agent settings.

## Workflow

### Phase 1: Fetch & Analyze the PRD

1. **Fetch the main PRD page** with `include_discussions: true`
2. **Identify all Epic sub-pages** from the content (look for child page links)
3. **Fetch all Epic pages** in parallel with `include_discussions: true`
4. **Fetch full comments** from every page using `notion-get-comments` with `include_all_blocks: true`
5. **Synthesize decisions and blockers** from the PRD content + all comments:
   - Decisions already confirmed by the team (look for agreement in comment threads)
   - Open questions that need product/engineering input
   - Engineering comments (prefixed with "Engineering:" or wrench emoji) that identify technical constraints
   - Cross-PRD dependencies (references to other features or shared infrastructure)

### Phase 2: Codebase Research (if needed)

If the session doesn't already have codebase context, explore the repos to understand what exists.
Use Explore agents for repos not yet examined. Skip repos already explored in the current session.

Key things to look for:
- Existing entities/modules that overlap with the PRD
- Patterns to reuse (auth decorators, S3 services, existing UI components)
- Data model gaps the PRD requires (new fields, new entities)
- The tech stack per repo (framework, ORM, UI library, deployment)

### Phase 3: Create Epics

Create one Epic per PRD epic using the JIRA project key from config. Each Epic description should include:
- Summary of the epic from the PRD
- List of user stories it contains
- Key decisions from comments (with attribution)
- Blockers and open questions
- Dependencies on other epics or PRDs

Use `contentFormat: "markdown"` for all descriptions.

### Phase 4: Create Stories

For each Epic, create Stories:
- **One "X.0 Setup" story** for data model and infrastructure prerequisites (new entities, migrations, new fields, infrastructure like S3 buckets or SQS queues)
- **One story per user story** from the PRD (numbered to match the PRD)

**Story naming convention**: Prefix with a short code derived from the PRD title:
- "Contract Upload" -> `[CU-1.1]`
- "Squad Planning" -> `[SP-1.1]`
- Use your judgment for other PRDs

Each story description should include:
- The user story statement from the PRD
- Acceptance criteria (from functional requirements)
- Technical notes from engineering comments
- Blockers with recommendation + alternatives (if any)

Set `parent` to the Epic key to link stories to their epic.

### Phase 5: Create Sub-tasks

Delegate sub-task creation to **parallel agents** (one per epic or batch of stories) for efficiency.

Each sub-task MUST:
1. **Be scoped to exactly ONE repo** — indicated in brackets in the summary: `[repo-name]`
2. **Include an Empirical Verification Plan** — real user-like verification, NOT unit tests, linting, or typechecking

**Verification plan examples by stack:**
- **Backend APIs**: curl GraphQL/REST calls with auth token, database queries, checking audit entries
- **Frontend web**: Playwright browser tests (login with test user, navigate, interact, screenshot)
- **Infrastructure**: `cdk synth` / `terraform plan` verification, CLI checks after deploy

Use the test user credentials from config for all verification plans.

Set `parent` to the Story key. Use `issueTypeName: "Sub-task"`.

### Phase 6: Report Results

After all tickets are created, present a summary table to the user:
- All Epics with keys and URLs
- All Stories grouped by Epic
- All Sub-tasks grouped by Story with repo tags
- Repo distribution (how many tasks per repo)
- Blockers list with recommendations and alternatives
- Cross-PRD dependencies

## Handling Ambiguities and Blockers

When you encounter something the PRD + comments + codebase can't resolve:

1. **Don't guess** — mark the ticket with a BLOCKER section
2. **Include your recommendation** with rationale (what you'd pick and why)
3. **List 2-3 alternatives** so the user/product can choose
4. **State what's needed to unblock** (e.g., "Product decision on X", "Sync with Y on Z")

Common blocker categories:
- Missing data model decisions (field types, entity relationships)
- Permission model unclear (who can view/edit)
- UX decisions not finalized (display format, input mechanism)
- Cross-team dependencies (shared infrastructure, coordinated rollouts)
- Preset values not defined (enums, tags, labels)

## Agent Prompt Template for Sub-task Creation

When delegating to agents, provide this context:

```text
Create JIRA sub-tasks in the [PROJECT] project at [CLOUD_ID].
Use issueTypeName "Sub-task" and set parent to the story key.
Use contentFormat "markdown".

Test user info: [credentials from config]

Each sub-task must:
1. Be scoped to ONE repo only
2. Include an **Empirical Verification Plan** section
3. Include the repo in brackets in the summary

[Then list all sub-tasks grouped by parent story with details]
```

## Cross-PRD Shared Infrastructure

Track tickets that are shared across PRDs to avoid duplication.
When a sub-task overlaps with an existing ticket, reference it instead of creating a duplicate.
Search JIRA for existing tickets in the project before creating new ones for shared infrastructure.

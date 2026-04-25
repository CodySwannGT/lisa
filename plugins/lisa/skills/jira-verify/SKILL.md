---
name: jira-verify
description: This skill should be used when verifying that a JIRA ticket meets organizational standards for epic relationships and description quality. It checks epic parent relationships and validates description completeness for coding assistants, developers, and stakeholders.
allowed-tools: ["mcp__atlassian__getJiraIssue", "mcp__atlassian__searchJiraIssuesUsingJql", "mcp__atlassian__getAccessibleAtlassianResources"]
---

# Verify JIRA Ticket: $ARGUMENTS

Fetch ticket $ARGUMENTS and verify it meets organizational standards.

## Verification Checks

### 1. Epic Parent Relationship

**Rule**: Non-bug, non-epic tickets MUST have an epic parent

- If missing: Search filter 10089 (Epic Backlog) and suggest appropriate epics

### 2. Description Quality

Verify description adequately addresses:

**Coding Assistants**: Acceptance criteria, requirements, constraints, I/O
**Developers**: Technical context, integration points, testing, edge cases
**Stakeholders**: Business value, user impact, success metrics, summary

### 3. Validation Journey

**Rule**: Tickets that change runtime behavior MUST include a Validation Journey section.

Check by running:

```bash
python3 .claude/skills/jira-journey/scripts/parse-plan.py <TICKET_ID> 2>&1
```

- If the parser returns steps: PASS
- If the parser fails with "No 'Validation Journey' section found": FAIL — recommend using `/jira-add-journey <TICKET_ID>` to add one

This check is skipped for:
- Documentation-only tickets
- Config-only tickets (env vars, CI/CD, feature flags)
- Type-definition-only tickets (no runtime effect)
- Epic-level tickets (journeys belong on child stories/tasks)

### 4. Target Backend Environment

**Rule**: Tickets that change runtime behavior MUST name a target backend environment in the description.

Look for an `h2. Target Backend Environment` section (or equivalent named callout) containing one of `dev`, `staging`, or `prod`. The check is skipped for the same exclusions as the Validation Journey (doc-only, config-only, type-only, Epic).

- If present and valid: PASS
- If missing or unparseable: FAIL — recommend adding the section. QA/product report against a deployed env; the implementer needs to know which backend to point local at before CI/CD.

### 5. Sign-in Credentials (Conditional)

**Rule**: If the ticket touches an authenticated surface, the description MUST name the account/role to sign in as and where to get credentials.

A surface is "authenticated" if any of these signals are present in the description, acceptance criteria, or Validation Journey:
- Verbs like "log in", "sign in", "as a {role} user", "authenticated"
- Routes/screens that require auth in this product
- Roles named (admin, customer, partner, etc.)

If those signals are present, look for an `h2. Sign-in Required` section naming an account or credential source.

- If signals absent: PASS (sign-in not required)
- If signals present and section present: PASS
- If signals present and section missing: FAIL — recommend adding it. Implementers must not have to guess which account to use.

### 6. Single-Repo Scope (Bug / Task / Sub-task)

**Rule**: Bug, Task, and Sub-task tickets MUST cover one repo. Epic, Spike, and Story may span multiple repos.

Check by inspecting the description's `h2. Repository` section (or equivalent) and any explicit cross-repo references in the description / acceptance criteria.

- Bug / Task / Sub-task that names exactly one repo: PASS
- Bug / Task / Sub-task that names multiple repos OR has acceptance criteria spanning repos: FAIL — recommend splitting into per-repo tickets under a parent Story/Epic.
- Other types: skipped.

### 7. Relationship Discovery

**Rule**: Every ticket MUST have either at least one issue link OR a documented relationship search showing none was found.

- If the ticket has any issue link (`blocks`, `is blocked by`, `relates to`, `duplicates`, `clones`): PASS
- If no links but the description (or a comment) contains a `## Relationship Search` block listing the git and JQL queries that were run with their outcomes: PASS
- If no links and no documented search: FAIL — recommend running `/jira-write-ticket` (or its discovery phase) to capture the search.

## Execute Verification

Retrieve ticket details, run all checks, and produce a single output block. For each FAIL include the specific remediation. The caller (typically `jira-agent`) uses the FAIL list to decide whether to gate work — see the agent's pre-flight gate.

```text
## jira-verify: <TICKET-KEY>
- Epic parent: PASS | FAIL — <reason>
- Description quality: PASS | FAIL — <reason>
- Validation Journey: PASS | FAIL | N/A — <reason>
- Target backend environment: PASS | FAIL | N/A — <reason>
- Sign-in credentials: PASS | FAIL | N/A — <reason>
- Single-repo scope: PASS | FAIL | N/A — <reason>
- Relationship discovery: PASS | FAIL — <reason>

## Verdict: PASS | FAIL
## Missing requirements: [list of FAILed checks, or "none"]
```

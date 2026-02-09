# Plan: Create REFERENCE.0003.md — Agent Teams & Updated Reference

## Context

Anthropic released a major new feature called **Agent Teams** for Claude Code. The existing reference files (`.claude/REFERENCE.md` and `.claude/REFERENCE.0002.md`) document hooks and settings but predate Agent Teams. The user needs a new reference file that compiles all Agent Teams information alongside updated hooks/settings documentation, following the same comprehensive reference style as previous files.

**Branch:** `main` (protected) — need to create a new branch
**PR target:** `main`

## Research Summary

### What's New Since REFERENCE.0002.md

1. **Agent Teams** (experimental) — coordinate multiple Claude Code instances as a team with shared tasks, messaging, and centralized management
2. **2 new hook events** — `TeammateIdle` and `TaskCompleted` (total now 15, up from 13)
3. **Agent-based hooks** — new `type: "agent"` hook handler that spawns a subagent with tool access for verification
4. **Async hooks** — `"async": true` for command hooks to run in background
5. **New settings** — `teammateMode`, `prefersReducedMotion`, `spinnerVerbs`, `allowManagedPermissionRulesOnly`, `sandbox.network.allowAllUnixSockets`, `sandbox.network.allowedDomains`
6. **New environment variables** — `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`, `CLAUDE_CODE_TEAM_NAME`, `CLAUDE_CODE_PLAN_MODE_REQUIRED`, `CLAUDE_CODE_EFFORT_LEVEL`, `CLAUDE_CODE_SUBAGENT_MODEL`, `CLAUDE_CODE_TASK_LIST_ID`, `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS`, `CLAUDE_CODE_DISABLE_AUTO_MEMORY`, many more
7. **Updated subagent config** — `memory` field for persistent memory, `skills` preloading, `hooks` in frontmatter, `mcpServers` field, agent-based hooks
8. **SessionEnd** new matcher value — `bypass_permissions_disabled`
9. **`$schema`** validation support for settings.json

## Implementation

### File to Create

- `.claude/REFERENCE.0003.md` — **Standalone** comprehensive reference superseding both REFERENCE.md and REFERENCE.0002.md

### Structure

The file will be a single complete reference document (no need to read previous files). Dense tabular format:

1. Summary of updates from REFERENCE.0002.md
2. **Agent Teams** — full reference covering:
   - Enabling (env var + settings.json)
   - Architecture (team lead, teammates, task list, mailbox)
   - Team config files (`~/.claude/teams/{name}/config.json`, `~/.claude/tasks/{name}/`)
   - TeamCreate tool — parameters, team file structure
   - TeamDelete tool
   - SendMessage tool — all 5 message types (message, broadcast, shutdown_request, shutdown_response, plan_approval_response) with schemas
   - Task tools integration (TaskCreate, TaskUpdate, TaskList, TaskGet) for teams
   - Teammate lifecycle (spawning, idle state, messaging, shutdown)
   - Display modes (in-process, split-pane/tmux, auto)
   - Delegate mode, plan approval
   - Permissions inheritance
   - Context and communication patterns
   - Token cost guidance (~7x standard, use Sonnet for teammates)
   - Limitations (no session resumption, no nested teams, one team per session, etc.)
3. Hook Event Types table (15 total — added TeammateIdle, TaskCompleted)
4. Hook Configuration Structure (3 handler types: command, prompt, agent)
5. Hook handler fields (common, command-specific, prompt/agent-specific, async)
6. Hook Input/Output Schemas per event (all 15 events)
7. Complete settings.json schema with key descriptions
8. Permission Settings with evaluation order and wildcard patterns
9. Sandbox Settings
10. Environment Variables (comprehensive — auth, model, provider, teams, bash, context, MCP, UI, features, file/dir, network, TLS, debugging)
11. Subagent Configuration (frontmatter fields, memory, skills preloading, hooks in frontmatter, mcpServers, permission modes)
12. Settings File Locations & Precedence
13. Best Practices
14. Sources

### Skills to Invoke

- `/jsdoc-best-practices` — for any documentation standards
- `/coding-philosophy` — always required

## Tasks

Create task list using TaskCreate with the following tasks:

### Task 1: Create branch and draft PR
- **Subject:** Create feature branch and draft PR for REFERENCE.0003.md
- **ActiveForm:** Creating feature branch and draft PR
- Create branch `feat/reference-0003-agent-teams` from `main`
- Open draft PR targeting `main`

### Task 2: Create REFERENCE.0003.md
- **Subject:** Create .claude/REFERENCE.0003.md with Agent Teams and updated reference content
- **ActiveForm:** Creating REFERENCE.0003.md
- Write the complete reference file with all researched content
- Follow the format/style of existing REFERENCE.md and REFERENCE.0002.md files
- Include all Agent Teams documentation, updated hooks (15 events), new settings, new env vars, updated subagent config
- **Verification:** `test -f .claude/REFERENCE.0003.md && wc -l .claude/REFERENCE.0003.md` (file exists and has substantial content)

### Task 3: Review with CodeRabbit
- **Subject:** Review REFERENCE.0003.md with CodeRabbit
- **ActiveForm:** Running CodeRabbit review
- Blocked by: Task 2

### Task 4: Review with local code review
- **Subject:** Run local code review on REFERENCE.0003.md
- **ActiveForm:** Running local code review
- Blocked by: Task 2

### Task 5: Implement valid review suggestions
- **Subject:** Implement valid review suggestions from code reviews
- **ActiveForm:** Implementing review suggestions
- Blocked by: Tasks 3, 4

### Task 6: Simplify with code simplifier
- **Subject:** Simplify REFERENCE.0003.md with code simplifier agent
- **ActiveForm:** Simplifying reference document
- Blocked by: Task 5

### Task 7: Update documentation
- **Subject:** Update/verify documentation quality (JSDoc preambles, markdown formatting)
- **ActiveForm:** Updating documentation
- Blocked by: Task 5

### Task 8: Verify all task verifications
- **Subject:** Verify all verification metadata in existing tasks
- **ActiveForm:** Verifying task metadata
- Blocked by: Task 5

### Task 9: Archive plan
- **Subject:** Archive the plan to ./plans/completed
- **ActiveForm:** Archiving plan
- Steps:
  - Create folder `reference-0003-agent-teams` in `./plans/completed`
  - Rename this plan to a befitting name
  - Move it into `./plans/completed/reference-0003-agent-teams`
  - Read the session IDs from `./plans/completed/reference-0003-agent-teams`
  - For each session ID, move `~/.claude/tasks/<session-id>` to `./plans/completed/reference-0003-agent-teams/tasks`
  - Update any "in_progress" tasks to "completed"
  - Commit changes
  - Push changes to the PR
- Blocked by: All other tasks

## Verification

- `test -f .claude/REFERENCE.0003.md` — file exists
- `grep -c "Agent Teams" .claude/REFERENCE.0003.md` — contains Agent Teams content
- `grep -c "TeammateIdle" .claude/REFERENCE.0003.md` — contains new hook events
- `grep -c "TaskCompleted" .claude/REFERENCE.0003.md` — contains new hook events
- `grep -c "teammateMode" .claude/REFERENCE.0003.md` — contains new settings
- `grep -c "SendMessage" .claude/REFERENCE.0003.md` — contains team messaging docs
- Content review: file follows same format as REFERENCE.md and REFERENCE.0002.md

## Sessions

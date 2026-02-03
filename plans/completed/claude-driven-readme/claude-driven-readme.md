# Plan: Replace README with Claude-driven format

## Branch

`main` (protected) → create branch `chore/claude-driven-readme`

## Summary

Replace Lisa's own README.md with a minimal Claude-driven format, and add generic Claude-driven README templates to each stack's `copy-overwrite/` directory so Lisa-managed projects get appropriate READMEs.

## Files to modify/create

- `README.md` — complete replacement (Lisa's own README)
- `all/copy-overwrite/README.md` — generic base template for all projects
- `expo/copy-overwrite/README.md` — adds Expo-specific common tasks
- `nestjs/copy-overwrite/README.md` — adds NestJS-specific common tasks
- `cdk/copy-overwrite/README.md` — adds CDK-specific common tasks
- `npm-package/copy-overwrite/README.md` — adds npm publishing tasks

Note: `typescript/` does not need its own README since `all/` covers it. The stack-specific ones (expo, nestjs, cdk, npm-package) override with additional tasks unique to that stack.

## Template structure

### Base template (all/copy-overwrite/README.md)

All templates follow the frontend-v2/infrastructure-v2 pattern. Generic — no project names.

```markdown
# [Project Name]

Developers write specs and answer questions. Agents implement, test, verify, question, and document.

## About This Project

> Ask Claude: "What is the purpose of this project and how does it work?"

## Step 1: Install Claude Code
[standard install steps]

## Step 2: Set Up This Project
> Ask Claude: "I just cloned this repo. Walk me through the full setup..."

## Step 3: Run the App Locally
> Ask Claude: "How do I start the app locally?..."

## Step 4: Work on a Feature
> Ask Claude: "I have Jira ticket [TICKET-ID]..."
> Or break it down: /project:setup, /project:research, /project:plan, /project:implement

## Common Tasks
### Code Review, Submit a PR, Fix Lint Errors, Add Test Coverage, Deploy
[all "Ask Claude" style]

## Project Standards
> Ask Claude: ...

## Architecture
> Ask Claude: ...

## Troubleshooting
> Ask Claude: ...
```

### Stack-specific additions

Each stack README includes the full base template plus additional common tasks:

| Stack | Additional Common Tasks |
|-------|------------------------|
| **expo** | "Run on iOS/Android/Web", "Generate Types After Schema Changes" |
| **nestjs** | "Run Database Migrations", "Access GraphQL IDE" |
| **cdk** | "Synthesize CloudFormation Templates", "Diff Against Deployed Stacks" |
| **npm-package** | "Publish to npm" |

### Lisa's own README

Same Claude-driven pattern but with Lisa-specific steps:
- Step 2 → "Set Up This Project" (dev setup for contributing to Lisa)
- Step 3 → "Apply Lisa to a Project" (how to use Lisa on other projects)
- Common tasks include "Contributing" section

## Skills to invoke during execution

- `/coding-philosophy`

## Task list (TaskCreate)

1. **Create branch `chore/claude-driven-readme`** — branch off main, verify not on protected branch
   - Verification: `git branch --show-current` → `chore/claude-driven-readme`

2. **Replace Lisa's README.md** — write the new minimal Claude-driven README for Lisa itself
   - Verification: `wc -l README.md` → under 100 lines

3. **Create all/copy-overwrite/README.md** — generic base Claude-driven README template
   - Verification: `test -f all/copy-overwrite/README.md && grep -q "Ask Claude" all/copy-overwrite/README.md`

4. **Create expo/copy-overwrite/README.md** — Expo-specific Claude-driven README with mobile/web tasks
   - Verification: `grep -q "iOS\|Android\|Schema" expo/copy-overwrite/README.md`

5. **Create nestjs/copy-overwrite/README.md** — NestJS-specific Claude-driven README with API/DB tasks
   - Verification: `grep -q "Migration\|GraphQL" nestjs/copy-overwrite/README.md`

6. **Create cdk/copy-overwrite/README.md** — CDK-specific Claude-driven README with infra tasks
   - Verification: `grep -q "CloudFormation\|Synth\|Diff" cdk/copy-overwrite/README.md`

7. **Create npm-package/copy-overwrite/README.md** — npm package Claude-driven README with publish tasks
   - Verification: `grep -q "Publish\|npm" npm-package/copy-overwrite/README.md`

8. **Open draft PR** — `chore/claude-driven-readme` → `main`
   - Verification: `gh pr view --json state` → draft PR exists

9. **Review code with CodeRabbit** — run `/coderabbit:review`
   - Verification: review completes without blocking issues

10. **Review code with local code review** — run `/project:local-code-review`
    - Verification: review completes without blocking issues

11. **Implement valid review suggestions** — apply feedback from both reviews
    - Verification: re-run reviews show no outstanding issues

12. **Simplify code** — run code-simplifier agent on changes
    - Verification: agent completes, no further simplifications needed

13. **Update tests** — N/A (README-only changes, no code tests to update)
    - Verification: `bun run test` passes (no regressions)

14. **Update documentation** — verify cross-references (OVERVIEW.md was already deleted per git status)
    - Verification: no broken links in markdown files

15. **Verify all task verification metadata** — run each task's proof command
    - Verification: all proof commands pass

16. **Archive the plan** — create `./plans/completed/claude-driven-readme/`, rename plan, move it, move `~/.claude/tasks/<session-id>` directories, update in_progress tasks to completed, commit, push to PR

## Sessions

<!-- Auto-maintained by track-plan-sessions.sh -->
| Session ID | First Seen | Phase |
|------------|------------|-------|
| 5dbba6ba-2af7-4bc5-894d-ddbb17d98766 | 2026-02-03T16:30:01Z | plan |

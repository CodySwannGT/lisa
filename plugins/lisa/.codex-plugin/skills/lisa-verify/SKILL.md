---
name: lisa-verify
description: "Ship and verify code"
allowed-tools: ["Skill", "Bash", "Read", "Grep", "Glob"]
---

# Verify: $ARGUMENTS

Ship the current branch and prove it works in the target environment.

## Orchestration: agent team

You are "inside an agent team" only if you are yourself a spawned teammate or subagent — you were spawned into a team context, or your context names a team lead you report to. A lead/root session that has previously spawned subagents is still the lead and retains full authority to create this flow's team.

If you are NOT inside an agent team by that definition, the very first thing you do is establish team orchestration.

Use the team tool for the current runtime:

- Claude Code >= 2.1.178: there is no `TeamCreate` tool; the team forms automatically when you spawn the first teammate with `Agent`. That first spawn should be the bounded specialist needed to start this flow. On older Claude Code that still exposes `TeamCreate`, the explicit team-create path is also acceptable.
- Codex: do not call `TeamCreate`; Codex does not expose that Claude tool. Use `tool_search` with a query like `multi-agent tools` to load `multi_agent_v1`, then use `multi_agent_v1.spawn_agent` for teammate delegation. Treat the first successful `spawn_agent` call as establishing team orchestration.
- Other runtimes: use the current runtime's tool-discovery mechanism to discover and call the appropriate multi-agent/team tool.

If no team creation or subagent delegation tool is available, explicitly state that team orchestration is unavailable in this runtime, continue as the lead agent, and preserve the workflow's review, verification, and task-tracking obligations locally.

Until the team is established, the first Codex teammate has been spawned, or the no-team fallback has been declared, do NOT call any of: `TaskCreate`, `Skill`, MCP tools (Atlassian / Linear / GitHub / Notion), `Read`, `Write`, `Edit`, `Bash`, `Grep`, `Glob`. The initial Claude `Agent` spawn described above is the only pre-team exception because it establishes the team. Inspecting the branch, running quality gates, opening the PR — all of those are tasks for the team you are about to create, not for the lead session before orchestration exists.

If you ARE already inside an agent team (e.g., a teammate invoked this skill via the Skill tool), do NOT create a second team — many harnesses reject double-creates — and do NOT collapse the nested flow into a single inline worker. A nested team-first flow must still bring in the specialists it requires by adding them to the existing team, not by doing the work itself:

- **Claude:** teams are flat and only the lead can add named teammates, so do NOT call `Agent` with a `name` from a teammate (the harness rejects it: *"Teammates cannot spawn other teammates — the team roster is flat"*). Send the team lead a message naming the specialist teammate(s) this flow needs, their task assignments, and completion criteria, then coordinate through the shared task list until they finish. An anonymous subagent (`Agent` with `name` omitted) is permitted only for bounded one-shot work whose result returns directly to you — it is not a substitute for the required lifecycle specialists.
- **Codex:** do NOT call `TeamCreate`. If the lead/root agent is addressable (you were given its id/handle), send it a request to `multi_agent_v1.spawn_agent` the specialist agent(s), including each agent's prompt, ownership, and expected result. If no lead handle exists but `spawn_agent` is available to you, spawn only the bounded specialist agent(s) this flow needs, `wait_agent` for their results, and relay those results upward to the parent/lead.

Treat the first successful lead-spawn request (or, on the Codex fallback, the first specialist spawn) as preserving team orchestration. Never satisfy a team-first lifecycle flow by doing all the work inline.

## Flow

Execute the **Verify** flow as defined in the `intent-routing` rule (loaded via the lisa plugin). The flow includes:

1. **Pre-flight: codification gate** — confirm that every passing local empirical verification on this branch was codified as a regression test (the Implement flow's codify step). If any verification has no committed test and no allowed skip reason (PR / Documentation / Deploy / Investigate-Only), invoke `codify-verification` now and amend the PR before shipping. For frontend work the gate is dual-runner: a Playwright spec AND, when the project supports Maestro (`.maestro/`, `maestro:test` script, or Maestro CI workflow), a Maestro flow for the same journey — a missing runner needs a recorded absence or a linked build-ready follow-up ticket, never a silent skip. A change cannot ship until its verifications are guarded.
2. **Commit** any pending changes via `lisa-git-commit`
3. **Push and PR** via `lisa-git-submit-pr`
4. **Review loop** — handle CodeRabbit / human review comments via `lisa-pull-request-review`
5. **Merge** when CI is green
6. **Remote verification** — invoke the `lisa-monitor` skill against the target environment **in report-only mode** (`lisa-monitor <env> --report-only`) to confirm the deploy actually works (health endpoints, recent logs/errors, Validation Journey replay if defined). `--report-only` is required here: it keeps the post-deploy check a pure health/audit report and prevents monitor's standalone ticket-filing from creating issues during a verify run. If remote verification surfaces a behavioral gap that the existing codified tests do not guard, invoke `codify-verification` to add coverage and open a follow-up PR.
   - When the Validation Journey is DOM-web, the target is an allowed non-production environment with mutation policy `full`, and `lisa kane probe` succeeds, verification may invoke `lisa-kane-browser`. Import the local evidence pack into Lisa's evidence flow; the Test Manager URL is secondary. Kane does not replace the pre-flight Playwright/Maestro codification gate.
   - When remote verification needs credentials, follow the shared `verification-lifecycle` credential lookup order before declaring them missing: project e2e / Playwright config and fixtures first, then `.lisa.config.local.json` / environment variables, then documented ticket credentials such as a `Sign-in Required` section.
   - Should credentials remain genuinely unavailable after those sources are exhausted, do not complete the item on artifact-only evidence. Post a tracker comment stating what could not be verified and why, transition the work item to the configured blocked state, and apply the configured `needs-human` / `human-review` label, creating it if the tracker supports label creation and it is missing.
   - Evidence must explicitly distinguish `verified empirically` from `artifact-only / verification deferred`.
7. **Evidence usage** — before posting, route the generated evidence artifact through `lisa-usage-accounting` so the comment body / PR evidence section / markdown proof carries a direct `lisa-verify` usage entry in the canonical `## Lisa Usage` section. If the originating work item or PRD parentage is known, prefer `record_and_rollup` so ancestor totals refresh in the same pass. If runtime usage is unavailable, still write `source: unavailable` with nullable token/cost fields instead of skipping the row.
8. **Evidence** — post results to the originating ticket via `lisa-tracker-evidence` (vendor-neutral; dispatches to `lisa-jira-evidence`, `lisa-github-evidence`, or `lisa-linear-evidence` per `.lisa.config.json` `tracker`), including the list of codified tests added on this branch. **If the work is UI-visible** (any verification step ran in a browser, or the change touches a user-facing surface), author `evidence/comment.md` per the **UI Evidence Checklist** in `lisa-tracker-evidence` — numbered live-session steps, one screenshot captured through the interactive browser controller per step uploaded to the GitHub `pr-assets` release as plain URLs, and an explicit invitation to be corrected.

The rule contains the canonical step sequence. Change it there, propagate everywhere.

## Output

A merged PR, a successful deploy to the target environment, and posted evidence on the originating work item.

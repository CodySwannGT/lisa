# When to Stop

This rule replaces the eager heads of `settled-decisions`, `not-blocked-just-waiting`, and `tool-access-gate`. Their reference bodies keep the detail: [settled-decisions.md](settled-decisions.md) (questions already answered), [not-blocked-just-waiting.md](not-blocked-just-waiting.md) (waiting versus blocked), and [tool-access-gate.md](tool-access-gate.md) (the access probe table and blocker report).

## Why this shape

Lisa's flows run unattended. A session manager or scheduler dispatches a work item, and when the agent is truly blocked it marks the item as needing a human; a separate process alerts people, who unblock the item outside the flow. A stop that is not one of the three reasons wastes a human's attention and a dispatch slot. A missed stop on a genuine blocker produces wrong work. Current models stop early more than they push through a real blocker, so the rule names the stops it wants and lists the routine actions that need nobody's approval.

## Finishing work (adapted from Anthropic's guidance for unattended agents)

Do not stop while you still owe work. Status notes and recommendations on open decisions are welcome, but put them in the same message as your next tool call, and carry on with whatever does not depend on the answer. If you notice yourself offering to wait or inviting someone to redirect you, do the next thing instead.

Ordinary obstacles — errors, timeouts, locked files, empty results, failing tools — get diagnosed first. When they are not real blockers, work through them with the access you have: wait and retry, fix the request, use another tool or source.

If someone deliberately put something out of reach — a file marked not to be touched, access intentionally withheld, a safety guardrail — leave it alone, say plainly what you found, and look for another safe way to finish.

## The three stops

| Reason | Test | What the stop names |
|---|---|---|
| Missing access | Credentials resolved through `lisa-secrets-access` and a cheap read-only probe through the `*-access` skill both failed. Presence on PATH is not access. | The missing resource, the operation it blocks, and any known access requirement. Never a secret value. |
| Product ambiguity | The readings lead to materially different deliverables, and the work item, wiki, code, config, and standing decisions do not decide between them. | The question, the options, and your recommendation. |
| Dangerous operation | Destructive, irreversible, or behind a protected approval. | The exact action and what it would change. |

Probe access before implementation starts, and again when a new requirement appears mid-flow. Substituting weaker verification, mocking the inaccessible system, guessing at its contents, or narrowing scope to dodge the gap are not acceptable ways around missing access.

## Before you stop

- **Check whether it is already decided.** A standing preference (project memory, `.lisa.config.json`, a project rule, `AGENTS.md`/`CLAUDE.md`), evidence you already gathered, or an obvious convention may answer it. If so, act and record the decision in one clause.
- **Re-read the instruction file from disk.** Open `AGENTS.md` (or `CLAUDE.md`) and read its `## Standing rulings` section, or the whole file when there is no such heading. Your injected copy is a snapshot from session start and can arrive shortened; its completeness is not observable from inside. This rule is delivered at session start, but the re-read it asks for happens at the escalation boundary — re-reading at session start would only re-read the moment your context was built from. It is a pointer, not a copy: it stays correct as rulings accumulate, and survives a shortened copy of the file because it does not travel inside it.
- **Check the withdrawn-rulings ledger** (`withdrawn-rulings`): a premise you are about to escalate on may have been retracted.

## Routine actions that need no approval

Commits; pushes to your own branch; opening, updating, and driving PRs to merge; enabling auto-merge; replying to and resolving review threads; tracker comments and lifecycle transitions; filing build-ready tickets; posting evidence. Approval rules that list routine outward actions make agents hold back routine work: in Anthropic's testing, listing "sending messages to people outside this conversation" as needing approval made the model withhold about half of its routine requests.

## The tracker vocabulary is unchanged

`human_needed` and the `blocked` lifecycle role, used by `lisa-implement`, `lisa-repair-intake`, and the intake skills, keep their own stricter definitions. This rule decides when a run reaches for them.

---
name: lisa-openclaw-connect-repo-topic
description: Bind a Telegram forum topic to an OpenClaw dispatcher+worker agent pair that runs a coding CLI against a repo, so you can drive code work from chat. Supports single-repo topics and folder-scoped topics (multiple repos with repo-confirmation). Creates/validates the agent pair, ensures the bot is a group admin, captures real group/topic ids, wires the route in ~/.openclaw/openclaw.json, validates the gateway, and runs a no-change self-test. Requires lisa-openclaw-setup first.
---

# lisa-openclaw-connect-repo-topic

Turn a Telegram forum topic into a repeatable OpenClaw entrypoint for code work. A **dispatcher**
agent receives the request and delegates; a **worker** agent runs the local coding CLI in a safe
target directory and relays the result.

This SKILL.md is complete and runnable under both Claude Code and Codex (no command/`$ARGUMENTS`
layer in Codex). Keep real ids/handles/paths out of committed files — they go only in
`~/.openclaw/openclaw.json`. For exact config shapes read
[references/repo-topic-config.md](references/repo-topic-config.md).

## Prerequisites

- `lisa-openclaw-setup` has run and its capability probes passed.
- A Telegram supergroup with forum topics, and a bot that is (or can be promoted to) a **group
  admin** — bot presence alone is not enough for topic routing.

## Boundaries (apply every time)

- groups = the human trust boundary
- topics = the project-routing boundary
- native-reply roots = the short-term session boundary inside a topic
- agents = the capability boundary
- Do not mix admin-only repos with broader-collaboration repos in one group. If two repos need
  different member lists, use separate groups, not topic-only separation.

## Scope modes (pick exactly one per topic)

- **`single-repo`** — the topic is pinned to one repo directory; the dispatcher never asks which repo.
- **`folder-scoped`** — the topic is pinned to a parent folder containing multiple repos; the
  dispatcher must confirm the inferred repo(s) unless the user named them explicitly.

Do not mix both behaviors in one topic.

## Required inputs

- trust boundary: `admin` or `developer`
- scope mode: `single-repo` or `folder-scoped`
- access surface: Telegram group + topic (by name; ids captured during the run)
- the bot handle to bind
- workspace root on disk (repo dir for single-repo; parent folder for folder-scoped)
- allowed Telegram user ids
- completion policy:
  - `admin` topics may request change + docs + commit + PR + merge
  - `developer` topics default to change + docs + commit + PR only
- for `folder-scoped`: a repo catalog (label, absolute path, a few matching keyword hints)

## Workflow

### 1. Resolve the contract

Confirm the trust boundary, scope mode, workspace root, bot handle, and (for folder-scoped) the repo
catalog. If a needed agent doesn't exist yet, create it in step 3.

### 2. Provision / reuse the Telegram surface

Reuse the trust-matched group and the exact topic if they already exist; otherwise create them (enable
forum/topics mode first). Ensure the bot is in the group and **promoted to admin**. Telegram Bot API
cannot list groups by name — discover ids from a logged-in Telegram client, an existing route in
`~/.openclaw/openclaw.json`, or a received Bot API update. If browser/UI automation blocks on a human
confirmation step, give the user only the blocked step, wait, then resume.

### 3. Implement the dispatcher + worker pair

Create or update two agents (exact tool-deny shapes in
[references/repo-topic-config.md](references/repo-topic-config.md)):

- **`<topic-slug>-dispatch`** — skill-aware entrypoint; tools restricted to delegation/session tools
  (+ optional `read`); denies file writes, shell/exec, browser, gateway, automation; may delegate
  only to `<topic-slug>-codex`.
- **`<topic-slug>-codex`** — restricted worker; keeps `read` + `exec`; denies session spawning,
  browser, gateway, and direct file-write tools; runs the local coding CLI for the actual work.

### 4. Repo-selection behavior

- `single-repo`: treat the repo as decided; pass the fixed repo path to the worker; never ask.
- `folder-scoped`: infer candidates from the catalog. If the user named repo(s) explicitly, skip
  confirmation; otherwise ask before spawning:
  - one likely repo: `This looks like <repo>. Is that correct?`
  - multiple: `This may belong to <repo-1> or <repo-2>. Is that correct, or which repo(s)?`
  On confirmation of multiple repos, spawn one worker run per repo (or ask the user to split a
  too-coupled change). Never skip confirmation in folder-scoped mode unless selection was explicit.

### 5. Worker safety contract

Every worker task receives an explicit repo path and:

1. inspects `git status --short --branch` in the selected repo
2. if the primary checkout is dirty or already on a feature branch, creates a temporary worktree from
   `main` under `/tmp`
3. trusts local tool config in a fresh worktree if required (e.g. `mise trust <target_dir>`)
4. runs the coding CLI in the foreground in the target directory
5. cleans up the temporary worktree after success when safe

The worker prepares the safe target and launches the CLI; it does not edit files directly.

### 6. Bind the topic

Route the topic to the dispatcher: set
`channels.telegram.groups.<group-id>.topics.<topic-id>.agentId = <topic-slug>-dispatch`, keep
allowlist policy, and add `allowFrom` only when membership must be narrower than the group. Leave the
topic-level `requireMention = false` (the default) so the agent activates on any message — the topic
is bound 1:1 to this dispatcher, so an @mention carries no routing information and is pure friction.
Set it to `true` only for a shared-workspace topic where humans also coordinate with each other and
you don't want every line to spawn a run; the group-level `requireMention` stays `true` regardless.
See "Mention gating" in [references/repo-topic-config.md](references/repo-topic-config.md) for the
tradeoff. The topic `systemPrompt` must state the scope mode, treat each native-reply
root as an independent request context, confirm repo selection only in folder-scoped mode, spawn the
worker with an explicit repo path, and return the worker result to the topic. Back up
`~/.openclaw/openclaw.json` before editing and preserve unrelated routes.

### 7. Validate + self-test

```sh
openclaw config validate
openclaw gateway restart
openclaw gateway status
openclaw channels status --probe
```

Then from the target topic, send a plain message with **no** @mention (the default
`requireMention = false` means the agent must activate without one) asking for an exact-token reply
with **no** file changes, commits, PRs, or merges, e.g. `reply with exactly TELEGRAM-ROUTE-OK`.
Confirm the visible reply, that the dispatcher spawned the worker, and that the worker ran in the
intended repo. If the topic was deliberately left at `requireMention = true`, mention the bot instead
(`<bot-handle> reply with exactly TELEGRAM-ROUTE-OK`) and additionally confirm that an un-mentioned
message is **ignored**. For folder-scoped topics, also send a request that implies but doesn't name a
repo and confirm the dispatcher asks for confirmation before proceeding. Do **not** treat `openclaw agent --agent
<id> ...` as proof a topic route works — use the visible topic reply.

## Output standard

Finish with: group id + topic id used; scope mode; workspace root and repo path or catalog;
dispatcher + worker agent ids; whether the bot is confirmed group admin; validation results; whether
the self-test passed; and any remaining manual follow-up or trust caveat.

## Related

`lisa-openclaw-setup` (run first), `lisa-openclaw-connect-staff` (facilitator/specialist staff on
Telegram or Slack).

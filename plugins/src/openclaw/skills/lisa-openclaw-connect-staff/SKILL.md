---
name: lisa-openclaw-connect-staff
description: Connect staff roles to a human chat surface (Telegram or Slack) via OpenClaw using a facilitator/specialist hub-and-spoke model. Registers bots/apps, creates or reuses the human-facing surface, wires routes in ~/.openclaw/openclaw.json, writes facilitator/specialist agent prompts, validates the gateway, resets stale sessions, and runs an end-to-end route test. Use when you want a "chief of staff" facilitator and its specialists reachable from chat. Requires lisa-openclaw-setup first.
---

# lisa-openclaw-connect-staff

Wire existing staff roles into a working hub-and-spoke chat deployment on **Telegram** or **Slack**
through OpenClaw. Humans talk only to the **facilitator** (the "chief of staff"); the facilitator
consults **specialists** internally and synthesizes one answer back to the human.

This SKILL.md is the complete, runnable definition for **both Claude Code and Codex**. Codex has no
command or `$ARGUMENTS` layer, so every behavior — including platform selection — is specified here.
Keep all real values (org names, ids, handles, tokens, paths) out of any committed file; they belong
only in `~/.openclaw/openclaw.json` (machine-local, never committed).

## Prerequisites

1. `lisa-openclaw-setup` has run (an `openclaw` section exists in `.lisa.config.json`, and the
   required gateway capabilities — `sessions_spawn`, native-reply session scoping, `NO_REPLY` — are
   confirmed). If a capability is unmet, **fail closed**: do not create routes that would post
   duplicates or bleed cross-thread context.
2. The staff roles to connect exist in `config.staff[]` and each has a dual-runtime subagent
   (`.claude/agents/<id>.md` + `.codex/agents/<id>.toml`). If a role or its subagent is missing:
   - Claude Code: run `/lisa:add-role <Role>` first.
   - Codex: invoke `$lisa-wiki:lisa-wiki-add-role` first.
   Only auto-delegate if that skill is available in the active runtime; otherwise print the exact
   next step and stop. **Never infer agent ids from display names** — always use `config.staff[].id`.

## Platform selection (identical in both runtimes)

Resolve the platform with this precedence:

1. An explicit platform in the user's request (the Claude commands pre-state `telegram` or `slack`).
2. `openclaw.defaultPlatform` from `.lisa.config.json`.
3. If still unknown, ask exactly one question: `Connect staff via telegram or slack?`

## Hub-and-spoke contract (both platforms)

- Humans speak only to the facilitator; specialists never take direct human work.
- The facilitator consults specialists via internal OpenClaw `sessions_spawn` with **explicit**
  `agentId`s — never by messaging another bot on the chat platform (bot-to-bot delivery is
  unreliable; treat any visible specialist "workroom" as an audit copy, not proof of delivery).
- Each visible human request thread is its own short-term session boundary.
- The facilitator acknowledges after starting consultation, waits/yields for specialist results,
  evaluates them (asking follow-ups when weak/incomplete/conflicting), synthesizes one answer, and
  replies in the original thread / native reply.
- After any explicit message-tool send, the agent returns exactly `NO_REPLY` as its assistant final
  so the gateway does not post a duplicate loose message.
- Do not instruct agents to add bracketed self-labels like `[Facilitator]`; the platform shows
  identity.

## Required inputs

- platform (resolved above)
- facilitator: staff id, display name, title, human-facing surface name
- specialists: list of staff ids + roles to attach to this facilitator
- surface visibility: Slack channel `private` (default) or `public`; for Telegram, whether any
  specialist audit topics are wanted (default: none)
- visible bot/app identities (display names, usernames/handles) if separate avatars are needed
- communication rules (who may talk to whom)

For exact route shapes and the facilitator/specialist prompt text, read
[references/platform-routing.md](references/platform-routing.md) and
[references/prompts.md](references/prompts.md).

## Workflow

### 1. Inspect existing state

Read only what you need; never print token contents:

- `~/.openclaw/openclaw.json` (existing agents, channels, groups, topics, routes)
- `config.staff[]` and the staff subagent files
- existing chat surfaces, apps, and bot accounts (reuse before creating)

### 2. Plan the platform shape

**Telegram:** create or reuse one organization supergroup with forum topics enabled; create one
human-facing facilitator topic; create one bot per visible identity only when separate names/avatars
are needed; specialist audit topics only if explicitly requested. The Bot API `chat_id` for a
supergroup is the **signed** id (usually starting `-100`); the topic id is the
`message_thread_id`.

**Slack:** use Socket Mode for a workstation-hosted gateway unless told otherwise; create or reuse one
human-facing facilitator channel (default `<organization-slug>-chief-of-staff`, private/invite-only
unless public is requested); bind routes by stable channel **id**, not channel name; optional
specialist workrooms are audit-only.

Telegram bot-to-bot and bot-originated-topic messages can fail to wake other bots — this is exactly
why internal `sessions_spawn` is the default route.

### 3. Register apps / bots and store tokens

- Telegram: create bots with the agreed names/usernames; add visible bots to the supergroup, promote
  as needed, and disable privacy mode when topic messages must reach them.
- Slack: create or reuse the org app; grant only required scopes; save `xoxb`/`xapp` tokens.
- Store every token via the configured secret provider (or `0600` local files outside the repo).
  **Never** print/paste tokens into chat, logs, docs, or any committed file. After saving, verify the
  token via an OpenClaw probe or platform API check without exposing it.
- If creation is rate-limited (e.g. BotFather) or needs a human confirmation step, wire what
  completed, record what is pending plus the retry time, and ask only for the specific approval/code
  needed.

### 4. Create or update agent files

For the facilitator and each specialist, ensure the OpenClaw agent exists and its prompt encodes the
hub-and-spoke contract. Use the prompt templates in [references/prompts.md](references/prompts.md).
The facilitator prompt must require: consult ≥1 specialist before substantive answers; treat the
current thread/native-reply root as the session boundary; route via `sessions_spawn` with explicit
`agentId`s; acknowledge → yield/wait → evaluate → synthesize → reply in the original thread; return
`NO_REPLY` after any message-tool send; isolate/clear/archive consulted specialist context after the
investigation. Specialist prompts must require: accept work only via internal dispatch; return
concise structured results; never post to human-facing surfaces.

### 5. Wire OpenClaw routing

Edit `~/.openclaw/openclaw.json` carefully (see [references/platform-routing.md](references/platform-routing.md)
for exact shapes). **Back up the file first.** Parse JSON, change only the intended keys, and preserve
all unrelated agents, channels, routes, and tokens:

- add/update each agent in `agents.list`
- give the facilitator `subagents.allowAgents` = the specialist ids; set
  `subagents.requireAgentId = true` when supported
- bind the human-facing surface (Telegram topic / Slack channel) to the facilitator
- bind optional audit surfaces as visibility-only
- for Slack, set `channels.slack.replyToModeByChatType.channel = "all"` so acknowledgements and final
  answers are real thread replies
- disable any default-bot fallback that would answer instead of the facilitator

Show the exact route keys you will change before writing.

### 6. Validate

Run, waiting for the gateway to warm up before declaring success:

```sh
openclaw config validate
openclaw gateway restart
openclaw channels status --probe --timeout 90000
```

### 7. Reset stale sessions (when changing an existing route's behavior)

Archive (don't delete) affected session files under `~/.openclaw/session-archive/`, remove active
session pointers for the changed routes, restart the gateway, and re-probe. Old session history can
preserve stale routing instructions after a prompt/config change.

### 8. End-to-end route test

Do not call the work complete until the live loop passes. Acceptance criteria:

1. A human post reaches the facilitator surface.
2. The facilitator acknowledges as a thread reply / native reply to the original message.
3. A second post in the same channel/topic but a different visible thread gets a **distinct** session
   context (no cross-thread bleed).
4. The facilitator starts internal `sessions_spawn` consultation with ≥1 explicit specialist id.
5. A specialist returns an internal result.
6. The facilitator evaluates and asks a follow-up if needed.
7. The facilitator synthesizes and replies in the original thread / native reply.
8. No duplicate loose message appears after the message-tool send (the `NO_REPLY` rule held).

If the test fails, inspect gateway logs and sessions before changing config; check the bot's admin
rights (Telegram) / app channel membership and scopes (Slack), and mention-gating, first.

## Output standard

Finish with: platform and human-facing surface; surfaces created/reused; apps/bots registered and any
pending; token storage location (no values); facilitator + specialist agents created/updated;
validation results; end-to-end test result; and any remaining manual or cooldown follow-up.

## Related

`lisa-openclaw-setup` (run first), `lisa-openclaw-connect-repo-topic` (Telegram repo-coding topics).
Staff "brains" come from the `lisa-wiki` plugin's `add-role`.

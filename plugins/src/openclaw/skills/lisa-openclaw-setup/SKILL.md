---
name: lisa-openclaw-setup
description: Set up OpenClaw as the chat-surface runtime for this project's staff roles. Verifies the openclaw CLI, the ~/.openclaw/openclaw.json config, a secret provider, and the required gateway capabilities (sessions_spawn, native-reply session scoping, the NO_REPLY sentinel), then writes a lean `openclaw` section to .lisa.config.json. Prerequisite for lisa-openclaw-connect-staff and lisa-openclaw-connect-repo-topic. Use when a project wants its facilitator/specialist staff reachable from Telegram or Slack.
---

# lisa-openclaw-setup

Verify the OpenClaw runtime prerequisites and record a minimal, placeholder-safe pointer in
`.lisa.config.json` so the connect skills have what they need. **This skill writes only setup-level
pointers** — never tokens, channel/topic/group ids, bot handles, or route tables. Those live in
`~/.openclaw/openclaw.json` (OpenClaw's own machine-local source of truth) and are written by the
connect skills, never committed.

This SKILL.md is self-contained and runs identically under Claude Code and Codex. There is no
command/argument layer in Codex, so do not rely on one.

## What OpenClaw is (so the checks make sense)

OpenClaw is a locally-hosted multi-agent gateway. A **CLI** (`openclaw`, usually at
`~/.local/bin/openclaw`) manages a **config file** (`~/.openclaw/openclaw.json`) that defines agents,
chat-channel bindings (Telegram groups/topics, Slack channels), and routing. A long-running
**gateway** process delivers chat messages to agents and back. Agents reach other agents internally
via `sessions_spawn` rather than by messaging each other on the chat platform.

## Required inputs

Gather (ask only for what is missing):

- **platform** the project will default to: `telegram` or `slack`
- **facilitator agent id** — the single human-facing "chief of staff" agent id (a staff role id; see
  the soft dependency below)
- **secret provider** — how OpenClaw stores bot/app tokens (e.g. the OS keychain, a named secret
  manager, or `0600` local token files). Capture only its *type* and a *reference*, never a value.

## Soft dependency on staff roles

The facilitator and specialists are **staff roles**. A companion plugin (`lisa-wiki`) scaffolds a
staff role's "brain" (a `wiki/staff/<id>.md` doc page plus a dual-runtime subagent at
`.claude/agents/<id>.md` and `.codex/agents/<id>.toml`) from a `config.staff[]` entry. This plugin
wires that role to a chat surface — the "body".

If `config.staff[]` (in `.lisa.config.json`) has no entries yet, tell the user to define their staff
first:

- In Claude Code: run `/lisa:add-role <Role>` (e.g. `/lisa:add-role Chief of Staff`).
- In Codex: invoke `$lisa-wiki:lisa-wiki-add-role` with the role.

Only auto-delegate if that skill is actually available in the active runtime; otherwise just print the
exact next step and stop.

## Workflow

### 1. Locate the OpenClaw CLI

Resolve a usable `openclaw` binary, in order:

1. `~/.local/bin/openclaw`
2. `openclaw` on `PATH`
3. a path the user supplies

If none is found, stop and tell the user to install OpenClaw and re-run. Record the resolved path for
the config's `configPath`/CLI discovery only if it is non-standard.

### 2. Verify the config file

Confirm `~/.openclaw/openclaw.json` exists and is valid JSON. Do **not** print token values found
inside it. If it is missing, instruct the user to initialize OpenClaw (its own init flow creates the
file) before continuing.

### 3. Verify a secret provider

Confirm a token-storage mechanism is configured. Acceptable: the OpenClaw-configured secret provider,
an OS keychain entry, or `0600`-permissioned local token files outside the repo. Capture the provider
*type* and a non-secret *reference* only.

### 4. Probe required gateway capabilities

The connect skills depend on three OpenClaw behaviors. Probe for them and **fail closed** (warn
loudly, do not silently proceed) if any is missing:

- **`sessions_spawn`** — internal agent-to-agent dispatch (how the facilitator consults specialists).
- **Native-reply session scoping** — a top-level human request seeds a session keyed to its thread
  root (Slack channel + root `thread_ts`; Telegram supergroup + forum topic + root `message_id`), and
  replies in that thread continue the same session, so concurrent threads don't share short-term
  context.
- **`NO_REPLY` sentinel** — after an agent sends a message with the platform message tool, returning
  exactly `NO_REPLY` as its assistant final prevents the gateway from posting a duplicate loose
  message.

Probe via the OpenClaw CLI/version and a non-mutating validate, e.g.:

```sh
openclaw --version
openclaw config validate
```

If a capability cannot be confirmed, record it as an unmet prerequisite. The connect skills must
refuse to create routes that would post duplicates or leak cross-thread context.

### 5. Write the lean config section

Update **only** the `openclaw` section of `.lisa.config.json`. Parse the existing JSON, preserve all
other keys and formatting as much as practical, and write structurally (never string-splice). Shape:

```json
{
  "openclaw": {
    "defaultPlatform": "telegram",
    "facilitatorAgentId": "<facilitator-agent-id>",
    "secretProvider": {
      "type": "<secret-provider-type>",
      "ref": "<secret-provider-ref>"
    },
    "configPath": "~/.openclaw/openclaw.json"
  }
}
```

Rules for this section:

- `defaultPlatform`: `"telegram"` or `"slack"`.
- `facilitatorAgentId`: the default facilitator/chief id only — **not** per-surface routing.
- `secretProvider`: a pointer only; never token material.
- `configPath`: optional; default `~/.openclaw/openclaw.json`. Set only for non-standard installs.
- **Reject** writing tokens, channel ids, topic ids, group ids, Slack thread roots, bot handles, or
  repo paths here. If the user offers them, decline and explain they belong in
  `~/.openclaw/openclaw.json`.

### 6. Report

Finish with: resolved CLI path, config-file status, secret-provider type/ref, each capability probe
result (pass / warn / unknown), the `openclaw` section written, and the exact next command/skill
(`lisa-openclaw-connect-staff` or `lisa-openclaw-connect-repo-topic`).

## Related

`lisa-openclaw-connect-staff`, `lisa-openclaw-connect-repo-topic`. Staff "brains" come from the
`lisa-wiki` plugin's `add-role`.

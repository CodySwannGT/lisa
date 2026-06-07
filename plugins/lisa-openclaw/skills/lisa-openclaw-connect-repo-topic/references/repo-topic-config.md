# Repo-coding topic config shapes

Placeholder-only. Real ids/paths/handles go only into `~/.openclaw/openclaw.json` (machine-local,
never committed). Back up that file before editing; change only the intended keys.

## Trust model

- `admin` group: highly trusted people; machine-config/infra repos allowed; topics may request merge
  after PR.
- `developer` group: broader collaborators; topics stop at change + docs + commit + PR unless
  explicitly raised.

If two repos need different member lists, use different groups even if both are `developer`.

## Folder-scoped repo catalog

```yaml
repos:
  - name: repo-1
    path: /absolute/path/to/repo-1
    hints: [billing, invoices]
  - name: repo-2
    path: /absolute/path/to/repo-2
    hints: [login, mobile-app]
```

## Naming

- topic slug: derived from the topic purpose or workspace name
- dispatcher agent id: `<topic-slug>-dispatch`
- worker agent id: `<topic-slug>-codex`

## Dispatcher agent

```json5
{
  "id": "<topic-slug>-dispatch",
  "workspace": "/absolute/path/to/repo-or-parent",
  "skills": ["acp-router"],
  "subagents": { "allowAgents": ["<topic-slug>-codex"] },
  "tools": {
    "profile": "coding",
    "deny": [
      "group:ui", "group:automation", "group:nodes",
      "bash", "exec", "process", "browser", "canvas", "cron",
      "gateway", "write", "edit", "apply_patch"
    ]
  },
  "elevated": { "enabled": false }
}
```

## Worker agent

```json5
{
  "id": "<topic-slug>-codex",
  "workspace": "/absolute/path/to/repo-or-parent",
  "tools": {
    "profile": "coding",
    "deny": [
      "group:ui", "group:automation", "group:nodes", "group:sessions",
      "subagents", "process", "browser", "canvas", "cron",
      "gateway", "write", "edit", "apply_patch"
    ]
  },
  "elevated": { "enabled": false }
}
```

## Topic route

Use `channels.telegram.groups` for a single-account Telegram setup. If
`channels.telegram.accounts` is configured, bind the route under the owning bot account instead:
`channels.telegram.accounts.<account-id>.groups.<group-id>`. Account-scoped Telegram configs do not
inherit root `channels.telegram.groups` routes.

Account-scoped topic `agentId` routes require an OpenClaw runtime that treats the topic agent as an
explicit group route for non-default Telegram accounts. If a real topic self-test is delivered to the
bot but the logs show `drop non-default account requires explicit binding`, update or rebuild
OpenClaw. Do not add a persistent ACP binding as a workaround; the configured topic `agentId` is the
intended route.

### Single-account route

```json5
{
  "channels": {
    "telegram": {
      "groups": {
        "<group-id>": {
          "groupPolicy": "allowlist",
          // Group-level gate stays on: messages in the group that are NOT inside a
          // routed topic still require an explicit mention.
          "requireMention": true,
          "allowFrom": ["<telegram-user-id>"],
          "topics": {
            "<topic-id>": {
              "agentId": "<topic-slug>-dispatch",
              // Default false: the topic is bound 1:1 to this agent, so every message
              // in it is already addressed to the agent — an @mention carries no routing
              // information. Flip to true only for shared-workspace topics where humans
              // also coordinate with each other (see "Mention gating" below).
              "requireMention": false,
              "systemPrompt": "Use the topic's configured scope mode. For single-repo, pass the fixed repo path to <topic-slug>-codex. For folder-scoped, confirm the inferred repo or repo set unless the user already named it explicitly, then pass the explicit repo path(s) to <topic-slug>-codex. Treat each native reply root as an independent request context."
            }
          }
        }
      }
    }
  }
}
```

### Multi-account route

```json5
{
  "channels": {
    "telegram": {
      "accounts": {
        "<account-id>": {
          "groups": {
            "<group-id>": {
              "groupPolicy": "allowlist",
              "requireMention": true,
              "allowFrom": ["<telegram-user-id>"],
              "topics": {
                "<topic-id>": {
                  "agentId": "<topic-slug>-dispatch",
                  "requireMention": false,
                  "systemPrompt": "Use the topic's configured scope mode. For single-repo, pass the fixed repo path to <topic-slug>-codex. For folder-scoped, confirm the inferred repo or repo set unless the user already named it explicitly, then pass the explicit repo path(s) to <topic-slug>-codex. Treat each native reply root as an independent request context. If generated files need to be returned as Telegram attachments, write or copy them under ~/.openclaw/media before calling message(action=\"send\"), because outbound local media delivery rejects arbitrary /tmp paths."
                }
              }
            }
          }
        }
      }
    }
  }
}
```

## File return path

When a repo-topic agent returns generated files to Telegram, use the OpenClaw `message` tool with
real local file paths. Write or copy returnable artifacts under `~/.openclaw/media` before sending;
outbound local media delivery rejects arbitrary `/tmp` paths even when the file exists.

## Mention gating

`requireMention` controls whether a message must @-mention the bot before the agent activates. It is
set independently at the group level and the topic level; the topic-level value wins for messages
inside a routed topic.

- **Topic level — default `false`.** A repo-coding topic is bound 1:1 to its dispatcher
  (`agentId`), so the topic itself already determines the agent. Every message in the topic is
  addressed to that agent and the @mention adds nothing but friction. This is the "inbox topic"
  shape: the topic *is* the conversation with the agent.
- **Set the topic level to `true`** only for a **shared-workspace topic** — one where humans also
  talk *to each other* (status updates, coordination) and you do not want every stray line to spawn
  an agent run. The mention then acts as an explicit "this one is for the bot" intent signal.
- **Group level — keep `true`.** It gates messages posted in the group but outside any routed
  topic, where there is no 1:1 agent binding to lean on.

Tradeoff to weigh before leaving a topic at `false`: with no mention required, **every** top-level
message and **every** native reply in the topic wakes the dispatcher (and can spawn a worker run). In
an inbox topic that is exactly what you want; in a topic people also chat in, it is noise and cost.
When in doubt, keep code-work topics as dedicated inbox topics (`false`) and push human coordination
to a separate topic or the group body.

## Worker launcher form

```sh
PATH="$HOME/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin" \
  "$HOME/bin/<coding-cli>" exec -C <target_dir> "<prompt>"
```

## Id rules

- Telegram Bot API `chat_id` for a supergroup is the full signed id (usually starts `-100`); the short
  positive number is not a valid substitute.
- Topic id is the Telegram `message_thread_id`.
- Discover ids from a logged-in Telegram client, an existing route in `~/.openclaw/openclaw.json`, or a
  received Bot API update — the Bot API cannot list groups by name.

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

```json5
{
  "channels": {
    "telegram": {
      "groups": {
        "<group-id>": {
          "groupPolicy": "allowlist",
          "requireMention": true,
          "allowFrom": ["<telegram-user-id>"],
          "topics": {
            "<topic-id>": {
              "agentId": "<topic-slug>-dispatch",
              "requireMention": true,
              "systemPrompt": "Use the topic's configured scope mode. For single-repo, pass the fixed repo path to <topic-slug>-codex. For folder-scoped, confirm the inferred repo or repo set unless the user already named it explicitly, then pass the explicit repo path(s) to <topic-slug>-codex. Treat each native reply root as an independent request context."
            }
          }
        }
      }
    }
  }
}
```

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

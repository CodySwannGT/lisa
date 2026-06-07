# OpenClaw routing shapes (Telegram & Slack)

Placeholder-only. Real ids/handles/tokens go only into `~/.openclaw/openclaw.json` (machine-local,
never committed). Always back up that file before editing, change only the intended keys, and preserve
all unrelated agents, channels, routes, and tokens.

## Identity & session-scoping rules

- **Telegram** `chat_id`: the signed supergroup id (usually starts with `-100`), not the short
  positive number. Topic id is the `message_thread_id`. Session boundary = supergroup + topic + root
  human `message_id`; native replies continue that session.
- **Slack** routes bind by stable channel **id**, not channel name. Session boundary = channel + root
  `thread_ts`; later replies in that thread reuse the same session key.

## Telegram — facilitator topic route

Use `channels.telegram.groups` for a single-account Telegram setup. If the OpenClaw config has
`channels.telegram.accounts`, put the route under the owning bot account at
`channels.telegram.accounts.<account-id>.groups.<telegram-supergroup-id>`; account-scoped Telegram
configs do not inherit root group routes.

### Single-account route

```json5
{
  "channels": {
    "telegram": {
      "groups": {
        "<telegram-supergroup-id>": {
          "groupPolicy": "allowlist",
          "requireMention": true,
          "allowFrom": ["<telegram-user-id>"],
          "topics": {
            "<facilitator-topic-id>": {
              "agentId": "<facilitator-agent-id>",
              "requireMention": true
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
            "<telegram-supergroup-id>": {
              "groupPolicy": "allowlist",
              "requireMention": true,
              "allowFrom": ["<telegram-user-id>"],
              "topics": {
                "<facilitator-topic-id>": {
                  "agentId": "<facilitator-agent-id>",
                  "requireMention": true
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

## Slack — facilitator channel route

```json5
{
  "channels": {
    "slack": {
      "replyToModeByChatType": { "channel": "all" },
      "channelRoutes": {
        "<slack-channel-id>": {
          "agentId": "<facilitator-agent-id>",
          "requireMention": true
        }
      }
    }
  }
}
```

## Facilitator agent + specialist allow-list

```json5
{
  "agents": {
    "list": [
      {
        "id": "<facilitator-agent-id>",
        "workspace": "<wiki-or-repo-path>",
        "subagents": {
          "allowAgents": ["<specialist-agent-id-1>", "<specialist-agent-id-2>"],
          "requireAgentId": true
        }
      },
      { "id": "<specialist-agent-id-1>", "workspace": "<wiki-or-repo-path>" },
      { "id": "<specialist-agent-id-2>", "workspace": "<wiki-or-repo-path>" }
    ]
  }
}
```

## Notes

- Optional specialist audit topics/workrooms are visibility surfaces only; do not treat a post there
  as proof of delivery. The operational route is internal `sessions_spawn`.
- Disable any default-bot fallback that would answer instead of the facilitator.
- Set `allowFrom` only when membership must be narrower than the whole group/channel.

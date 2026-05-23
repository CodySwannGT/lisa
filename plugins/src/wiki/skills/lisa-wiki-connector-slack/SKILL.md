---
name: lisa-wiki-connector-slack
description: Ingest a Slack channel into sanitized source notes via a user token. Use only when lisa-wiki-ingest routes to the slack connector AND the run carries explicit external-write intent (Slack OAuth opens a browser and stores a token file). Centralized stdlib-Python scripts; secrets are redacted.
---

# lisa-wiki-connector-slack

The centralized Slack connector backed by `scripts/slack_oauth_user.py` (one-time OAuth) and
`scripts/ingest_slack_channel.py` (ingest). These are the stdlib-Python scripts previously duplicated
verbatim across projects, now shipped once by the plugin.

## Side effects — `external-write`
Slack OAuth opens a browser and writes a user-token file to a local secrets path. The slack connector
is therefore `external-write`: it runs ONLY with config opt-in **and** explicit per-run intent, is
skipped during an unattended full ingest, and its PR never auto-merges.

## Flow
1. One-time auth (explicit): `python3 "${PLUGIN_ROOT}/scripts/slack_oauth_user.py"` — stores a
   `xoxp-` user token under an ignored secrets path. The token file is never committed.
2. Ingest: `python3 "${PLUGIN_ROOT}/scripts/ingest_slack_channel.py" --channel <id-or-name> \
   --config wiki/lisa-wiki.config.json --emit-meta wiki/state/handoff/slack-<runId>.json` — verifies
   the Slack tenant against config, then writes sanitized source notes under `wiki/sources/slack/`
   (tokens/keys redacted) and emits a **proposed** cursor to the handoff file.
3. Hand the source notes + handoff meta back to `lisa-wiki-ingest` (the kernel advances final state
   after verification).

## Rules
- Verify the Slack team/tenant matches config before ingesting.
- Token/OAuth artifacts stay in `.gitignore` and are never committed.
- Writes only Slack source notes; the kernel performs synthesis/index/log/verify/PR.

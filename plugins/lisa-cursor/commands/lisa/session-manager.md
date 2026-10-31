---
description: "Run the local session manager: one dispatch-and-relay cycle (the /loop prompt), or start, stop or show the tmux-hosted manager. Dispatches Ready work items to fresh background worker sessions and relays their questions over the project's Telegram bot when one is configured (Telegram is optional). Claude Code only; configure it with /lisa:setup:session-manager."
allowed-tools: ["Skill"]
argument-hint: "[cycle|start|stop|status]"
---

Use the /lisa-session-manager skill to run one manager cycle or to start, stop or report on the manager. $ARGUMENTS

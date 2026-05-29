# Claude Code Web + Notifications Workflow

> **Retired (ticket-1054).** Lisa's built-in ntfy Stop-hook notifier
> (`notify-ntfy.sh`) has been removed. The hook emitted a `No such file or
> directory` error and was no longer used, so it was retired from the Lisa
> source entirely (the script, the base `Stop` hook entry, the Codex hook
> definition, and every per-agent ship-list). Lisa no longer ships or installs
> any ntfy notification hook.

## What this means

- Lisa does **not** configure push notifications for you anymore.
- If you want ntfy-style push notifications for Claude Code Web, set them up
  yourself: [ntfy.sh](https://ntfy.sh) is a simple pub-sub service, and Claude
  Code supports user-defined `Stop` hooks in your own `.claude/settings.json`.
  This is now entirely host-owned configuration, outside Lisa's governance.

This page is kept as a tombstone so existing links resolve; the previous
step-by-step ntfy setup guide no longer applies.

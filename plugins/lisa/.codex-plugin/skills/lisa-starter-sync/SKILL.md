---
name: lisa-starter-sync
description: "Run one starter sync using…"
allowed-tools: ["Bash", "Read", "Skill"]
---

# Sync the project's starter

Run one `lisa starter sync --json` in the verified project checkout using the
installed Lisa CLI. The CLI owns diffing, ownership rules, isolated PR worktrees,
direct-when-clean refusal, and reuse of an existing PR. Do not reproduce them.

For a scheduled invocation, re-read `starter.sync.auto` from the project's
current config before any mutation. If it is not exactly `true`, report
`no-change — automatic starter sync is off` and stop. A stale registration must
not keep applying changes after the operator turns the setting off.

Use a real existing work item when supplied (`--work-item <ref>`) and the actual
runtime's identity with `--co-author <identity>`. Never invent attribution,
disable hooks, or open a ticket merely to make an empty sync pass. If project
commit policy needs attribution that is unavailable, surface that requirement.

Report the returned outcome accurately:

- `current`: **nothing to do**; no changes landed.
- `committed`: name the resulting commit.
- `pull-request`: link the existing or newly opened PR; it is awaiting review,
  not merged and not an advanced consumer baseline. Continue the existing
  `lisa-drive-pr-to-merge` review workflow with `auto_merge=false` when available.
- Nonzero exit or malformed output: report the actual failure and any retained
  worktree location. Do not reset or delete those recovery files.

Never write to the starter repository. Never enable auto-merge as part of this
command. The same skill is distributed to all six agent runtimes; native slash
commands use `/lisa:starter-sync`, and Codex uses `$lisa-starter-sync`.

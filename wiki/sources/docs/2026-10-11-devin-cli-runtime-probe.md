# Devin CLI Runtime Probe

- Captured: 2026-10-11
- Runtime: Devin CLI 3000.11.3 (macOS), authenticated, run in a workspace Devin trusts
- Work items: Epic CodySwannGT/lisa#4283; leaves #4426, #4427, #4428, #4429
- Method: we ran real `devin -p` sessions against throwaway projects. A logging hook captured each payload, and we installed local plugins with `devin plugins install --local -y`. Each finding below was measured, not taken from the docs.

## Findings

| # | Finding | Evidence |
|---|---|---|
| 1 | **Project hooks.** `.devin/hooks.v1.json` (the whole file is the hooks object) fires `SessionStart`, `PreToolUse` and `Stop` hooks. | The logging hook recorded all three events. |
| 2 | **Environment.** Hook commands receive both `DEVIN_PROJECT_DIR` and `CLAUDE_PROJECT_DIR`, each set to the project root. | Recorded by the logging hook. |
| 3 | **Tool names.** Devin's tools are named `exec`, `write`, `edit` and `read`. The fields inside each tool's input use Claude's names: `command`, `file_path`, `content`, `old_string`, `new_string`. | Recorded payloads. |
| 4 | **Claude-format hooks never fire.** Hooks in `.claude/settings.json` with matchers `Bash` or `Write\|Edit` never fired. | Same session as finding 1. |
| 5 | **Plugin manifest.** A plugin with `.devin-plugin/plugin.json` installs; `devin plugins info` lists its skills (`/<plugin>:<skill>`), its agents (`<plugin>:<agent>`), its root `hooks.json` hooks and its root `.mcp.json` servers. | `devin plugins info` output. |
| 6 | **Hook location.** Hooks declared inline in `.claude-plugin/plugin.json` were **not** loaded. | `devin plugins install` listed no hooks for such a plugin. |
| 7 | **Plugin-root variable.** `${CLAUDE_PLUGIN_ROOT}` (and the `DEVIN_PLUGIN_ROOT` environment variable) resolved to the installed plugin root inside plugin hook commands. `${PLUGIN_ROOT}` did not. | Logging hook output. |
| 8 | **Rules folder.** A plugin's nested `rules/eager` and `rules/reference` folders were not loaded. | `Rules (none)` in `devin plugins info`. |
| 9 | **Lisa guards block once the tool name is translated.** With Lisa's `lisa-devin` variant installed, a request to `git commit --allow-empty --no-verify` was refused by `block-no-verify.sh`. | Devin's refusal message. |
| 10 | **The translation is what makes it work.** For the same `exec` payload, `block-no-verify.sh` exited 0 without the tool-name translation and 2 with it. | Exit codes. |
| 11 | **The backup guard works without the plugin.** With no plugin installed and only Lisa's `.devin/hooks.v1.json` backup guard, the same commit was refused by the project's `scripts/lisa-hooks/block-no-verify.sh`, and `git log` showed no commit. | Refusal message and `git log`. |
| 12 | **The branch-binding guard doesn't run on Devin.** `worktree-binding-guard` reported "payload carries no session id or cwd", because Devin's payloads carry no `cwd`. Its check that you're on the right branch for the ticket does not run on Devin. | Guard output. |

## Not observed

- **Scheduler.** No CLI command or setting creates recurring or scheduled sessions.
- **Language servers.** No plugin manifest field registers a language server.
- **Commands.** No plugin `commands/` folder is loaded; Devin's slash commands are skills.

## Reference documentation

- https://docs.devin.ai/cli/extensibility/plugins/overview
- https://docs.devin.ai/cli/extensibility/hooks/overview
- https://docs.devin.ai/cli/extensibility/hooks/lifecycle-hooks

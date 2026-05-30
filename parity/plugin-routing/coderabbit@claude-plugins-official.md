# Parity routing review — `coderabbit@claude-plugins-official`

- **Plugin:** `coderabbit@claude-plugins-official`
- **Upstream version:** `1.1.1`
- **Analyzed:** 2026-05-30
- **Status:** `proposed` (flip to `approved` before running `implement-plugin-parity`)

## Components

| kind | id | path | classification | notes |
| --- | --- | --- | --- | --- |
| agent | `code-reviewer` | `agents/code-reviewer.md` | claude-agent | Subagent wrapping the CodeRabbit CLI review. |
| command | `coderabbit-review` | `commands/coderabbit-review.md` | claude-command | Slash command entry to a CodeRabbit review. |
| skill | `autofix` | `skills/autofix/SKILL.md` | claude-skill | Applies CodeRabbit autofix suggestions. |
| skill | `code-review` | `skills/code-review/SKILL.md` | claude-skill | Default code-review skill. |

## Per-agent routing

| agent | outcome | actions | rationale |
| --- | --- | --- | --- |
| codex | `reimplement` | - reimplement the code-reviewer agent as a Lisa-native skill stamped synced-from: coderabbit@claude-plugins-official@1.1.1<br>- reimplement the coderabbit-review command as a Lisa-native skill stamped synced-from: coderabbit@claude-plugins-official@1.1.1<br>- reimplement the autofix and code-review skills as Lisa-native skills stamped synced-from: coderabbit@claude-plugins-official@1.1.1 | Codex has no plugin agent/command surface and is not in the fan-out; reimplement every component group as Lisa skills. (The CodeRabbit CLI itself is agent-agnostic and can be invoked from the reimplemented skills.) |
| cursor | `claude-only` | _(none)_ | Cursor reads .claude-plugin/ natively; the agent, command, and skills load unchanged. |
| agy | `reimplement` | - reimplement the code-reviewer agent as a Lisa-native skill stamped synced-from: coderabbit@claude-plugins-official@1.1.1<br>- reimplement the coderabbit-review command as a Lisa-native skill stamped synced-from: coderabbit@claude-plugins-official@1.1.1<br>- reimplement the autofix and code-review skills as Lisa-native skills stamped synced-from: coderabbit@claude-plugins-official@1.1.1 | Curated third-party plugins are not in agy's fan-out; reimplement every component group as Lisa skills. |
| copilot | `enable-vendor-equivalent` | - enable Copilot's native code-review capability (covers the code-reviewer agent, coderabbit-review command, and code-review skill) in the project-scoped marketplace<br>- the autofix skill has no generic Copilot equivalent — reimplement it as a Lisa-native skill stamped synced-from: coderabbit@claude-plugins-official@1.1.1 | Code review is a generic capability Copilot ships natively (enable it for the review components); the CodeRabbit-specific autofix has no native equivalent so it is reimplemented. |

> Plan-only artifact. Review the routing, then flip `"status": "proposed"` → `"approved"` in the paired `.json` to authorize `implement-plugin-parity`.

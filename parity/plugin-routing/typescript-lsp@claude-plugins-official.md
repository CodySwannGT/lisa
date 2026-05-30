# Parity routing review — `typescript-lsp@claude-plugins-official`

- **Plugin:** `typescript-lsp@claude-plugins-official`
- **Upstream version:** `1.0.0`
- **Analyzed:** 2026-05-30
- **Status:** `proposed` (flip to `approved` before running `implement-plugin-parity`)

## Components

| kind | id | path | classification | notes |
| --- | --- | --- | --- | --- |
| lsp | `typescript-lsp` | `README.md` | lsp-server | TypeScript/JavaScript language server (typescript-language-server). Inferred from README; no machine-readable manifest. Version from cache dir name; no plugin.json. |

## Per-agent routing

| agent | outcome | actions | rationale |
| --- | --- | --- | --- |
| codex | `re-point-mcp-lsp` | - emit the TypeScript LSP into Codex's .codex-plugin pointer (lspServers) — flagged follow-up: confirm the Codex pointer generator handles lspServers | An LSP-bearing plugin is re-pointed into Codex's .codex-plugin pointer rather than reimplemented. |
| cursor | `already-native` | - Cursor ships a native TypeScript language server; no emission needed | Cursor provides TypeScript/JavaScript language intelligence natively, so the LSP is already covered. |
| agy | `re-point-mcp-lsp` | - emit the TypeScript LSP via agy's user-global installer (lspServers) — flagged follow-up: confirm the agy installer handles LSP servers | An LSP-bearing plugin is re-pointed via agy's installer rather than reimplemented. |
| copilot | `re-point-mcp-lsp` | - emit the TypeScript LSP as an inline lspServers entry on Copilot's manifest — first LSP routed to Copilot lspServers; flagged follow-up: verify the Copilot manifest generator emits lspServers | An LSP-bearing plugin is re-pointed into Copilot's lspServers manifest rather than reimplemented. |

> Plan-only artifact. Review the routing, then flip `"status": "proposed"` → `"approved"` in the paired `.json` to authorize `implement-plugin-parity`.

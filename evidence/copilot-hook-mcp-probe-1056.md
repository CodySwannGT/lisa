# Copilot plugin hook-firing + MCP probe (issue #1056)

Empirical, install-path verification of the GitHub Copilot plugin variant against
the **GitHub Copilot CLI 1.0.56** (verified by run; the probe cache in
`scripts/internal-copilot-runtime-probe.json` was captured on 1.0.55 and the
results below reconfirm them on 1.0.56).

Method: register the local repo as a Copilot marketplace
(`copilot plugin marketplace add <local path>`), `copilot plugin install` the
real built artifacts, instrument the bundled hook scripts with a sentinel
side-effect, then run a non-interactive `copilot -p` session that begins a
session (`sessionStart`) and runs a Bash tool call (`preToolUse`). Hook firing is
observed via the sentinel file; MCP load is observed in `~/.copilot/logs`. All
probe state (marketplace + installs) was removed afterward.

`--plugin-dir` headless mode does NOT load plugin hooks or plugin MCP, so a real
`copilot plugin install` is required — that is why the original ticket marked
these "unverified".

## Item #2 / #1 — `subagentStart` invalidates the whole hooks config → zero hooks fire

The base manifest's `SubagentStart` group carries `inject-rules.sh`, which ships
to Copilot. Translated, it becomes a `subagentStart` event with an empty
`matcher`. Copilot has no `subagentStart` event and rejects the **entire** inline
hooks config on the empty matcher, so NONE of the plugin's hooks fire.

**Probe A — buggy (`subagentStart` present), CLI 1.0.56:**

```
Plugin "lisa-copilot-buggy" installed successfully. Installed 123 skills.
hooks fired (buggy):  NONE — zero hooks fired
[ERROR] Invalid inline hooks config for plugin "lisa-copilot-buggy": hooks.subagentStart[0].matcher: matcher cannot be empty
```

**Probe B — fixed (`subagentStart` dropped, this PR), CLI 1.0.56:**

```
Plugin "lisa-copilot-fixed" installed successfully. Installed 123 skills.
hooks fired (fixed):
fired:lisa-copilot-fixed:install-pkgs.sh
fired:lisa-copilot-fixed:inject-rules.sh
fired:lisa-copilot-fixed:setup-jira-cli.sh
```

→ With `subagentStart` removed, the `sessionStart` hooks fire and
`${CLAUDE_PLUGIN_ROOT}` resolves (to `~/.copilot/installed-plugins/.../lisa-copilot`).
`inject-rules.sh` fires under `sessionStart`, so **Lisa rules are delivered**
(AC-1). The `subagentStart` fix is the thing that unblocks hook firing — items #1
and #2 are the same root cause.

## Item #3 — bundled `.mcp.json` is not auto-discovered; only an inline `mcpServers` object loads

`copilot mcp --help` lists the MCP config sources as `User`
(`~/.copilot/mcp-config.json`), `Workspace` (project-root `.mcp.json`), and
`Plugin` (installed plugins with MCP servers). A plugin's bundled `.mcp.json` is
NOT the workspace file. Tested shapes (CLI 1.0.55 + reconfirmed 1.0.56):

| Plugin manifest / files | `expo` server loaded? |
|---|---|
| bundled `.mcp.json`, no manifest field | NO ("No MCP servers configured") |
| `"mcpServers": ".mcp.json"` (path string) | NO |
| root `plugin.json` with inline `mcpServers` | NO (via `mcp list`) |
| `mcp.json` / `.github/mcp.json` files | NO |
| **`.claude-plugin/plugin.json` inline `mcpServers` object** | **YES** |

**Probe C — inline `mcpServers` object (this PR), CLI 1.0.56:**

```
Plugin "lisa-expo-copilot" installed successfully. Installed 44 skills.
[ERROR] Server expo requires authentication, initiating OAuth flow
[ERROR] OAuth authentication required for expo
[ERROR] OAuth required for expo with no cached tokens; marking as needs-auth
```

→ Copilot loads the plugin's `expo` server and initiates its connection (the
OAuth step is expected — the public expo MCP requires auth). Note `copilot mcp
list` does NOT enumerate plugin-provided servers in 1.0.55/1.0.56 (only User +
Workspace), so the load is observed via the session log, not `mcp list`. The fix
mirrors `.mcp.json`'s `mcpServers` into the manifest as an inline object.

## Conclusion

- **AC-1 (hooks fire):** PASS — `sessionStart` hooks fire after install once the
  invalid `subagentStart` is dropped; `inject-rules.sh` delivers rules.
- **AC-2 (only valid events shipped):** PASS — `subagentStart` removed from every
  copilot variant; cursor (which supports it) is unaffected.
- **AC-3 (MCP discovery):** PASS — inline `mcpServers` object loads the server;
  bare `.mcp.json` and the path-string pointer do not.

Residual note: `copilot mcp list` not enumerating plugin servers is a Copilot CLI
display limitation, not a Lisa defect — the server is loaded in-session.

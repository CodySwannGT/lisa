---
name: lisa-setup-sonar
description: "Configure the official…"
allowed-tools: ["Bash", "Read", "Write", "Edit", "AskUserQuestion", "Skill"]
---

# Set up SonarQube (official plugin + MCP)

This is an explicit exterior setup gate. Run it **outside** any active Build, QA,
Monitor, or Verify factory — authentication and MCP wiring must be complete before
unattended factories run. It replaces Lisa's former hand-rolled SonarCloud REST
access with the vendor's official token-authed MCP, which is Lisa's single Sonar
substrate on both developer machines and headless cloud routines.

This does **not** touch the CI SonarCloud SAST job in `quality.yml` or its
`SONAR_TOKEN` secret — that enforcement gate is separate and stays as-is.

## Supported agents

Wire only Lisa's supported agents: **Claude Code, Codex, Cursor, GitHub Copilot,
Antigravity (agy)** via `sonar integrate <agent>`, and **OpenCode** via its MCP
config. **Never** wire Kiro or Gemini CLI even though the vendor supports them —
they are not Lisa-supported agents.

## 1. Install or update the SonarQube CLI

Check `sonar` on PATH (`command -v sonar`). If present, update it (`sonar
self-update`, or the package manager that owns it); if absent, install it and ask
for confirmation before running the install:

```bash
# macOS/Linux (script) — default, works everywhere
curl -o- https://raw.githubusercontent.com/SonarSource/sonarqube-cli/refs/heads/master/user-scripts/install.sh | bash
# or Homebrew: brew install --cask sonarqube-cli
# or mise:     mise use -g aqua:SonarSource/sonarqube-cli
```

A container runtime (Docker/Podman/Nerdctl) must be installed and running — the
MCP runs as a container via `sonar run mcp`. Probe with `docker ps` (falling back
to `podman ps` / `nerdctl ps`). If none succeed, tell the operator to start it and
note the agent session must restart afterward for the MCP tools to load.

## 2. Authenticate — token for factories, login for dev machines

The MCP authenticates from environment variables — this is the headless path and
the one factories use. **Never** write credentials to `.lisa.config.json` or
`.lisa.config.local.json`; provide them as environment variables / CI secrets:

- `SONARQUBE_CLI_TOKEN` — required.
- `SONARQUBE_CLI_ORG` — for SonarQube Cloud.
- `SONARQUBE_CLI_SERVER` — for a self-hosted SonarQube Server.

On an interactive developer machine you may instead run `sonar auth login`
(browser flow; token stored in the OS keychain). Do **not** use the keychain flow
for headless/cloud-routine environments — provision the env token there instead
(see `/lisa:generate-claude-remote-build-script`, which now installs the CLI,
pre-pulls the MCP image, and sets `SONARQUBE_CLI_TOKEN`). Verify with `sonar auth
status`; record the identity label only, never token material.

## 3. Select the Test Manager target

Use `sonar config project` (and optional `sonar config folder`), then `sonar
config show`. Capture the non-secret project/organization identifiers.

## 4. Integrate per supported agent

Confirm the target scope (single-choice: current project / global), then for each
supported agent detected on PATH run its non-interactive integrate:

```bash
sonar integrate claude       --non-interactive
sonar integrate codex        --non-interactive
sonar integrate cursor       --non-interactive
sonar integrate copilot      --non-interactive
sonar integrate antigravity  --non-interactive
```

For **OpenCode** (no vendor integrate path), wire the MCP through OpenCode's own
MCP config so it launches `sonar run mcp`, authenticated from the same env token.

Skip any agent whose CLI is not installed; never wire Kiro or Gemini.

## 5. Write non-secret policy config

Merge only non-secret identifiers into committed `.lisa.config.json`, preserving
every unrelated key (never credentials):

```json
{
  "verification": {
    "sonar": {
      "enabled": true,
      "edition": "cloud",
      "organization": "<org-key>",
      "projectKey": "<project-key>"
    }
  }
}
```

Use `"edition": "server"` with a `"serverUrl"` for a self-hosted Server.

## 6. Prove readiness

Run the `lisa-sonarcloud-access` probe (an `mcp__sonarqube__*` project search) and
confirm a `mcp__sonarqube__*` tool answers. Then run `lisa doctor` and confirm the
Sonar provider check is green. If the MCP tools do not appear, verify the container
runtime is running and restart the agent session.

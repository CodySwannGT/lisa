---
name: maestro-mcp-setup
description: "Enable the Maestro CLI's…"
allowed-tools:
  - Bash
  - Read
---

# Maestro MCP Setup

Wire the Maestro CLI's built-in MCP server (`maestro mcp`, STDIO) into the
current coding agent for **this machine only**, in a way that actually works.

## Why this skill exists (read before changing it)

The Maestro MCP server is intentionally **NOT** in the distributed plugin
`.mcp.json`. A static, committed entry always attempts to spawn, and coding
agents spawn stdio servers with a **non-login PATH**. So an always-on entry
fails visibly — Claude Code shows `Failed to reconnect … -32000` **every
session** — on any machine missing the Maestro CLI *or* a resolvable Java
runtime, which is most of a typical fleet (CI runners, unattended QA/intake
agent boxes). That exact regression shipped once (expo plugin commit b12d5d3)
and was reverted (b1f3efd).

This skill fixes both failure modes without poisoning the fleet:

1. **Missing CLI / Java** → detect, and install or guide install.
2. **Installed but PATH-less spawn** → register with an **absolute `command`
   path** plus injected **`JAVA_HOME` / `PATH`** env, so the server finds Java
   regardless of the spawn's inherited PATH.

Registration is always **`--scope local`** (per-machine, uncommitted). Never use
`--scope project` / a committed `.mcp.json` entry — that is the always-on form
that reds out every other machine.

## Steps

### 1. Locate the Maestro CLI

```bash
MAESTRO_BIN="$(command -v maestro || true)"
[ -z "$MAESTRO_BIN" ] && [ -x "$HOME/.maestro/bin/maestro" ] && MAESTRO_BIN="$HOME/.maestro/bin/maestro"
echo "maestro: ${MAESTRO_BIN:-NOT FOUND}"
```

If not found, install it (official installer — confirm with the user first,
since it writes to `~/.maestro`):

```bash
curl -fsSL "https://get.maestro.mobile.dev" | bash
MAESTRO_BIN="$HOME/.maestro/bin/maestro"
```

Resolve to an **absolute** path — a bare `maestro` in the registration relies on
the very PATH that is missing at spawn time.

### 2. Locate a usable Java runtime

Maestro needs a JDK (8+). Resolve `JAVA_HOME` **honoring the project's version
manager** — do not install a parallel global JDK when one is already managed:

```bash
# Prefer an already-active/managed Java before installing anything.
if command -v mise >/dev/null 2>&1 && mise which java >/dev/null 2>&1; then
  JAVA_BIN="$(mise which java)"
elif command -v asdf >/dev/null 2>&1 && asdf which java >/dev/null 2>&1; then
  JAVA_BIN="$(asdf which java)"
elif command -v java >/dev/null 2>&1; then
  JAVA_BIN="$(command -v java)"
fi
echo "java: ${JAVA_BIN:-NOT FOUND}"
# JAVA_HOME is the parent of the bin/ dir that contains java.
[ -n "$JAVA_BIN" ] && JAVA_HOME="$(cd "$(dirname "$JAVA_BIN")/.." && pwd)"
```

If no Java is found: install through the project's version manager when present
(`mise use -g java@21`, `asdf install java …`, or `sdk install java`), or guide
the user to install a JDK. Prefer the managed path; only fall back to a global
install with explicit consent. Re-resolve `JAVA_HOME` afterward.

### 3. Register at local scope with injected env

Build a `PATH` that puts the Maestro and Java `bin` dirs first, then register for
the **current** coding agent. `$JAVA_BIN`/`$MAESTRO_BIN` are absolute.

Claude Code:

```bash
JBIN_DIR="$(dirname "$JAVA_BIN")"; MBIN_DIR="$(dirname "$MAESTRO_BIN")"
claude mcp add --scope local maestro \
  --env "JAVA_HOME=$JAVA_HOME" \
  --env "PATH=$JBIN_DIR:$MBIN_DIR:$PATH" \
  -- "$MAESTRO_BIN" mcp
```

Parity — same intent on other harnesses (local/per-machine scope, absolute
command, injected `JAVA_HOME`/`PATH`); translate the registration verb only:

- **Codex** — `codex mcp add maestro --env JAVA_HOME=… --env PATH=… -- "$MAESTRO_BIN" mcp` (writes `~/.codex/config.toml`; keep it out of the committed project config).
- **Cursor** — add the server to the user-scope `~/.cursor/mcp.json` (not the project `.cursor/mcp.json`) with `command`, `args: ["mcp"]`, and `env: { JAVA_HOME, PATH }`.
- **OpenCode** — add to the user config (`~/.config/opencode/opencode.json`) `mcp` block with the absolute command and `environment`.
- **Antigravity (agy) / Copilot** — add to the per-user MCP config with the absolute command + `env`; Copilot uses `type: "local"` for stdio servers.

In every case: **local/user scope, never the committed project file.**

### 4. Verify

```bash
claude mcp list        # or the harness equivalent
```

Confirm `maestro` shows connected. If it still fails, the usual cause is
`JAVA_HOME` pointing at a JRE without `bin/java`, or a Maestro path that moved —
re-resolve both and re-register. Do not "fix" it by dropping to a bare
`maestro mcp` command; that reintroduces the PATH-less failure.

## Guardrails

- **Local scope only.** If you catch yourself typing `--scope project` or editing
  a committed `.mcp.json`, stop — that is the reverted fleet-wide regression.
- **Absolute paths + injected env are mandatory**, not optional — they are the
  whole reason this is a skill and not a one-line doc.
- Installing the CLI or a JDK mutates the machine — confirm before installing,
  and prefer the project's version manager over a parallel global install.

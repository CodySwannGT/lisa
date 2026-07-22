#!/usr/bin/env bash
##
# SessionStart hook: register the Maestro MCP server for THIS machine — but only
# when the toolchain is already present.
#
# The Maestro stdio server is intentionally NOT in the distributed .mcp.json: an
# always-on entry reds out ("Failed to reconnect ... -32000") every session on
# any machine lacking the Maestro CLI or a login-PATH Java runtime (see
# THIRD-PARTY-NOTICES and the expo plugin history b12d5d3 -> b1f3efd, where the
# always-on entry broke the whole fleet). This hook is the SAFE inverse: it
# registers at LOCAL scope, with an ABSOLUTE command path and injected
# JAVA_HOME/PATH, ONLY when both `maestro` and a usable `java` resolve — and
# stays completely silent otherwise. Machines without the toolchain are never
# touched, so they never red. The registration takes effect on the NEXT session
# (MCP servers connect at startup), exactly like the other setup hooks.
#
# Fast + idempotent: unequipped machines (most of the fleet) exit after a couple
# of `command -v` probes; equipped machines re-register only if not already set.
#
# Parity note: this auto-register hook is Claude-specific — it uses SessionStart
# semantics and the `claude mcp add` verb. Other harnesses (Codex, Cursor,
# OpenCode, Antigravity, Copilot) enable Maestro MCP via the vendor-agnostic
# `maestro-mcp-setup` skill, which registers the same absolute-command +
# injected-env server at each agent's local/user scope. Extending automatic
# registration to those agents' native session hooks is deliberate follow-up, not
# a silent drop.
##

set -euo pipefail

# Drain the hook envelope so the caller's pipe closes cleanly.
cat >/dev/null 2>&1 || true

# A hook must never interrupt the session; swallow any unexpected failure.
trap 'exit 0' ERR

# Need the Claude CLI to register at all.
command -v claude >/dev/null 2>&1 || exit 0

# 1. Resolve the Maestro CLI to an ABSOLUTE path (a bare `maestro` relies on the
#    very PATH that is missing when the agent spawns the stdio server).
MAESTRO_BIN="$(command -v maestro 2>/dev/null || true)"
if [ -z "${MAESTRO_BIN}" ] && [ -x "${HOME}/.maestro/bin/maestro" ]; then
  MAESTRO_BIN="${HOME}/.maestro/bin/maestro"
fi
[ -n "${MAESTRO_BIN}" ] || exit 0 # CLI absent -> stay silent, never register.

# 2. Resolve a usable Java, honoring the project's version manager before any
#    ambient java. No Java -> stay silent (the spawn would die without it).
JAVA_BIN=""
if command -v mise >/dev/null 2>&1 && JAVA_BIN="$(mise which java 2>/dev/null)"; then
  :
elif command -v asdf >/dev/null 2>&1 && JAVA_BIN="$(asdf which java 2>/dev/null)"; then
  :
elif command -v java >/dev/null 2>&1; then
  JAVA_BIN="$(command -v java)"
fi
[ -n "${JAVA_BIN}" ] && [ -x "${JAVA_BIN}" ] || exit 0

JAVA_HOME_DIR="$(cd "$(dirname "${JAVA_BIN}")/.." && pwd)"
JBIN_DIR="$(dirname "${JAVA_BIN}")"
MBIN_DIR="$(dirname "${MAESTRO_BIN}")"

# 3. Already registered (any scope)? Nothing to do.
claude mcp get maestro >/dev/null 2>&1 && exit 0

# 4. Register at LOCAL scope (per-machine, uncommitted) with the absolute command
#    and injected toolchain env, so the stdio spawn finds Java regardless of the
#    inherited PATH. Failure is non-fatal and silent.
claude mcp add --scope local maestro \
  --env "JAVA_HOME=${JAVA_HOME_DIR}" \
  --env "PATH=${JBIN_DIR}:${MBIN_DIR}:${PATH}" \
  -- "${MAESTRO_BIN}" mcp >/dev/null 2>&1 || true

exit 0

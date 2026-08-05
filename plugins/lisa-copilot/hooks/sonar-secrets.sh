#!/usr/bin/env bash
#
# Shared wrapper around `sonar hook <event>` for every agent surface.
#
# `sonar integrate <agent>` generates a five-line shim per surface: if `sonar` is
# on PATH, pipe the hook payload to it and let whatever comes back stand. That is
# correct for the thing the scanner exists to do — refusing a prompt or a file
# read that genuinely contains a credential — and wrong for the thing it also
# does, which is refusing *everything* when the CLI has no token yet:
#
#   {"decision":"block","reason":"SonarQube secret scanning is inactive:
#    not authenticated. Run 'sonar auth login'."}
#
# At the shim level that reply is indistinguishable from a real finding, so a
# workstation that had simply never run the browser login could not submit a
# prompt at all. Two things are wrong with that, and this wrapper fixes both.
#
# 1. The credential is usually already provisioned. A project that declares
#    SONARQUBE_CLI_TOKEN under `secrets.require` has it in its configured
#    provider — and the CLI reads only the environment and the OS keychain, so on
#    a local surface (which deliberately materializes nothing to disk) the value
#    is present and unreachable at the same time. We resolve it through
#    lisa-secrets-access, the one sanctioned reader, and only when the CLI says
#    it needs it.
#
# 2. An unauthenticated scanner is a degraded gate, not a breach. This hook is
#    one of several overlapping layers: secret scanning at commit time and in CI
#    does not depend on it. Blocking every prompt to protect a redundant layer
#    trades a certain outage for a hypothetical leak — and the outage lands on
#    exactly the person least able to diagnose it, since the block fires before
#    their first prompt is ever seen.
#
# A real finding still blocks. Only the "inactive" reply is downgraded, and the
# distinction is drawn on the reason text the vendor emits, so a detection that
# arrives while unauthenticated is impossible by construction — in that state the
# scanner does not scan at all.
#
# Usage: sonar-secrets.sh <vendor-event-name>   # hook payload on stdin
set -uo pipefail

event="${1:-}"
[ -n "$event" ] || exit 0

# Nothing installed, nothing to enforce. Matches the vendor shim's own guard.
command -v sonar >/dev/null 2>&1 || exit 0

# An explicit off switch, for bisecting a session that is misbehaving. There is
# deliberately no way to turn the *blocking* back on from the environment: the
# decision that a missing token must not stop work belongs in this file, where it
# is reviewable, not in whatever shell happened to launch the agent.
[ "${LISA_SONAR_HOOK:-on}" = "off" ] && exit 0

payload="$(cat)"

# The vendor signals its verdict as JSON on stdout and always exits 0, so the
# exit code carries no information and the reason text is the only channel.
inactive_marker='secret scanning is inactive'

run_scanner() {
  printf '%s' "$payload" | sonar hook "$event" 2>/dev/null
}

is_inactive() {
  case "$1" in
    *"$inactive_marker"*) return 0 ;;
    *) return 1 ;;
  esac
}

# Run the resolver with a ceiling, because the provider call crosses the network
# and this sits in front of every prompt and every file read. `timeout` is not
# present on a stock macOS, so this is the portable equivalent: start it, poll,
# give up. Giving up is safe — the caller treats an empty value as "the provider
# had nothing", which lands on the warn path rather than a block.
resolve_secret() {
  local resolver="$1" name="$2" out pid waited=0
  out="$(mktemp)" || return 0
  node "$resolver" get "$name" >"$out" 2>/dev/null &
  pid=$!
  while kill -0 "$pid" 2>/dev/null; do
    [ "$waited" -ge 10 ] && { kill -9 "$pid" 2>/dev/null; break; }
    sleep 1
    waited=$((waited + 1))
  done
  wait "$pid" 2>/dev/null
  cat "$out"
  rm -f "$out"
}

out="$(run_scanner)"

if is_inactive "$out"; then
  # Where lisa-secrets-access lives depends on how the project receives Lisa.
  # Claude and Codex get it as an installed plugin, which is not part of a clone;
  # the agent skill directories and node_modules are what a fresh checkout
  # actually has. Same search order as the remote-env setup script, including the
  # `plugins/` rung that exists only in the Lisa monorepo itself.
  repo_root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
  resolver=""
  for candidate in \
    "$repo_root/.claude/skills/lisa-secrets-access/scripts/resolve-secret.mjs" \
    "$repo_root/.agents/skills/lisa-secrets-access/scripts/resolve-secret.mjs" \
    "$repo_root/.codex/skills/lisa-secrets-access/scripts/resolve-secret.mjs" \
    "$repo_root/plugins/lisa/skills/lisa-secrets-access/scripts/resolve-secret.mjs" \
    "$repo_root/node_modules/@codyswann/lisa/plugins/lisa/skills/lisa-secrets-access/scripts/resolve-secret.mjs"; do
    if [ -f "$candidate" ]; then
      resolver="$candidate"
      break
    fi
  done

  if [ -n "$resolver" ] && command -v node >/dev/null 2>&1; then
    token="$(resolve_secret "$resolver" SONARQUBE_CLI_TOKEN)"
    if [ -n "$token" ]; then
      # Exported into this process only. Writing it anywhere durable would create
      # a second live copy of a credential whose single store is the provider —
      # see the one-store rule in lisa-secrets-access.
      export SONARQUBE_CLI_TOKEN="$token"
      org="$(resolve_secret "$resolver" SONARQUBE_CLI_ORG)"
      [ -n "$org" ] && export SONARQUBE_CLI_ORG="$org"
      out="$(run_scanner)"
    fi
    unset token org
  fi
fi

if is_inactive "$out"; then
  # stderr on a zero exit is advisory in every agent's hook protocol: the user
  # sees it, the operation proceeds.
  echo "sonar: local secret scanning is inactive (no token in the environment," >&2
  echo "  the OS keychain, or the configured secrets provider). Continuing —" >&2
  echo "  commit-time and CI secret scanning still gate this repository." >&2
  echo "  To restore it: 'sonar auth login', or store SONARQUBE_CLI_TOKEN in" >&2
  echo "  the project's secrets provider." >&2
  exit 0
fi

[ -n "$out" ] && printf '%s' "$out"
exit 0

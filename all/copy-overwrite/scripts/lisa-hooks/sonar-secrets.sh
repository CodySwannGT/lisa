#!/usr/bin/env bash
# This file is managed by Lisa and IS replaced on each `lisa` run.
# Do not edit directly — durable changes belong upstream in Lisa.

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

# Read the payload FIRST, before anything here can stand aside.
#
# The caller pipes the hook envelope into our stdin. A path that exits before
# consuming it closes the read end while the caller's write is still in flight,
# and the caller's write raises EPIPE — a failure in the harness, produced by a
# hook that had nothing to say and exited 0 saying it. The evidence lands
# entirely on the writing side, which is why it read as a mystery for so long.
#
# It is a race, so it only fires when this process wins. Measured against the
# real payload at a 1-minute load average of 82: 3 EPIPE in 600 invocations of
# the no-event path (0.50%), and 30 in 30 once the payload exceeds the pipe
# buffer. Rare enough to look like a real failure, frequent enough to keep
# costing re-runs (CodySwannGT/lisa#2949).
#
# Reading first is the fix that also covers real callers, rather than only the
# tests: every exit below now happens after stdin has reached EOF. Use Bash's
# `read` builtin instead of `cat`: the no-CLI path deliberately works with a
# PATH that contains no executables, and making the drain depend on PATH removes
# the drain at exactly the moment this wrapper is proving `sonar` is absent
# (CodySwannGT/lisa#3308). An empty delimiter means "read through NUL or EOF";
# hook envelopes contain no NUL, so the non-zero EOF result is expected.
#
# Every wait in this file has a ceiling (CodySwannGT/lisa#5038). This one waited
# for EOF with none, so a caller that gave up on the hook without closing its end
# of the pipe left the hook blocked in `read` forever: four were found on one
# workstation, orphaned to PID 1 with no children, 2h, 2h, 5h and 146h old. A
# real caller writes the whole envelope at once (a 1MB payload drains in ~0.6s
# at a load average of 20), so the ceiling only ever ends a wait nobody is going
# to finish. When EOF arrives in time nothing changes: every exit below still
# follows it. When it does not, the hook stops waiting and steps aside — Bash
# discards a partial read on timeout, so there is no complete payload to scan.
#
# `read -t` cannot tell its caller which happened (Bash 3.2 returns 1 for both
# EOF and a timeout), so the clock decides: a read that lasted the whole ceiling
# timed out. A value that is not a positive whole number falls back to the
# shipped ten seconds rather than to `read -t 0`, which would skip the drain.
bound_s() {
  case "$1" in
    '' | *[!0-9]* | 0*) printf '10' ;;
    *) printf '%s' "$1" ;;
  esac
}

payload=""
stdin_bound="$(bound_s "${LISA_SONAR_STDIN_TIMEOUT_S:-}")"
stdin_started=$SECONDS
IFS= read -r -d '' -t "$stdin_bound" payload || true
if (( SECONDS - stdin_started >= stdin_bound )); then
  echo "sonar: the hook's input did not finish arriving within ${stdin_bound}s;" >&2
  echo "  skipping the local secret scan. Commit-time and CI secret scanning" >&2
  echo "  still gate this repository." >&2
  exit 0
fi

event="${1:-}"
[[ -n "$event" ]] || exit 0

# Nothing installed, nothing to enforce. Matches the vendor shim's own guard.
command -v sonar >/dev/null 2>&1 || exit 0

# An explicit off switch, for bisecting a session that is misbehaving. There is
# deliberately no way to turn the *blocking* back on from the environment: the
# decision that a missing token must not stop work belongs in this file, where it
# is reviewable, not in whatever shell happened to launch the agent.
[[ "${LISA_SONAR_HOOK:-on}" == "off" ]] && exit 0

# The vendor signals its verdict as JSON on stdout and always exits 0, so the
# exit code carries no information and the reason text is the only channel.
inactive_marker='secret scanning is inactive'

# Run one command with a ceiling and capture its stdout into `captured`.
#
# Usage: capture_bounded <seconds> <delimiter> <label> <stdin> <command...>
# Returns 0 when the command answered in time, 1 when the ceiling expired (and
# `captured` is then empty), and 2 when the private FIFO could not be made.
#
# `read -t` supplies the ceiling. `timeout` is absent on a stock macOS and
# `coproc` needs Bash 4 (the hooks run under /bin/bash 3.2 there), so this is the
# portable form. Stopping the wait is not stopping the work, so when the read
# returns the command is killed and reaped; that requires its PID, which is why
# the command is backgrounded explicitly and its output goes through a FIFO.
# On /bin/bash 3.2, `$!` after `< <(cmd)` is the SHELL'S OWN PID, not the
# substitution's child (verified: the child's PPID is the shell, and `$!` equals
# the shell), so `kill -9 "$!"` there would tell the hook to kill itself. For a
# background pipeline `$!` is its last command, so the kill lands on the command
# itself; its stdin writer then dies on the closed pipe.
#
# The FIFO's OPEN is bounded too, not only the read (CodySwannGT/lisa#5038). A
# read-only open of a FIFO blocks until a writer opens the other end, and a
# writer that dies first would leave it blocked for good with `read -t` never
# reached. So the hook opens the FIFO read-write first, which never blocks, and
# the command inherits that end at fork instead of opening the path later. The
# read-only end is then opened while a writer is guaranteed to exist, and the
# hook's own write end is closed, so EOF arrives exactly when the command (and
# anything it handed its stdout to) is done.
#
# The FIFO is a rendezvous, not storage: a named pipe holds no data at rest, so a
# value carried through it never lands on disk (CWE-922) and a kill at any point
# leaves an empty pipe behind rather than a readable token. The directory is
# `mktemp -d`, which is 0700. Its explicit Lisa prefix makes an interrupted run
# attributable to the owning scratch lifecycle instead of anonymous `tmp.*`.
# Descriptors 3 and 4 are used for nothing else in this file.
captured=""
capture_bounded() {
  local seconds="$1" delim="$2" label="$3" feed="$4" dir="" fifo="" child=""
  local started=0 status=0
  shift 4
  captured=""
  dir="$(mktemp -d "${TMPDIR:-/tmp}/lisa-sonar-${label}.XXXXXXXX")" || return 2
  fifo="$dir/$label"
  if ! mkfifo -m 600 "$fifo" 2>/dev/null; then
    rm -rf "$dir"
    return 2
  fi
  exec 3<>"$fifo"
  { printf '%s' "$feed"; } 3>&- | "$@" >&3 3>&- 2>/dev/null &
  child=$!
  exec 4<"$fifo"
  exec 3>&-
  started=$SECONDS
  IFS= read -r -d "$delim" -t "$seconds" captured <&4
  exec 4<&-
  # The clock decides, as for stdin above: Bash 3.2 returns 1 for EOF and for a
  # timeout alike, and Bash 4+ keeps a timed-out partial read, which must never
  # pass for a verdict or a token.
  if (( SECONDS - started >= seconds )); then
    captured=""
    status=1
  fi
  kill -9 "$child" 2>/dev/null
  wait "$child" 2>/dev/null
  rm -rf "$dir"
  return "$status"
}

# `sonar hook` is a call with no ceiling of its own, in front of every prompt and
# every file read (CodySwannGT/lisa#5038). Ten seconds by default, like the
# resolver below; `LISA_SONAR_SCAN_TIMEOUT_S` lets a caller that is not a session
# say otherwise. A scanner that does not answer is a degraded layer, not a
# finding, so the hook warns and steps aside.
scan_bound="$(bound_s "${LISA_SONAR_SCAN_TIMEOUT_S:-}")"
run_scanner() {
  capture_bounded "$scan_bound" '' scan "$payload" sonar hook "$event"
  case $? in
    0) out="$captured" ;;
    1)
      echo "sonar: the secret scanner did not answer within ${scan_bound}s;" >&2
      echo "  skipping the local secret scan. Commit-time and CI secret scanning" >&2
      echo "  still gate this repository." >&2
      exit 0
      ;;
    *)
      echo "sonar: could not make a private pipe for the secret scanner;" >&2
      echo "  skipping the local secret scan. Commit-time and CI secret scanning" >&2
      echo "  still gate this repository." >&2
      exit 0
      ;;
  esac
}

is_inactive() {
  case "$1" in
    *"$inactive_marker"*) return 0 ;;
    *) return 1 ;;
  esac
}

# Resolve a secret with a ceiling, because the provider call crosses the network
# and this sits in front of every prompt and every file read.
#
# The value never touches the filesystem. An earlier version captured it through
# `mktemp` and deleted the file afterwards, which is a race, not a cleanup: a
# kill between the write and the `rm` leaves the token readable on disk (CWE-922)
# — the precise failure the one-store rule in lisa-secrets-access exists to
# prevent, reintroduced by the code enforcing it. `capture_bounded` carries it
# over a FIFO instead, which holds nothing at rest.
#
# Ten seconds is the ceiling a consumer gets, and that is a product decision, not
# a tuning constant: this runs in front of every prompt and every file read, so
# it must not hang a session. `LISA_SONAR_RESOLVER_TIMEOUT_S` lets a caller that
# is NOT a session say so. The only caller that is not a session is this repo's
# own suite, where the "provider" is a local `node` script rather than a network
# call and the cost of starting it is unbounded under load — a spawn measured
# 45-50ms here at a 1-minute load average of 50, against an 18ms quiet figure,
# and the read lost its whole ten seconds to one at ~98 concurrent test workers
# (CodySwannGT/lisa#2905). The suite scales this the same way it scales its own
# budgets, and stages a hang by shrinking it.
#
# A timeout leaves the value empty, which the caller treats as "the provider had
# nothing" — the warn path, never a block. Unset, empty, or unparseable all fall
# back to the shipped ten seconds, so there is no value of this variable that
# turns a warn into a block.
resolve_secret() {
  capture_bounded "$(bound_s "${LISA_SONAR_RESOLVER_TIMEOUT_S:-10}")" $'\n' resolver "" \
    node "$1" get "$2"
  printf '%s' "$captured"
}

run_scanner

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
    if [[ -f "$candidate" ]]; then
      resolver="$candidate"
      break
    fi
  done

  if [[ -n "$resolver" ]] && command -v node >/dev/null 2>&1; then
    token="$(resolve_secret "$resolver" SONARQUBE_CLI_TOKEN)"
    if [[ -n "$token" ]]; then
      # Exported into this process only. Writing it anywhere durable would create
      # a second live copy of a credential whose single store is the provider —
      # see the one-store rule in lisa-secrets-access.
      export SONARQUBE_CLI_TOKEN="$token"
      org="$(resolve_secret "$resolver" SONARQUBE_CLI_ORG)"
      [[ -n "$org" ]] && export SONARQUBE_CLI_ORG="$org"
      run_scanner
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

[[ -n "$out" ]] && printf '%s' "$out"
exit 0

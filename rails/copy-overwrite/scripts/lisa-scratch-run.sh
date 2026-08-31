#!/bin/sh
# This file is managed by Lisa and IS replaced on each `lisa` run.
# Do not edit directly — durable changes belong upstream in Lisa.
# -----------------------------------------------------------------------------
# Rails scratch supervisor — run-scoped scratch ownership with an outside
# cleanup authority that survives the tested process.
# -----------------------------------------------------------------------------
# WHY THIS IS SHELL AND NOT NODE
#
# A Rails repository is not required to have Node, npm, Bun, Yarn, a populated
# `node_modules`, or a network at test runtime. The Node-managed scratch
# supervisor cannot be reused here for exactly that reason. This file assumes
# only what the routes it wraps already assume: a POSIX shell, coreutils/BSD
# userland (`ps`, `mkdir`, `rm`, `date`, `od`), and Ruby/Bundler for the payload
# itself. It never fetches anything.
#
# USAGE
#
#   sh scripts/lisa-scratch-run.sh --suite <label> -- <command> [args...]
#
# WHAT IT GUARANTEES
#
#   1. Authority precedes allocation. Before the payload can allocate one byte
#      of scratch, a separate cleanup authority process — outside the payload's
#      process group, and outside this shell's — has read and acknowledged the
#      exact run token, the canonical run root, the run root's filesystem
#      identity (device + inode), the suite label, the payload's process-group
#      identity, and the payload's process-birth identity. The payload is held
#      at a gate until that acknowledgement lands. An arming or acknowledgement
#      failure REFUSES: the payload never executes.
#   2. Cleanup survives the payload. Pass, fail, timeout, SIGTERM, SIGINT,
#      SIGHUP, payload SIGKILL, and foreground-supervisor SIGKILL all end with
#      the owned process group boundedly drained and the owned run root absent,
#      done by this invocation's own already-armed authority. No successor run
#      is started and no global sweep is performed.
#   3. Only what this invocation owns is touched. The authority signals exactly
#      one process group — the one it acknowledged, re-verified by birth
#      identity so PID reuse cannot broaden it — and deletes exactly one root,
#      re-verified by token and by device+inode so a swap cannot broaden it. An
#      external database service is never signalled, stopped, reset, or deleted.
#   4. Ambiguity fails closed. Traversal, symlinked roots, inode swaps, owner
#      token changes, malformed or oversized markers, PID reuse, birth
#      mismatch, and foreign quarantine names all exit nonzero with a reason.
#   5. A fixture leak fails the suite. Unregistered direct children left under
#      the payload's temp root are reported with the suite label, the leaked
#      count, and the sorted leaked basenames, and make the route exit nonzero.
#      A red payload verdict is never overwritten by the leak verdict, and a
#      green payload never masks a leaking child.
#
# ENVIRONMENT
#
#   LISA_SCRATCH_BASE               Temp base. Default: $TMPDIR, else /tmp.
#   LISA_SCRATCH_REGISTERED_PREFIXES
#                                   Comma-separated basename prefixes that are
#                                   batch-cleaned instead of reported as leaks.
#                                   Default: "lisa-".
#   LISA_SCRATCH_LEAK_GATE          enforce (default) | report | off.
#   LISA_SCRATCH_ARM_TIMEOUT_MS     Arming handshake budget, in ms. Default 15000.
#   LISA_SCRATCH_GATE_TIMEOUT_MS    How long the held payload waits for the gate
#                                   to open before refusing. Default 300000.
#   LISA_SCRATCH_AUTHORITY_REFUSE   Conformance control. When 1, the cleanup
#                                   authority declines to acknowledge. The run
#                                   must then REFUSE before the payload executes.
#                                   It can only turn a run into a refusal; it can
#                                   never let one through unsupervised.
#   LISA_SCRATCH_DRAIN_MS           SIGTERM→SIGKILL drain budget. Default 5000.
#   LISA_SCRATCH_TRACE              Append lifecycle events to this file. The
#                                   file order IS the ordering proof.
#   LISA_SCRATCH_INHERIT_STDIN      1 to give the payload this shell's stdin.
#                                   Default: /dev/null (avoids SIGTTIN on a
#                                   background process group).
# -----------------------------------------------------------------------------

set -eu

LISA_SCRATCH_NAMESPACE="lisa-rails-scratch"
LISA_SCRATCH_MARKER_MAX_BYTES=4096
LISA_SCRATCH_MARKER_MAX_LINES=64
LISA_SCRATCH_VERSION=1

# Exit codes. Distinct so a caller can tell refusal from payload failure.
EX_USAGE=64
EX_LEAK=65
EX_ARM=70
EX_AMBIGUOUS=78

lisa_die() {
  _code="$1"
  shift
  printf '%s\n' "lisa-scratch-run: $*" >&2
  exit "$_code"
}

lisa_trace() {
  [ -n "${LISA_SCRATCH_TRACE:-}" ] || return 0
  printf '%s %s %s\n' "$(date +%s 2>/dev/null || echo 0)" "$LISA_SCRATCH_ROLE" "$*" \
    >>"$LISA_SCRATCH_TRACE" 2>/dev/null || true
}

# --- portability probes ------------------------------------------------------

# Stat device and inode of a path, portably.
# $1 path -> "<dev> <ino>" on stdout, nonzero when it cannot be determined.
lisa_dev_ino() {
  _p="$1"
  if _v="$(stat -f '%d %i' "$_p" 2>/dev/null)" && [ -n "$_v" ]; then
    printf '%s\n' "$_v"
    return 0
  fi
  if _v="$(stat -c '%d %i' "$_p" 2>/dev/null)" && [ -n "$_v" ]; then
    printf '%s\n' "$_v"
    return 0
  fi
  # Last-resort fallback: inode from `ls -di`, device stood in for by the
  # mount point reported by `df -P`. Both are POSIX.
  _ino="$(ls -di "$_p" 2>/dev/null | awk '{print $1}')" || return 1
  [ -n "$_ino" ] || return 1
  _dev="$(df -P "$_p" 2>/dev/null | awk 'NR==2 {print $NF}')" || return 1
  [ -n "$_dev" ] || return 1
  printf '%s %s\n' "$_dev" "$_ino"
}

# Process-birth identity for a pid: something that changes when the PID is
# reused. `lstart` where available, `etime`+`ppid` otherwise.
# $1 pid -> birth string on stdout, nonzero when the process is gone.
lisa_birth() {
  _pid="$1"
  if _v="$(ps -o lstart= -p "$_pid" 2>/dev/null)" && [ -n "$_v" ]; then
    printf '%s\n' "$(printf '%s' "$_v" | tr -s ' ' ' ' | sed 's/^ *//;s/ *$//')"
    return 0
  fi
  if _v="$(ps -o ppid=,etime= -p "$_pid" 2>/dev/null)" && [ -n "$_v" ]; then
    printf '%s\n' "$(printf '%s' "$_v" | tr -s ' ' ' ' | sed 's/^ *//;s/ *$//')"
    return 0
  fi
  return 1
}

lisa_pgid_of() {
  ps -o pgid= -p "$1" 2>/dev/null | tr -d ' \t' || return 1
}

lisa_alive() {
  kill -0 "$1" 2>/dev/null
}

# Short sleep, degrading to a whole second where fractional sleep is absent.
lisa_nap() {
  if [ "${LISA_SCRATCH_FRACTIONAL_SLEEP:-unknown}" = "unknown" ]; then
    if sleep 0.05 2>/dev/null; then
      LISA_SCRATCH_FRACTIONAL_SLEEP=yes
    else
      LISA_SCRATCH_FRACTIONAL_SLEEP=no
    fi
  fi
  if [ "$LISA_SCRATCH_FRACTIONAL_SLEEP" = yes ]; then
    sleep 0.05
  else
    sleep 1
  fi
}

# --- marker (arming record) --------------------------------------------------

# Read one key out of a marker file, fail-closed on malformed or oversized
# input. $1 marker path, $2 key.
lisa_marker_get() {
  _file="$1"
  _key="$2"
  [ -f "$_file" ] || return 1
  if [ -L "$_file" ]; then return 1; fi
  _bytes="$(wc -c <"$_file" 2>/dev/null | tr -d ' ')" || return 1
  [ -n "$_bytes" ] || return 1
  [ "$_bytes" -le "$LISA_SCRATCH_MARKER_MAX_BYTES" ] || return 1
  _lines="$(wc -l <"$_file" 2>/dev/null | tr -d ' ')" || return 1
  [ "$_lines" -le "$LISA_SCRATCH_MARKER_MAX_LINES" ] || return 1
  _hits="$(grep -c "^${_key}=" "$_file" 2>/dev/null || true)"
  [ "$_hits" = "1" ] || return 1
  sed -n "s/^${_key}=//p" "$_file"
}

# --- path safety -------------------------------------------------------------

# Canonicalize a directory that must already exist, without readlink -f (absent
# on stock macOS). Refuses a symlinked leaf outright.
lisa_canonical_dir() {
  _p="$1"
  [ -d "$_p" ] || return 1
  [ -L "$_p" ] && return 1
  (cd -P -- "$_p" 2>/dev/null && pwd -P) || return 1
}

# A run root must be an absolute, traversal-free path directly beneath the
# namespace directory of the declared base.
lisa_root_is_well_formed() {
  _root="$1"
  _base="$2"
  case "$_root" in
    /*) : ;;
    *) return 1 ;;
  esac
  case "$_root" in
    *..*) return 1 ;;
  esac
  case "$_root" in
    "${_base}/${LISA_SCRATCH_NAMESPACE}/"*) : ;;
    *) return 1 ;;
  esac
  _leaf="${_root#"${_base}/${LISA_SCRATCH_NAMESPACE}/"}"
  case "$_leaf" in
    */*) return 1 ;;
    "") return 1 ;;
  esac
  return 0
}

lisa_token_is_well_formed() {
  case "$1" in
    "" | *[!0-9a-f]*) return 1 ;;
  esac
  [ "${#1}" -eq 64 ]
}

lisa_suite_is_well_formed() {
  case "$1" in
    "" | *[!A-Za-z0-9._-]*) return 1 ;;
  esac
  [ "${#1}" -le 64 ]
}

# =============================================================================
# AUTHORITY MODE — the outside cleanup authority.
#
# Started by the supervisor BEFORE the payload's gate is opened, in its own
# process group, so that killing either the payload group or the supervisor
# group leaves it running. It is the same file and the same invocation: no
# successor Lisa run is ever started to do cleanup.
# =============================================================================

lisa_authority_main() {
  LISA_SCRATCH_ROLE=authority
  _root="$1"

  # Every field is re-derived from the marker and independently verified. A
  # marker this cannot fully validate is never acted on.
  _base="${LISA_SCRATCH_BASE:-${TMPDIR:-/tmp}}"
  _base="${_base%/}"
  _base="$(lisa_canonical_dir "$_base")" ||
    lisa_die "$EX_AMBIGUOUS" "authority: temp base is not a canonical directory"

  lisa_root_is_well_formed "$_root" "$_base" ||
    lisa_die "$EX_AMBIGUOUS" "authority: refusing malformed run root: $_root"
  if [ -L "$_root" ]; then
    lisa_die "$EX_AMBIGUOUS" "authority: refusing symlinked run root: $_root"
  fi
  _canon="$(lisa_canonical_dir "$_root")" ||
    lisa_die "$EX_AMBIGUOUS" "authority: run root is not a canonical directory: $_root"
  [ "$_canon" = "$_root" ] ||
    lisa_die "$EX_AMBIGUOUS" "authority: run root resolves elsewhere: $_root -> $_canon"

  _marker="$_root/.lisa-scratch-arm"
  _token="$(lisa_marker_get "$_marker" token)" ||
    lisa_die "$EX_AMBIGUOUS" "authority: unreadable or malformed arming marker"
  lisa_token_is_well_formed "$_token" ||
    lisa_die "$EX_AMBIGUOUS" "authority: malformed run token"
  _version="$(lisa_marker_get "$_marker" version)" ||
    lisa_die "$EX_AMBIGUOUS" "authority: arming marker has no version"
  [ "$_version" = "$LISA_SCRATCH_VERSION" ] ||
    lisa_die "$EX_AMBIGUOUS" "authority: unsupported arming marker version: $_version"
  _mroot="$(lisa_marker_get "$_marker" root)" ||
    lisa_die "$EX_AMBIGUOUS" "authority: arming marker has no root"
  [ "$_mroot" = "$_root" ] ||
    lisa_die "$EX_AMBIGUOUS" "authority: arming marker root disagrees: $_mroot"
  _suite="$(lisa_marker_get "$_marker" suite)" ||
    lisa_die "$EX_AMBIGUOUS" "authority: arming marker has no suite"
  lisa_suite_is_well_formed "$_suite" ||
    lisa_die "$EX_AMBIGUOUS" "authority: malformed suite label"
  _dev_ino="$(lisa_marker_get "$_marker" devino)" ||
    lisa_die "$EX_AMBIGUOUS" "authority: arming marker has no filesystem identity"
  _live_dev_ino="$(lisa_dev_ino "$_root")" ||
    lisa_die "$EX_AMBIGUOUS" "authority: cannot read run root filesystem identity"
  [ "$_dev_ino" = "$_live_dev_ino" ] ||
    lisa_die "$EX_AMBIGUOUS" "authority: run root filesystem identity changed"
  _pgid="$(lisa_marker_get "$_marker" pgid)" ||
    lisa_die "$EX_AMBIGUOUS" "authority: arming marker has no process group"
  case "$_pgid" in
    "" | 0 | 1 | *[!0-9]*)
      lisa_die "$EX_AMBIGUOUS" "authority: refusing process group '$_pgid'"
      ;;
  esac
  _birth="$(lisa_marker_get "$_marker" birth)" ||
    lisa_die "$EX_AMBIGUOUS" "authority: arming marker has no process-birth identity"
  [ -n "$_birth" ] ||
    lisa_die "$EX_AMBIGUOUS" "authority: empty process-birth identity"
  _sup_pid="$(lisa_marker_get "$_marker" suppid)" ||
    lisa_die "$EX_AMBIGUOUS" "authority: arming marker has no supervisor pid"
  case "$_sup_pid" in
    "" | *[!0-9]*)
      lisa_die "$EX_AMBIGUOUS" "authority: refusing supervisor pid '$_sup_pid'"
      ;;
  esac
  _sup_birth="$(lisa_marker_get "$_marker" supbirth)" ||
    lisa_die "$EX_AMBIGUOUS" "authority: arming marker has no supervisor birth"

  # The payload group must still be the one that was armed. Verifying birth
  # here — not only later — is what makes PID reuse unable to broaden the kill.
  _live_birth="$(lisa_birth "$_pgid" || true)"
  if [ -n "$_live_birth" ] && [ "$_live_birth" != "$_birth" ]; then
    lisa_die "$EX_AMBIGUOUS" "authority: payload process-birth identity mismatch"
  fi

  if [ "${LISA_SCRATCH_AUTHORITY_REFUSE:-0}" = "1" ]; then
    lisa_trace "ack-declined"
    lisa_die "$EX_ARM" "authority: declining to acknowledge (LISA_SCRATCH_AUTHORITY_REFUSE=1)"
  fi

  # Acknowledge. Only now may the supervisor open the payload gate.
  printf 'version=%s\ntoken=%s\nroot=%s\ndevino=%s\nsuite=%s\npgid=%s\nbirth=%s\nauthority=%s\n' \
    "$LISA_SCRATCH_VERSION" "$_token" "$_root" "$_dev_ino" "$_suite" "$_pgid" \
    "$_birth" "$$" >"$_root/.lisa-scratch-ack.tmp"
  mv -f "$_root/.lisa-scratch-ack.tmp" "$_root/.lisa-scratch-ack"
  lisa_trace "ack token=$_token pgid=$_pgid suite=$_suite"

  # Wait for the run to end, by any exit path. The root vanishing means the
  # supervisor completed its own cleanup first; the supervisor's process
  # disappearing means it was killed and cleanup falls to this process.
  while :; do
    [ -d "$_root" ] || break
    if [ -f "$_root/.lisa-scratch-done" ]; then
      break
    fi
    if ! lisa_alive "$_sup_pid"; then
      break
    fi
    _now_birth="$(lisa_birth "$_sup_pid" || true)"
    if [ -n "$_now_birth" ] && [ "$_now_birth" != "$_sup_birth" ]; then
      break
    fi
    lisa_nap
  done

  lisa_trace "reap-begin"
  lisa_drain_group "$_pgid" "$_birth"
  lisa_remove_root "$_root" "$_token" "$_dev_ino" "$_base"
  if [ -d "$_root" ]; then
    lisa_trace "reap-end root-absent=no"
  else
    lisa_trace "reap-end root-absent=yes"
  fi
  exit 0
}

# =============================================================================
# Bounded process-group drain.
#
# Signals exactly the acknowledged process group, and only while its birth
# identity still matches. Never signals pid 1, never signals this process's own
# group, and therefore never reaches a database service running outside it.
# =============================================================================

lisa_drain_group() {
  _pgid="$1"
  _birth="$2"

  case "$_pgid" in
    "" | 0 | 1 | *[!0-9]*) return 0 ;;
  esac

  _own_pgid="$(lisa_pgid_of "$$" || true)"
  if [ -n "$_own_pgid" ] && [ "$_own_pgid" = "$_pgid" ]; then
    # Refusing to signal our own group is what keeps a misconfigured run from
    # taking down the shell, the runner, or a sibling service.
    printf '%s\n' "lisa-scratch-run: refusing to drain our own process group" >&2
    return 0
  fi

  _live_birth="$(lisa_birth "$_pgid" || true)"
  if [ -n "$_live_birth" ] && [ "$_live_birth" != "$_birth" ]; then
    # A live process wearing our group's pid, born at a different moment: PID
    # reuse. Draining it would signal someone else's work.
    printf '%s\n' "lisa-scratch-run: process-birth identity mismatch; not draining $_pgid" >&2
    return 0
  fi
  if [ -z "$_live_birth" ]; then
    # The group LEADER is gone — which is precisely what happens when the
    # payload is SIGKILLed — but a process group outlives its leader, so the
    # survivors are the payload's own children and they are still ours.
    #
    # Returning here instead was a real leak: the orphaned children kept
    # running, and because they still held the run's inherited stdout and
    # stderr, the managed invocation could not report its outcome until they
    # finished on their own. Measured as a 60-second hang on a run that had
    # already been killed.
    #
    # Nothing else can be wearing this group id: a group id is its leader's
    # pid, and no process holds that pid at all.
    if ! kill -0 -"$_pgid" 2>/dev/null; then
      return 0
    fi
  fi

  kill -TERM -"$_pgid" 2>/dev/null || true

  _budget="${LISA_SCRATCH_DRAIN_MS:-5000}"
  case "$_budget" in
    "" | *[!0-9]*) _budget=5000 ;;
  esac
  _waited=0
  while [ "$_waited" -lt "$_budget" ]; do
    kill -0 -"$_pgid" 2>/dev/null || return 0
    lisa_nap
    _waited=$((_waited + 50))
  done

  kill -0 -"$_pgid" 2>/dev/null || return 0
  kill -KILL -"$_pgid" 2>/dev/null || true
  return 0
}

# =============================================================================
# Token-and-identity-bound root removal.
#
# Re-verifies token and device+inode immediately before the rename, renames the
# root into a quarantine name derived from THIS run's token, and deletes only
# that name. A quarantine directory whose suffix is not our token is left
# alone, so a foreign quarantine cannot be swept.
# =============================================================================

lisa_remove_root() {
  _root="$1"
  _token="$2"
  _dev_ino="$3"
  _base="$4"

  [ -d "$_root" ] || return 0
  if [ -L "$_root" ]; then
    printf '%s\n' "lisa-scratch-run: run root became a symlink; refusing to delete" >&2
    return 1
  fi
  lisa_root_is_well_formed "$_root" "$_base" || {
    printf '%s\n' "lisa-scratch-run: run root no longer well-formed; refusing to delete" >&2
    return 1
  }
  _now="$(lisa_dev_ino "$_root")" || return 1
  if [ "$_now" != "$_dev_ino" ]; then
    printf '%s\n' "lisa-scratch-run: run root filesystem identity changed; refusing to delete" >&2
    return 1
  fi
  _marker_token="$(lisa_marker_get "$_root/.lisa-scratch-arm" token || true)"
  if [ -n "$_marker_token" ] && [ "$_marker_token" != "$_token" ]; then
    printf '%s\n' "lisa-scratch-run: run root owner token changed; refusing to delete" >&2
    return 1
  fi

  _quarantine="${_base}/${LISA_SCRATCH_NAMESPACE}/.quarantine.${_token}"
  case "$_quarantine" in
    "${_base}/${LISA_SCRATCH_NAMESPACE}/.quarantine.${_token}") : ;;
    *) return 1 ;;
  esac
  if mv -f "$_root" "$_quarantine" 2>/dev/null; then
    rm -rf "$_quarantine" 2>/dev/null || true
  else
    # Another participant of this same invocation may have taken it already.
    [ -d "$_root" ] || return 0
    rm -rf "$_root" 2>/dev/null || true
  fi
  if [ -d "$_root" ]; then return 1; fi
  return 0
}

# =============================================================================
# GATED PAYLOAD LAUNCHER.
#
# Runs as the leader of its own process group, so the group identity exists —
# and can therefore be acknowledged — before the payload runs. It refuses to
# exec the payload unless the authority's acknowledgement for this exact token
# is on disk. That refusal is the enforcement of authority-before-allocation:
# even if the supervisor were wrong, the payload would not start.
# =============================================================================

lisa_launcher_main() {
  LISA_SCRATCH_ROLE=launcher
  _root="$1"
  _token="$2"
  shift 2

  # Deliberately NOT the arming budget: shrinking the arming budget must
  # produce a refusal that is observable as 'the payload never ran', which it
  # cannot be if the held payload has already given up on its own.
  _deadline="${LISA_SCRATCH_GATE_TIMEOUT_MS:-300000}"
  case "$_deadline" in
    "" | *[!0-9]*) _deadline=300000 ;;
  esac
  _waited=0
  while [ ! -f "$_root/.lisa-scratch-go" ]; do
    if [ "$_waited" -ge "$_deadline" ]; then
      lisa_die "$EX_ARM" "payload gate never opened; refusing to run the payload"
    fi
    lisa_nap
    _waited=$((_waited + 50))
  done

  _ack_token="$(lisa_marker_get "$_root/.lisa-scratch-ack" token || true)"
  [ "$_ack_token" = "$_token" ] ||
    lisa_die "$EX_ARM" "no valid cleanup-authority acknowledgement; refusing to run the payload"

  [ -d "$_root/tmp" ] ||
    lisa_die "$EX_ARM" "payload scratch root missing; refusing to run the payload"

  TMPDIR="$_root/tmp"
  TMP="$TMPDIR"
  TEMP="$TMPDIR"
  export TMPDIR TMP TEMP
  lisa_trace "payload-exec"
  if [ "${LISA_SCRATCH_INHERIT_STDIN:-0}" = "1" ]; then
    exec "$@"
  else
    exec "$@" </dev/null
  fi
}

# =============================================================================
# Leak scan.
# =============================================================================

# Emits the leak report on stderr. Returns 0 clean, 1 leaked.
lisa_leak_scan() {
  _tmp="$1"
  _suite="$2"

  [ -d "$_tmp" ] || return 0

  _registered="${LISA_SCRATCH_REGISTERED_PREFIXES:-lisa-}"

  _leaked=""
  _count=0
  for _entry in "$_tmp"/* "$_tmp"/.[!.]*; do
    [ -e "$_entry" ] || continue
    _name="${_entry##*/}"
    _is_registered=no
    _rest="$_registered"
    while [ -n "$_rest" ]; do
      case "$_rest" in
        *,*)
          _prefix="${_rest%%,*}"
          _rest="${_rest#*,}"
          ;;
        *)
          _prefix="$_rest"
          _rest=""
          ;;
      esac
      [ -n "$_prefix" ] || continue
      case "$_name" in
        "$_prefix"*) _is_registered=yes ;;
      esac
    done
    if [ "$_is_registered" = yes ]; then
      # Registered prefixes are batch-cleaned, never reported.
      rm -rf "$_entry" 2>/dev/null || true
      continue
    fi
    _count=$((_count + 1))
    _leaked="$_leaked$_name
"
  done

  if [ "$_count" -eq 0 ]; then return 0; fi

  _sorted="$(printf '%s' "$_leaked" | LC_ALL=C sort | tr '\n' ' ' | sed 's/ *$//')"
  printf '%s\n' "lisa-scratch-run: scratch leak in suite '$_suite': $_count unregistered direct child(ren): $_sorted" >&2
  printf '%s\n' "lisa-scratch-run: register benign prefixes via LISA_SCRATCH_REGISTERED_PREFIXES (comma-separated) or fix the fixture that leaked." >&2
  return 1
}

# =============================================================================
# SUPERVISOR (default mode).
# =============================================================================

# Terminal path for a signal that arrives while the run is still arming, i.e.
# before the payload has been allowed to allocate anything. Nothing is owned
# yet beyond the run root and, at most, a payload held at the gate.
lisa_abort_arming() {
  _sig="$1"
  trap - TERM INT HUP
  lisa_trace "arm-aborted signal=$_sig"
  [ -n "${LISA_SCRATCH_PAYLOAD_PID:-}" ] && kill -TERM "$LISA_SCRATCH_PAYLOAD_PID" 2>/dev/null
  [ -n "${LISA_SCRATCH_AUTHORITY_PID:-}" ] && kill -TERM "$LISA_SCRATCH_AUTHORITY_PID" 2>/dev/null
  if [ -n "${LISA_SCRATCH_ROOT:-}" ] &&
    lisa_root_is_well_formed "$LISA_SCRATCH_ROOT" "${LISA_SCRATCH_BASE_CANONICAL:-}"; then
    rm -rf "$LISA_SCRATCH_ROOT" 2>/dev/null || true
  fi
  kill -"$_sig" $$
}

lisa_supervisor_main() {
  LISA_SCRATCH_ROLE=supervisor

  _suite=""
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --suite)
        [ "$#" -ge 2 ] || lisa_die "$EX_USAGE" "--suite requires a value"
        _suite="$2"
        shift 2
        ;;
      --suite=*)
        _suite="${1#--suite=}"
        shift
        ;;
      --)
        shift
        break
        ;;
      *)
        lisa_die "$EX_USAGE" "unexpected argument '$1'; usage: --suite <label> -- <command>"
        ;;
    esac
  done

  lisa_suite_is_well_formed "$_suite" ||
    lisa_die "$EX_USAGE" "--suite must be 1-64 chars of [A-Za-z0-9._-]"
  [ "$#" -ge 1 ] ||
    lisa_die "$EX_USAGE" "no payload command after --"

  # A supervised payload may not be another supervisor: exactly one boundary
  # per route, no recursive alias.
  case "${LISA_SCRATCH_TOKEN:-}" in
    ?*) lisa_die "$EX_USAGE" "refusing to nest inside an existing supervised run (suite ${LISA_SCRATCH_SUITE:-unknown})" ;;
  esac
  case "$1" in
    *lisa-scratch-run.sh) lisa_die "$EX_USAGE" "refusing to supervise the supervisor" ;;
  esac

  # --- terminal paths, armed before anything can exist to leak ------------
  # Installed as the very first thing the run does. A handler installed one
  # statement after the directory it protects is a handler with a window, and
  # the window is exactly where an interrupted run leaves its root behind
  # forever. Installing it here means there is no ordering to get wrong: the
  # handler is older than every resource it can be asked to release, and it
  # simply does nothing while there is nothing to release.
  LISA_SCRATCH_ROOT=""
  LISA_SCRATCH_BASE_CANONICAL=""
  LISA_SCRATCH_PAYLOAD_PID=""
  LISA_SCRATCH_AUTHORITY_PID=""
  for _sig in TERM INT HUP; do
    # shellcheck disable=SC2064
    trap "lisa_abort_arming $_sig" "$_sig"
  done

  # --- base + token -------------------------------------------------------
  _base="${LISA_SCRATCH_BASE:-${TMPDIR:-/tmp}}"
  _base="${_base%/}"
  _base="$(lisa_canonical_dir "$_base")" ||
    lisa_die "$EX_ARM" "temp base is not a canonical directory: ${LISA_SCRATCH_BASE:-${TMPDIR:-/tmp}}"

  _token="$(od -An -tx1 -N32 /dev/urandom 2>/dev/null | tr -d ' \n')" || _token=""
  lisa_token_is_well_formed "$_token" ||
    lisa_die "$EX_ARM" "cannot obtain a 256-bit run token from /dev/urandom"

  mkdir -p "$_base/$LISA_SCRATCH_NAMESPACE" ||
    lisa_die "$EX_ARM" "cannot create scratch namespace under $_base"
  chmod 700 "$_base/$LISA_SCRATCH_NAMESPACE" 2>/dev/null || true

  _root="$_base/$LISA_SCRATCH_NAMESPACE/$_suite.$_token"
  lisa_root_is_well_formed "$_root" "$_base" ||
    lisa_die "$EX_ARM" "computed run root is not well-formed: $_root"

  # The already-installed handler becomes able to act the moment these are set,
  # which is one statement before the directory they name can exist.
  LISA_SCRATCH_ROOT="$_root"
  LISA_SCRATCH_TOKEN="$_token"
  LISA_SCRATCH_SUITE="$_suite"
  LISA_SCRATCH_BASE_CANONICAL="$_base"
  export LISA_SCRATCH_ROOT LISA_SCRATCH_TOKEN LISA_SCRATCH_SUITE

  # Exclusive create: mkdir of an existing leaf fails, so two runs can never
  # share a root even if a token somehow repeated.
  mkdir "$_root" || lisa_die "$EX_ARM" "cannot exclusively create run root"
  chmod 700 "$_root" 2>/dev/null || true
  _canon="$(lisa_canonical_dir "$_root")" ||
    lisa_die "$EX_ARM" "run root is not a canonical directory"
  [ "$_canon" = "$_root" ] ||
    lisa_die "$EX_ARM" "run root resolves elsewhere: $_root -> $_canon"
  _dev_ino="$(lisa_dev_ino "$_root")" ||
    lisa_die "$EX_ARM" "cannot read run root filesystem identity"

  lisa_trace "arm-begin suite=$_suite root=$_root"

  # --- process group exists before it is acknowledged ---------------------
  # Job control gives the background launcher its own process group, so the
  # payload's group identity is knowable BEFORE the payload runs. The launcher
  # blocks at the gate; it cannot allocate scratch until the gate opens.
  set -m 2>/dev/null || lisa_die "$EX_ARM" "shell has no job control; cannot isolate the payload process group"

  # Turning job control on resets the shell's SIGINT disposition — a terminal
  # normally delivers SIGINT to the foreground job's group, so the shell steps
  # out of the way. That silently drops the handler installed above, and a
  # Ctrl-C landing in the handshake window would be discarded rather than
  # honoured: measured as a run that continued to completion 15 seconds after
  # being told to stop. Re-arming here is what closes it.
  for _sig in TERM INT HUP; do
    # shellcheck disable=SC2064
    trap "lisa_abort_arming $_sig" "$_sig"
  done

  lisa_launcher_main "$_root" "$_token" "$@" &
  _payload_pid="$!"
  LISA_SCRATCH_PAYLOAD_PID="$_payload_pid"

  _pgid="$(lisa_pgid_of "$_payload_pid" || true)"
  _own_pgid="$(lisa_pgid_of "$$" || true)"
  case "$_pgid" in
    "" | 0 | 1 | *[!0-9]*)
      kill -TERM "$_payload_pid" 2>/dev/null || true
      rm -rf "$_root" 2>/dev/null || true
      lisa_die "$EX_ARM" "cannot determine the payload process group"
      ;;
  esac
  if [ -n "$_own_pgid" ] && [ "$_pgid" = "$_own_pgid" ]; then
    kill -TERM "$_payload_pid" 2>/dev/null || true
    rm -rf "$_root" 2>/dev/null || true
    lisa_die "$EX_ARM" "payload did not get an isolated process group; refusing"
  fi
  _birth="$(lisa_birth "$_payload_pid" || true)"
  if [ -z "$_birth" ]; then
    kill -TERM "$_payload_pid" 2>/dev/null || true
    rm -rf "$_root" 2>/dev/null || true
    lisa_die "$EX_ARM" "cannot read the payload process-birth identity"
  fi
  _sup_birth="$(lisa_birth "$$" || true)"

  # --- write the arming record -------------------------------------------
  {
    printf 'version=%s\n' "$LISA_SCRATCH_VERSION"
    printf 'token=%s\n' "$_token"
    printf 'root=%s\n' "$_root"
    printf 'devino=%s\n' "$_dev_ino"
    printf 'suite=%s\n' "$_suite"
    printf 'pgid=%s\n' "$_pgid"
    printf 'birth=%s\n' "$_birth"
    printf 'suppid=%s\n' "$$"
    printf 'supbirth=%s\n' "$_sup_birth"
  } >"$_root/.lisa-scratch-arm.tmp" || {
    kill -TERM "$_payload_pid" 2>/dev/null || true
    rm -rf "$_root" 2>/dev/null || true
    lisa_die "$EX_ARM" "cannot write the arming record"
  }
  mv -f "$_root/.lisa-scratch-arm.tmp" "$_root/.lisa-scratch-arm"
  lisa_trace "arm-written pgid=$_pgid"

  # --- start the outside authority and wait for its acknowledgement -------
  # Forked from THIS invocation, before the payload gate opens, into its own
  # process group. It therefore survives both a payload-group kill and a
  # supervisor kill, and no successor Lisa run is ever needed to clean up.
  lisa_authority_main "$_root" &
  _authority_pid="$!"
  LISA_SCRATCH_AUTHORITY_PID="$_authority_pid"
  lisa_trace "authority-started pid=$_authority_pid"

  # Both process groups are assigned at fork time, so job control has done
  # its job. Turning it back off keeps the shell's asynchronous 'Terminated'
  # notices out of the payload's own stderr.
  set +m 2>/dev/null || true

  # Same reason as after `set -m`: the disposition change cuts both ways.
  for _sig in TERM INT HUP; do
    # shellcheck disable=SC2064
    trap "lisa_abort_arming $_sig" "$_sig"
  done

  _deadline="${LISA_SCRATCH_ARM_TIMEOUT_MS:-15000}"
  case "$_deadline" in
    "" | *[!0-9]*) _deadline=15000 ;;
  esac
  _waited=0
  _acked=no
  while :; do
    _ack_token="$(lisa_marker_get "$_root/.lisa-scratch-ack" token || true)"
    if [ "$_ack_token" = "$_token" ]; then
      _acked=yes
      break
    fi
    if ! lisa_alive "$_authority_pid"; then
      break
    fi
    if [ "$_waited" -ge "$_deadline" ]; then
      break
    fi
    lisa_nap
    _waited=$((_waited + 50))
  done

  if [ "$_acked" != yes ]; then
    # REFUSE. The payload has not run and never will on this invocation.
    kill -TERM "$_payload_pid" 2>/dev/null || true
    kill -TERM "$_authority_pid" 2>/dev/null || true
    rm -rf "$_root" 2>/dev/null || true
    lisa_trace "arm-refused"
    lisa_die "$EX_ARM" "cleanup authority did not acknowledge the run; refusing to execute the payload"
  fi
  lisa_trace "arm-acked"

  # --- terminal paths, installed BEFORE the gate opens --------------------
  # A signal arriving in the window between allocation and trap installation
  # would otherwise leave the root behind on the foreground path.
  LISA_SCRATCH_SIGNAL=""
  for _sig in TERM:143 INT:130 HUP:129; do
    _signame="${_sig%%:*}"
    _sigstatus="${_sig##*:}"
    # shellcheck disable=SC2064
    trap "LISA_SCRATCH_SIGNAL=$_signame; lisa_supervisor_finish $_payload_pid $_authority_pid \"\$LISA_SCRATCH_ROOT\" \"\$LISA_SCRATCH_TOKEN\" \"$_dev_ino\" \"$_base\" \"$_pgid\" \"$_birth\" $_sigstatus" "$_signame"
  done

  # --- allocation may begin -----------------------------------------------
  mkdir "$_root/tmp" || {
    kill -TERM "$_payload_pid" 2>/dev/null || true
    lisa_die "$EX_ARM" "cannot create the payload scratch root"
  }
  chmod 700 "$_root/tmp" 2>/dev/null || true
  : >"$_root/.lisa-scratch-go"
  lisa_trace "gate-open"

  _status=0
  wait "$_payload_pid" || _status="$?"
  lisa_trace "payload-exit status=$_status"
  trap - TERM INT HUP
  lisa_supervisor_finish "$_payload_pid" "$_authority_pid" "$_root" "$_token" \
    "$_dev_ino" "$_base" "$_pgid" "$_birth" "$_status"
}

# Drain, scan, delete, verify, then exit preserving the payload's verdict.
lisa_supervisor_finish() {
  _payload_pid="$1"
  _authority_pid="$2"
  _root="$3"
  _token="$4"
  _dev_ino="$5"
  _base="$6"
  _pgid="$7"
  _birth="$8"
  _status="$9"

  lisa_trace "finish-begin status=$_status"

  # Drain first: a survivor in the owned group could still be creating
  # scratch, which would make the leak verdict a race rather than a fact.
  lisa_drain_group "$_pgid" "$_birth"

  _leak=0
  if [ "${LISA_SCRATCH_LEAK_GATE:-enforce}" != "off" ]; then
    lisa_leak_scan "$_root/tmp" "$LISA_SCRATCH_SUITE" || _leak=1
  fi

  : >"$_root/.lisa-scratch-done" 2>/dev/null || true
  lisa_remove_root "$_root" "$_token" "$_dev_ino" "$_base" || true

  if [ -d "$_root" ]; then
    # The authority still owns this root. Do not kill it — it is the safety
    # net, and it is already armed.
    printf '%s\n' "lisa-scratch-run: run root still present after cleanup: $_root" >&2
    lisa_trace "finish-root-present"
    if [ "$_status" -eq 0 ]; then _status="$EX_AMBIGUOUS"; fi
  else
    lisa_trace "finish-root-absent"
    # The owned group is drained and the owned root is gone, so the authority
    # has nothing left to own. Retire it and reap it here rather than leaving
    # an orphan behind.
    #
    # Polling `kill -0` instead would not work: a background child that has
    # already exited is a zombie until it is waited for, and signal 0 succeeds
    # against a zombie. That reads as "still working" for the whole budget, and
    # cost a flat two seconds on every single supervised run.
    kill -TERM "$_authority_pid" 2>/dev/null || true
    wait "$_authority_pid" 2>/dev/null || true
  fi

  if [ "$_leak" -eq 1 ] && [ "${LISA_SCRATCH_LEAK_GATE:-enforce}" = "enforce" ]; then
    # A red payload keeps its own verdict; a green payload does not get to
    # mask a leaking child.
    if [ "$_status" -eq 0 ]; then _status="$EX_LEAK"; fi
  fi

  if [ -n "${LISA_SCRATCH_SIGNAL:-}" ]; then
    # Re-raise the original terminal signal so the caller sees what really
    # happened, after cleanup has completed.
    trap - "$LISA_SCRATCH_SIGNAL"
    kill -"$LISA_SCRATCH_SIGNAL" $$
  fi

  exit "$_status"
}

# =============================================================================
# Entry point.
# =============================================================================

LISA_SCRATCH_ROLE=supervisor

case "${0}" in
  /*) LISA_SCRATCH_SELF="$0" ;;
  *) LISA_SCRATCH_SELF="$(cd -P -- "$(dirname -- "$0")" && pwd -P)/$(basename -- "$0")" ;;
esac
export LISA_SCRATCH_SELF

if [ "${1:-}" = "--authority" ]; then
  [ "$#" -eq 2 ] || lisa_die "$EX_USAGE" "--authority takes exactly one run root"
  lisa_authority_main "$2"
fi

lisa_supervisor_main "$@"

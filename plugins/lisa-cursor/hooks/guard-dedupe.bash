# This file is managed by Lisa and IS replaced on each `lisa` run.
# Do not edit directly — durable changes belong upstream in Lisa.

# shellcheck shell=bash
# Evaluate a dual-channel guard once per tool call, without de-registering it.
#
# Sourced — never executed — by every guard that Lisa registers on BOTH of its
# enforcement channels: the repository dispatcher
# (`scripts/lisa-enforcement-fallback.sh`, which sweeps the guard roster in one
# process) and the plugin manifest, which registers the same guards
# individually. On a machine where both are live the harness runs each guard
# twice for one tool call. The verdicts agree — the guards are idempotent — so
# the defect is cost, not correctness (CodySwannGT/lisa#3814).
#
# WHY THIS IS NOT "DROP ONE REGISTRATION".
#
# The obvious fix is to de-register the fallback where the plugin covers the
# same ground. That fix cannot be made safely from here, and the reason is
# written into the dispatcher itself: plugin-hook LIVENESS is not observable
# from disk. `installed_plugins.json` answers "was this plugin ever installed",
# which is project-blind, enablement-blind and session-blind — hooks load at
# session start, the record is rewritten on any install. A stand-down keyed on
# that record switched enforcement off in sessions where the plugin hooks were
# not loaded, and did it silently. So the dispatcher runs unconditionally and
# always will.
#
# What IS observable is EXECUTION. A guard that has already run in this session
# from a different directory is proof — not inference — that a second channel is
# live right now. This file turns that observation into a per-call memo, so the
# second copy of an identical guard replays a verdict the first one produced
# instead of computing it again. Nothing is de-registered, no matcher narrows,
# and a host with the plugin absent takes the single-channel path where the memo
# can never hit.
#
# WHAT THE MEMO IS ALLOWED TO SHORT-CIRCUIT, and the three conditions that make
# it sound. Every one of them is a REFUSAL to dedupe when it cannot be proven:
#
#   1. BYTE-IDENTICAL CODE. The digest covers the guard script and this library
#      verbatim. Two channels at different vintages therefore compute different
#      keys and both run — which is required, because the agent is meant to see
#      the UNION of two vintages' verdicts, and a tightening on either channel
#      must take effect at once. Deduplicating across vintages would let the
#      older, weaker copy answer for the newer one.
#   2. IDENTICAL PAYLOAD, SAME TOOL CALL. The digest covers the payload and a
#      per-call discriminator — the transcript's size, which grows with every
#      turn. Without the discriminator a command repeated later in the session
#      would hit a memo written before the repository changed underneath it, and
#      a guard that classifies against the working tree would be answering with
#      a stale verdict. No discriminator available means no memo.
#   3. ALLOW VERDICTS ONLY. A refusal is never memoised and never replayed. That
#      is deliberate: refusals are the rare path, so deduplicating them saves
#      nothing measurable, and it removes the whole class of hazard the ticket
#      names — a replayed refusal whose producing channel died mid-run, or a
#      refusal reaching the agent without the message that explains it. On a
#      refusal every channel evaluates and speaks exactly as it does today.
#
# State ownership, modes and ancestry are verified before channel discovery.
# After that validation the channel check uses only builtins, and returns
# before digesting code or sizing the transcript unless another channel is live.

# Key this guard would memoise under, once computed. Empty means "record
# nothing on exit".
lisa_guard_memo_key=""

# File that memo is written to.
lisa_guard_memo_file=""

# Base directory for memo state, resolved at most once per process.
lisa_guard_memo_base=""

# Whether a key was computed and a memo may be recorded on exit.
lisa_guard_memo_ready=0

# Digest tool for the memo key, resolved once. Empty disables the memo.
lisa_guard_memo_digest_tool=""

# Read ownership and all permission bits without accepting output from a
# failed platform-specific stat invocation.
# $1 - directory; sets lisa_guard_memo_owner and lisa_guard_memo_mode
lisa_guard_memo_stat() {
  local facts=""
  facts="$(stat -c '%u %a' "$1" 2>/dev/null)" ||
    facts="$(stat -f '%u %p' "$1" 2>/dev/null)" || return 1
  lisa_guard_memo_owner="${facts%% *}"
  lisa_guard_memo_mode="${facts#* }"
  case "$lisa_guard_memo_owner:$lisa_guard_memo_mode" in
    *[!0-9:]* | :* | *:) return 1 ;;
  esac
  case "$lisa_guard_memo_mode" in *[!0-7]*) return 1 ;; esac
  lisa_guard_memo_mode=$((8#$lisa_guard_memo_mode & 8#7777))
}

# Memo leaves must be private even when a sticky shared temp ancestor is safe.
# Ownership alone allows another local account to plant a session/allow file
# in an owned but group- or world-writable directory.
#
# $1 - candidate directory
lisa_guard_memo_dir_usable() {
  [ -n "${1:-}" ] || return 1
  [ -d "$1" ] || return 1
  [ ! -L "$1" ] || return 1
  [ -O "$1" ] || return 1
  lisa_guard_memo_stat "$1" || return 1
  [ $((lisa_guard_memo_mode & 8#0022)) -eq 0 ]
}

# Resolve parents physically and verify every ancestor. Plugin hooks do not
# inherit the dispatcher's trust walk, and exported paths are still inputs.
# $1 - candidate memo base; sets lisa_guard_memo_base only on success
lisa_guard_memo_trust_base() {
  lisa_guard_memo_dir_usable "$1" || return 1
  local physical=""
  physical="$(cd "$1" 2>/dev/null && pwd -P)" || return 1
  local current="$physical"
  while :; do
    lisa_guard_memo_stat "$current" || return 1
    [ "$lisa_guard_memo_owner" = 0 ] || [ -O "$current" ] || return 1
    if [ $((lisa_guard_memo_mode & 8#0022)) -ne 0 ] &&
      [ $((lisa_guard_memo_mode & 8#1000)) -eq 0 ]; then
      return 1
    fi
    [ "$current" != / ] || break
    current="${current%/*}"
    [ -n "$current" ] || current=/
  done
  lisa_guard_memo_base="$physical"
}

# Establish the memo base directory.
#
# Preferred source is `LISA_GUARD_MEMO_DIR`, exported by the dispatcher. Both
# this input and the plugin channel's TMPDIR fallback receive the same trust
# checks. Missing state is created privately; untrusted state disables memo use.
lisa_guard_memo_resolve_base() {
  [ -z "$lisa_guard_memo_base" ] || return 0

  local candidate="${LISA_GUARD_MEMO_DIR:-}"
  if lisa_guard_memo_trust_base "$candidate"; then
    return 0
  fi

  local uid="${LISA_GUARD_MEMO_UID:-}"
  if [ -z "$uid" ]; then
    uid="$(id -u 2>/dev/null || printf 'unknown')"
  fi
  candidate="${TMPDIR:-/tmp}"
  candidate="${candidate%/}/lisa-guard-memo-$uid"
  if [ ! -e "$candidate" ] && [ ! -L "$candidate" ]; then
    (umask 077 && mkdir -p "$candidate") 2>/dev/null || true
  fi
  if lisa_guard_memo_trust_base "$candidate"; then
    return 0
  fi
  return 1
}

# Resolve a SHA-256 tool, or report that there is none.
#
# Two spellings because the guards run on macOS, on Linux CI images, and in
# containers that carry neither. A missing digest tool disables dedupe rather
# than degrading it to something weaker: a cheap checksum could collide, and a
# collision here means a DIFFERENT payload reads as already-allowed, which is
# lost enforcement rather than a slow guard.
lisa_guard_memo_resolve_digest() {
  [ -z "$lisa_guard_memo_digest_tool" ] || return 0
  if command -v shasum >/dev/null 2>&1; then
    lisa_guard_memo_digest_tool="shasum"
  elif command -v sha256sum >/dev/null 2>&1; then
    lisa_guard_memo_digest_tool="sha256sum"
  else
    return 1
  fi
  return 0
}

# Remove memo state older than a day.
#
# Files first, then the emptied session directories, both with `find -delete`.
# Never a recursive forced delete: this runs unattended inside every guard, and
# the blast radius of a mis-resolved base directory has to stay bounded to
# entries this scheme itself created.
lisa_guard_memo_sweep() {
  find "$lisa_guard_memo_base" -mindepth 2 -maxdepth 2 -type f -mmin +1440 \
    -delete 2>/dev/null || true
  find "$lisa_guard_memo_base" -mindepth 1 -maxdepth 1 -type d -empty \
    -mmin +1440 -delete 2>/dev/null || true
}

# Decide whether this guard has already been evaluated for this tool call, and
# exit 0 in place of re-evaluating it when it has.
#
# Returns 0 for "carry on and evaluate". Never returns non-zero, so a caller
# running under `set -e` is unaffected by it.
#
# $1 - guard name, used only to name the memo file
# $2 - the raw tool payload this guard was handed on stdin
# Remaining arguments - files containing delegated verdict code
lisa_guard_dedupe() {
  local guard_name="${1:-}"
  local payload="${2:-}"
  [ -n "$guard_name" ] || return 0
  [ -n "$payload" ] || return 0
  [ -z "${LISA_GUARD_DEDUPE_DISABLE:-}" ] || return 0

  # The session scopes every piece of state below. No session id means the
  # payload came from a surface this cannot reason about — an adapter's
  # synthesised envelope, a test harness — and the answer there is to evaluate.
  local session_id=""
  local session_pattern="\"session_id\"[[:space:]]*:[[:space:]]*\"([^\"]+)\""
  if [[ "$payload" =~ $session_pattern ]]; then
    session_id="${BASH_REMATCH[1]}"
  fi
  [ -n "$session_id" ] || return 0
  # It is used as a path component, so anything that could escape the state
  # directory disqualifies it outright.
  case "$session_id" in *[!A-Za-z0-9._-]* | .*) return 0 ;; esac

  lisa_guard_memo_resolve_base || return 0

  local session_dir="$lisa_guard_memo_base/$session_id"
  local fresh_session=0
  if [ ! -d "$session_dir" ]; then
    if (umask 077 && mkdir "$session_dir") 2>/dev/null; then
      fresh_session=1
    fi
  fi
  lisa_guard_memo_dir_usable "$session_dir" || return 0

  # Swept once, by the process that created the session directory, so a
  # long-lived machine does not accumulate memo state. Off the hot path by
  # construction: every later call in the session finds the directory present.
  if [ "$fresh_session" -eq 1 ]; then
    lisa_guard_memo_sweep
  fi

  # The directory this copy of the guard was served from. Two registrations of
  # one guard are always two different directories — a repository tree or an
  # applied `scripts/lisa-hooks/` on one side, a plugin cache on the other — so
  # the set of directories seen this session IS the set of live channels.
  local self_script="${BASH_SOURCE[1]:-$0}"
  local self_dir="."
  case "$self_script" in */*) self_dir="${self_script%/*}" ;; esac

  local channels_file="$session_dir/channels"
  local seen_self=0
  local other_channel=0
  local line=""
  if [ -f "$channels_file" ]; then
    while IFS= read -r line || [ -n "$line" ]; do
      [ -n "$line" ] || continue
      if [ "$line" = "$self_dir" ]; then
        seen_self=1
      else
        other_channel=1
      fi
    done <"$channels_file"
  fi
  if [ "$seen_self" -eq 0 ]; then
    printf '%s\n' "$self_dir" >>"$channels_file" 2>/dev/null || true
  fi

  # Single channel: the memo can never hit, so nothing below is worth its cost.
  # This is the branch a host with no plugin takes on every call, and it is the
  # reason the fork lives below this line rather than above it.
  [ "$other_channel" -eq 1 ] || return 0

  # The per-call discriminator. The transcript grows with every turn, so its
  # size separates two identical commands issued at different points in one
  # session — which matters because a guard classifies against a working tree
  # that may have changed between them. Both channels read the same transcript
  # within one tool call, and anything appended between them costs a memo miss,
  # never a stale hit.
  local transcript=""
  local transcript_pattern="\"transcript_path\"[[:space:]]*:[[:space:]]*\"([^\"]+)\""
  if [[ "$payload" =~ $transcript_pattern ]]; then
    transcript="${BASH_REMATCH[1]}"
  fi
  [ -n "$transcript" ] || return 0
  [ -f "$transcript" ] || return 0

  lisa_guard_memo_resolve_digest || return 0

  # The transcript's size, captured and VALIDATED before it can reach the
  # digest, because a `stat` that rejects the other platform's spelling can
  # still write to stdout on its way out. GNU `stat -f '%z' FILE` reads `-f` as
  # `--file-system` and the format string as a FILE that does not exist: it
  # exits non-zero AND prints a filesystem status block for the real operand,
  # whose `Free` and `Available` counts move under any disk activity. Appended
  # straight into the digest, that made the two channels of ONE tool call
  # compute different keys, so the memo could only ever miss — the whole
  # mechanism switched off on every Linux host, while the three "must not
  # dedupe" controls stayed green because they assert a miss.
  #
  # Only an all-digits answer is accepted, and no size means NO MEMO rather
  # than a memo with nothing separating one call from the next: that is
  # condition 2 above, which the `A || B` spelling had left unenforced on a
  # host carrying neither `stat`.
  local transcript_size=""
  transcript_size="$(stat -c '%s' "$transcript" 2>/dev/null)" ||
    transcript_size=""
  case "$transcript_size" in
    "" | *[!0-9]*)
      transcript_size="$(stat -f '%z' "$transcript" 2>/dev/null)" ||
        transcript_size=""
      ;;
  esac
  case "$transcript_size" in "" | *[!0-9]*) return 0 ;; esac

  # One command substitution, covering everything the verdict depends on: the
  # guard's own bytes, this library, delegated code, payload, and call identity.
  # Keep literal bytes (including trailing newlines), and propagate every read
  # failure. A successful digest of a partial stream is not proof of identity.
  local key=""
  key="$(
    set -o pipefail
    {
      local source_file=""
      for source_file in "$self_script" "${BASH_SOURCE[0]}" "${@:3}"; do
        cat "$source_file" 2>/dev/null || exit 1
        printf '\0'
      done
      printf '\n%s\n' "$payload"
      printf '%s\n' "$transcript_size"
    } | if [ "$lisa_guard_memo_digest_tool" = "shasum" ]; then
      shasum -a 256 2>/dev/null
    else
      sha256sum 2>/dev/null
    fi
  )" || key=""
  key="${key%% *}"
  case "$key" in "" | *[!0-9a-f]*) return 0 ;; esac
  [ "${#key}" -eq 64 ] || return 0

  # One memo file per guard per session, rewritten as the call moves on, so the
  # state directory stays a fixed size however long a session runs. A saturated
  # temp directory is its own outage on this fleet, and a memo scheme that grew
  # a file per tool call would be one.
  local memo_file="$session_dir/$guard_name.allow"
  local recorded=""
  if [ -f "$memo_file" ] && [ ! -L "$memo_file" ]; then
    IFS= read -r recorded <"$memo_file" 2>/dev/null || recorded=""
    if [ "$recorded" = "$key" ]; then
      # A byte-identical copy of this guard already allowed this exact payload
      # on this exact tool call. The evaluation being skipped could only have
      # produced the verdict that was already delivered.
      exit 0
    fi
  fi

  lisa_guard_memo_key="$key"
  lisa_guard_memo_file="$memo_file"
  lisa_guard_memo_ready=1
  return 0
}

# Record an ALLOW verdict for the other channel to replay. Installed as the
# guard's EXIT trap, so it covers every path the guard can leave by.
#
# Any status other than 0 writes nothing and, when a memo from an earlier call
# is still sitting there, removes it: a guard that refused must never leave
# behind something that reads as permission.
#
# $1 - the exiting status
lisa_guard_dedupe_record() {
  [ "${lisa_guard_memo_ready:-0}" -eq 1 ] || return 0
  [ -n "$lisa_guard_memo_file" ] || return 0
  if [ "${1:-1}" -eq 0 ]; then
    printf '%s\n' "$lisa_guard_memo_key" >"$lisa_guard_memo_file" 2>/dev/null ||
      true
  else
    rm -f "$lisa_guard_memo_file" 2>/dev/null || true
  fi
  return 0
}

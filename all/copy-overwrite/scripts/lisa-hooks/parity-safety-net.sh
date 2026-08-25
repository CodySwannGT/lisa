#!/usr/bin/env bash
# This file is managed by Lisa and IS replaced on each `lisa` run.
# Do not edit directly — durable changes belong upstream in Lisa.

# PreToolUse hook for Bash: a safety net that blocks destructive shell commands
# before they run. Lisa-native reimplementation of the upstream
# `safety-net@cc-marketplace` plugin's PreToolUse Bash-guard (parity work,
# issues #1059 and #1960). It does NOT port upstream code — it re-expresses the
# behavior in Lisa's hook conventions, modeled on block-no-verify.sh.
#
# It reads the hook stdin JSON, inspects the proposed Bash command, and EXITS
# NON-ZERO (2) to BLOCK when a known-destructive pattern matches:
#   - `rm -rf` of a root / home / wildcard path (quote-aware boundaries, so
#     `bash -c "rm -rf /"` and interpreter one-liners are caught too; the rm
#     guards also match path-prefixed invocations like `/bin/rm` and `./rm`)
#   - `rm -rf` of the cwd (`.`), a `..`-traversal path, a `~/`-anchored path,
#     an absolute path outside the project (with a /tmp, /var/tmp, $TMPDIR
#     allowance, each also matched by its symlink-resolved spelling so /tmp and
#     /private/tmp are ONE location), a `$VAR` target that neither is $TMPDIR
#     nor resolves through an unambiguous in-command assignment, or ANY
#     recursive forced delete while cwd is $HOME
#   - force-pushing a protected branch (main/master/production/prod/release) —
#     feature-branch force-push stays allowed (sanctioned rebase workflow;
#     deliberate divergence from upstream's any-branch block). Every git guard
#     sees through leading git GLOBAL options (`-C <path>`, `-c <k>=<v>`,
#     `--git-dir[=…]`, `--no-pager`, …), so `git -C /path <destructive>` cannot
#     dodge the subcommand anchor
#   - `git reset --hard` / `--merge` while the working tree is dirty. Deliberate
#     divergence: upstream blocks unconditionally; Lisa allows clean-tree resets.
#     Residual risk (documented, accepted): the dirty check runs in the hook's
#     cwd at hook time, so a `cd elsewhere && git reset --hard` evades it.
#   - `git rebase --abort`/`--quit` while the in-progress rebase holds
#     human-made conflict resolutions (AUTO_MERGE discriminator; issue #1956).
#     Clean or untouched rebase state stays abortable; the apply backend and a
#     missing AUTO_MERGE ref fail closed. Deliberate divergence: upstream
#     blocks `rebase --abort` unconditionally, which strands agents mid-rebase.
#   - `git checkout` discards (`--`, `-f/--force`, `--pathspec-from-file`,
#     bare `.` — the bare-`.` block exceeds upstream)
#   - `git switch --discard-changes` / `-f/--force`
#   - `git restore` touching the worktree (allowed only with `--staged` and
#     without `--worktree`)
#   - `git stash drop` / `git stash clear`
#   - `git clean` with force and no dry-run (`-n`/`--dry-run` anywhere wins)
#   - `git branch -D` (or `-d` + `-f` in any spelling)
#   - `git tag -d`, `git reflog delete`, `git worktree remove --force`
#   - `find ... -delete`, `find ... -exec rm -rf`, `xargs ... rm -rf`
#   - disk destroyers: `dd of=/dev/...`, `mkfs ... /dev/...`, `shred`
#   - dropping or truncating a database/schema/table (Lisa-only guard)
# Otherwise it exits 0 and the command proceeds. Malformed hook input fails
# CLOSED: any parse error exits 2 (a non-2 exit would be a non-blocking hook
# error in Claude Code, silently failing open).
#
# Narrowed false-positive class (issue #3106): the rm TARGET WALK is now scoped
# to the quoting region that contains the rm, so a recursive delete quoted as
# PROSE no longer turns every later token on the line into a deletion target. A
# variable in an unrelated argument — a `gh issue create --body-file "$G/x"`, a
# `git commit -F "$MSG"` — is no longer read as the thing being deleted. An rm
# outside quotes, or first inside its quoted run (`bash -c "rm -rf /"`,
# `echo "$(rm -rf /)"`), still hands the whole statement to the walk. See
# rm_scan_scope below for the rule and its accepted residual.
#
# Known accepted false-positive class: this is a text scan, not a shell engine,
# so display commands quoting a destructive string (`echo "docs about rm -rf /"`)
# can match — including one whose target sits in the SAME quoted run as the
# prose, which the #3106 scoping deliberately does not reach. Upstream exempts those via an engine-only DISPLAY_COMMANDS list a
# grep hook cannot replicate. The same text-scan limit means the rm guard treats
# a substitution-wrapped catastrophic delete as verdict-neutral (issue #1982): an
# executable `echo "$(rm -rf /)"` is blocked, but so are inert twins the shell
# would never expand — a single-quoted `echo '$(rm -rf /)'` or an escaped
# `echo "\$(rm -rf /)"` — because the scan has no quote-context awareness. That
# over-block stays inside this accepted class. Workaround: quote-break the string
# or use the gh-writer heredoc form, whose payload is stripped before the guards
# run — spelled with a QUOTE-PAIR delimiter (`<<'EOF'`). That exact spelling is
# what the SAFE path recognises; `<<"EOF"` and `<<\EOF` do not reach it, and
# since #1993 a `gh … <<\EOF` writer fails closed instead (see parse_marker).
#
# Known accepted BYPASS class (the symmetric error direction, issue #1993): the
# heredoc classifier in parity-safety-net-heredoc.py re-implements bash's
# here-doc lexing in Python, and any divergence from real bash is a shape it
# mis-classifies. Five rounds on #1958 and three more on #1993 (R5a swallowed
# terminator, R5b body-apostrophe quote-state poisoning, R5c backslash-quoted
# delimiter) established that enumerating those divergences is an open-ended
# arms race, so the class is CLOSED as accepted rather than chased further. This
# is survivable because of where a mis-classification lands: ONLY the narrow
# gh-writer SAFE path strips payload text, and every other classifier exit hands
# the RAW command to the guards below. A missed here-doc therefore degrades to
# the content guards; it does not bypass them. Since #1982 taught those guards to
# see through substitution wrappers, every destructive class this net exists to
# stop is blocked on the raw text regardless of how the here-doc was read. The
# net catches ACCIDENTAL catastrophic commands; it is not a wall against an
# adversary who knows bash's lexer, and it was never the only thing standing
# between an agent and arbitrary execution.
#
# Operators extend the built-in rules with a project-local rule file — one
# extended-regex (ERE) per line, blank lines and `#` comments ignored — managed
# by the parity-safety-net-rules skill. Default location (overridable via
# SAFETY_NET_RULES_FILE):
#   ${CLAUDE_PROJECT_DIR:-$PWD}/.claude/safety-net-rules.txt
set -euo pipefail

# Fail CLOSED on any unexpected error (malformed JSON, missing jq, …): exit 2 so
# the tool call is denied instead of surfacing a non-blocking hook warning.
# Deliberately NOT `set -E`: errtrace would propagate this trap into command
# substitutions (e.g. the heredoc parser call, whose non-zero exit codes are
# meaningful protocol) and rewrite their status to 2 before it can be read.
trap 'printf "%s\n" "Blocked by safety-net: hook failed while parsing its input; denying fail-closed." >&2; exit 2' ERR

input="$(cat)"

tool_name="$(printf '%s' "$input" | jq -r '.tool_name // empty')"
if [ "$tool_name" != "Bash" ]; then
  exit 0
fi

command_str="$(printf '%s' "$input" | jq -r '.tool_input.command // empty')"
if [ -z "$command_str" ]; then
  exit 0
fi

# block() prints the reason to stderr (surfaced to the model) and exits 2 so the
# Bash tool call is denied. $1 = human-readable reason for the block.
block() {
  cat >&2 <<EOF
Blocked by safety-net: $1

This command matched a destructive-operation guard. If it is genuinely safe and
intentional, ask the user to confirm, then run it manually outside the agent, or
narrow the command so it no longer matches the guard.
EOF
  exit 2
}

# Heredoc payloads are data only for a deliberately narrow set of GitHub CLI
# write commands. A companion parser proves that shape before removing payload
# text from the destructive-command scans below. Unknown executable heredocs
# remain visible to every built-in and custom rule. Ambiguous or malformed
# heredocs fail closed instead of guessing which text the shell would execute.
#
# block_heredoc() teaches the remediation the moment the wall is hit: a bare
# denial strands the agent with no path forward (gardener #1789). The remedy
# depends on the command shape (issue #1958): `git commit -m "$(cat <<EOF …)"`
# attempts get the commit -F text; every other heredoc denial gets the
# file-based execution guidance instead — the commit text is misleading there.
# The git-commit detection inlines the GIT_GLOBAL_OPTS shape (defined later in
# this file, after the heredoc dispatch runs) so `git -C <path> commit` and
# `git -c k=v commit` spellings are still recognized.
block_heredoc() {
  if printf '%s' "$command_str" \
    | grep -Eq -- '(^|[^[:alnum:]_-])git[[:space:]]+(-[^;&|[:space:]]+([[:space:]]+[^-;&|[:space:]][^;&|[:space:]]*)?[[:space:]]+)*commit([^[:alnum:]_-]|$)'; then
    block "$1
Heredoc commit invocations are blocked (the payload is executable shell).
Fix: write the commit message to a file and run \`git commit -F <file>\`.
Every commit must also carry a Co-authored-by trailer for a supported agent
(Claude/Codex/OpenCode) — the commit-msg hook enforces this."
  fi
  block "$1
Heredoc payloads are blocked here (the payload is executable shell).
Fix: write the payload to a file with the Write tool, then execute that file
directly (for example \`python3 <file>\` or \`bash <file>\`)."
}

command_for_guards="$command_str"
case "$command_str" in
  *'<<'*)
    hook_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    heredoc_parser="$hook_dir/parity-safety-net-heredoc.py"
    if ! command -v python3 >/dev/null 2>&1 || [ ! -r "$heredoc_parser" ]; then
      block_heredoc "cannot safely classify heredoc command because its parser runtime is unavailable"
    fi
    if ! printf '%s\n' "$command_str" | /bin/bash -n >/dev/null 2>&1; then
      block_heredoc "malformed heredoc command failed shell syntax validation"
    fi

    parser_status=0
    if parser_output="$(printf '%s' "$command_str" | python3 "$heredoc_parser" 2>/dev/null)"; then
      parser_status=0
    else
      parser_status=$?
    fi

    case "$parser_status" in
      0) command_for_guards="$parser_output" ;;
      10) command_for_guards="$command_str" ;;
      20) block_heredoc "malformed or ambiguous heredoc command cannot be safely classified" ;;
      *) block_heredoc "heredoc parser failed; command was denied fail-closed" ;;
    esac
    ;;
esac

# Normalize bash line-continuations (a trailing backslash + newline → space)
# before segmenting the command. Without this, "git push --force origin
# \<newline>main" splits into a segment matching --force but not `main`, letting a
# protected force-push slip past. Uses awk (POSIX) instead of a GNU-only
# `sed ':a;N;$!ba;…'`, which errors on BSD sed (macOS) and there silently no-ops.
normalized_command_str="$(printf '%s' "$command_for_guards" \
  | awk '{ if (sub(/\\$/, "")) printf "%s ", $0; else print }')"

# matches / matches_cs run an ERE against the guarded command text. matches is
# case-insensitive (the default for these guards); matches_cs is case-SENSITIVE
# for guards where flag case is meaningful (`git branch -d` vs `-D`).
#
# Both read the NORMALIZED text. They used to read $command_for_guards, so only
# the two segment-walking guards (rm, git push) were protected against line
# continuations and every guard expressed through these helpers could be evaded
# by breaking the command across lines:
#
#     git reset --hard \
#       origin/main
#
# The patterns match on intermediate whitespace, and an embedded "\<newline>" is
# not whitespace to grep -E, so the anchor failed to span the break. Defined
# after the normalization above so the value exists when these are first called.
matches() {
  printf '%s' "$normalized_command_str" | grep -Eiq -- "$1"
}
matches_cs() {
  printf '%s' "$normalized_command_str" | grep -Eq -- "$1"
}

# Shared ERE fragments. GIT_TOKENS walks over intermediate argv tokens without
# crossing a statement separator, so a flag in a LATER statement can never be
# attributed to an earlier git subcommand.
readonly GIT_TOKENS='([[:space:]]+[^;&|[:space:]]+)*[[:space:]]+'
# Git GLOBAL options (`-C <path>`, `-c <k>=<v>`, `--git-dir[=…]`, `--no-pager`,
# …) legally sit between `git` and its subcommand, so every subcommand guard
# consumes them — otherwise `git -C /path checkout -- f` dodges the anchor
# (issue #1960 security review F1). Shape: zero or more dash-led tokens, each
# optionally followed by ONE non-dash value token, which covers both the
# `--git-dir=/x` and `--git-dir /x` spellings without naming every option.
readonly GIT_GLOBAL_OPTS='(-[^;&|[:space:]]+([[:space:]]+[^-;&|[:space:]][^;&|[:space:]]*)?[[:space:]]+)*'
# Anchor for every git subcommand guard: word-bounded `git`, whitespace, then
# any run of global options. Callers append the subcommand name directly.
readonly GIT_CMD='(^|[^[:alnum:]_-])git[[:space:]]+'"$GIT_GLOBAL_OPTS"
# An rm invocation: bare `rm` or a path whose basename is exactly `rm`
# (`/bin/rm`, `./rm`) — issue #1960 security review F2. The optional prefix must
# END IN `/` immediately before `rm`, so charm/confirm/informant/rmdir never
# match. The preceding-char class still excludes `.`, `/`, and `-` to keep
# `--rm`-style flags and `foo.rm` names out.
readonly RM_CMD='(^|[^[:alnum:]_./-])([[:alnum:]_./-]*/)?rm'
# rm invoked with BOTH a recursive and a force flag — clustered (-rf/-fr, any
# extra letters) or split, in either order. The split gate pairs ANY recursive
# form (short cluster containing r, or --recursive) with ANY force form (short
# cluster containing f, or --force), so mixed spellings like `rm -r --force /`
# and `rm --recursive -f /` cannot slip between the short/short and long/long
# alternations (PR #1976 review).
readonly RM_RF_CLUSTER="$RM_CMD"'([[:space:]]+-[[:alnum:]-]+)*[[:space:]]+(-[[:alnum:]]*r[[:alnum:]]*f|-[[:alnum:]]*f[[:alnum:]]*r)([[:space:]]|$)'
readonly RM_RF_SPLIT="$RM_CMD"'(([[:space:]][^;&|]*)?[[:space:]](-[[:alnum:]]*r[[:alnum:]]*|--recursive)([[:space:]][^;&|]*)?[[:space:]](-[[:alnum:]]*f[[:alnum:]]*|--force)([[:space:]]|$)|([[:space:]][^;&|]*)?[[:space:]](-[[:alnum:]]*f[[:alnum:]]*|--force)([[:space:]][^;&|]*)?[[:space:]](-[[:alnum:]]*r[[:alnum:]]*|--recursive)([[:space:]]|$))'

# 1. Recursive forced delete (`rm -rf`) of a filesystem root, home, or top-level
#    wildcard. Two gates ANDed: the statement must invoke `rm` with BOTH a
#    recursive and a force flag, AND name a catastrophic target. Splitting the
#    flag check from the target check keeps each regex legible and testable.
#    The target boundary classes include quote characters (issue #1960): without
#    them, `bash -c "rm -rf /"` and interpreter one-liners like
#    `python -c "… os.system('rm -rf /')"` slip through because the target is
#    quote-adjacent instead of space-bounded.
#    Both gates run PER STATEMENT inside the shared rm loop below (quality
#    review S1): a harmless `/` in a LATER statement (`rm -rf build && cd /`)
#    is never attributed to the rm in an earlier one.
qc="'\""
# Path/home targets also accept the command-substitution closers `)` and backtick
# as a trailing boundary (issue #1982): in `echo "$(rm -rf /)"` the target `/` is
# followed by `)`, not a space or quote, so without them an executable
# substitution-wrapped `rm -rf <root>` slips past this gate. Leading boundary is
# unchanged — the target is always space-separated from the recursive+force flag.
tc="'\"\`)"
# The bare-`*` wildcard deliberately KEEPS the narrow (space/quote/end) boundary:
# admitting `)` there would misread a shell `case … in *)` default arm as a
# catastrophic `rm -rf *` (T4b F1). A genuinely substitution-wrapped bare `*`
# (`echo "$(rm -rf *)"`) is instead caught by the token-walk (guard 1b) below.
readonly RM_CATASTROPHIC_TARGET='([[:space:]='"$qc"'])((/|/\*|/\.\*?|~|~/\*?|\$HOME\b|\$\{HOME\})([[:space:]'"$tc"']|/?\*?['"$tc"']?$)|\*([[:space:]'"$qc"']|/?\*?['"$qc"']?$))'

# 1b. rm target hardening (issue #1960). For every statement that invokes rm
#     with recursive+force flags, additionally block when:
#       - cwd is $HOME (any target is one argument away from wiping home), or
#       - the target is the cwd itself (`.` / `./`), or
#       - the target traverses out via `..`, or
#       - the target is home-anchored (`~/…` — the shell expands it to $HOME at
#         execution time, so it is always outside the project), or
#       - the target is an absolute path outside the project — with an allowance
#         for /tmp, /var/tmp, and $TMPDIR — or
#       - the target is a `$VAR` expansion other than the sanctioned $TMPDIR.
#     Globbing is disabled around the token walk so a literal `*` in the command
#     is never expanded against the hook's own cwd.
project_dir="${CLAUDE_PROJECT_DIR:-$PWD}"
tmp_dir_allow="${TMPDIR:-/tmp}"
tmp_dir_allow="${tmp_dir_allow%/}"
[ -n "$tmp_dir_allow" ] || tmp_dir_allow="/tmp"
# Physical (symlink-resolved) spelling of an allowed root — issue #3106 arm B.
# The allowance below is a set of LITERAL string prefixes, so on macOS, where
# /tmp is a symlink to /private/tmp, one directory had two spellings and only
# one of them was allowed: `rm -rf /tmp/x` passed while `rm -rf /private/tmp/x`
# — the SAME directory, and the spelling an agent's own scratchpad path is
# handed to it in — was refused as "outside the project". Two opposite verdicts
# for one location is a defect regardless of which verdict is right.
#
# This widens no LOCATION. It adds the second name of a location the guard has
# always allowed, computed from the filesystem rather than hardcoded, so a
# platform where /tmp is not a symlink gains nothing. Falls back to the logical
# path when the directory does not exist or resolves to `/`, so the allowance
# can never become an empty or root-anchored prefix (an empty prefix would make
# `""/*` match every absolute path).
phys_dir() {
  local logical="$1" real=""
  real="$(cd -- "$logical" 2>/dev/null && pwd -P)" || real=""
  case "$real" in
    "" | /) printf '%s' "$logical" ;;
    *) printf '%s' "$real" ;;
  esac
}
project_dir_phys="$(phys_dir "$project_dir")"
tmp_phys="$(phys_dir /tmp)"
var_tmp_phys="$(phys_dir /var/tmp)"
tmp_dir_allow_phys="$(phys_dir "$tmp_dir_allow")"
[ -n "$project_dir_phys" ] || project_dir_phys="$project_dir"
[ -n "$tmp_phys" ] || tmp_phys="/tmp"
[ -n "$var_tmp_phys" ] || var_tmp_phys="/var/tmp"
[ -n "$tmp_dir_allow_phys" ] || tmp_dir_allow_phys="$tmp_dir_allow"
# Peel command-substitution wrappers off a token so an rm nested in `$(…)`,
# backticks, `<(…)`/`>(…)`, a `"…"`/`'…'` quote, or a leading `\` alias-bypass
# (`\rm`) is recognized and its target classified as if the token were unwrapped
# (issue #1982) — substitution-wrapping is verdict-neutral for the rm guard.
# Leading wrappers (\ $( ` ( <( >( and quotes) and trailing closers () ` and
# quotes) are stripped in runs, so `"$(\rm` → `rm` and `/etc)"` → `/etc`. `$((`
# is ARITHMETIC, never command substitution: the LEADING peel stops at it (its
# case is ordered first), so the inner expression is never exposed as a command
# or a target. The trailing loop may still trim a closing `))`, but that is
# harmless — an arithmetic token like `$((10/2))` still keeps its `$` for the
# variable-target guard and can never be mis-normalized into an rm or a `/`-target.
strip_subst_wrappers() {
  local t="$1" prev=""
  while [ "$t" != "$prev" ]; do
    prev="$t"
    case "$t" in
      '$(('*) break ;;
      '\'*) t="${t#\\}" ;;
      '$('*) t="${t#'$('}" ;;
      '<('*) t="${t#'<('}" ;;
      '>('*) t="${t#'>('}" ;;
      '"'*) t="${t#'"'}" ;;
      "'"*) t="${t#\'}" ;;
      '`'*) t="${t#'`'}" ;;
      '('*) t="${t#(}" ;;
    esac
  done
  prev=""
  while [ "$t" != "$prev" ]; do
    prev="$t"
    case "$t" in
      *')') t="${t%)}" ;;
      *'`') t="${t%'`'}" ;;
      *'"') t="${t%'"'}" ;;
      *"'") t="${t%\'}" ;;
    esac
  done
  printf '%s' "$t"
}
# Decide which text of an rm statement the TARGET WALK may read — issue #3106
# arm A. The statement selector matches the RAW command text, so a recursive
# delete quoted as PROSE inside a string argument selects the line, and every
# remaining token on it is then classified as a deletion target. Three
# independent sightings in one day, all of them commands that delete nothing:
# a `printf` reduction, a `gh issue create --title …` filing the report about
# this guard, and a commit message describing it. Each was refused for a
# variable in a LATER, unrelated argument.
#
# The rule is structural, with no allowlist of "display commands":
#   - an rm invocation OUTSIDE any quote is real; the walk reads the whole
#     statement, exactly as before (`rm -rf "$HOME"` keeps its target),
#   - an rm at the START of its quoted run is an invocation the quote merely
#     wraps (`bash -c "rm -rf /"`, `echo "$(rm -rf /)"`); the walk reads the
#     whole statement, exactly as before,
#   - an rm preceded by other words INSIDE its quoted run is prose; the walk is
#     scoped to that run, so the rm's own quoted arguments are still classified
#     in full while a variable in a later argument is no longer read as a
#     deletion target.
#
# Failure directions all point at blocking: an unterminated quote, an
# over-long statement, or any run the scan cannot place falls back to the whole
# statement. Residual (accepted, documented): `eval "prose rm -rf" "$X"` would
# concatenate its words at run time and is scoped to the first run here.
rm_scan_scope() {
  local stmt="$1"
  local n=${#stmt}
  # Long statements fall back to the full walk rather than pay a char scan.
  if [ "$n" -gt 4000 ]; then
    printf '%s' "$stmt"
    return
  fi
  local i=0 ch q="" esc=0 outside="" cur_run="" rm_runs="" found=0
  local run_leading=0
  while [ "$i" -lt "$n" ]; do
    ch="${stmt:i:1}"
    i=$((i + 1))
    if [ "$esc" -eq 1 ]; then
      esc=0
      if [ -n "$q" ]; then cur_run="$cur_run$ch"; else outside="$outside$ch"; fi
      continue
    fi
    if [ "$ch" = '\' ] && [ "$q" != "'" ]; then
      esc=1
      continue
    fi
    if [ -n "$q" ]; then
      if [ "$ch" = "$q" ]; then
        case "$cur_run" in
          *[Rr][Mm]*)
            if printf '%s' "$cur_run" | grep -Eiq -- "$RM_CMD"'([[:space:]]|$)'; then
              found=$((found + 1))
              if [ -n "$rm_runs" ]; then rm_runs="$rm_runs"$'\n'; fi
              rm_runs="$rm_runs$cur_run"
              if printf '%s' "$cur_run" \
                | grep -Eiq -- '^[[:space:]]*(\\|\$\(|`|\(|<\(|>\()*[[:space:]]*([[:alnum:]_./-]*/)?rm([[:space:]]|$)'; then
                run_leading=1
              fi
            fi
            ;;
        esac
        q=""
        cur_run=""
      else
        cur_run="$cur_run$ch"
      fi
      continue
    fi
    case "$ch" in
      '"' | "'")
        q="$ch"
        cur_run=""
        ;;
      *) outside="$outside$ch" ;;
    esac
  done
  # An unterminated quote is text the scan cannot place: treat it as unquoted so
  # the fallback below hands back the whole statement.
  [ -z "$q" ] || outside="$outside$cur_run"
  if printf '%s' "$outside" | grep -Eiq -- "$RM_CMD"'([[:space:]]|$)'; then
    printf '%s' "$stmt"
    return
  fi
  if [ "$found" -eq 0 ]; then
    printf '%s' "$stmt"
    return
  fi
  # `rm` first in ANY run (modulo whitespace and substitution/alias openers) is
  # an invocation, not prose. Inspect every run before deciding: returning on
  # the first prose run used to hide a real delete in a later quoted run.
  if [ "$run_leading" -eq 1 ]; then
    printf '%s' "$stmt"
    return
  fi
  printf '%s' "$rm_runs"
}
# Look up the ONE unambiguous assignment of NAME inside the command being
# classified — issue #3106 arm B, the variable half.
#
# Prints the recorded right-hand side, or fails when the name is not assigned
# before the first rm token or is assigned more than one distinct value there.
# A later write cannot affect an earlier delete, and a quoted assignment-like
# argument can be prose, so neither is considered. Only assignments literally
# present in this command are ever trusted; nothing is expanded from the hook's
# own environment.
rm_assignment_stmt=""
rm_assignment_value() {
  local name="$1"
  case "$name" in
    "" | *[!A-Za-z0-9_]*) return 1 ;;
  esac
  # Only assignments that occur before this statement's rm token can influence
  # its delete safely. A later assignment is too late at runtime, and an
  # assignment whose NAME begins inside a quoted argument can be prose. The
  # small lexer below preserves quoted right-hand sides such as V="/tmp/x"
  # while excluding an argument such as echo "V=/tmp/x". Any ambiguity fails
  # closed.
  RM_ASSIGNMENT_NAME="$name" RM_ASSIGNMENT_COMMAND="$normalized_command_str" \
    RM_ASSIGNMENT_STATEMENT="$rm_assignment_stmt" \
    python3 - <<'PY'
import os
import re
import sys

name = os.environ.get("RM_ASSIGNMENT_NAME", "")
command = os.environ.get("RM_ASSIGNMENT_COMMAND", "")
statement = os.environ.get("RM_ASSIGNMENT_STATEMENT", "")
if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", name):
    sys.exit(1)

rm_pattern = re.compile(
    r"(?i)(?<![A-Za-z0-9_./-])(?:[A-Za-z0-9_./-]*/)?rm(?=$|[\s;&|()'\"`])",
)
rm_token = rm_pattern.search(statement)
if rm_token is None or not statement or command.count(statement) != 1:
    sys.exit(1)
statement_start = command.find(statement)
if statement_start < 0:
    sys.exit(1)
prefix = command[: statement_start + rm_token.start()]

tokens = []
buffer = []
quote = None
escaped = False
started = False
started_unquoted = False

def flush():
    global buffer, started, started_unquoted
    if started:
        tokens.append(("".join(buffer), started_unquoted))
    buffer = []
    started = False
    started_unquoted = False

for char in prefix:
    if escaped:
        buffer.append(char)
        escaped = False
        continue
    if quote is not None:
        if char == quote:
            quote = None
        elif char == "\\" and quote == '"':
            escaped = True
        else:
            buffer.append(char)
        continue
    if char in "'\"":
        if not started:
            started = True
            started_unquoted = False
        quote = char
    elif char == "\\":
        if not started:
            started = True
            started_unquoted = True
        escaped = True
    elif char.isspace() or char in ";&|()":
        flush()
    else:
        if not started:
            started = True
            started_unquoted = True
        buffer.append(char)
flush()

needle = f"{name}="
hits = [token[len(needle):] for token, outside in tokens
        if outside and token.startswith(needle)]
distinct = set(hits)
if len(distinct) != 1:
    sys.exit(1)
value = hits[0]
if not value:
    sys.exit(1)
sys.stdout.write(value)
PY
}
# Rewrite a leading `$NAME` / `${NAME}` in a deletion target to the value the
# command itself assigns it, so the target is classified as if the agent had
# written that value literally — issue #3106 arm B.
#
# The guard's standing reason for refusing variable targets is that "unset or
# mistyped variables can point anywhere", and that reason survives intact: a
# name with no in-command assignment, an ambiguous one, or a value that is
# itself a command substitution never resolves and stays refused. What changes
# is only that a target the agent could have spelled literally is no longer
# refused for being spelled through a variable.
resolve_var_prefix() {
  local token="$1" name="" rest="" value=""
  case "$token" in
    '${'*'}'*)
      name="${token#'${'}"
      name="${name%%\}*}"
      rest="${token#'${'"$name"'}'}"
      ;;
    '$'*)
      rest="${token#'$'}"
      name="${rest%%[!A-Za-z0-9_]*}"
      rest="${rest#"$name"}"
      ;;
    *) return 1 ;;
  esac
  [ -n "$name" ] || return 1
  value="$(rm_assignment_value "$name")" || return 1
  # A value that is itself a command substitution names no location the guard
  # can read, so it never resolves — the refusal stands. `$(…)` already fails
  # below (its leading `$` yields no variable name); backticks are named here so
  # both spellings of substitution behave the same way.
  case "$value" in
    *'`'*) return 1 ;;
  esac
  case "$value" in
    '"'*'"')
      value="${value#\"}"
      value="${value%\"}"
      ;;
    "'"*"'")
      value="${value#\'}"
      value="${value%\'}"
      ;;
  esac
  [ -n "$value" ] || return 1
  printf '%s%s' "$value" "$rest"
}
# Classify ONE deletion target. Extracted from the token walk so a variable
# target can be re-classified through every arm after resolution (#3106),
# instead of the variable arm being a terminal verdict of its own.
classify_rm_target() {
  local token="$1" depth="${2:-0}" resolved=""
  case "$token" in
    -*) return 0 ;;
    . | ./)
      set +f
      block "recursive forced delete of the current directory (rm -rf .)"
      ;;
    .. | ../* | */.. | */../*)
      set +f
      block "recursive forced delete of a path outside the project (.. traversal)"
      ;;
    '~' | '~'/*)
      set +f
      block "recursive forced delete of a home-anchored path (~/…) outside the project"
      ;;
    /*)
      case "$token" in
        "$project_dir" | "$project_dir"/* | "$project_dir_phys" | "$project_dir_phys"/* \
          | /tmp | /tmp/* | "$tmp_phys" | "$tmp_phys"/* \
          | /var/tmp | /var/tmp/* | "$var_tmp_phys" | "$var_tmp_phys"/* \
          | "$tmp_dir_allow" | "$tmp_dir_allow"/* | "$tmp_dir_allow_phys" | "$tmp_dir_allow_phys"/*) : ;;
        *)
          set +f
          block "recursive forced delete of an absolute path outside the project (only the project, /tmp, /var/tmp, and \$TMPDIR are allowed)"
          ;;
      esac
      ;;
    '*')
      # Bare top-level wildcard expands to every entry in the cwd. Guard 1a no
      # longer bounds `*)` (T4b F1), so a substitution-wrapped `rm -rf *` is
      # caught here after the trailing-closer strip peels `*)"` down to `*`.
      set +f
      block "recursive forced delete of a top-level wildcard (rm -rf *)"
      ;;
    *'$'*)
      case "$token" in
        '$TMPDIR' | '$TMPDIR'/* | '${TMPDIR}' | '${TMPDIR}'/*) : ;;
        *)
          if [ "$depth" -lt 4 ] \
            && resolved="$(resolve_var_prefix "$token")" \
            && [ -n "$resolved" ] \
            && [ "$resolved" != "$token" ]; then
            classify_rm_target "$resolved" $((depth + 1))
          else
            set +f
            block "recursive forced delete of a variable-expanded target (unset or mistyped variables can point anywhere; \$TMPDIR is the only sanctioned dynamic target)"
          fi
          ;;
      esac
      ;;
  esac
  return 0
}
while IFS= read -r rm_stmt; do
  if ! printf '%s' "$rm_stmt" | grep -Eiq -- "$RM_RF_CLUSTER" \
    && ! printf '%s' "$rm_stmt" | grep -Eiq -- "$RM_RF_SPLIT"; then
    continue
  fi
  # Guard 1: catastrophic target named in the SAME statement as the rm -rf.
  if printf '%s' "$rm_stmt" | grep -Eq -- "$RM_CATASTROPHIC_TARGET"; then
    block "recursive forced delete of a root, home, or wildcard path (rm -rf)"
  fi
  # Physical-path comparison (pwd -P): on macOS $HOME or the cwd may arrive via
  # a symlink (/var → /private/var), and a string compare would miss the match.
  if [ -n "${HOME:-}" ] \
    && [ "$(pwd -P)" = "$(cd -- "$HOME" 2>/dev/null && pwd -P)" ]; then
    block "recursive forced delete while the working directory is \$HOME (cd into a project first)"
  fi
  # Scope the walk to the quoting region that actually contains the rm (#3106
  # arm A). Unquoted and run-leading invocations get the whole statement back,
  # so this is a no-op for every real delete.
  rm_assignment_stmt="$rm_stmt"
  rm_walk_text="$(rm_scan_scope "$rm_stmt")"
  while IFS= read -r rm_scope; do
    set -f
    seen_rm=0
    for raw_token in $rm_scope; do
      token="$(strip_subst_wrappers "$raw_token")"
      if [ "$seen_rm" -eq 0 ]; then
        # Path-prefixed spellings (`/bin/rm`, `./rm`) are still rm (F2).
        case "$token" in
          rm | */rm) seen_rm=1 ;;
        esac
        continue
      fi
      classify_rm_target "$token"
    done
    set +f
  done <<< "$rm_walk_text"
done < <(printf '%s' "$normalized_command_str" | tr '&|;' '\n' \
  | grep -Ei -- "$RM_CMD"'([[:space:]]|$)' || true)

# 2. Force-pushing a protected branch. `--force-with-lease` is the safe,
#    non-clobbering alternative and is intentionally NOT blocked. Deliberate
#    divergence from upstream (which blocks force-push on ANY branch):
#    feature-branch force-push is a sanctioned rebase-and-push agent workflow.
#
#    The force flag AND the protected-branch name must appear in the SAME
#    `git push` statement. Checking them independently over the whole command is
#    a false-positive magnet: an unrelated `-f` (a `[ -f file ]` test, `rm -f`,
#    `grep -f`, `tail -f`) plus an unrelated protected name (`--base main`,
#    `origin/main`, `git fetch origin main`) alongside any feature-branch
#    `git push` would wrongly block. So split the command into statements
#    (`;`, `&&`, `||`, `|`, newlines), keep only the `git push` segments, and
#    inspect each in isolation — a real `git push --force origin main` still
#    matches, while a feature-branch push next to `[ -f ]`/`--base main` passes.
while IFS= read -r push_stmt; do
  if printf '%s' "$push_stmt" \
    | grep -Eiq '(--force([[:space:]]|=|$)|[[:space:]]-f([[:space:]]|$))' \
    && ! printf '%s' "$push_stmt" | grep -Eiq -- '--force-with-lease' \
    && printf '%s' "$push_stmt" \
    | grep -Eiq '(^|[^[:alnum:]_/-])(main|master|production|prod|release)([^[:alnum:]_/-]|$)'; then
    block "force-pushing a protected branch (use --force-with-lease, or push a feature branch)"
  fi
done < <(printf '%s' "$normalized_command_str" | tr '&|;' '\n' \
  | grep -Ei -- "${GIT_CMD}push\b" || true)

# 3. `git reset --hard` / `git reset --merge` while the working tree has
#    uncommitted changes — both silently discard them. Only blocks when the tree
#    is actually dirty, so a clean-tree reset (a legitimate workflow) passes.
#    Deliberate divergence from upstream's unconditional block; the accepted
#    residual risk (dirty check runs at hook time in the hook's cwd) is
#    documented in the header.
if matches "${GIT_CMD}"'reset\b.*--(hard|merge)\b'; then
  if git rev-parse --is-inside-work-tree >/dev/null 2>&1 \
    && [ -n "$(git status --porcelain 2>/dev/null)" ]; then
    block "git reset --hard/--merge on a dirty working tree would discard uncommitted changes (stash or commit first)"
  fi
fi

# 3b. `git rebase --abort` / `--quit` ONLY while human/agent conflict
#     resolutions exist (issue #1956). `--abort` restores the pre-rebase branch
#     and discards every resolution; `--quit` deletes the rebase bookkeeping
#     (head-name, todo) while stranding a detached HEAD, making recovery
#     ambiguous — both are treated the same, conditionally. A rebase state with
#     nothing human-made in it (a clean-pick wedge, or a conflict stop nobody
#     has touched) is agent-recoverable, so aborting it stays ALLOWED.
#     Discriminator (empirical, git 2.53): diff the worktree/index against the
#     AUTO_MERGE ref (the merge-ort recorded conflicted tree). Abort-safe ⇔
#     worktree diff is quiet AND (the cached diff is quiet OR unmerged index
#     entries exist — an untouched conflict stop has unmerged entries that make
#     the cached diff non-quiet without any human edit). Fail CLOSED on the
#     rebase-apply backend (no AUTO_MERGE contract) and on a missing AUTO_MERGE
#     ref while rebase-merge state exists. Same accepted residual risk as
#     guard 3: the probes run in the hook's cwd at hook time.
if matches "${GIT_CMD}"'rebase'"${GIT_TOKENS}"'--(abort|quit)([[:space:]]|$)'; then
  rebase_apply_dir="$(git rev-parse --git-path rebase-apply 2>/dev/null || true)"
  rebase_merge_dir="$(git rev-parse --git-path rebase-merge 2>/dev/null || true)"
  if [ -n "$rebase_apply_dir" ] && [ -d "$rebase_apply_dir" ]; then
    block "git rebase --abort/--quit on an apply-backend rebase cannot prove no conflict resolutions would be lost (fail closed; finish or continue the rebase instead)"
  fi
  if [ -n "$rebase_merge_dir" ] && [ -d "$rebase_merge_dir" ]; then
    if ! git rev-parse -q --verify AUTO_MERGE >/dev/null 2>&1; then
      block "git rebase --abort/--quit with an unresolvable AUTO_MERGE ref cannot prove no conflict resolutions would be lost (fail closed)"
    fi
    if ! git diff --quiet AUTO_MERGE 2>/dev/null; then
      block "git rebase --abort/--quit would discard conflict resolutions in the working tree (finish resolving and run git rebase --continue instead)"
    fi
    unmerged_entries="$(git ls-files -u 2>/dev/null || true)"
    if [ -z "$unmerged_entries" ] \
      && ! git diff --cached --quiet AUTO_MERGE 2>/dev/null; then
      block "git rebase --abort/--quit would discard staged conflict resolutions (finish resolving and run git rebase --continue instead)"
    fi
  fi
fi

# 4. `git checkout` worktree discards: the `--` pathspec form (with or without a
#    ref), `-f/--force`, `--pathspec-from-file`, and bare `git checkout .`.
#    Blocking bare `.` exceeds upstream (which allows any single positional) —
#    issue #1960 names it explicitly: it discards the entire tree. Branch
#    switches and creation (`-b`/`-B`) stay allowed.
readonly GIT_CHECKOUT="${GIT_CMD}checkout"
if matches "${GIT_CHECKOUT}${GIT_TOKENS}"'--([[:space:]]|$)' \
  || matches "${GIT_CHECKOUT}${GIT_TOKENS}"'(-[[:alnum:]]*f[[:alnum:]]*|--force)([[:space:]]|=|$)' \
  || matches "${GIT_CHECKOUT}"'[[:space:]][^;&|]*--pathspec-from-file' \
  || matches "${GIT_CHECKOUT}"'[[:space:]]+\.(/)?([[:space:]]|$)'; then
  block "git checkout discarding local changes (--, -f/--force, --pathspec-from-file, or bare .) — use git stash to preserve work first"
fi

# 5. `git switch` discards: `--discard-changes` and its `-f/--force` aliases.
if matches "${GIT_CMD}switch${GIT_TOKENS}"'(--discard-changes|--force|-f)([[:space:]]|=|$)'; then
  block "git switch discarding local changes (--discard-changes/-f/--force)"
fi

# 6. `git restore` defaults to overwriting the WORKTREE — a silent discard. Only
#    the pure staging-area form is safe: `--staged` present and `--worktree`
#    absent. Two conditions, because an ERE has no lookahead: `--staged
#    --worktree` still discards, so `--worktree` blocks regardless of `--staged`.
if matches "${GIT_CMD}"'restore([[:space:]]|$)'; then
  if matches "${GIT_CMD}"'restore[^;&|]*--worktree' \
    || ! matches "${GIT_CMD}"'restore[^;&|]*--staged'; then
    block "git restore overwriting worktree files (only 'git restore --staged <path>' without --worktree is allowed)"
  fi
fi

# 7. `git stash drop` / `git stash clear` destroy stashed work. push/pop/list/
#    apply — the safe alternatives the reset guard recommends — stay allowed.
if matches "${GIT_CMD}"'stash[[:space:]]+(drop|clear)([[:space:]]|$)'; then
  block "git stash drop/clear destroys stashed work"
fi

# 8. `git clean` with a force flag wipes untracked files. A dry-run flag
#    (`-n`/`--dry-run`) ANYWHERE wins — git itself performs no deletion under
#    dry-run, so `git clean -fdn` is a safe preview.
readonly GIT_CLEAN="${GIT_CMD}clean"
if matches "${GIT_CLEAN}${GIT_TOKENS}"'(-[[:alnum:]]*f[[:alnum:]]*|--force)([[:space:]]|=|$)' \
  && ! matches "${GIT_CLEAN}${GIT_TOKENS}"'(-[[:alnum:]]*n[[:alnum:]]*|--dry-run)([[:space:]]|=|$)'; then
  block "git clean --force deletes untracked files (preview with git clean -n first)"
fi

# 9. `git branch` force-delete loses unmerged commits: `-D`, `-d` combined with
#    `-f` (clustered or split), or `--delete` + `--force`. Case-SENSITIVE so the
#    safe `-d` (which refuses unmerged work) and rename `-m` stay allowed.
readonly GIT_BRANCH="${GIT_CMD}branch"
if matches_cs "${GIT_BRANCH}${GIT_TOKENS}"'-[[:alnum:]]*D[[:alnum:]]*([[:space:]]|$)' \
  || { matches_cs "${GIT_BRANCH}${GIT_TOKENS}"'-[[:alnum:]]*d[[:alnum:]]*([[:space:]]|$)' \
    && matches_cs "${GIT_BRANCH}${GIT_TOKENS}"'-[[:alnum:]]*f[[:alnum:]]*([[:space:]]|$)'; } \
  || { matches "${GIT_BRANCH}"'[^;&|]*--delete' && matches "${GIT_BRANCH}"'[^;&|]*--force'; }; then
  block "git branch force-delete (-D) loses unmerged commits (use -d, which refuses unmerged work)"
fi

# 10. Cheap destructive-ref guards: `git tag -d` (tags are shared refs),
#     `git reflog delete` (erases recovery history), and
#     `git worktree remove --force` (discards a dirty worktree). Tag deletion is
#     case-SENSITIVE so annotated-tag `-a` and message `-m` flags never match.
if matches_cs "${GIT_CMD}tag${GIT_TOKENS}"'(-[[:alnum:]]*d[[:alnum:]]*([[:space:]]|$)|--delete([[:space:]]|=|$))'; then
  block "git tag -d deletes a shared ref"
fi
if matches "${GIT_CMD}"'reflog[[:space:]]+delete([[:space:]]|$)'; then
  block "git reflog delete erases recovery history"
fi
if matches "${GIT_CMD}"'worktree[[:space:]]+remove[^;&|]*(--force([[:space:]]|=|$)|[[:space:]]-[[:alnum:]]*f[[:alnum:]]*([[:space:]]|$))'; then
  block "git worktree remove --force discards a dirty worktree (remove without --force, which refuses dirty trees)"
fi

# 11. Deletion through find/xargs, where the target never appears as a literal
#     argument: `find … -delete`, `find … -exec rm -rf`, and `xargs … rm -rf`
#     (targets arrive from dynamic stdin — unauditable). Plain `rm` (no
#     recursive+force) on find/xargs output stays allowed for normal cleanups.
if matches '(^|[^[:alnum:]_./-])find[[:space:]][^;&|]*[[:space:]]-delete([[:space:]]|$)'; then
  block "find -delete removes files tree-wide (use -print to preview, or an explicit rm on reviewed paths)"
fi
if matches '(^|[^[:alnum:]_./-])find[[:space:]][^;&|]*-exec[[:space:]]+rm[[:space:]]+(-[[:alnum:]]*r[[:alnum:]]*f|-[[:alnum:]]*f[[:alnum:]]*r)([[:space:]]|$)'; then
  block "find -exec rm -rf performs a recursive forced delete on unreviewed paths"
fi
if matches '(^|[^[:alnum:]_./-])xargs[[:space:]]([^;&|]*[[:space:]])?rm[[:space:]]+(-[[:alnum:]]*r[[:alnum:]]*f|-[[:alnum:]]*f[[:alnum:]]*r)([[:space:]]|$)'; then
  block "xargs rm -rf performs a recursive forced delete on dynamic stdin input"
fi

# 12. Disk destroyers, always on (exceeds upstream, which only scans these
#     inside interpreter one-liners): writing to a raw /dev node via dd,
#     formatting a device with mkfs, and shred's unrecoverable overwrite.
#     dd/mkfs against regular files (imaging) stays allowed.
if matches '(^|[^[:alnum:]_./-])dd[[:space:]]+([^;&|]*[[:space:]])?of=/dev/'; then
  block "dd writing to a raw device (of=/dev/…) destroys it"
fi
if matches '(^|[^[:alnum:]_./-])mkfs(\.[[:alnum:]]+)?[[:space:]][^;&|]*/dev/'; then
  block "mkfs formatting a device erases it"
fi
if matches '(^|[^[:alnum:]_./-])shred([[:space:]]|$)'; then
  block "shred overwrites files unrecoverably"
fi

# 13. Dropping or truncating a database / schema / table (Lisa-only guard —
#     upstream has no SQL protection; keep).
if matches '\b(drop[[:space:]]+(database|schema|table)|truncate[[:space:]]+(table[[:space:]]+)?[[:alnum:]_."`]+)\b'; then
  block "destructive SQL (DROP/TRUNCATE) detected"
fi

# 14. The git control plane. A recursive forced delete of `.git` destroys every
# commit, branch and stash that is not already pushed — the one directory whose
# loss is not recoverable from the working tree.
#
# This is not a new principle, it is a hole in one the guard already holds. Rule
# 4 above already refuses `rm -rf "$SOMEDIR"` and paths outside the project;
# `rm -rf .git` was permitted only because nothing named it. Measured before
# this rule existed: `rm -rf .git`, `rm -rf ./.git` and `rm -rf .git/objects`
# were all ALLOWED while the variable-expanded case was correctly blocked.
#
# `.git` must be a whole path component. `.gitignore`, `.gitattributes`,
# `.github/` and a `.git-old` backup are ordinary files a project deletes on
# purpose, and blocking those would be the collision that gets a guard switched
# off. The trailing `([/[:space:]'"$qc"']|$)` is what draws that line.
readonly GIT_CONTROL_PLANE='(^|[[:space:]='"$qc"'./])\.git([/[:space:]'"$qc"']|$)'
if matches_cs "$RM_RF_CLUSTER" || matches_cs "$RM_RF_SPLIT"; then
  if matches_cs "$GIT_CONTROL_PLANE"; then
    block "recursive forced delete of the git control plane (.git holds every commit, branch and stash not already pushed; nothing in the working tree can rebuild it). Delete a specific ignored artifact instead, or re-clone if the checkout is genuinely to be discarded."
  fi
fi

# 15. Credential stores. Reading one into an agent transcript is disclosure even
# when nothing is copied anywhere: the value lands in a log, a context window,
# and whatever retains either.
#
# Scoped deliberately rather than by the obvious pattern. Each clause below is a
# separate judgement about a family where an agent has no legitimate read, and
# each carries the exclusions that keep ordinary work moving — public keys,
# known_hosts, ssh config, and `.env.example` are all still readable, because a
# guard that blocks routine setup is a guard somebody disables.

# The verbs that disclose: read it, duplicate it, or send it. Writing is NOT
# here — `echo FOO=1 > .env` during setup creates a secret rather than leaking
# one, and refusing it would block the very workflow that produces the file.
readonly SECRET_READ_VERB='(^|[^[:alnum:]_./-])([[:alnum:]_./-]*/)?(cat|bat|less|more|head|tail|strings|xxd|od|base64|cp|mv|rsync|scp|sftp|tar|zip|curl|wget|http|nc)([[:space:]]|$)'

# 15a. SSH PRIVATE keys. `id_rsa.pub` and friends are public by construction and
# stay readable; so do `known_hosts`, `config` and `authorized_keys`, which
# agents legitimately inspect when diagnosing a remote.
readonly SSH_PRIVATE_KEY='\.ssh/(id_[[:alnum:]_-]+|[[:alnum:]_.-]*_(rsa|dsa|ecdsa|ed25519))([[:space:]'"$qc"']|$)'
# 15b. Cloud provider credential files.
readonly CLOUD_CREDENTIAL='(\.aws/(credentials|config)|\.config/gcloud/[[:alnum:]_./-]*credentials[[:alnum:]_.-]*|\.azure/(accessTokens|msal_token_cache)[[:alnum:]_.-]*|\.kube/config)([[:space:]'"$qc"']|$)'
# 15c. Coding-agent credential stores — the tokens that impersonate the operator
# to every service their agent can reach.
readonly AGENT_CREDENTIAL='(\.(claude|codex|cursor|copilot|gemini|antigravity)/[[:alnum:]_./-]*(credentials|auth|token)[[:alnum:]_.-]*|\.netrc|\.npmrc|\.pypirc|\.docker/config\.json)([[:space:]'"$qc"']|$)'
# 15d. Dotenv files. `.env.example`, `.sample`, `.template`, `.dist` and
# `.schema` are checked-in documentation of which keys exist, never the values,
# so they are excluded — that collision is the one this rule most had to avoid.
readonly DOTENV_SECRET='(^|[[:space:]='"$qc"'./])\.env(\.[[:alnum:]_-]+)?([[:space:]'"$qc"']|$)'
readonly DOTENV_PUBLIC='\.env\.(example|sample|template|dist|schema|defaults)([[:space:]'"$qc"']|$)'

if matches "$SECRET_READ_VERB"; then
  if matches "$SSH_PRIVATE_KEY"; then
    block "reading, copying or transmitting an SSH PRIVATE key. Public keys (.pub), known_hosts and ssh config are unaffected; if you need the fingerprint use \`ssh-keygen -lf <key>.pub\`."
  fi
  if matches "$CLOUD_CREDENTIAL"; then
    block "reading, copying or transmitting a cloud provider credential file. Use the provider CLI's own identity command (\`aws sts get-caller-identity\`, \`gcloud auth list\`) instead of reading the file."
  fi
  if matches "$AGENT_CREDENTIAL"; then
    block "reading, copying or transmitting a coding-agent or package-registry credential store. These tokens impersonate the operator to every service the agent can reach."
  fi
  # `.env` only when the path is NOT one of the public example forms. Ordered as
  # an exclusion rather than a narrower pattern so a new example suffix is one
  # word to add, and so the reason a file is exempt stays readable.
  if matches "$DOTENV_SECRET" && ! matches "$DOTENV_PUBLIC"; then
    block "reading, copying or transmitting a dotenv file holding real values. \`.env.example\`, \`.env.sample\`, \`.env.template\` and \`.env.dist\` are readable, and WRITING a .env is unaffected — only reading one back is refused."
  fi
  # Fail-closed, narrowly. A read whose DIRECTORY is a known credential store
  # but whose leaf is variable-expanded cannot be classified, and #2980's lesson
  # is that a guard which cannot classify must refuse rather than permit. Scoped
  # to credential directories on purpose: refusing every \`cat "\$FILE"\` would be
  # the over-reach that gets the whole hook switched off.
  if matches_cs '(\.ssh|\.aws|\.config/gcloud|\.azure|\.kube)/[^[:space:]'"$qc"']*\$'; then
    block "reading a path inside a credential directory whose filename is variable-expanded, so the guard cannot tell which file it is. Name the file explicitly if it is genuinely not a secret."
  fi
fi

# 16. Project-local custom rules. Each non-comment line is an ERE; a match blocks.
rules_file="${SAFETY_NET_RULES_FILE:-${CLAUDE_PROJECT_DIR:-$PWD}/.claude/safety-net-rules.txt}"
if [ -f "$rules_file" ]; then
  while IFS= read -r rule || [ -n "$rule" ]; do
    case "$rule" in
      '' | '#'*) continue ;;
    esac
    # Normalized text, for the same reason every built-in guard uses it: a
    # project rule must not be evadable by breaking the command across lines.
    #
    # `|| rule_status=$?` rather than a bare pipeline: this script runs under
    # `set -e`, and a no-match grep exits 1, which would end the hook right
    # here — before the remaining rules ran, and with an exit status that is
    # not a refusal. The `||` puts the pipeline in a condition context, where
    # a non-zero status is expected rather than fatal.
    rule_status=0
    printf '%s' "$normalized_command_str" | grep -Eiq -- "$rule" || rule_status=$?
    case "$rule_status" in
      0) block "matched a project custom safety rule (${rules_file##*/}): $rule" ;;
      1) ;; # no match
      # grep exits 2 on a malformed ERE. Treated as no-match before, so a typo
      # in a project's rules file silently disabled that rule — a guard the
      # project believed it had. Say so instead; still non-fatal, because one
      # bad line must not take the other rules down with it.
      *)
        printf 'parity-safety-net: invalid regex in %s, rule NOT enforced: %s\n' \
          "$rules_file" "$rule" >&2
        ;;
    esac
  done <"$rules_file"
fi

exit 0

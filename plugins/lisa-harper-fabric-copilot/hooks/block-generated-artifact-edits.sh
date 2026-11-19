#!/bin/bash
# This file is managed by Lisa.
# Do not edit directly - changes will be overwritten on the next `lisa` run.

# PreToolUse hook: block Write/Edit/MultiEdit on generated Harper deploy
# artifacts. Harper/Fabric projects build these files from TypeScript under
# src/, so direct edits are overwritten by the next build and usually ship as
# no-op fixes.
# Reference: https://docs.claude.com/en/docs/claude-code/hooks
# Exit code 2 blocks the tool call and surfaces stderr to Claude.

JSON_INPUT=$(cat)

command -v jq >/dev/null 2>&1 || exit 0

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FILE_PATHS=$(printf '%s' "$JSON_INPUT" | jq -r '.tool_input.file_path // empty')
if [ -z "$FILE_PATHS" ] && [ -f "$SCRIPT_DIR/_extract-edit-paths.sh" ]; then
  # shellcheck source=_extract-edit-paths.sh
  . "$SCRIPT_DIR/_extract-edit-paths.sh"
  FILE_PATHS=$(lisa_extract_edit_paths "$JSON_INPUT")
fi
[ -n "$FILE_PATHS" ] || exit 0

PLUGIN_ROOT=${CLAUDE_PLUGIN_ROOT:-}
if [ -z "$PLUGIN_ROOT" ]; then
  PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fi
GLOBS_FILE="$PLUGIN_ROOT/generated-artifact-globs.txt"
if [ ! -f "$GLOBS_FILE" ]; then
  GLOBS_FILE="$SCRIPT_DIR/generated-artifact-globs.txt"
fi
[ -f "$GLOBS_FILE" ] || exit 0

normalize_path() {
  local path="$1"
  path="${path#./}"
  printf '%s' "$path"
}

# lisa_glob_ere <glob>
#
# Set `lisa_glob_ere_result` to an anchored ERE that matches exactly the
# strings the shell's `case` matches with <glob>, so
# `[[ $path =~ $lisa_glob_ere_result ]]` can stand in for an unquoted `case`
# pattern: `*` is any run of characters (slashes included), `?` is one
# character, `[...]` is a bracket expression (`!` or `^` negates it), a
# backslash makes the next character literal, and an unterminated `[` is a
# literal `[`. Every other character is literal, so an ERE metacharacter in a
# glob is matched as itself rather than obeyed. Returns 1, matching nothing, for a trailing backslash: it escapes
# nothing, and the shell's matcher then matches nothing either.
#
# A range compares code points, as bash 5 does by default (`globasciiranges`)
# and as minimatch does. Measured against bash 3.2's `case` in the C locale:
# no mismatch over 3,127 pattern/path pairs and over a second fuzz of 3,795.
# Two differences remain, both in a bracket. Under a UTF-8 locale bash 3.2
# orders a range by collation (`[]-a]`). And a bracket holding an unterminated
# `[.` or `[=`, or an unterminated `[:` after other members (`[a[:]`), is read
# by bash 3.2 with its earlier members dropped; this reads every member.
#
# No subshells: this runs on every agent edit (it is the copy in
# block-managed-file-edits.sh), so each helper appends to a
# variable instead of printing.
lisa_glob_ere() {
  local glob="$1" char
  local -i i=0 n=${#1}
  lisa_glob_ere_result=""
  while [ "$i" -lt "$n" ]; do
    char="${glob:i:1}"
    case "$char" in
      "*") lisa_glob_ere_result+=".*" ;;
      "?") lisa_glob_ere_result+="." ;;
      "\\")
        [ "$((i + 1))" -lt "$n" ] || return 1
        i+=1
        lisa_glob_ere_literal "${glob:i:1}"
        ;;
      "[")
        if lisa_glob_bracket_end "$glob" "$i"; then
          lisa_glob_bracket_ere "${glob:i+1:lisa_glob_close-i-1}"
          i=$lisa_glob_close
        else
          lisa_glob_ere_literal "["
        fi
        ;;
      *) lisa_glob_ere_literal "$char" ;;
    esac
    i+=1
  done
  lisa_glob_ere_result="^${lisa_glob_ere_result}\$"
}

# lisa_glob_ere_literal <char>
#
# Append one character to `lisa_glob_ere_result`, written so an ERE matches
# it literally.
lisa_glob_ere_literal() {
  case "$1" in
    "^") lisa_glob_ere_result+="\\^" ;;
    "\\") lisa_glob_ere_result+="[\\]" ;;
    "[") lisa_glob_ere_result+="[[]" ;;
    "." | "+" | "(" | ")" | "{" | "}" | "|" | "$" | "*" | "?") lisa_glob_ere_result+="[$1]" ;;
    *) lisa_glob_ere_result+="$1" ;;
  esac
}

# lisa_glob_bracket_end <glob> <open>
#
# Set `lisa_glob_close` to the index of the `]` closing the bracket opened
# at <open>, or return 1 when it is never closed. A `]` straight after the
# opening (or after its `!`/`^`) is a member, `[:name:]`, `[.x.]` and `[=x=]`
# are single members, and a backslash escapes the next character, as in the
# shell's own matcher.
lisa_glob_bracket_end() {
  local glob="$1" rest name mark
  local -i i=$(($2 + 1)) n=${#1} start
  case "${glob:i:1}" in "!" | "^") i+=1 ;; esac
  start=$i
  while [ "$i" -lt "$n" ]; do
    case "${glob:i:1}" in
      "]")
        if [ "$i" -gt "$start" ]; then
          lisa_glob_close=$i
          return 0
        fi
        ;;
      "\\") i+=1 ;;
      "[")
        mark="${glob:i+1:1}"
        case "$mark" in
          ":" | "." | "=")
            rest="${glob:i+2}"
            case "$rest" in
              *"$mark]"*)
                name="${rest%%"$mark]"*}"
                i+=$((${#name} + 3))
                ;;
            esac
            ;;
        esac
        ;;
    esac
    i+=1
  done
  return 1
}

# lisa_glob_bracket_ere <body>
#
# Append the ERE bracket expression for a glob bracket body to
# `lisa_glob_ere_result`. An escaped member loses its backslash, and a literal
# `]`, `^` or `-` is placed where an ERE bracket reads it literally: first, not
# first, and last. A `[:name:]`, `[.x.]` or `[=x=]` is copied whole; any other
# `[` is a literal member, placed after the others so it never opens a class
# the ERE would reject (`[[:]`). A `-` straight after a range is literal, as
# the shell reads `[a-c-e]`, rather than a second range the ERE would reject.
lisa_glob_bracket_ere() {
  local body="$1" negate="" members="" close="" open="" caret="" dash=""
  local char next rest
  local -i i=0 n=${#1} after_range=0
  case "${body:0:1}" in "!" | "^") negate="^" i=1 ;; esac
  if [ "${body:i:1}" = "]" ]; then
    close="]"
    i+=1
  fi
  while [ "$i" -lt "$n" ]; do
    char="${body:i:1}"
    next="${body:i+1:1}"
    if [ "$char" = "\\" ] && [ "$((i + 1))" -lt "$n" ]; then
      i+=1
      case "$next" in
        "]") close="]" ;;
        "^") caret="^" ;;
        "-") dash="-" ;;
        *) members+="$next" ;;
      esac
      after_range=0
    elif [ "$char" = "^" ] && [ -z "$members$close" ]; then
      caret="^"
      after_range=0
    elif [ "$char" = "[" ]; then
      rest="${body:i+2}"
      case "$next" in
        ":" | "." | "=")
          case "$rest" in
            *"$next]"*)
              rest="${rest%%"$next]"*}"
              members+="[${next}${rest}${next}]"
              i+=$((${#rest} + 3))
              ;;
            # An unterminated `[:` opens nothing, and the shell drops its
            # `[`; any other unterminated opener leaves a literal `[`.
            *) if [ "$next" != ":" ]; then open="["; fi ;;
          esac
          ;;
        *) open="[" ;;
      esac
      after_range=0
    elif [ "$char" = "-" ] && [ "$after_range" -eq 1 ]; then
      dash="-"
      after_range=0
    elif [ "$char" = "-" ] && [ -n "$members$close" ] && [ "$((i + 1))" -lt "$n" ]; then
      members+="-${next}"
      i+=1
      after_range=1
    elif [ "$char" = "-" ]; then
      if [ -z "$members$close" ]; then members+="-"; else dash="-"; fi
      after_range=0
    else
      members+="$char"
      after_range=0
    fi
    i+=1
  done
  if [ -z "$close$members$open$dash" ]; then
    members="$caret"
    caret=""
  fi
  lisa_glob_ere_result+="[${negate}${close}${members}${open}${caret}${dash}]"
}

matches_glob() {
  local file="$1"
  local glob="$2"

  # Recursive directory globs: "dir/**" matches everything under dir.
  if [ "${glob: -3}" = "/**" ]; then
    local dir="${glob%/**}"
    case "$file" in
      "$dir"/* | */"$dir"/*) return 0 ;;
    esac
    return 1
  fi

  # Single-star globs like "harper-app/*.js": the star must not cross a
  # directory separator, so a broadened root-level pattern protects compiled
  # modules emitted straight into harper-app/ (resources.js, resource-*.js, and
  # any other build output such as detail-shell-negotiation.js) WITHOUT matching
  # hand-written files nested one level down (e.g. harper-app/<route>/index.js).
  case "$glob" in
    */\** | \**)
      local base_glob="${glob##*/}"
      local dir_glob=""
      case "$glob" in
        */*) dir_glob="${glob%/*}" ;;
      esac
      local file_base="${file##*/}"
      local file_dir=""
      case "$file" in
        */*) file_dir="${file%/*}" ;;
      esac
      # The globs are globs on purpose, matched through their ERE so no
      # expansion is left unquoted. A glob with no ERE matches nothing.
      lisa_glob_ere "$base_glob" || return 1
      [[ $file_base =~ $lisa_glob_ere_result ]] || return 1
      [ -z "$dir_glob" ] && return 0
      # Match the directory exactly, or as a suffix so absolute/prefixed paths
      # (e.g. /repo/harper-app/foo.js) still resolve.
      case "$file_dir" in
        */"$dir_glob") return 0 ;;
      esac
      lisa_glob_ere "$dir_glob" || return 1
      if [[ $file_dir =~ $lisa_glob_ere_result ]]; then
        return 0
      fi
      return 1
      ;;
  esac

  # Literal (wildcard-free) globs.
  if lisa_glob_ere "$glob" && [[ $file =~ $lisa_glob_ere_result ]]; then
    return 0
  fi
  lisa_glob_ere "*/$glob" || return 1
  [[ $file =~ $lisa_glob_ere_result ]]
}

# Project-owned allowlist of hand-written files that live under harper-app/ and
# must NOT be treated as generated (e.g. a hand-authored SEO shell, or route
# index.js shims kept at the harper-app root). The broadened root-level
# `harper-app/*.js` protection would otherwise block editing them. One glob per
# line (same syntax as the globs file); blank lines and `#` comments ignored.
# Prefer naming compiled resource modules `resource-*.ts` so their JS output is
# unambiguously generated and never needs allowlisting.
check_file() {
  local file_path="$1"
  local normalized_file
  normalized_file=$(normalize_path "$file_path")
  local allowlist_file="${CLAUDE_PROJECT_DIR:-.}/.lisa/harper-generated-artifact-allowlist.txt"
  if [ -f "$allowlist_file" ]; then
    while IFS= read -r allow || [ -n "$allow" ]; do
      [ -n "$allow" ] || continue
      case "$allow" in \#*) continue ;; esac
      if matches_glob "$normalized_file" "$allow"; then
        return 0
      fi
    done <"$allowlist_file"
  fi

  while IFS= read -r glob || [ -n "$glob" ]; do
    [ -n "$glob" ] || continue
    case "$glob" in \#*) continue ;; esac
    if matches_glob "$normalized_file" "$glob"; then
      cat >&2 <<MSG
Blocked: direct edit to generated Harper/Fabric artifact.

File: $file_path
Matched generated artifact pattern: $glob

TypeScript under src/ is the source of truth for Harper resources, web assets,
and shared libraries. Change the matching TypeScript source under src/ and run
the project build to regenerate harper-app outputs.
MSG
      return 2
    fi
  done <"$GLOBS_FILE"
}

while IFS= read -r FILE_PATH; do
  [ -n "$FILE_PATH" ] || continue
  check_file "$FILE_PATH" || exit $?
done <<EOF
$FILE_PATHS
EOF

exit 0

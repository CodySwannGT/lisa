#!/usr/bin/env bash
# This file is managed by Lisa and IS replaced on each `lisa` run.
# Do not edit directly — durable changes belong upstream in Lisa.

# PreToolUse hook: refuse agent writes to files Lisa overwrites on every apply.
#
# Lisa ships templates in three modes, and only one of them is unsafe to edit:
#
#   copy-overwrite — see below; the harm depends on the file.
#   copy-contents  — Lisa APPENDS its lines; host content survives.
#   create-only    — skipped when the file exists; the host owns it outright.
#
# So this guard covers copy-overwrite and nothing else. Blocking the other two
# would stop agents editing files they are supposed to own, which is worse than
# the problem being solved.
#
# The name `copy-overwrite` is misleading, and two successive versions of this
# guard got the consequence wrong by trusting it. MEASURED, by mutating four
# files in a scratch project and running a real `lisa apply` against them:
#
#   scripts/lisa-gates.mjs   (ledger-tracked)  → SURVIVED
#   .lintstagedrc.json       (untracked, JSON) → SURVIVED
#   .prettierignore          (untracked, text) → SURVIVED
#   .yamllint                (untracked, text) → SURVIVED
#
#   Summary line: `Overwritten: 0 files` / `Out of date: 3 files (managed
#   templates changed; NOT updated)`.
#
# copy-overwrite overwrites an UNMODIFIED copy — it refreshes. It does not
# overwrite a host-edited one, in any population tested. So the harm is the same
# for both, and it is not deletion:
#
#   THE FILE SILENTLY FORKS. It keeps looking current while every upstream fix
#   stops reaching it. Nothing is lost, which is exactly what makes it invisible.
#
# Ledger membership changes the MESSAGE apply prints, not the outcome — tracked
# files get a provenance verdict naming the fork and offering
# `lisa-guard-capabilities:`; untracked ones get a bare "Out of date" warning.
# The refusal branches on that so the reader sees the words apply will use.
#
# Measured, not hypothetical. Nothing enforced this, so downstream copies were
# edited and then silently diverged: `classify-maestro-failures.mjs` reached
# 36,061 bytes in one fleet repo against 29,586 shipped, and five gate files in
# another stopped receiving upstream fixes — one over roughly 138 bytes of
# cosmetic change. The edits were made in good faith; nothing told anyone the
# file was not theirs.
#
# ## Why the path, not a banner comment
#
# 103 of Lisa's 145 copy-overwrite files carry a "managed by Lisa" header, and
# the other 42 CANNOT: 30 are `.json` (no comment syntax), 8 are `.gitkeep` /
# `.keep` placeholders, and the rest are bare-value files like `.nvmrc`. A guard
# keyed on the banner would miss every one of them, so this resolves the path
# against the installed package instead and covers all 145 regardless of format.
#
# Blocked signatures:
#   1. Write / Edit / MultiEdit / NotebookEdit whose target resolves to a
#      copy-overwrite template in the installed Lisa package;
#   2. Bash output redirection (`>`, `>>`, `>|`), `tee`, or an in-place `sed`
#      aimed at one — `-i`, `-i ''`, `-i.bak`, a cluster such as `-ni`, and the
#      long `--in-place[=SUFFIX]`. Reads never fire;
#   3. any of those inside a script the command EXECUTES — `bash edit.sh`,
#      `sh`, `source`, `.`, `bash < edit.sh`, and behind wrappers that carry an
#      operand of their own (`nice -n 5`, `timeout 5`, `sudo`).
#
# ## What signature 3 deliberately does NOT do
#
# A path is followed ONLY when the command EXECUTES it. `grep -n x edit.sh`,
# `wc -l edit.sh`, `git diff edit.sh` and a test run over it name a file as
# DATA, and following those is the known-wrong fix this guard family has already
# made once: it refuses ordinary reads and attributes a file's capability to a
# command that merely mentions it. Command POSITION decides. Taint does not
# propagate any further either — a path a followed script merely NAMES is data
# one file further out, not a third hop.
#
# ## Parity gap, recorded rather than silently dropped
#
# This guard has no Antigravity, Codex or OpenCode port — only the Claude
# reference and the copies generated from it. Its siblings do. That predates
# this change and is not closed by it: opening three ports is its own work, and
# doing it here would triple the surface under review. Recorded so it reads as a
# known gap rather than an oversight.
#
# Exemptions (allowed):
#   - `LISA_ALLOW_MANAGED_FILE_WRITE` set — the operator's explicit override,
#     named in the refusal;
#   - paths under `node_modules/` or `dist/` — vendored copies, not the host's;
#   - the Lisa source repository itself, where these files are the originals and
#     editing them is the entire point.
#
# The line below lets `lisa apply` tell a downstream copy of this guard that is
# BEHIND from one that is AHEAD. Byte comparison cannot: both look like "differs
# from mine", and guessing "behind" is how a fork's stronger guard gets silently
# replaced by a weaker upstream one. Add a name here in the same commit that
# closes a vector.
# lisa-guard-capabilities: managed-path-resolution, lisaignore-precedence, generated-path-rebuild, redirect-target, tee-target, sed-in-place-all-spellings, executed-script-reach, source-builtin-reach, stdin-redirect-reach, wrapper-positional-operand
set -euo pipefail

input="$(cat)"

command -v jq >/dev/null 2>&1 || exit 0

# The operator's override, checked first so it is always the cheapest way out.
if [ -n "${LISA_ALLOW_MANAGED_FILE_WRITE:-}" ]; then
  exit 0
fi

tool_name="$(printf '%s' "$input" | jq -r '.tool_name // empty')"
[ -n "$tool_name" ] || exit 0

project_root="${CLAUDE_PROJECT_DIR:-$PWD}"
package_root="$project_root/node_modules/@codyswann/lisa"

# No installed Lisa means nothing to classify against. Silent, because a project
# that has not installed Lisa is not doing anything wrong.
[ -d "$package_root" ] || exit 0

# In Lisa's own repository these files ARE the originals. Blocking here would
# make the templates uneditable by the only agents that should edit them.
if [ -f "$project_root/package.json" ] &&
  grep -q '"name": *"@codyswann/lisa"' "$project_root/package.json" 2>/dev/null; then
  exit 0
fi

# Whether the project has claimed a path in `.lisaignore`.
#
# THIS IS THE OWNERSHIP QUESTION, and it decides whether blocking is right at
# all. `lisa apply` skips an ignored path — it logs `Kept (.lisaignore)` and
# counts it as ignored rather than overwritten — so the file is the project's,
# its edits survive, and refusing them would be refusing someone access to their
# own file. `doctor-lisa-owned-artifacts` already consults this list; this guard
# did not, which would have blocked deliberate forks.
#
# The real matcher is minimatch in `src/utils/ignore-patterns.ts` and cannot be
# reproduced faithfully in shell. This covers the common shapes — exact path,
# directory prefix, glob, and a bare pattern matching any segment — and where it
# is unsure it ALLOWS. Wrongly allowing costs an edit that apply may overwrite,
# which is the behaviour before this guard existed; wrongly blocking locks
# someone out of a file they own.
lisaignored() {
  local rel="$1"
  local list="$project_root/.lisaignore"
  [ -f "$list" ] || return 1
  # Gitignore precedence: patterns are read in order and the LAST one to select
  # the path decides, so `!x` re-includes something an earlier line ignored.
  # This mirrors `matchesAnyPattern` in `src/utils/ignore-patterns.ts`; the two
  # must agree, or an agent gets blocked on a file apply considers the
  # project's, or waved through on one it does not.
  #
  # `ignored` carries shell truth: 0 = ignored, 1 = not.
  local ignored=1
  local pattern
  while IFS= read -r pattern || [ -n "$pattern" ]; do
    pattern="${pattern#"${pattern%%[![:space:]]*}"}"
    pattern="${pattern%"${pattern##*[![:space:]]}"}"
    [ -n "$pattern" ] || continue
    case "$pattern" in \#*) continue ;; esac
    local negated=1
    case "$pattern" in
      # A bare `!` selects nothing rather than everything.
      !) continue ;;
      !*)
        negated=0
        pattern="${pattern#!}"
        ;;
      # `\!x` is a literal leading `!`, not a negation.
      \\!*) pattern="${pattern#\\}" ;;
    esac
    local selected=1
    case "$pattern" in
      */)
        case "$rel" in "${pattern%/}"/* | "${pattern%/}") selected=0 ;; esac
        ;;
    esac
    if [ "$selected" -ne 0 ]; then
      # The pattern is a glob on purpose, so it is deliberately unquoted.
      #
      # The reason sits on its own line because a shellcheck directive is
      # `key=value` pairs and NOTHING else. Written as
      # `disable=SC2254 -- <prose>`, the trailing words are read as more
      # directive keys: the directive fails with SC1072/SC1073, shellcheck
      # stops checking the rest of THIS FILE, and SC2254 is left unsuppressed
      # as well. Measured with shellcheck 0.11.0. Do not rejoin these lines.
      # shellcheck disable=SC2254
      case "$rel" in $pattern) selected=0 ;; esac
    fi
    if [ "$selected" -ne 0 ]; then
      case "$pattern" in
        */*) ;;
        *)
          # Ditto, matched against the basename — and ditto about the reason
          # living on its own line rather than after the directive.
          # shellcheck disable=SC2254
          case "${rel##*/}" in $pattern) selected=0 ;; esac
          ;;
      esac
    fi
    [ "$selected" -eq 0 ] || continue
    # A positive match ignores the path; a negated one un-ignores it. Both
    # OVERWRITE any earlier verdict rather than short-circuiting — that is what
    # makes the last matching pattern win.
    if [ "$negated" -eq 0 ]; then
      ignored=1
    else
      ignored=0
    fi
  done <"$list"
  return "$ignored"
}

# A candidate rewritten relative to the project, so an absolute target from a
# tool payload and a relative one from a shell command classify identically.
relative_path() {
  local rel="${1#"$project_root"/}"
  printf '%s' "${rel#./}"
}

# Whether a host-relative path is shipped as a copy-overwrite template.
#
# A few stat calls rather than an enumeration: the same relative path is probed
# under each stack's copy-overwrite tree, so cost does not grow with the 145
# templates.
managed_source() {
  local candidate="$1"
  case "$candidate" in
    */node_modules/* | node_modules/* | */dist/* | dist/*) return 1 ;;
  esac
  local rel
  rel="$(relative_path "$candidate")"
  [ -n "$rel" ] || return 1
  # Claimed by the project, so not ours to refuse.
  lisaignored "$rel" && return 1
  local stack
  for stack in "$package_root"/*/copy-overwrite; do
    [ -d "$stack" ] || continue
    if [ -e "$stack/$rel" ]; then
      printf '%s' "${stack#"$package_root"/}/$rel"
      return 0
    fi
  done
  # A generated path has no template to point at — apply rebuilds it from the
  # migration rather than copying it — so the source is named for the reader
  # rather than resolved to a file that does not exist.
  if generated_path "$rel"; then
    printf '%s' "generated by lisa apply"
    return 0
  fi
  return 1
}

# Whether a destination is a path `lisa apply` GENERATES rather than copies.
#
# Read out of the installed package, never restated here.
# `dist/migrations/generated-paths.js` is the single source the vendoring
# migration also imports, so a new generated tree is covered without editing this
# hook. A hook carrying its own copy of that list would be a second place to
# update that nobody updates, which then governs silently — the defect this file
# already documents for copy-overwrite, one step along.
#
# The distinction earns its keep because the two populations fail in OPPOSITE
# ways, and a guard that gives one answer is wrong for half the files it covers:
# an edited copy-overwrite file is PRESERVED and silently forks, while a
# generated file is REBUILT and the edit vanishes on the next install.
generated_path() {
  local rel="$1"
  local module="$package_root/dist/migrations/generated-paths.js"
  [ -f "$module" ] || return 1
  local prefixes
  prefixes="$(grep -oE '"[^"]+"' "$module" 2>/dev/null | tr -d '"')"
  local prefix
  for prefix in $prefixes; do
    case "$prefix" in
      */*) ;;
      *) continue ;;
    esac
    case "$rel" in
      "$prefix" | "$prefix"/*) return 0 ;;
    esac
  done
  return 1
}

# Whether a destination is a ledger-tracked Lisa-owned guard.
#
# Both populations are PRESERVED once edited (measured — see the header). What
# membership changes is what apply prints and what the escape hatch is: a tracked
# guard gets a provenance verdict and can declare `lisa-guard-capabilities:`,
# while an untracked template gets a bare "Out of date" line and `.lisaignore`.
# The refusal quotes the words the reader will actually see, so it has to know
# which side it is on.
ledger_tracked() {
  local rel="$1"
  local ledger="$package_root/dist/core/lisa-owned-hash-ledger.js"
  [ -f "$ledger" ] || return 1
  grep -q "\"$rel\"" "$ledger" 2>/dev/null
}

refuse() {
  local target="$1"
  local source="$2"
  local rel="$3"
  local consequence
  if generated_path "$rel"; then
    consequence="\`lisa apply\` REGENERATES this file. It is not copied from a
template and it is not preserved: the next \`bun install\` rebuilds it and your
edit is gone, with nothing reporting that it had been.

That is the opposite failure from the copy-overwrite files this guard also
covers, where an edit SURVIVES and forks silently. Here the edit works locally,
CI agrees because CI regenerates too, and it disappears on the next install."
  elif ledger_tracked "$rel"; then
    consequence="\`lisa apply\` will KEEP your edit — this is a Lisa-owned guard,
and apply says so: \"its contents match no Lisa release, so Lisa cannot tell
whether it is out of date or deliberately stronger. Kept yours.\"

That is the trap. Nothing is deleted; the file silently FORKS. It keeps looking
current while every upstream fix stops reaching it. One repository in this fleet
carries 243 lines of divergence nobody knew about, in a guard that had quietly
stopped receiving fixes."
  else
    consequence="\`lisa apply\` will KEEP your edit and report the file as
\"Out of date, not updated\" on every run from now on.

That is the trap. Nothing is deleted; the file silently FORKS, stops receiving
upstream changes, and adds a permanent warning line that the next person learns
to scroll past."
  fi
  cat >&2 <<EOF
BLOCKED: refusing to write \`$target\`.

WHY: this file is Lisa-managed, shipped as a **copy-overwrite** template
(\`$source\` in the installed package).

$consequence

WHERE IT GOES INSTEAD — take the first one that fits:

1. The change should apply everywhere. Edit the template upstream in Lisa and
   release it — \`/lisa:cross-pollinate\`, or an issue on CodySwannGT/lisa.
   That is the only edit that survives an install.

2. Only this project needs to differ. Look for the local escape hatch beside the
   file — Lisa ships \`.local\` variants for the configs that support one
   (\`eslint.config.local.ts\`, \`tsconfig.local.json\`, \`audit.ignore.local.json\`,
   and others). Those are yours and are never overwritten.

3. The behaviour is configurable rather than hardcoded. Check \`.lisa.config.json\`
   — the \`gates\` block in particular decides which checks run and what command
   proves each one, so a project can substitute its own task without touching a
   shipped file.

4. This project has deliberately FORKED this file and means to keep its own
   version. Apply already preserves the edit either way, so what is left to
   choose is whether the fork stays VISIBLE. Keeping it visible is the point:

   - **A Lisa-owned guard (hash-tracked).** Do NOT add it to \`.lisaignore\`.
     Apply preserves your version regardless, so ignoring it buys nothing — and
     it silences the standoff \`lisa doctor\` reports on every run, replacing a
     true warning with the line "Enforcement guards match the installed Lisa
     version", which is then false. A visible, resolvable fork becomes a silent
     permanent one. Instead declare what your version defends with a
     \`lisa-guard-capabilities:\` line; apply then classifies it \`host-ahead\`
     and says so by name, rather than reporting that it cannot tell.
   - **Any other template.** \`.lisaignore\` records the divergence where the
     next person can see it and stops the recurring "Out of date" line. It does
     not preserve the file — apply already does — so use it to DECLARE a fork
     you have decided on, never to quiet one you have not.

5. You believe this file should not be Lisa-managed at all. That is a real
   argument and it belongs upstream, not in a local edit that will be erased.

If a human explicitly asked for this edit, they can re-run with
\`LISA_ALLOW_MANAGED_FILE_WRITE=1\` set, which bypasses this guard.
EOF
  exit 2
}

case "$tool_name" in
  Write | Edit | MultiEdit | NotebookEdit | Update)
    paths="$(printf '%s' "$input" | jq -r '
      [ .tool_input.file_path?,
        .tool_input.path?,
        .tool_input.notebook_path?,
        (.tool_input.edits? // [] | .[].file_path?)
      ] | map(select(. != null and . != "")) | .[]' 2>/dev/null || true)"
    while IFS= read -r candidate; do
      [ -n "$candidate" ] || continue
      if source_path="$(managed_source "$candidate")"; then
        refuse "$candidate" "$source_path" "$(relative_path "$candidate")"
      fi
    done <<EOF
$paths
EOF
    ;;
  Bash)
    command_str="$(printf '%s' "$input" | jq -r '.tool_input.command // empty')"
    [ -n "$command_str" ] || exit 0
    # A missing interpreter must be announced rather than swallowed. This guard
    # degrades to "allow" — a hook that cannot parse its input cannot tell a
    # write from a read — but a guard that is silently absent reads exactly like
    # a guard that is passing.
    if ! command -v python3 >/dev/null 2>&1; then
      printf 'block-managed-file-edits: python3 not found; Bash write protection is NOT active\n' >&2
      exit 0
    fi
    # Why a tokenizer replaced the two-stage regex.
    #
    # The old extraction was `grep -Eo` for a redirect / tee / in-place sed,
    # followed by a `sed -E` strip of the matched prefix. MEASURED against it:
    # `tee <path>` and `tee -a <path>` extracted correctly, and EVERY `sed -i`
    # spelling extracted NOTHING — `-i`, `-i ''` and `-i.bak` alike. The
    # `grep` matched; the strip pattern `sed[[:space:]]+[^|;&]*-i[^|;&]*` is
    # greedy, so it consumed the path along with the flags and left an empty
    # token. The arm was DEAD, not merely missing macOS's two-token spelling.
    #
    # A regex cannot answer the question this guard actually asks — is this path
    # WRITTEN or merely NAMED — because that depends on token position, which is
    # what a tokenizer is for.
    #
    # The analyzer is read into a variable by `read -d ''` rather than run
    # inside a `$(python3 - <<'PY' … PY)`. Bash has to find the closing paren of
    # a command substitution by re-scanning its text, and a heredoc body nested
    # there is scanned too: the lone backtick in `re.compile(r"[$`]")` below
    # reads as an unterminated backtick substitution and the whole script fails
    # to parse. Keeping the heredoc out of the substitution is the fix.
    analyzer=''
    IFS= read -r -d '' analyzer <<'PY' || true
import os
import re
import shlex

command = os.environ.get("MANAGED_EDIT_COMMAND", "")
project = os.environ.get("MANAGED_EDIT_PROJECT", "") or os.getcwd()

# Following a script costs a read on every intercepted command, so the walk is
# bounded three ways, and a file past the cap is skipped rather than half-read:
# a truncated scan reports a confident ALLOW about text it never saw.
FOLLOW_MAX_BYTES = 262144
FOLLOW_MAX_FILES = 8
FOLLOW_MAX_DEPTH = 3

# Spelled with chr() rather than backslash escapes on purpose. This source is
# embedded in a shell heredoc and copied verbatim through several generators
# into every shipped plugin; a backslash literal is the one thing in it most
# likely to be mangled in transit, and the mangling would be silent.
BACKSLASH = chr(92)
NEWLINE = chr(10)

STATEMENT_SEPARATORS = {";", "|", "||", "&", "&&", "(", ")", "&|"}
# `>`, `>>`, and the noclobber override `>|`.
REDIRECT_OUT = {">", ">>", ">|"}
REDIRECT_IN = "<"

SHELL_PROGRAMS = {"bash", "dash", "ksh", "sh", "zsh"}
SOURCE_BUILTINS = {"source", "."}

# Wrappers that run what FOLLOWS them without changing what it is, mapped to
# (options whose value is a SEPARATE token, positional operands consumed).
# The positional count is why this is a table rather than a set: `timeout 5
# bash x` puts an operand between the wrapper and the interpreter, so a walk
# that steps over `-flags` only stops at `5` and never reaches `bash`.
FOLLOW_WRAPPERS = {
    "builtin": (frozenset(), 0),
    "command": (frozenset(), 0),
    "exec": (frozenset({"-a"}), 0),
    "nice": (frozenset({"-n", "--adjustment"}), 0),
    "nohup": (frozenset(), 0),
    "setsid": (frozenset(), 0),
    "stdbuf": (frozenset({"-i", "-o", "-e"}), 0),
    "sudo": (
        frozenset(
            {
                "-C", "--close-from", "-g", "--group", "-h", "--host",
                "-p", "--prompt", "-r", "--role", "-t", "--type",
                "-U", "--other-user", "-u", "--user",
            }
        ),
        0,
    ),
    "time": (frozenset(), 0),
    "timeout": (frozenset({"-k", "--kill-after", "-s", "--signal"}), 1),
}

# `-i`, `-i.bak`, a cluster such as `-ni`, and the long `--in-place[=SUFFIX]`.
IN_PLACE = re.compile(r"^(--in-place(=.*)?|-[a-zA-Z]*i.*)$")
# A value the SHELL computes; this hook runs before expansion and cannot know
# which file it will name.
COMPUTED_VALUE = re.compile(r"[$`]")


def normalise_lines(text):
    """Spell line breaks as statement separators.

    A newline ends a command exactly as `;` does, but shlex treats it as plain
    whitespace — so two consecutive lines of a followed script would read as
    one invocation and only the first program would be classified. A
    backslash-newline is joined first, because there the newline is NOT a
    boundary.

    Args:
        text: A command line or a script's contents.

    Returns:
        The same text with line breaks spelled as separators.
    """
    joined = text.replace(BACKSLASH + NEWLINE, " ")
    return joined.replace(NEWLINE, " ; ")


def tokenize(text):
    """Tokenize with shell operators kept as their own tokens.

    Args:
        text: A command line or a script's contents.

    Returns:
        The token list, or None when the text does not lex.
    """
    lexer = shlex.shlex(normalise_lines(text), posix=True, punctuation_chars=True)
    lexer.whitespace_split = True
    # `#` is not a comment introducer on a typed command line, and letting shlex
    # treat it as one silently truncates the rest of the line.
    lexer.commenters = ""
    try:
        return list(lexer)
    except ValueError:
        return None


def strip_comments(text):
    """Drop `#` comments from a FOLLOWED SCRIPT, quote-aware.

    Applied to file contents and never to a typed command. A comment cannot
    execute, and Lisa's own managed templates discuss redirection and `sed -i`
    against managed paths in their headers — classifying a followed file
    without dropping its comments reads documentation as an edit.

    Args:
        text: A script's contents.

    Returns:
        The same text with unquoted comments removed.
    """
    output = []
    for line in text.split(NEWLINE):
        quote = ""
        escaped = False
        cut = None
        for position, character in enumerate(line):
            if escaped:
                escaped = False
                continue
            if character == BACKSLASH and quote != "'":
                escaped = True
                continue
            if quote:
                if character == quote:
                    quote = ""
                continue
            if character in "'\"":
                quote = character
                continue
            # A `#` opens a comment only at the start of a word, so `x#y` and
            # `${x#y}` keep their hashes.
            if character == "#" and (position == 0 or line[position - 1].isspace()):
                cut = position
                break
        output.append(line if cut is None else line[:cut])
    return NEWLINE.join(output)


def statements(tokens):
    """Split a token list at statement separators, keeping redirects inline.

    Redirect operators are deliberately NOT separators here: `>` and its target
    have to stay in the same group, because the pair is the write signature.

    Args:
        tokens: The operator-aware token list.

    Returns:
        A list of statements.
    """
    grouped = []
    current = []
    for token in tokens:
        if token in STATEMENT_SEPARATORS:
            grouped.append(current)
            current = []
            continue
        current.append(token)
    grouped.append(current)
    return grouped


def command_word(statement):
    """The program a statement runs, and the tokens after it.

    Steps over leading variable assignments and over wrappers that do not
    change what runs. Reading a wrapper as the command is how a payload hides
    from a guard that inspects only a statement's first word.

    Args:
        statement: One statement's tokens.

    Returns:
        A pair (program, args); (None, []) when no program is named.
    """
    index = 0
    while index < len(statement):
        token = statement[index]
        if "=" in token and not token.startswith(("=", "-")):
            index += 1
            continue
        program = token.rsplit("/", 1)[-1]
        if program not in FOLLOW_WRAPPERS:
            return (program, statement[index + 1 :])
        separate, positional = FOLLOW_WRAPPERS[program]
        index += 1
        while index < len(statement) and statement[index].startswith("-"):
            option = statement[index]
            if option == "--":
                index += 1
                break
            index += 2 if option in separate else 1
        index += positional
    return (None, [])


def shell_script_operand(args):
    """The file a shell invocation runs, or None when it runs no script file.

    Args:
        args: The tokens following the shell's own name.

    Returns:
        The operand token, or None for an interactive shell or a `-c` string.
    """
    for token in args:
        if token == "--":
            continue
        if token.startswith(("-", "+")):
            # A single-dash cluster containing `c` carries a command string,
            # not a script file.
            if not token.startswith("--") and "c" in token[1:]:
                return None
            continue
        return token
    return None


def write_targets(statement):
    """Paths this statement WRITES.

    Reads never fire. A path has to be the target of an output redirection, or
    an operand of `tee` or of an in-place `sed`. That is the whole distinction
    this guard turns on: `grep -n x <managed>` names the same path and stays
    allowed, and following a merely-named path is the known-wrong fix that
    refuses ordinary reads elsewhere in this family.

    Extraction is deliberately GENEROUS for `tee` and `sed`: every non-flag
    operand is offered. It costs nothing, because the caller classifies each
    candidate by resolving it against the installed package, and a `sed` script
    expression such as `s/a/b/` resolves to no template. Being narrow here is
    precisely what left the old `sed -i` arm dead in every spelling.

    Args:
        statement: One statement's tokens.

    Returns:
        Candidate paths this statement writes.
    """
    found = []
    program, args = command_word(statement)
    for index, token in enumerate(statement):
        if token in REDIRECT_OUT and index + 1 < len(statement):
            found.append(statement[index + 1])
    if program == "tee":
        found.extend(token for token in args if not token.startswith("-"))
    elif program == "sed" and any(IN_PLACE.match(token) for token in args):
        found.extend(token for token in args if not token.startswith("-"))
    return found


def executed_script(statement):
    """The path this statement EXECUTES, or None.

    Only a COMMAND POSITION can execute something. A path anywhere else is an
    argument, and an argument is data.

    Args:
        statement: One statement's tokens.

    Returns:
        The operand token naming a script that will run, or None.
    """
    program, args = command_word(statement)
    if program is None:
        return None
    if program in SHELL_PROGRAMS:
        for index, token in enumerate(statement):
            # `bash < script.sh` runs that file as surely as `bash script.sh`.
            if token == REDIRECT_IN and index + 1 < len(statement):
                return statement[index + 1]
        return shell_script_operand(args)
    if program in SOURCE_BUILTINS:
        return args[0] if args else None
    return None


def resolve(token):
    """An existing readable script a token names, or None.

    A computed target (`bash "$SCRIPT"`) is NOT followed and NOT refused. This
    guard's harm is a template that silently forks — recoverable, and reported
    by `lisa doctor` on every run — so failing closed on every `bash "$SCRIPT"`
    in every host project would cost far more than it buys. Its sibling
    `block-no-verify` DOES fail closed on the identical shape, because an
    unverified commit is not recoverable. The divergence is deliberate, and it
    is recorded here so the next reader does not read it as an oversight.

    Args:
        token: The operand naming a script.

    Returns:
        A path, or None.
    """
    if COMPUTED_VALUE.search(token):
        return None
    text = token.strip().strip("'\"")
    if not text or text == "-":
        return None
    if os.path.isabs(text):
        candidates = [text]
    else:
        candidates = [os.path.join(project, text), os.path.join(os.getcwd(), text)]
    for candidate in candidates:
        try:
            if not os.path.isfile(candidate):
                continue
            if os.path.getsize(candidate) > FOLLOW_MAX_BYTES:
                continue
        except OSError:
            continue
        return candidate
    return None


def collect(text, depth, seen, out):
    """Accumulate every write target in this text and in the scripts it runs.

    Args:
        text: A command line, or a followed script's contents.
        depth: Number of scripts already followed.
        seen: Real paths already inspected, so a cycle terminates.
        out: Accumulator for candidate paths.

    Returns:
        Nothing; `out` is extended in place.
    """
    tokens = tokenize(text)
    if tokens is None:
        return
    for statement in statements(tokens):
        if not statement:
            continue
        out.extend(write_targets(statement))
        operand = executed_script(statement)
        if operand is None:
            continue
        if depth >= FOLLOW_MAX_DEPTH or len(seen) >= FOLLOW_MAX_FILES:
            continue
        path = resolve(operand)
        if path is None:
            continue
        try:
            key = os.path.realpath(path)
        except OSError:
            key = path
        if key in seen:
            continue
        seen.add(key)
        try:
            with open(path, encoding="utf-8", errors="replace") as handle:
                body = handle.read(FOLLOW_MAX_BYTES)
        except OSError:
            continue
        collect(strip_comments(body), depth + 1, seen, out)


targets = []
collect(command, 0, set(), targets)
for target in targets:
    cleaned = target.strip().strip("'\"")
    if cleaned:
        print(cleaned)
PY
    write_targets="$(printf '%s' "$analyzer" |
      MANAGED_EDIT_COMMAND="$command_str" \
        MANAGED_EDIT_PROJECT="$project_root" \
        python3 - 2>/dev/null || true)"
    while IFS= read -r token; do
      [ -n "$token" ] || continue
      if source_path="$(managed_source "$token")"; then
        refuse "$token" "$source_path" "$(relative_path "$token")"
      fi
    done <<EOF
$write_targets
EOF
    ;;
esac

exit 0

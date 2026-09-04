#!/usr/bin/env bash
# Lisa-managed Codex hook script (PreToolUse Bash).
# Blocks git commands that bypass verification hooks: the --no-verify long flag
# and any abbreviation git accepts for it, its short form -n as a real argv
# token of a `git commit` (bare or bundled, as in `-nm "msg"`), HUSKY=0 /
# HUSKY_SKIP_HOOKS= (disables husky hooks), and core.hooksPath pointed
# at /dev/null or set empty (disables all git hooks). Shell-token matching
# avoids false positives from issue bodies, heredocs, and commit-message prose
# while still catching quoted real argv values such as
# `git -c "core.hooksPath=/dev/null"`.
#
# Capability names below are the canonical guard's, kept identical on every agent.
# lisa-guard-capabilities: no-verify-abbrev, husky-env, hookspath-allowlist, config-env, env-split-string, git-config-key, git-config-parameters, git-config-parameters-append, git-config-parameters-expansion, heredoc-shell-word, herestring-aware, no-verify-short, nested-shell-no-verify, nested-shell-long-options, env-split-string-abbrev, command-wrapper-normalization, executed-script-reach, source-builtin-reach, stdin-redirect-reach, wrapper-positional-operand, dispatcher-exec-position
set -euo pipefail

input="$(cat 2>/dev/null || true)"
[ -n "$input" ] || exit 0
command -v jq >/dev/null 2>&1 || exit 0

tool_name="$(printf '%s' "$input" | jq -r '.tool_name // empty' 2>/dev/null || true)"
[ "$tool_name" = "Bash" ] || exit 0

command_str="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null || true)"
[ -n "$command_str" ] || exit 0

command -v python3 >/dev/null 2>&1 || exit 0

if ! BLOCK_NO_VERIFY_COMMAND="$command_str" python3 - <<'PY'
import os
import re
import shlex
import sys

command = os.environ.get("BLOCK_NO_VERIFY_COMMAND", "")


def strip_heredocs(text: str) -> str:
    lines = text.splitlines()
    output = []
    pending = []
    marker_pattern = re.compile(
        r'''(?<!<)<<-?(?!<)\s*((?:'[^']*'|"(?:[^"\\]|\\.)*"|\\.|[^\s;&|<>()])+)'''
    )

    def marker_word(raw: str):
        try:
            words = shlex.split(raw, posix=True)
        except ValueError:
            return None
        # An explicitly quoted empty word is a valid heredoc delimiter. Bash
        # terminates that heredoc on the next empty line, so preserve "" as a
        # marker instead of treating it as a parse failure.
        return words[0] if len(words) == 1 else None

    index = 0
    while index < len(lines):
        line = lines[index]
        output.append(line)
        pending.extend(
            marker
            for match in marker_pattern.finditer(line)
            if (marker := marker_word(match.group(1))) is not None
        )
        index += 1
        while pending and index < len(lines):
            if lines[index].strip() == pending[0]:
                output.append(lines[index])
                pending.pop(0)
                index += 1
                break
            index += 1
    return "\n".join(output)


# The only relocations that keep a repo's own hooks in play. `.husky` is the
# husky convention this fleet runs; `.githooks` is the common hand-rolled one.
# Anything else — including "" and /dev/null, which are simply the two most
# obvious members of the blocked set rather than special cases — is refused.
PERMITTED_HOOKS_PATHS = {".husky", ".githooks"}


def is_permitted_hooks_path(value):
    """Whether a core.hooksPath value relocates hooks rather than disabling them.

    Args:
        value: The raw core.hooksPath value as it appeared on the command line.

    Returns:
        True if the path is an established in-repo hooks directory.
    """
    cleaned = value.strip().strip("'\"")
    if cleaned.startswith("./"):
        cleaned = cleaned[2:]
    return cleaned.rstrip("/") in PERMITTED_HOOKS_PATHS


# Git resolves any UNAMBIGUOUS abbreviation of a long option, so `--no-verify`
# is only the longest of the spellings that disable verification: `git commit
# --no-veri` skips hooks exactly as completely. An equality check therefore
# enforced the guard against the one spelling nobody in a hurry types.
#
# Matched as "a prefix of --no-verify" rather than by listing abbreviations,
# because the set of accepted abbreviations is a property of git's parser and
# changes with the surrounding options. `--no-verbose` is NOT caught, and must
# not be: it diverges from `--no-verify` at the character after `--no-ver`, so
# it fails the prefix test.
#
# The floor is `--no-v`. Shorter is refused anyway — bare `--no-` is not a flag
# — and blocking an abbreviation git would reject as ambiguous costs nothing,
# while missing one git accepts costs the whole guard.
NO_VERIFY = "--no-verify"
NO_VERIFY_MIN_PREFIX = len("--no-v")


def disables_verification(token):
    """Whether a token is `--no-verify` or an abbreviation git would accept.

    Args:
        token: A single shell token from the command line.

    Returns:
        True if git would read this token as --no-verify.
    """
    return (
        len(token) >= NO_VERIFY_MIN_PREFIX
        and len(token) <= len(NO_VERIFY)
        and NO_VERIFY.startswith(token)
    )


# `git commit -n` is the short spelling of --no-verify and skips pre-commit and
# commit-msg identically. Matching it needs one thing the `--no-verify` scan
# above does not: SCOPE. `-n` means --dry-run to `git push`, --no-stat to `git
# merge`, and a line count to head/tail/sort/grep, so a token-anywhere match
# would refuse ordinary commands all day. Only `git commit` reads it as a hook
# bypass, so only that invocation's argv is scanned.
#
# The tokenizer below is a SECOND pass, deliberately not shared with the one the
# checks above use. `shlex.split` leaves `|` and `;` glued to their neighbours,
# which those checks paper over by stripping the punctuation off each token —
# fine when the question is "does this token look like a bypass anywhere in the
# line", fatal when the question is "where does this command end", because
# `git commit -m x && grep -n foo` would then read as one long git invocation
# and refuse the grep. `punctuation_chars=True` emits the operators as their own
# tokens, so the invocation's boundary is a token the scan can stop at.
COMMAND_SEPARATORS = {
    ";", "|", "||", "&", "&&", "(", ")", "<", ">", ">>", "<<", "&|",
}

SHELL_PROGRAMS = {"bash", "dash", "ksh", "sh", "zsh"}
MAX_SHELL_NESTING = 8

# GNU env's long options, listed in FULL so an abbreviation can be resolved
# against them. getopt_long accepts any prefix that names exactly one option,
# and no other env option begins with `s` — so `env --s`, `env --sp`, and
# `env --split` are `env --split-string` just as completely as the full
# spelling is. Matching only the full spelling is bypassed by deleting
# characters, which is why the set below exists instead of a literal list of
# the two spellings the guard used to know.
ENV_LONG_OPTIONS = {
    "--argv0", "--block-signals", "--chdir", "--debug", "--default-signal",
    "--help", "--ignore-environment", "--ignore-signal",
    "--list-signal-handling", "--null", "--split-string", "--unset",
    "--version",
}
# Of those, the ones whose value is a SEPARATE token, so the operand is never
# mistaken for the command (`env -u bash -c ...` consumes `bash` as the
# variable name). The signal options take an OPTIONAL value, which GNU reads
# only when it is attached with `=`, so they never consume a following token.
ENV_LONG_SEPARATE_VALUE = {"--argv0", "--chdir", "--split-string", "--unset"}

# env's single-letter options, by whether the rest of a cluster is more
# options or the option's value.
ENV_SHORT_NO_VALUE = frozenset("i0v")
ENV_SHORT_TAKES_VALUE = frozenset("uCaS")

# Builtins and wrappers that run whatever FOLLOWS them without changing what
# it is: `command env -S ...` runs exactly the `env` that `env -S ...` runs,
# and `env -- env -S ...` runs exactly the inner `env`. Reading the wrapper as
# the command is how a payload hides from a guard that inspects only the first
# word of an invocation.
COMMAND_PREFIX_WRAPPERS = {"command", "exec", "builtin", "nohup", "setsid"}
# The only option of those that consumes a separate following token
# (`exec -a NAME env -S ...`).
COMMAND_PREFIX_SEPARATE_VALUE = {"-a"}

# Shell options whose following token is an operand, not another option. The
# generic recursive scanner must step over these before looking for `-c`.
SHELL_OPTIONS_SEPARATE_VALUE = {
    "-o", "+o", "-O", "+O", "--rcfile", "--init-file", "--emulate",
}
SHELL_OPTIONS_INLINE_VALUE = ("--rcfile=", "--init-file=", "--emulate=")

# Boolean long options of the recognized shells. Listed only for PRECISION:
# a long option is never the command-string flag either way, but naming the
# ordinary ones keeps `bash --norc script.sh` from being treated as a possible
# value-taking option whose operand must be scanned past. zsh and ksh accept a
# long option per shell setting, so this set is deliberately not exhaustive —
# the scanner stays correct on the ones it does not name.
SHELL_LONG_OPTIONS_NO_VALUE = {
    "--debugger", "--dump-po-strings", "--dump-strings", "--emacs",
    "--globalrcs", "--help", "--interactive", "--login", "--monitor",
    "--no-globalrcs", "--no-rcs", "--noediting", "--noprofile", "--norc",
    "--norcs", "--posix", "--pretty-print", "--privileged", "--protected",
    "--rcs", "--restricted", "--verbose", "--version", "--vi", "--wordexp",
    "--xtrace",
}

# git's own options that take a SEPARATE value token, which therefore must be
# skipped when looking for the subcommand: `git -c core.hooksPath=x commit` and
# `git -C /repo commit` both reach `commit`.
GIT_GLOBAL_SEPARATE_VALUE = {
    "-c", "-C", "--config-env", "--git-dir", "--work-tree",
    "--namespace", "--exec-path", "--super-prefix",
}

# `git commit` long options whose value can be a separate token. Listed so the
# VALUE is never mistaken for a flag — `git commit --author "A -n B" -m x`
# must stay allowed. Only genuinely value-taking options belong here: adding a
# boolean one by mistake would swallow the token after it, and `git commit
# --amend -n` would go unnoticed.
COMMIT_LONG_SEPARATE_VALUE = {
    "--message", "--file", "--author", "--date", "--template", "--cleanup",
    "--reuse-message", "--reedit-message", "--fixup", "--squash",
    "--pathspec-from-file", "--trailer",
}

# Short `git commit` options that REQUIRE a value: `-m`/`-F`/`-c`/`-C`/`-t`.
# In a cluster the value is whatever follows them in the same token, or the next
# token when nothing does — which is why `-mn` is the message "n" and not a
# bypass, and `-nm msg` IS one.
COMMIT_SHORT_REQUIRED_VALUE = set("mFcCt")

# Short options taking an OPTIONAL value, which git only ever reads attached:
# `-uno` is --untracked-files=no, `-Skeyid` is --gpg-sign=keyid. The cluster
# ends at them either way, so `-un` is untracked-files "n" rather than a bypass.
COMMIT_SHORT_OPTIONAL_VALUE = set("uS")


def line_boundaries_as_separators(text):
    """Turn newlines into command separators, keeping continuations intact.

    A newline ends a command exactly as `;` does, but shlex treats it as plain
    whitespace — so `git commit -m x` on one line and `grep -n foo` on the next
    read as ONE invocation and the grep gets refused. That is the same
    false-positive class the short-form match exists to avoid, arriving through
    the boundary rather than through the token.

    Backslash-newline is joined first, because there the newline is NOT a
    boundary: `git commit \\` + newline + `-nm x` is one command, and turning
    that newline into a separator would hide a real bypass.

    Args:
        text: The command line, heredoc payloads already stripped.

    Returns:
        The same command with line breaks spelled as separators.
    """
    joined = text.replace("\r\n", "\n").replace("\\\n", " ")
    return joined.replace("\n", " ; ")


def shell_tokens(text):
    """Tokenize a command with shell operators kept as their own tokens.

    Args:
        text: The command line, heredoc payloads already stripped.

    Returns:
        The token list, with `;`, `|`, `&&`, `(` and friends standing alone.
    """
    lexer = shlex.shlex(
        line_boundaries_as_separators(text), posix=True, punctuation_chars=True
    )
    lexer.whitespace_split = True
    # shlex treats `#` as a comment introducer by default and would silently
    # truncate the rest of the line; `shlex.split` disables it, and so must this.
    lexer.commenters = ""
    return list(lexer)


def cluster_skips_verification(cluster):
    """Read a short-option cluster the way git's own parser reads it.

    Args:
        cluster: A single token beginning with one `-`, e.g. `-nm` or `-mn`.

    Returns:
        A pair (bypasses, consumes_next_token). `bypasses` is True when a real
        `-n` option is present; `consumes_next_token` is True when the cluster
        ends in a value-taking option whose value is the following token.
    """
    body = cluster[1:]
    for offset, letter in enumerate(body):
        if letter == "n":
            return (True, False)
        if letter in COMMIT_SHORT_REQUIRED_VALUE:
            # Everything after this letter is the value. It is a separate token
            # only when nothing is attached.
            return (False, offset == len(body) - 1)
        if letter in COMMIT_SHORT_OPTIONAL_VALUE:
            return (False, False)
    return (False, False)


def commit_bypasses_verification(argv):
    """Whether a `git commit` invocation's argv carries a real short `-n`.

    Args:
        argv: Tokens following the `commit` subcommand, to the end of the line.

    Returns:
        True if git would read one of them as --no-verify.
    """
    index = 0
    while index < len(argv):
        token = argv[index]
        index += 1
        # `--` ends the options; everything after it is a pathspec, and a file
        # legitimately named `-n` is not a bypass.
        if token in COMMAND_SEPARATORS or token == "--":
            return False
        if token.startswith("--"):
            if token in COMMIT_LONG_SEPARATE_VALUE:
                index += 1
            elif disables_verification(token):
                return True
            continue
        # A bare `-` is git's stdin placeholder, not an option cluster.
        if not token.startswith("-") or token == "-":
            continue
        bypasses, consumes_next = cluster_skips_verification(token)
        if bypasses:
            return True
        if consumes_next:
            index += 1
    return False


def subcommand_after_git(tokens, start):
    """Find the subcommand a `git` token introduces, and its argv.

    Args:
        tokens: The full operator-aware token list.
        start: Index just past the `git` token.

    Returns:
        A pair (subcommand, argv), or None when the invocation names none.
    """
    index = start
    while index < len(tokens):
        token = tokens[index]
        if token in COMMAND_SEPARATORS:
            return None
        if not token.startswith("-"):
            return (token, tokens[index + 1:])
        index += 2 if token in GIT_GLOBAL_SEPARATE_VALUE else 1
    return None


def resolve_env_long_option(name):
    """Resolve one GNU env long option, abbreviations included.

    Args:
        name: A token beginning with `--`, with any `=value` already removed.

    Returns:
        The full option spelling; "" when the abbreviation names more than one
        option, which real env refuses; None when nothing matches at all.
    """
    if not name.startswith("--") or name == "--":
        return None
    if name in ENV_LONG_OPTIONS:
        return name
    matches = [option for option in ENV_LONG_OPTIONS if option.startswith(name)]
    if len(matches) == 1:
        return matches[0]
    return "" if matches else None


def env_option_kind(token):
    """Classify one token sitting in an `env` option position.

    Returns:
        "split-string" when env will reparse an argv value as shell words,
        "separate-value" when the NEXT token is this option's operand,
        "no-value" when the token stands alone, "ambiguous" when env accepts
        the token but this parser cannot say which option it is, or None when
        the token is not an option.
    """
    if not token.startswith("-") or token in {"-", "--"}:
        return None
    if token.startswith("--"):
        name = token.split("=", 1)[0]
        resolved = resolve_env_long_option(name)
        if not resolved:
            # Either unknown to this parser or an abbreviation naming several
            # options. Neither can be reasoned about, so say so and let the
            # caller fail closed rather than read past it.
            return "ambiguous"
        if resolved == "--split-string":
            return "split-string"
        if "=" in token:
            return "no-value"
        return (
            "separate-value" if resolved in ENV_LONG_SEPARATE_VALUE else "no-value"
        )
    for position, letter in enumerate(token[1:], start=2):
        if letter == "S":
            return "split-string"
        if letter in ENV_SHORT_TAKES_VALUE:
            # The rest of this cluster is the option's value when there is
            # one; otherwise the value is the following token.
            return "no-value" if position <= len(token) - 1 else "separate-value"
        if letter not in ENV_SHORT_NO_VALUE:
            return "ambiguous"
    return "no-value"


def strip_command_prefix(prefix):
    """Drop the tokens that precede a command without changing what it is.

    Variable assignments, the `command`/`exec`/`builtin` builtins, and nested
    `env` wrappers all leave the following word in command position. Reading
    any of them as the command itself is what let `command env -S ...` and
    `env -- env -S ...` slip past the split-string check: the prefix failed
    the "assignments only" test, so the wrapped `env` was never classified.

    Args:
        prefix: The tokens between the last command separator and the
            candidate program.

    Returns:
        A pair (status, remainder). "ok" carries the tokens still standing
        between the separator and the candidate — empty means the candidate is
        in command position. "operand" means the candidate is a wrapper
        option's value rather than a command. "ambiguous" means a wrapper
        option could not be classified and the caller must fail closed.
    """
    cursor = 0
    while cursor < len(prefix):
        token = prefix[cursor]
        if "=" in token and not token.startswith(("=", "-")):
            cursor += 1
            continue
        program = token.rsplit("/", 1)[-1]
        if program in COMMAND_PREFIX_WRAPPERS:
            cursor += 1
            while cursor < len(prefix) and prefix[cursor].startswith("-"):
                if prefix[cursor] == "--":
                    cursor += 1
                    break
                if prefix[cursor] in COMMAND_PREFIX_SEPARATE_VALUE:
                    if cursor + 1 >= len(prefix):
                        return ("operand", [])
                    cursor += 2
                    continue
                cursor += 1
            continue
        if program == "env":
            cursor += 1
            while cursor < len(prefix):
                option = prefix[cursor]
                if option == "--":
                    cursor += 1
                    break
                kind = env_option_kind(option)
                if kind is None:
                    break
                if kind == "ambiguous":
                    return ("ambiguous", [])
                if kind == "split-string":
                    # Everything after `-S` is env's own opaque payload, so the
                    # candidate is not a command at all.
                    return ("operand", [])
                if kind == "separate-value":
                    if cursor + 1 >= len(prefix):
                        return ("operand", [])
                    cursor += 2
                    continue
                cursor += 1
            continue
        break
    return ("ok", prefix[cursor:])


def shell_starts_command(tokens, index):
    """Whether a recognized shell token occupies command position."""
    start = index - 1
    while start >= 0 and tokens[start] not in COMMAND_SEPARATORS:
        start -= 1
    status, remainder = strip_command_prefix(tokens[start + 1:index])
    if status == "ambiguous":
        # A prefix option this parser cannot classify may still be launching
        # the shell. Fail closed rather than trusting the wrapper.
        return True
    return status == "ok" and not remainder


def env_uses_split_string(tokens, index):
    """Whether a command-position env invocation uses split-string parsing.

    `env -S` reparses one opaque argv value as shell-like words. Inspecting the
    outer command cannot prove what executable or nested shell that second
    parse will produce, so the verification guard refuses the ambiguous form.

    Args:
        tokens: The full operator-aware token list.
        index: Index of the candidate env executable.

    Returns:
        True when env will reparse a split-string payload.
    """
    start = index - 1
    while start >= 0 and tokens[start] not in COMMAND_SEPARATORS:
        start -= 1
    status, remainder = strip_command_prefix(tokens[start + 1:index])
    if status != "ok" or remainder:
        return False

    cursor = index + 1
    while cursor < len(tokens):
        token = tokens[cursor]
        if token in COMMAND_SEPARATORS or token == "--":
            return False
        kind = env_option_kind(token)
        if kind == "split-string":
            return True
        if kind == "ambiguous":
            # An option env accepts but this parser cannot name makes the rest
            # of the invocation unreadable; refuse instead of reading past it.
            return True
        if kind is None:
            if "=" in token and not token.startswith(("=", "-")):
                cursor += 1
                continue
            return False
        cursor += 2 if kind == "separate-value" else 1
    return False


def nested_shell_payload(tokens, index):
    """Return a shell `-c` payload, or True when option parsing is ambiguous."""
    cursor = index + 1
    opaque_option_seen = False
    while cursor < len(tokens):
        option = tokens[cursor]
        if option in COMMAND_SEPARATORS or option == "--":
            return None
        if not option.startswith(("-", "+")):
            # Ordinarily the script operand, which ends option parsing. After
            # a long option this parser cannot name it may instead be that
            # option's value (`zsh --emulate ksh -c ...`), so keep scanning
            # rather than concluding there is no command string.
            if not opaque_option_seen:
                return None
            cursor += 1
            continue
        if option in SHELL_OPTIONS_SEPARATE_VALUE:
            if cursor + 1 >= len(tokens) or tokens[cursor + 1] in COMMAND_SEPARATORS:
                return True
            cursor += 2
            continue
        if option.startswith(SHELL_OPTIONS_INLINE_VALUE):
            cursor += 1
            continue
        # A LONG option is never the command-string flag, and testing it for a
        # bare `c` was the bug: `--norc` and `--restricted` merely CONTAIN one,
        # so the real `-c` that followed was consumed as their payload and the
        # nested `git commit --no-verify` was never classified at all. The
        # command string lives only in a single-dash cluster (`-c`, `-lc`).
        if option.startswith("--"):
            if option not in SHELL_LONG_OPTIONS_NO_VALUE:
                opaque_option_seen = True
            cursor += 1
            continue
        if "c" in option[1:]:
            if cursor + 1 >= len(tokens) or tokens[cursor + 1] in COMMAND_SEPARATORS:
                return True
            return tokens[cursor + 1]
        cursor += 1
    return None


# ── Reach: the contents of a script this command EXECUTES ──────────────────
#
# The guard used to inspect argv and nothing else, so `bash nv.sh` showed it two
# tokens, `bash` and a path, while the script it was about to run carried
# `git commit --no-verify` and skipped pre-commit exactly as completely as the
# inline spelling. Measured before this change: inline BLOCK, the same line one
# file away ALLOW — on bash, sh, zsh, `source`, `.`, an absolute interpreter
# path, and behind every wrapper.
#
# THE RULE IS TAKEN FROM parity-safety-net.sh RATHER THAN INVENTED HERE: a path
# is followed ONLY when the command EXECUTES it. `grep -n x nv.sh`,
# `git commit -F msg.txt` and `gh pr create --body-file body.md` name a file as
# DATA, and following those is the known-wrong fix that guard names by number —
# it refuses ordinary reads and attributes a file's capability to a command that
# merely mentions it. So COMMAND POSITION decides, never the presence of a path.
#
# Non-shell interpreters (`python3 x.py`, `node x.mjs`) are deliberately NOT
# followed. These matchers are git and shell syntax; running them over a Python
# or JS file buys mis-attribution, not coverage.
#
# Reach was not safe to add until the bare-token match was narrowed to a git
# argv — see `git_argv_disables_verification`. With the old unscoped matcher
# this guard would have refused `bash` on its own source, on every husky hook,
# and on much of this repository, all of which carry the literal token in prose.
FOLLOW_MAX_BYTES = 262144
FOLLOW_MAX_FILES = 8
FOLLOW_MAX_DEPTH = 3

# The `.` builtin and its `source` alias run the named file in the CURRENT
# shell, which is execution by any definition.
SOURCE_BUILTINS = {"source", "."}

# Wrappers that run what FOLLOWS them without changing what it is, mapped to
# (options whose value is a SEPARATE token, positional operands consumed).
#
# The second field is why this table exists rather than a bare set. `timeout 5
# bash x` puts a POSITIONAL between the wrapper and the interpreter, so a walk
# that steps over `-flags` only stops at `5` and never reaches `bash` — the
# shape that walked past three guards in this family before it was named.
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

# Dispatchers that BUILD a command out of their own arguments, putting an
# interpreter at a command position the text does not spell as one. Scoped to
# exactly one token — the word after `find -exec`/`-execdir`, and `xargs`'s
# first operand — because latching "an interpreter name anywhere" refuses
# `find . -name bash`, where `bash` is a filename PATTERN and nothing runs.
FIND_EXEC_FLAGS = {"-exec", "-execdir"}

# A value the SHELL computes. This guard sees the command before expansion, so
# it cannot prove which file such a token will name.
COMPUTED_VALUE = re.compile(r"[$`]")


def strip_shell_comments(text):
    """Remove `#` comments from a file's contents, quote-aware.

    Applied to FILE CONTENTS and never to a typed command, because the two are
    genuinely different problems. On a typed command `#` handling is a
    bash-versus-shlex divergence a guard can be attacked through, which is why
    `shell_tokens` sets `commenters = ""`. Inside a file the question is not
    adversarial and the answer is unambiguous: a comment cannot execute.

    It is also what makes reach usable at all. This repository's guards, its
    husky hooks and its own refusal messages discuss `git commit -n` and
    `--no-verify` in prose, and a comment line reading "`git commit -n` skips
    pre-commit" tokenizes into exactly the argv of a real bypass. Following a
    file without dropping its comments refuses this guard's own source.

    Args:
        text: A file's contents.

    Returns:
        The same text with unquoted comments removed.
    """
    output = []
    for line in text.splitlines():
        quote = ""
        escaped = False
        cut = None
        for position, character in enumerate(line):
            if escaped:
                escaped = False
                continue
            if character == "\\" and quote != "'":
                escaped = True
                continue
            if quote:
                if character == quote:
                    quote = ""
                continue
            if character in "'\"":
                quote = character
                continue
            # A `#` only opens a comment at the start of a word, so `x#y` and
            # `${x#y}` keep their hashes.
            if character == "#" and (position == 0 or line[position - 1].isspace()):
                cut = position
                break
        output.append(line if cut is None else line[:cut])
    return "\n".join(output)


def statement_slices(tokens):
    """Split an operator-aware token list into statements.

    Args:
        tokens: The full operator-aware token list.

    Returns:
        Pairs of (separator that PRECEDED the statement, its tokens). The
        separator is carried because `<` is both a statement boundary and the
        link between `bash` and the script it reads — `bash < nv.sh` runs that
        file as surely as `bash nv.sh` does.
    """
    statements = []
    current = []
    separator = ""
    for token in tokens:
        if token in COMMAND_SEPARATORS:
            statements.append((separator, current))
            current = []
            separator = token
            continue
        current.append(token)
    statements.append((separator, current))
    return statements


def command_word(statement):
    """The program a statement runs, and the tokens after it.

    Steps over leading variable assignments and over wrappers that do not
    change what runs. Reading a wrapper as the command is how a payload hides
    from a guard that inspects only a statement's first word.

    Args:
        statement: One statement's tokens.

    Returns:
        A triple (program, args, opaque). `opaque` is True when a wrapper's
        option grammar could not be read, which the caller must treat as an
        execution it cannot follow rather than as an ordinary command.
    """
    index = 0
    while index < len(statement):
        token = statement[index]
        if "=" in token and not token.startswith(("=", "-")):
            index += 1
            continue
        program = token.rsplit("/", 1)[-1]
        if program == "env":
            index += 1
            while index < len(statement):
                option = statement[index]
                if option == "--":
                    index += 1
                    break
                kind = env_option_kind(option)
                if kind is None:
                    if "=" in option and not option.startswith(("=", "-")):
                        index += 1
                        continue
                    break
                if kind in {"ambiguous", "split-string"}:
                    # `env -S` reparses an opaque payload as shell words, and an
                    # unnameable option makes the rest unreadable. Neither can be
                    # resolved to a program.
                    return (None, [], True)
                index += 2 if kind == "separate-value" else 1
            continue
        if program in FOLLOW_WRAPPERS:
            separate, positional = FOLLOW_WRAPPERS[program]
            index += 1
            while index < len(statement) and statement[index].startswith("-"):
                option = statement[index]
                if option == "--":
                    index += 1
                    break
                index += 2 if option in separate else 1
            index += positional
            continue
        return (program, statement[index + 1 :], False)
    return (None, [], False)


def shell_script_operand(args):
    """The file a shell invocation runs, when it runs one.

    Args:
        args: The tokens following the shell's own name.

    Returns:
        The operand token, or None when the invocation runs no script file —
        an interactive shell, or a `-c` command string, which
        `nested_shell_payload` already owns.
    """
    index = 0
    opaque_option_seen = False
    while index < len(args):
        token = args[index]
        if token == "--":
            index += 1
            break
        if not token.startswith(("-", "+")):
            if not opaque_option_seen:
                break
            index += 1
            opaque_option_seen = False
            continue
        if token in SHELL_OPTIONS_SEPARATE_VALUE:
            index += 2
            continue
        if token.startswith(SHELL_OPTIONS_INLINE_VALUE):
            index += 1
            continue
        if token.startswith("--"):
            if token not in SHELL_LONG_OPTIONS_NO_VALUE:
                opaque_option_seen = True
            index += 1
            continue
        if "c" in token[1:]:
            return None
        index += 1
    return args[index] if index < len(args) else None


def dispatched_commands(program, args):
    """Commands a dispatcher builds out of its own arguments.

    `find … -exec bash {} \\;` and `find … | xargs bash` put an interpreter at
    a command position the text does not spell as one. The exception is scoped
    to a `find`/`xargs` statement and to exactly ONE token, because latching an
    interpreter NAME anywhere refuses `find . -name bash` and
    `xargs grep bash`, where the word is a pattern and nothing is executed.

    Args:
        program: The dispatcher's name.
        args: Its arguments.

    Returns:
        Pairs of (program, args) the dispatcher will run.
    """
    built = []
    if program == "find":
        for index, token in enumerate(args):
            if token in FIND_EXEC_FLAGS and index + 1 < len(args):
                built.append((args[index + 1].rsplit("/", 1)[-1], args[index + 2 :]))
        return built
    if program != "xargs":
        return built
    index = 0
    while index < len(args):
        token = args[index]
        if token == "--":
            index += 1
            break
        if not token.startswith("-"):
            break
        # `-I`, `-n`, `-P`, `-s`, `-a`, `-d`, `-E`, `-L` take a value; the rest
        # do not. Over-consuming here only loses the dispatcher, which degrades
        # to the fail-open this file's header already accepts.
        index += 2 if token in {"-I", "-n", "-P", "-s", "-a", "-d", "-E", "-L"} else 1
    if index < len(args):
        built.append((args[index].rsplit("/", 1)[-1], args[index + 1 :]))
    return built


def resolve_script(token):
    """Resolve a token naming a script to a readable file.

    Args:
        token: The operand an interpreter will run.

    Returns:
        A pair (path, reason). Exactly one is set. `reason` names why the
        execution could not be followed, which the caller fails CLOSED on:
        silence about a command that is definitely running something the guard
        cannot read is the fail-open this change exists to close.
    """
    if COMPUTED_VALUE.search(token):
        return (None, "a computed path the guard cannot resolve before the shell does")
    text = token.strip().strip("'\"")
    # `bash -` and a bare `-` read the script from stdin; there is no file.
    if not text or text == "-":
        return (None, None)
    candidates = [text]
    if not os.path.isabs(text):
        project = os.environ.get("CLAUDE_PROJECT_DIR", "")
        candidates.append(os.path.join(os.getcwd(), text))
        if project:
            candidates.append(os.path.join(project, text))
    for candidate in candidates:
        try:
            if not os.path.isfile(candidate):
                continue
            if os.path.getsize(candidate) > FOLLOW_MAX_BYTES:
                return (None, "a script larger than the inspection cap")
        except OSError:
            continue
        return (candidate, None)
    return (None, "a script that does not exist or cannot be read")


def executed_scripts(tokens):
    """The files a command line will RUN, and the executions it cannot follow.

    Args:
        tokens: The full operator-aware token list.

    Returns:
        A pair (paths, reasons). `reasons` is non-empty when a command position
        clearly runs a script the guard cannot read.
    """
    paths = []
    reasons = []
    previous_shell_awaiting_stdin = False
    for separator, statement in statement_slices(tokens):
        if separator == "<" and previous_shell_awaiting_stdin and statement:
            # `bash < nv.sh`: the redirect target is the script.
            path, reason = resolve_script(statement[0])
            if reason:
                reasons.append((reason, statement[0]))
            elif path:
                paths.append(path)
        previous_shell_awaiting_stdin = False
        if not statement:
            continue
        program, args, opaque = command_word(statement)
        if opaque:
            reasons.append(("an invocation whose wrapper options cannot be read", ""))
            continue
        if program is None:
            continue
        for name, arguments in [(program, args)] + dispatched_commands(program, args):
            if name in SOURCE_BUILTINS:
                operand = arguments[0] if arguments else None
            elif name in SHELL_PROGRAMS:
                operand = shell_script_operand(arguments)
                if operand is None and not arguments:
                    previous_shell_awaiting_stdin = True
            else:
                continue
            if operand is None:
                continue
            path, reason = resolve_script(operand)
            if reason:
                reasons.append((reason, operand))
            elif path:
                paths.append(path)
    return paths, reasons


def read_script(path):
    """The text of a script the command runs, comments removed.

    Args:
        path: A path from `resolve_script`.

    Returns:
        The contents, or an empty string when unreadable.
    """
    try:
        with open(path, encoding="utf-8", errors="replace") as handle:
            return strip_shell_comments(handle.read(FOLLOW_MAX_BYTES))
    except OSError:
        return ""


def git_argv_disables_verification(argv):
    """Whether a git invocation's argv carries `--no-verify` or an abbreviation.

    SCOPED to a git invocation, which is the change that made file reach usable.
    The token match used to fire anywhere on the line, so `echo --no-verify` and
    `grep -rl -- "--no-verify" scripts/` were both refused — ordinary commands
    that run no git at all. That was survivable while the guard read only argv.
    It is not once the guard reads FILE CONTENTS, because this file, every husky
    hook, and much of this repository carry the literal token in prose and in
    refusal text; an unscoped matcher plus reach refuses the repository's own
    operations on the first command.

    Deliberately NOT narrowed to `commit`. `git push --no-verify` skips pre-push
    and `git am` / `git merge` skip their own hooks, so every subcommand's argv
    is scanned. Only the SHORT `-n` needs the commit scope, because `-n` is
    --dry-run to push and --no-stat to merge — see
    `commit_bypasses_verification`.

    Args:
        argv: Tokens following the `git` token, to the end of the line.

    Returns:
        True if git would read one of them as --no-verify.
    """
    for token in argv:
        # `--` ends the options; a pathspec literally named `--no-verify` is a
        # file, not a bypass.
        if token in COMMAND_SEPARATORS or token == "--":
            return False
        if disables_verification(token):
            return True
    return False


def git_skips_verification(text, depth=0):
    """Whether the command runs a git invocation that skips verification.

    Args:
        text: The command line, heredoc payloads already stripped.
        depth: Number of recognized shell payloads already traversed.

    Returns:
        True if any `git commit` invocation on the line skips verification.
    """
    try:
        scoped_tokens = shell_tokens(text)
    except ValueError:
        return False
    for index, token in enumerate(scoped_tokens):
        if token.rsplit("/", 1)[-1] == "env" and env_uses_split_string(
            scoped_tokens, index
        ):
            return True
    for index, token in enumerate(scoped_tokens):
        # `/usr/bin/git` and a bare `git` are the same program; an env prefix
        # (`HUSKY=1 git commit -n`) simply sits in an earlier token.
        if token != "git" and not token.endswith("/git"):
            continue
        # The LONG flag, scoped to this invocation's argv rather than matched
        # anywhere on the line. This replaces the unscoped token match that used
        # to live in the flat loop below.
        if git_argv_disables_verification(scoped_tokens[index + 1 :]):
            return True
        found = subcommand_after_git(scoped_tokens, index + 1)
        if found and found[0] == "commit" and commit_bypasses_verification(found[1]):
            return True
    if depth >= MAX_SHELL_NESTING:
        return True
    for index, token in enumerate(scoped_tokens):
        program = token.rsplit("/", 1)[-1]
        if program not in SHELL_PROGRAMS or not shell_starts_command(
            scoped_tokens, index
        ):
            continue
        payload = nested_shell_payload(scoped_tokens, index)
        if payload is True:
            return True
        if isinstance(payload, str) and git_skips_verification(payload, depth + 1):
            return True
    return False


def token_bypass(tokens):
    """Whether any token disables hooks by environment or by git config.

    These stay UNSCOPED, unlike the `--no-verify` match that moved into
    `git_argv_disables_verification`. The difference is what the token means
    where it appears: `HUSKY=0` and `core.hooksPath=` are assignments that
    configure whatever git runs next, so they legitimately sit before the
    invocation and often on a different line of a script. `--no-verify` is an
    option, and an option belongs to an argv.

    Args:
        tokens: Punctuation-stripped tokens of one command or script.

    Returns:
        True when a token disables verification.
    """
    for i, token in enumerate(tokens):
        if token == "HUSKY=0" or token.startswith("HUSKY_SKIP_HOOKS="):
            return True
        # Allowlist the destinations, do not denylist the disabling ones.
        #
        # This used to block only "" and /dev/null. But hooks are disabled just
        # as completely by pointing hooksPath at any directory that happens to
        # contain none — `-c core.hooksPath=/tmp/empty` bypassed every hook while
        # reading as an ordinary path — so a denylist of "obviously disabling"
        # values can always be stepped around by naming a third thing. The set of
        # paths that DISABLE hooks is unbounded; the set that legitimately
        # relocates them is tiny and known, so the allowlist is the only side
        # that can be enumerated.
        #
        # Matched case-insensitively because git config variable names are:
        # `CORE.HOOKSPATH=/x` and `core.hookspath=/x` are the same setting to
        # git, so a case-sensitive check is bypassed by holding down shift.
        lowered = token.lower()
        if lowered.startswith("core.hookspath="):
            if not is_permitted_hooks_path(token.split("=", 1)[1]):
                return True
        if lowered == "core.hookspath" and i + 1 < len(tokens):
            if not is_permitted_hooks_path(tokens[i + 1]):
                return True
        # `git --config-env=core.hooksPath=SOMEVAR` sets the same config, reading
        # the value out of the named environment variable. The path therefore is
        # not in the command at all, so there is nothing to allowlist against —
        # SOMEVAR can hold anything by the time git reads it. Any core.hooksPath
        # routed through --config-env is refused outright.
        if lowered.startswith("--config-env="):
            spec = token.split("=", 1)[1]
            if spec.split("=", 1)[0].strip().lower() == "core.hookspath":
                return True
        # git accepts `--config-env <name>=<envvar>` as TWO tokens as well as
        # one, and guarding only the `=` spelling was worse than missing the
        # separate form outright: the trailing `core.hooksPath=.husky` then fell
        # through to the allowlist above, which reads `.husky` as a PATH and
        # permits it. But here it is an ENVIRONMENT VARIABLE NAME, and
        # `env '.husky=/dev/null' git --config-env core.hooksPath=.husky` really
        # does resolve hooksPath to /dev/null. The allowlist was being used as
        # the bypass.
        #
        # Checked at the `--config-env` token, which the loop reaches first, so
        # the refusal happens before the value token can be mistaken for a path.
        if lowered == "--config-env" and i + 1 < len(tokens):
            spec = tokens[i + 1]
            if spec.split("=", 1)[0].strip().strip("'\"").lower() == "core.hookspath":
                return True
        # `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath
        # GIT_CONFIG_VALUE_0=/dev/null git commit` sets command-scope config the
        # same way `-c core.hooksPath=...` does — env-var-style assignments ahead
        # of the invocation instead of a flag — so it disables every hook just as
        # completely while matching none of the token shapes above. Upstream
        # missed this until a downstream fork hardened its own copy against it,
        # which is the one direction a guard must never be caught in.
        #
        # The index is matched as `\d+` rather than pinned to 0: git accepts any
        # index below GIT_CONFIG_COUNT, so a single-index check is evaded by
        # typing a 1. Refused outright, like --config-env=, because the path
        # lives in a separate GIT_CONFIG_VALUE_<n> token that can be exported
        # earlier, reordered, or left out entirely — there is nothing here to
        # allowlist against.
        key_match = re.match(r"git_config_key_\d+=(.*)$", lowered, re.DOTALL)
        if key_match and key_match.group(1).strip().strip("'\"") == "core.hookspath":
            return True
        # `git -c` propagates command-scope config through GIT_CONFIG_PARAMETERS.
        # Parsing the value as Git's shell-quoted parameter list distinguishes
        # the key from an unrelated value that merely contains the same text.
        if re.match(r"git_config_parameters\+?=", lowered):
            parameters = token.split("=", 1)[1]
            # The guard sees the command before the shell expands assignments. A
            # variable or command substitution can therefore hide hooksPath from
            # this parser and reveal it only to Git. Refuse unresolved values;
            # the guard cannot safely prove what configuration they will become.
            if "$" in parameters or "`" in parameters:
                return True
            try:
                configured = shlex.split(parameters, posix=True)
            except ValueError:
                configured = []
            if any(
                parameter.split("=", 1)[0].strip().lower() == "core.hookspath"
                for parameter in configured
            ):
                return True
    return False


def flat_tokens(text):
    """Punctuation-stripped tokens, or None when the text does not lex.

    Args:
        text: A command line or a script's contents.

    Returns:
        The token list, or None.
    """
    try:
        return [token.strip("();|&") for token in shlex.split(text, posix=True)]
    except ValueError:
        return None


def verdict(text, depth=0, followed=None):
    """Whether this text, or a script it runs, bypasses verification.

    Args:
        text: A command line or a followed script's contents.
        depth: Number of scripts already followed.
        followed: Real paths already inspected, so a cycle terminates.

    Returns:
        True when the command must be refused.
    """
    if git_skips_verification(text):
        return True
    tokens = flat_tokens(text)
    if tokens is not None and token_bypass(tokens):
        return True
    try:
        scoped_tokens = shell_tokens(text)
    except ValueError:
        # Text this parser cannot lex is left to the checks above, which is the
        # same accepted fail-open the header records for an unlexable command.
        return False
    paths, reasons = executed_scripts(scoped_tokens)
    if reasons:
        reason, operand = reasons[0]
        print(
            f"block-no-verify: refusing an execution it cannot inspect — {reason}"
            + (f" ({operand})" if operand else ""),
            file=sys.stderr,
        )
        return True
    if followed is None:
        followed = set()
    for path in paths:
        try:
            key = os.path.realpath(path)
        except OSError:
            key = path
        if key in followed:
            continue
        if len(followed) >= FOLLOW_MAX_FILES or depth >= FOLLOW_MAX_DEPTH:
            print(
                "block-no-verify: refusing at the script-following cap rather "
                f"than skipping past it ({path})",
                file=sys.stderr,
            )
            return True
        followed.add(key)
        if verdict(read_script(path), depth + 1, followed):
            print(
                f"block-no-verify: {path} — a script this command runs — "
                "bypasses git's verification hooks.",
                file=sys.stderr,
            )
            return True
    return False


if verdict(strip_heredocs(command)):
    sys.exit(1)

sys.exit(0)
PY
then
  jq -n '{
    "hookSpecificOutput": {
      "hookEventName": "PreToolUse",
      "permissionDecision": "deny",
      "permissionDecisionReason": "Blocked: this command bypasses pre-commit/pre-push hooks (--no-verify or its short form -n, HUSKY=0, or core.hooksPath disabling). `git commit -n` and a cluster such as `-nm \"msg\"` skip pre-commit exactly as completely as the long flag. Fix the underlying issue (security audit, lint, typecheck, tests, formatting) instead. If a fix is genuinely impossible, ask the user to make the risk-acceptance decision and add a specific documented ignore; never bypass the hook."
    }
  }'
fi

exit 0

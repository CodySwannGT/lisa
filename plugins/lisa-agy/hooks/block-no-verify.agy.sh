#!/usr/bin/env bash
# Antigravity (agy) PreToolUse hook: blocks shell commands that bypass Lisa's
# git quality gates (exact parity with the Claude block-no-verify.sh): the
# `--no-verify` long flag and any abbreviation git accepts for it, its short
# form `-n` as a real argv token of a `git commit` (bare or bundled, as in
# `-nm "msg"`), `HUSKY=0`/`HUSKY_SKIP_HOOKS=` (disables husky hooks), and
# `core.hooksPath` pointed anywhere but an allowlisted in-repo hooks dir
# (disables all git hooks). Shell-token matching avoids false positives from
# issue bodies, heredocs, and commit-message prose while still catching quoted
# real argv values such as `git -c "core.hooksPath=/dev/null"`.
#
# This file used to be cited BY the Claude variant as the reason the short `-n`
# was excluded ("grep cannot distinguish a real -n option from prose"). Neither
# variant greps: both tokenize, which is exactly what tells an option from a
# quoted message. The cross-reference outlived the matcher it described, and a
# stale rationale is worse than none — it reads as a considered decision and
# stops the next reader from re-examining it.
#
# agy protocol (distinct from the Claude block-no-verify.sh exit-code protocol):
#   - stdin  = JSON: { "toolCall": { "name": "run_command",
#                      "args": { "CommandLine": "<shell command>" } }, ... }
#   - stdout = JSON decision: {"decision":"deny","reason":"..."} | {"decision":"allow"}
#
# Shipped as a GLOBAL agy plugin hook (hooks.json at the plugin root, installed
# to ~/.gemini/config/plugins/<variant>/). Matches agy's shell tool `run_command`
# on PreToolUse. jq parses the JSON envelope (per project rule: never grep/sed
# JSON); the command string itself is matched with grep (it is a plain string,
# not JSON). Malformed/empty stdin → allow (fail open, never crash the tool).
set -uo pipefail

allow() {
  printf '%s\n' '{"decision":"allow"}'
  exit 0
}

deny() {
  printf '%s\n' '{"decision":"deny","reason":"This command bypasses Lisa pre-commit/pre-push quality gates (--no-verify or its short form -n, HUSKY=0, or core.hooksPath disabling). `git commit -n` and a cluster such as `-nm \"msg\"` skip pre-commit exactly as completely as the long flag. Fix the underlying issue (security audit, lint, typecheck, tests, formatting) instead. If a fix is genuinely impossible, ask the user to make the risk-acceptance decision and add a specific documented ignore; never bypass the hook."}'
  exit 0
}

input="$(cat 2>/dev/null || true)"
[ -z "$input" ] && allow

command_str="$(printf '%s' "$input" | jq -r '.toolCall.args.CommandLine // empty' 2>/dev/null || true)"
[ -z "$command_str" ] && allow

command -v python3 >/dev/null 2>&1 || allow

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


try:
    tokens = shlex.split(strip_heredocs(command), posix=True)
except ValueError:
    sys.exit(0)

normalized_tokens = [token.strip("();|&") for token in tokens]

# Git resolves any UNAMBIGUOUS abbreviation of a long option, so `--no-veri`
# skips hooks exactly as completely as `--no-verify`. Matched as a prefix
# rather than by listing abbreviations; `--no-verbose` diverges after
# `--no-ver` and so is correctly not caught.
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

# The only relocations that keep a repo's own hooks in play. Anything else —
# including "" and /dev/null, which are simply the two most obvious members of
# the blocked set rather than special cases — is refused.
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


# `git commit -n` is the short spelling of --no-verify and skips pre-commit and
# commit-msg identically; so does a cluster such as `-nm "msg"`. Matching it
# needs SCOPE, which is why it was long excluded: `-n` means --dry-run to `git
# push`, --no-stat to `git merge`, and a line count to head/tail/sort/grep. Only
# `git commit` reads it as a hook bypass, so only that invocation's argv is
# scanned. Parity with the Claude block-no-verify.sh, which carries the full
# rationale for why a tokenizer can make this distinction and a grep could not.
#
# A SECOND tokenizer pass, deliberately not shared with the checks above:
# `shlex.split` glues `|` and `;` to their neighbours, so `git commit -m x &&
# grep -n foo` would read as one long git invocation and refuse the grep.
# `punctuation_chars=True` emits the operators as their own tokens, giving the
# scan a boundary to stop at.
COMMAND_SEPARATORS = {
    ";", "|", "||", "&", "&&", "(", ")", "<", ">", ">>", "<<", "&|",
}

# GNU env's long options in FULL, so an ABBREVIATION can be resolved against
# them: getopt_long accepts any prefix naming exactly one option, and nothing
# but --split-string starts with `s`, so `env --s` splits a string just as
# completely as `env --split-string` does.
ENV_LONG_OPTIONS = {
    "--argv0", "--block-signals", "--chdir", "--debug", "--default-signal",
    "--help", "--ignore-environment", "--ignore-signal",
    "--list-signal-handling", "--null", "--split-string", "--unset",
    "--version",
}
# Of those, the ones whose value is a SEPARATE token. The signal options take
# an OPTIONAL value, which GNU reads only when attached with `=`.
ENV_LONG_SEPARATE_VALUE = {"--argv0", "--chdir", "--split-string", "--unset"}
ENV_SHORT_NO_VALUE = frozenset("i0v")
ENV_SHORT_TAKES_VALUE = frozenset("uCaS")

# Builtins and wrappers that run whatever FOLLOWS them without changing what it
# is, so `command env -S ...` runs exactly the `env` that `env -S ...` runs.
COMMAND_PREFIX_WRAPPERS = {"command", "exec", "builtin", "nohup", "setsid"}
COMMAND_PREFIX_SEPARATE_VALUE = {"-a"}

# git's own options taking a SEPARATE value token, skipped when looking for the
# subcommand so `git -c core.hooksPath=x commit` still reaches `commit`.
GIT_GLOBAL_SEPARATE_VALUE = {
    "-c", "-C", "--config-env", "--git-dir", "--work-tree",
    "--namespace", "--exec-path", "--super-prefix",
}

# `git commit` long options whose value can be a separate token, listed so the
# VALUE is never read as a flag (`git commit --author "A -n B" -m x` is fine).
# Only genuinely value-taking options belong here: a boolean added by mistake
# would swallow the next token and miss `git commit --amend -n`.
COMMIT_LONG_SEPARATE_VALUE = {
    "--message", "--file", "--author", "--date", "--template", "--cleanup",
    "--reuse-message", "--reedit-message", "--fixup", "--squash",
    "--pathspec-from-file", "--trailer",
}

# Short options REQUIRING a value. In a cluster the value is whatever follows in
# the same token, or the next token when nothing does — which is why `-mn` is
# the message "n" and not a bypass, while `-nm msg` is one.
COMMIT_SHORT_REQUIRED_VALUE = set("mFcCt")

# Short options taking an OPTIONAL value, which git reads only when attached:
# `-uno` is --untracked-files=no, so `-un` is a mode and not a bypass.
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
    # shlex treats `#` as a comment introducer and would truncate the line;
    # `shlex.split` disables it, and so must this.
    lexer.commenters = ""
    return list(lexer)


def cluster_skips_verification(cluster):
    """Read a short-option cluster the way git's own parser reads it.

    Args:
        cluster: A single token beginning with one `-`, e.g. `-nm` or `-mn`.

    Returns:
        A pair (bypasses, consumes_next_token).
    """
    body = cluster[1:]
    for offset, letter in enumerate(body):
        if letter == "n":
            return (True, False)
        if letter in COMMIT_SHORT_REQUIRED_VALUE:
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
        # `--` ends the options; a file legitimately named `-n` is not a bypass.
        if token in COMMAND_SEPARATORS or token == "--":
            return False
        if token.startswith("--"):
            if token in COMMIT_LONG_SEPARATE_VALUE:
                index += 1
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
    """Resolve one env long option, abbreviations included.

    Returns the full spelling, "" when the abbreviation names several options
    (real env refuses those), or None when nothing matches.
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
    """Classify one token in an `env` option position.

    Returns "split-string", "separate-value", "no-value", "ambiguous" when env
    accepts the token but this parser cannot name it, or None when the token is
    not an option at all.
    """
    if not token.startswith("-") or token in {"-", "--"}:
        return None
    if token.startswith("--"):
        resolved = resolve_env_long_option(token.split("=", 1)[0])
        if not resolved:
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
            # The rest of the cluster is the option's value when there is one;
            # otherwise the value is the following token.
            return "no-value" if position <= len(token) - 1 else "separate-value"
        if letter not in ENV_SHORT_NO_VALUE:
            return "ambiguous"
    return "no-value"


def strip_command_prefix(prefix):
    """Drop tokens that precede a command without changing what it is.

    Assignments, the `command`/`exec`/`builtin` builtins, and nested `env`
    wrappers all leave the following word in command position. Reading any of
    them as the command is what let `command env -S ...` and `env -- env -S
    ...` past the split-string check: the prefix failed the assignments-only
    test, so the wrapped `env` was never classified.

    Returns a pair (status, remainder): "ok" with whatever still stands before
    the candidate, "operand" when the candidate is a wrapper option's value,
    or "ambiguous" when an option could not be classified.
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


def env_uses_split_string(tokens, index):
    """Whether a command-position env invocation reparses an opaque payload."""
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
        if kind in {"split-string", "ambiguous"}:
            # An option this parser cannot name makes the rest of the
            # invocation unreadable; refuse instead of reading past it.
            return True
        if kind is None:
            if "=" in token and not token.startswith(("=", "-")):
                cursor += 1
                continue
            return False
        cursor += 2 if kind == "separate-value" else 1
    return False


def git_commit_skips_verification(text):
    """Whether the command runs `git commit` with the short `-n` bypass.

    Args:
        text: The command line, heredoc payloads already stripped.

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
        found = subcommand_after_git(scoped_tokens, index + 1)
        if found and found[0] == "commit" and commit_bypasses_verification(found[1]):
            return True
    return False


if git_commit_skips_verification(strip_heredocs(command)):
    sys.exit(1)

for i, token in enumerate(normalized_tokens):
    if disables_verification(token):
        sys.exit(1)
    if token == "HUSKY=0" or token.startswith("HUSKY_SKIP_HOOKS="):
        sys.exit(1)
    # Allowlist the destinations, do not denylist the disabling ones: hooks are
    # disabled just as completely by any directory that happens to contain none
    # (`-c core.hooksPath=/tmp/empty`), so the set that DISABLES hooks is
    # unbounded while the set that legitimately relocates them is tiny. Matched
    # case-insensitively because git config names are.
    lowered = token.lower()
    if lowered.startswith("core.hookspath="):
        if not is_permitted_hooks_path(token.split("=", 1)[1]):
            sys.exit(1)
    if lowered == "core.hookspath" and i + 1 < len(normalized_tokens):
        if not is_permitted_hooks_path(normalized_tokens[i + 1]):
            sys.exit(1)
    # `--config-env=core.hooksPath=SOMEVAR` reads the path out of the named env
    # var, so it is not in the command at all and cannot be allowlisted.
    if lowered.startswith("--config-env="):
        spec = token.split("=", 1)[1]
        if spec.split("=", 1)[0].strip().lower() == "core.hookspath":
            sys.exit(1)
    # git also accepts `--config-env <name>=<envvar>` as two tokens. Guarding
    # only the `=` spelling let the trailing `core.hooksPath=.husky` fall
    # through to the allowlist above, which reads `.husky` as a path — but here
    # it names an ENVIRONMENT VARIABLE, which can hold /dev/null. Checked at the
    # `--config-env` token, which the loop reaches first.
    if lowered == "--config-env" and i + 1 < len(normalized_tokens):
        spec = normalized_tokens[i + 1]
        if spec.split("=", 1)[0].strip().strip("'\"").lower() == "core.hookspath":
            sys.exit(1)
    # `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath
    # GIT_CONFIG_VALUE_0=/dev/null git ...` sets the same command-scope config
    # via env-var-style assignments. The index is arbitrary below
    # GIT_CONFIG_COUNT, so it is matched as `\d+` rather than pinned to 0.
    key_match = re.match(r"git_config_key_\d+=(.*)$", lowered, re.DOTALL)
    if key_match and key_match.group(1).strip().strip("'\"") == "core.hookspath":
        sys.exit(1)
    if re.match(r"git_config_parameters\+?=", lowered):
        parameters = token.split("=", 1)[1]
        if "$" in parameters or "`" in parameters:
            sys.exit(1)
        try:
            configured = shlex.split(parameters, posix=True)
        except ValueError:
            configured = []
        if any(
            parameter.split("=", 1)[0].strip().lower() == "core.hookspath"
            for parameter in configured
        ):
            sys.exit(1)

sys.exit(0)
PY
then
  deny
fi

allow

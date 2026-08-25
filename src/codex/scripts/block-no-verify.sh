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
        r"(?<!<)<<-?(?!<)\s*(?:'([^']+)'|\"([^\"]+)\"|([A-Za-z_][A-Za-z0-9_]*))"
    )
    index = 0
    while index < len(lines):
        line = lines[index]
        output.append(line)
        pending.extend(
            next(group for group in match.groups() if group)
            for match in marker_pattern.finditer(line)
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
    if lowered.startswith("git_config_parameters="):
        parameters = token.split("=", 1)[1]
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
  jq -n '{
    "hookSpecificOutput": {
      "hookEventName": "PreToolUse",
      "permissionDecision": "deny",
      "permissionDecisionReason": "Blocked: this command bypasses pre-commit/pre-push hooks (--no-verify or its short form -n, HUSKY=0, or core.hooksPath disabling). `git commit -n` and a cluster such as `-nm \"msg\"` skip pre-commit exactly as completely as the long flag. Fix the underlying issue (security audit, lint, typecheck, tests, formatting) instead. If a fix is genuinely impossible, ask the user to make the risk-acceptance decision and add a specific documented ignore; never bypass the hook."
    }
  }'
fi

exit 0

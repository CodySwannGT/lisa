#!/usr/bin/env bash
# This file is managed by Lisa and IS replaced on each `lisa` run.
# Do not edit directly — durable changes belong upstream in Lisa.

# PreToolUse hook for Bash: blocks commands that bypass git's verification hooks.
# Bypassing pre-commit/pre-push hooks (which exist for a reason) is blocked in
# all of its forms; the fix is to address the underlying issue, not silence the
# check. See feedback_never_no_verify in user memory.
#
# Blocked bypass vectors:
#   1. --no-verify, and any prefix abbreviation git would accept for it;
#   2. HUSKY=0 / HUSKY_SKIP_HOOKS=... — disables husky-managed git hooks;
#   3. core.hooksPath pointed anywhere but an allowlisted in-repo hooks dir;
#   4. --config-env=core.hooksPath=VAR, in both the one- and two-token spellings;
#   5. GIT_CONFIG_KEY_<n>=core.hooksPath env-var-style command-scope config;
#   6. GIT_CONFIG_PARAMETERS carrying core.hooksPath command-scope config;
#   7. the short `-n`, as a real argv token of a `git commit` — bare, or bundled
#      into a short-option cluster such as `-nm "msg"`.
#
# The line below is what lets `lisa apply` tell a downstream copy of this guard
# that is BEHIND from one that is AHEAD. Byte comparison cannot: both look like
# "differs from mine", and guessing "behind" is how a fork's stronger guard gets
# silently replaced by a weaker upstream one. Refresh compares the two declared
# sets, and refuses to overwrite a copy declaring anything this one does not.
#
# Add a name here in the same commit that closes a vector. A hardening that
# forgets to is invisible to refresh, and shows up as an unexplained diff at
# review time instead of a named capability.
# lisa-guard-capabilities: no-verify-abbrev, husky-env, hookspath-allowlist, config-env, git-config-key, git-config-parameters, herestring-aware, no-verify-short
#
# Shell-token matching avoids false positives from issue bodies, heredocs, and
# commit-message prose while still catching quoted real argv values such as
# `git -c "core.hooksPath=/dev/null"`.
#
# The short `-n` form used to be excluded here, and the stated reason was that
# "grep cannot distinguish a real -n option from -n in commit-message prose or
# an unrelated piped command". That was true of the matcher it was written for.
# It is not true of this one: the command is TOKENIZED, not grepped, so `-m "fix
# the -n flag"` is one token holding the message and `grep -n` is a separate
# command — the two cases the comment called inseparable are separated by the
# same machinery `--config-env` and `GIT_CONFIG_KEY_<n>` already depend on.
#
# A rationale that outlives the implementation it describes is worse than none:
# it reads as a considered decision and stops the next reader from re-examining
# it. Measured against real git, `git commit -n`, `-nm msg`, and `-anm msg` all
# skip pre-commit exactly as completely as `--no-verify`, and `-nm` is the more
# likely spelling in practice because it reads as an ordinary message flag.
#
# What the old comment got right is the part about `-n` being common, and that
# concern is answered by SCOPE rather than by giving up: `-n` is `--dry-run` for
# `push`, `--no-stat` for `merge`, and a line count for head/tail/sort/grep, so
# the match is confined to the argv of a `git commit` invocation and nothing
# else. See `git_commit_skips_verification` below.
set -euo pipefail

input="$(cat)"

# Both interpreters must be probed BEFORE they are used, and a missing one must
# be announced rather than swallowed.
#
# `jq` used to be called unguarded here while `python3` two lines below was
# guarded. Under `set -e` an absent jq aborted the script with 127, and Claude
# Code treats any non-2 exit as a NON-BLOCKING hook error — so the hook that
# enforces "never --no-verify" silently permitted the very thing it exists to
# stop. It was not hypothetical: agent containers routinely ship no jq (that is
# why jq is now a pinned toolchain entry). The Codex variant of this script has
# always had the guard, so this was a parity gap rather than a design choice.
#
# Degrading to "allow" is still the right behaviour — a hook that cannot parse
# its input cannot tell a bypass from an ordinary command, and failing closed
# would block every Bash call on a machine missing an interpreter. What is NOT
# right is doing it quietly, so the operator gets one line on stderr saying the
# protection is off. A guard that is silently absent reads exactly like a guard
# that is passing.
for required in jq python3; do
  if ! command -v "$required" >/dev/null 2>&1; then
    printf 'block-no-verify: %s not found; --no-verify protection is NOT active\n' \
      "$required" >&2
    exit 0
  fi
done

tool_name="$(printf '%s' "$input" | jq -r '.tool_name // empty' 2>/dev/null || true)"
if [ "$tool_name" != "Bash" ]; then
  exit 0
fi

command_str="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null || true)"
if [ -z "$command_str" ]; then
  exit 0
fi

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
    # Allowlist the destinations, do not denylist the disabling ones.
    #
    # This used to block only "" and /dev/null. But hooks are disabled just as
    # completely by pointing hooksPath at any directory that happens to contain
    # none — `-c core.hooksPath=/tmp/empty` bypassed every hook while reading as
    # an ordinary path — so a denylist of "obviously disabling" values can
    # always be stepped around by naming a third thing. The set of paths that
    # DISABLE hooks is unbounded; the set that legitimately relocates them is
    # tiny and known, so the allowlist is the only side that can be enumerated.
    #
    # Matched case-insensitively because git config variable names are:
    # `CORE.HOOKSPATH=/x` and `core.hookspath=/x` are the same setting to git,
    # so a case-sensitive check is bypassed by holding down shift.
    lowered = token.lower()
    if lowered.startswith("core.hookspath="):
        if not is_permitted_hooks_path(token.split("=", 1)[1]):
            sys.exit(1)
    if lowered == "core.hookspath" and i + 1 < len(normalized_tokens):
        if not is_permitted_hooks_path(normalized_tokens[i + 1]):
            sys.exit(1)
    # `git --config-env=core.hooksPath=SOMEVAR` sets the same config, reading
    # the value out of the named environment variable. The path therefore is
    # not in the command at all, so there is nothing to allowlist against —
    # SOMEVAR can hold anything by the time git reads it. Any core.hooksPath
    # routed through --config-env is refused outright.
    if lowered.startswith("--config-env="):
        spec = token.split("=", 1)[1]
        if spec.split("=", 1)[0].strip().lower() == "core.hookspath":
            sys.exit(1)
    # git accepts `--config-env <name>=<envvar>` as TWO tokens as well as one,
    # and guarding only the `=` spelling was worse than missing the separate
    # form outright: the trailing `core.hooksPath=.husky` then fell through to
    # the allowlist above, which reads `.husky` as a PATH and permits it. But
    # here it is an ENVIRONMENT VARIABLE NAME, and `env '.husky=/dev/null' git
    # --config-env core.hooksPath=.husky` really does resolve hooksPath to
    # /dev/null. The allowlist was being used as the bypass.
    #
    # Checked at the `--config-env` token, which the loop reaches first, so the
    # refusal happens before the value token can be mistaken for a path.
    if lowered == "--config-env" and i + 1 < len(normalized_tokens):
        spec = normalized_tokens[i + 1]
        if spec.split("=", 1)[0].strip().strip("'\"").lower() == "core.hookspath":
            sys.exit(1)
    # `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath
    # GIT_CONFIG_VALUE_0=/dev/null git commit` sets command-scope config the
    # same way `-c core.hooksPath=...` does — env-var-style assignments ahead of
    # the invocation instead of a flag — so it disables every hook just as
    # completely while matching none of the token shapes above. Upstream missed
    # this until a downstream fork hardened its own copy against it, which is
    # the one direction a guard must never be caught in.
    #
    # The index is matched as `\d+` rather than pinned to 0: git accepts any
    # index below GIT_CONFIG_COUNT, so a single-index check is evaded by typing
    # a 1. Refused outright, like --config-env=, because the path lives in a
    # separate GIT_CONFIG_VALUE_<n> token that can be exported earlier,
    # reordered, or left out entirely — there is nothing here to allowlist
    # against.
    key_match = re.match(r"git_config_key_\d+=(.*)$", lowered, re.DOTALL)
    if key_match and key_match.group(1).strip().strip("'\"") == "core.hookspath":
        sys.exit(1)
    # `git -c` propagates command-scope config through GIT_CONFIG_PARAMETERS.
    # Parsing the value as Git's shell-quoted parameter list distinguishes the
    # key from an unrelated value that merely contains the same text.
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
  cat >&2 <<'EOF'
Blocked: this command bypasses pre-commit/pre-push hooks (--no-verify or its
short form -n, HUSKY=0, or core.hooksPath disabling). `git commit -n` and a
cluster such as `-nm "msg"` skip pre-commit exactly as completely as the long
flag. Fix the underlying issue (security audit, lint,
typecheck, tests, formatting) instead. If a fix is genuinely impossible, ask the
user to make the risk-acceptance decision and add a specific documented ignore;
never bypass the hook.
EOF
  exit 2
fi

exit 0

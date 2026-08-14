#!/usr/bin/env bash
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
#   5. GIT_CONFIG_KEY_<n>=core.hooksPath env-var-style command-scope config.
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
# lisa-guard-capabilities: no-verify-abbrev, husky-env, hookspath-allowlist, config-env, git-config-key
#
# Shell-token matching avoids false positives from issue bodies, heredocs, and
# commit-message prose while still catching quoted real argv values such as
# `git -c "core.hooksPath=/dev/null"`.
#
# The short `-n` form is intentionally NOT matched (see block-no-verify.agy.sh):
# grep cannot distinguish a real -n option from -n in commit-message prose or an
# unrelated piped command, and -n is far more common than --no-verify.
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
        r"<<-?\s*(?:'([^']+)'|\"([^\"]+)\"|([A-Za-z_][A-Za-z0-9_]*))"
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

sys.exit(0)
PY
then
  cat >&2 <<'EOF'
Blocked: this command bypasses pre-commit/pre-push hooks (--no-verify, HUSKY=0,
or core.hooksPath disabling). Fix the underlying issue (security audit, lint,
typecheck, tests, formatting) instead. If a fix is genuinely impossible, ask the
user to make the risk-acceptance decision and add a specific documented ignore;
never bypass the hook.
EOF
  exit 2
fi

exit 0

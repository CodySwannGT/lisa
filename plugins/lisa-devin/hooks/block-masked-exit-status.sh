#!/usr/bin/env bash
# PreToolUse hook for Bash: blocks reading `$?` straight after a pipeline that
# ends in an output filter, because that `$?` is the filter's status, not the
# checked command's.
#
# The falsifiable-checks rule's first failure mode, made executable:
#
#   node scripts/gate.mjs 2>&1 | tail -4; echo "exit=$?"   # always exit=0
#
# The pipe keeps the output short, which is exactly why the failure line is the
# one most likely to be cut off, and the `$?` then reports success. An agent
# reading that as proof ships a red gate as green.
#
# Precision-first. It fires only when ALL of these hold:
#   1. a pipeline's last stage is an output filter (tail, head, grep, sed, awk,
#      cut, sort, uniq, wc, tee, tr, less, more, column, cat);
#   2. the very next command (after `;`, `&&`, `||`, or a newline) reads `$?`;
#   3. the command never turns on `pipefail` and never reads PIPESTATUS /
#      pipestatus.
# A pipeline whose status nobody reads is fine, and so is `$?` after a plain
# command. Heredoc payloads are stripped before classification.
#
# Agent parity: shipped to Claude, Codex, Cursor, Copilot and Devin through the
# per-agent hook filter. Documented gap: agy gets no adapter — its plugin hooks
# are wired only for the guards in AGY_PLUGIN_HOOKS — so on agy the
# falsifiable-checks rule's prose and CI exit codes are the only protection.
# Second documented gap: it is not in the enforcement fallback channel
# (scripts/lisa-enforcement-fallback.sh, all/copy-overwrite/scripts/lisa-hooks/),
# so a cloud session where the plugin never installs has the same prose-only
# protection. Adding it there is a separate change to that channel's guard list.
set -euo pipefail

input="$(cat)"

for required in jq python3; do
  if ! command -v "$required" >/dev/null 2>&1; then
    printf 'block-masked-exit-status: %s not found; masked-exit-status protection is NOT active\n' \
      "$required" >&2
    exit 0
  fi
done

tool_name="$(printf '%s' "$input" | jq -r '.tool_name // empty')"
[ "$tool_name" = "Bash" ] || exit 0

command_str="$(printf '%s' "$input" | jq -r '.tool_input.command // empty')"
[ -n "$command_str" ] || exit 0

# Fast path: no pipe or no `$?` means nothing to classify.
case "$command_str" in
  *'|'*) ;;
  *) exit 0 ;;
esac
case "$command_str" in
  *'$?'* | *'${?}'*) ;;
  *) exit 0 ;;
esac

if ! BLOCK_MASKED_EXIT_COMMAND="$command_str" python3 - <<'PY'
import os
import re
import sys

command = os.environ.get("BLOCK_MASKED_EXIT_COMMAND", "")

FILTERS = {
    "tail", "head", "grep", "egrep", "fgrep", "rg", "sed", "gsed", "awk",
    "gawk", "cut", "sort", "uniq", "wc", "tee", "tr", "less", "more",
    "column", "cat",
}
WRAPPERS = {"command", "env", "sudo", "time", "nohup"}
ASSIGNMENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=")
STATUS_READ = re.compile(r"\$\?|\$\{\?\}")
# A grep-family filter run with -q/-c/-l/-L reports its own match result as its
# status, and that is the status the caller wants: `diff | grep -q x; echo $?`.
GREP_FAMILY = {"grep", "egrep", "fgrep", "rg"}
STATUS_FLAGS_LONG = {"--quiet", "--silent", "--count", "--files-with-matches", "--files-without-match"}
ARITHMETIC = re.compile(r"\$\(\([^()]*(?:\([^()]*\)[^()]*)*\)\)")
COMMENT = re.compile(r"(?:^|(?<=\s))#[^\n]*")


def strip_heredoc_bodies(text):
    lines = text.splitlines()
    output = []
    # `<<<` is a here-string and `$((1<<n))` a shift; neither opens a heredoc.
    marker = re.compile(r"(?<!<)<<(?!<)-?\s*(?:'([^']+)'|\"([^\"]+)\"|\\?([A-Za-z_][A-Za-z0-9_]*))")
    index = 0
    while index < len(lines):
        line = lines[index]
        output.append(line)
        scan = ARITHMETIC.sub("", line)
        markers = [next(g for g in m.groups() if g) for m in marker.finditer(scan)]
        index += 1
        for name in markers:
            while index < len(lines):
                if lines[index].strip() == name:
                    index += 1
                    break
                index += 1
    return "\n".join(output)


def split_commands(text):
    """Split on top-level ; && || newline, keeping quoted text intact.

    Returns a list of command strings. Pipes stay inside a command.
    """
    commands, current, quote, i = [], [], None, 0
    while i < len(text):
        ch = text[i]
        if quote:
            current.append(ch)
            if ch == "\\" and quote == '"' and i + 1 < len(text):
                current.append(text[i + 1])
                i += 2
                continue
            if ch == quote:
                quote = None
            i += 1
            continue
        if ch in ("'", '"'):
            quote = ch
            current.append(ch)
            i += 1
            continue
        two = text[i:i + 2]
        if two in ("&&", "||"):
            commands.append("".join(current))
            current = []
            i += 2
            continue
        if ch in (";", "\n"):
            commands.append("".join(current))
            current = []
            i += 1
            continue
        current.append(ch)
        i += 1
    commands.append("".join(current))
    return [c.strip() for c in commands if c.strip()]


def pipe_stages(cmd):
    """Split one command on top-level single `|` (not `||`)."""
    stages, current, quote = [], [], None
    i = 0
    while i < len(cmd):
        ch = cmd[i]
        if quote:
            current.append(ch)
            if ch == "\\" and quote == '"' and i + 1 < len(cmd):
                current.append(cmd[i + 1])
                i += 2
                continue
            if ch == quote:
                quote = None
            i += 1
            continue
        if ch in ("'", '"'):
            quote = ch
            current.append(ch)
        elif ch == "|":
            stages.append("".join(current))
            current = []
            if cmd[i + 1:i + 2] == "&":
                i += 1
        else:
            current.append(ch)
        i += 1
    stages.append("".join(current))
    return [s.strip() for s in stages]


def reports_own_status(stage):
    """True for a grep-family stage whose exit status is its match result."""
    words = stage.split()
    if not words or first_word(stage) not in GREP_FAMILY:
        return False
    for word in words[1:]:
        if word in STATUS_FLAGS_LONG:
            return True
        if word.startswith("-") and not word.startswith("--") and set(word[1:]) & set("qclL"):
            return True
    return False


def first_word(stage):
    for word in stage.replace("(", " ").split():
        if ASSIGNMENT.match(word) or word in WRAPPERS:
            continue
        return os.path.basename(word)
    return ""


text = strip_heredoc_bodies(command)
if re.search(r"pipefail|PIPESTATUS|pipestatus", COMMENT.sub("", text)):
    sys.exit(0)

commands = split_commands(text)
for index, cmd in enumerate(commands[:-1]):
    stages = pipe_stages(cmd)
    if len(stages) < 2:
        continue
    last = first_word(stages[-1])
    if last not in FILTERS or reports_own_status(stages[-1]):
        continue
    if STATUS_READ.search(commands[index + 1]):
        source = first_word(stages[0]) or "the command"
        sys.stderr.write(
            "Blocked: the `$?` after this pipeline is the exit status of `"
            + last
            + "`, its last stage, not of `"
            + source
            + "`. It reads 0 even when the command failed, so it proves nothing.\n"
            "Capture the real status first, then filter the output:\n"
            "  " + source + " ... > /tmp/out.log 2>&1; status=$?; tail -n 20 /tmp/out.log; echo \"exit=$status\"\n"
            "(In bash or zsh, `set -o pipefail` also works.) See the falsifiable-checks rule.\n"
        )
        sys.exit(2)
sys.exit(0)
PY
then
  exit 2
fi
exit 0

#!/usr/bin/env bash
# PreToolUse hook for Bash: blocks structural JSON parsing with text tools.
# Text tools (grep/sed/cut/awk) break on valid JSON — multiline values, escaped
# quotes, reordered keys, nested objects — producing silently wrong output
# instead of errors. jq is the required tool for structural JSON reads and
# writes in shell. Promoted from PROJECT_RULES.md prose to an executable
# control by the learnings gardener (issue #1787).
#
# Precision-first: this hook fires only on high-confidence STRUCTURAL parsing
# of a *.json input — never on plain text search. Blocked signatures:
#   1. `sed -i` (or an s/…/…/ program) applied to a .json file or stream;
#   2. `cut -d` with a structural delimiter (quote/colon/comma) on .json input;
#   3. `awk` field extraction (-F or a $N program) on .json input;
#   4. `grep -o` on .json input (value extraction, not search).
# A "json input" is a *.json argument, a `< file.json` redirection, or a
# pipeline stream originating from a .json file (e.g. `cat x.json | …`).
#
# Exemptions (allowed):
#   - any command that invokes jq anywhere (already compliant or mixed-legit);
#   - search-only usage: plain grep / grep -l / rg with no extraction signature;
#   - *.jsonl targets (line-delimited streams are legitimately line-tooled);
#   - heredoc payload text (stripped before classification).
set -euo pipefail

input="$(cat)"

tool_name="$(printf '%s' "$input" | jq -r '.tool_name // empty')"
if [ "$tool_name" != "Bash" ]; then
  exit 0
fi

command_str="$(printf '%s' "$input" | jq -r '.tool_input.command // empty')"
if [ -z "$command_str" ]; then
  exit 0
fi

# Fast path: no ".json" reference at all means nothing to classify.
case "$command_str" in
  *.json*) ;;
  *) exit 0 ;;
esac

command -v python3 >/dev/null 2>&1 || exit 0

if ! BLOCK_SHELL_JSON_COMMAND="$command_str" python3 - <<'PY'
import os
import re
import shlex
import sys

command = os.environ.get("BLOCK_SHELL_JSON_COMMAND", "")

TEXT_TOOLS = {"grep", "egrep", "fgrep", "sed", "gsed", "awk", "gawk", "cut"}
WRAPPERS = {"command", "env", "sudo", "time", "nohup"}
ASSIGNMENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=")


def strip_heredoc_bodies(text: str) -> str:
    """Remove heredoc payload lines so prose .json mentions never classify."""
    lines = text.splitlines()
    output = []
    marker_pattern = re.compile(
        r"<<-?\s*(?:'([^']+)'|\"([^\"]+)\"|\\?([A-Za-z_][A-Za-z0-9_]*))"
    )
    index = 0
    while index < len(lines):
        line = lines[index]
        output.append(line)
        markers = [
            next(group for group in match.groups() if group)
            for match in marker_pattern.finditer(line)
        ]
        index += 1
        for marker in markers:
            while index < len(lines):
                if lines[index].strip() == marker:
                    index += 1
                    break
                index += 1
    return "\n".join(output)


def tokenize(text: str):
    lex = shlex.shlex(text, posix=True, punctuation_chars="|&;<>")
    lex.whitespace_split = True
    try:
        return list(lex)
    except ValueError:
        return None


def is_json_path(token: str) -> bool:
    return token.lower().rstrip(")};").endswith(".json")


def split_pipelines(tokens):
    """Yield lists of pipe-connected segments; each segment is a token list."""
    pipelines, pipeline, segment = [], [], []
    for token in tokens:
        if token in ("|", "|&"):
            pipeline.append(segment)
            segment = []
        elif token in (";", "&&", "||", "&", "\n"):
            pipeline.append(segment)
            pipelines.append(pipeline)
            pipeline, segment = [], []
        else:
            segment.append(token)
    pipeline.append(segment)
    pipelines.append(pipeline)
    return pipelines


def segment_parts(segment):
    """Return (tool, args, reads_json) for one pipeline segment."""
    reads_json = False
    tool = None
    args = []
    index = 0
    while index < len(segment):
        token = segment[index]
        if token == "<":
            if index + 1 < len(segment) and is_json_path(segment[index + 1]):
                reads_json = True
            index += 2
            continue
        if token in (">", ">>", "<<", "<<<"):
            index += 2
            continue
        if tool is None and (ASSIGNMENT.match(token) or token in WRAPPERS):
            index += 1
            continue
        if tool is None:
            tool = token.rsplit("/", 1)[-1]
        else:
            args.append(token)
            if is_json_path(token):
                reads_json = True
        index += 1
    return tool, args, reads_json


def flags_of(args):
    return [a for a in args if a.startswith("-")]


def is_violation(tool, args, has_json_input):
    if not has_json_input:
        return False
    flags = flags_of(args)
    if tool in ("grep", "egrep", "fgrep"):
        if any(f in ("-l", "-L", "--files-with-matches", "--files-without-match") for f in flags):
            return False
        return any(f == "-o" or f == "--only-matching" or ("o" in f[1:] and not f.startswith("--")) for f in flags)
    if tool in ("sed", "gsed"):
        if any(f.startswith("-i") or f == "--in-place" for f in flags):
            return True
        return any(re.match(r"^-?\d*s[/|#]", a) or a.startswith("s/") or a.startswith("s|") for a in args)
    if tool == "cut":
        for i, arg in enumerate(args):
            if arg == "-d" and i + 1 < len(args) and args[i + 1] in ('"', "'", ":", ","):
                return True
            if arg.startswith("-d") and len(arg) > 2 and arg[2:] in ('"', "'", ":", ","):
                return True
        return False
    if tool in ("awk", "gawk"):
        if any(f == "-F" or f.startswith("-F") for f in flags):
            return True
        return any(re.search(r"\$\d", a) for a in args if not a.startswith("-"))
    return False


tokens = tokenize(strip_heredoc_bodies(command))
if tokens is None:
    sys.exit(0)

pipelines = split_pipelines(tokens)

# Whole-command jq exemption: any jq stage means the author is already using
# the right tool; mixed pipelines (jq | grep) are legitimate.
for pipeline in pipelines:
    for segment in pipeline:
        tool, _args, _reads = segment_parts(segment)
        if tool == "jq":
            sys.exit(0)

for pipeline in pipelines:
    json_stream = False
    for segment in pipeline:
        tool, args, reads_json = segment_parts(segment)
        if tool is None:
            continue
        has_json_input = reads_json or json_stream
        if tool in TEXT_TOOLS and is_violation(tool, args, has_json_input):
            sys.exit(1)
        # Streams originating from a .json file stay json-classified through
        # pass-through text stages (cat x.json | grep … | cut …).
        if reads_json or (json_stream and tool in TEXT_TOOLS | {"cat", "head", "tail", "sort", "uniq", "tr", "xargs"}):
            json_stream = True
        else:
            json_stream = False

sys.exit(0)
PY
then
  cat >&2 <<'EOF'
BLOCKED: this command parses JSON with text tools (grep/sed/cut/awk). Text
tools break on valid JSON — multiline values, escaped quotes, reordered keys,
nested objects — producing silently wrong output instead of errors. Use jq for
all structural JSON reads and writes in shell. Typical fixes:
  read a field:   jq -r '.field' file.json
  filter items:   jq '.items[] | select(.name=="x")' file.json
  edit in place:  jq '.key="value"' file.json > tmp && mv tmp file.json
If you are only SEARCHING text inside a JSON file (not extracting values), use
`rg <pattern> file.json` with no extraction pipe and this hook will not fire.
EOF
  exit 2
fi

exit 0

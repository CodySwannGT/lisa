#!/usr/bin/env bash
# PreToolUse hook for Bash: refuse a direct tracker-creation command that
# declares no readiness.
#
# WHY THIS IS A HOOK AND NOT A RULE
#
# The `ready-role-filing` rule says every filing declares either
# `build_ready: true` or a `human_gate:` reason, and that filings go through
# `lisa-track` / `lisa-tracker-write`. A conformance audit of the ~13 issues
# filed during one working session found 13/13 bypassed it, with zero
# `lisa-track` invocations — eight of them filed AFTER the rule merged, several
# by the agent that wrote the rule. Over the same window `Co-Authored-By`
# compliance was 50/50, because a husky `commit-msg` hook enforces it.
#
# Prose at the EAGER-RULE rung did not bind even its own author; the executable
# control was never once violated. Lisa's `learnings-ladder` rule says
# machine-checkable knowledge belongs at EXECUTABLE-CONTROL. This is that
# promotion.
#
# WHAT IT CHECKS, AND WHY THAT AND NOT "DID YOU USE THE SKILL"
#
# A Bash-level hook cannot observe call provenance. Any provenance signal an
# agent could carry — a flag, a marker, an env var — is settable by the very
# agent being governed, so a guard built on one is theatre. What the hook CAN
# observe is the artifact: whether the command about to run produces a
# correctly declared work item. So it enforces the checkable half.
#
# A creation command is refused unless it carries a readiness declaration:
#   - the project's configured build-ready role (GitHub label, JIRA/Linear
#     workflow state) resolved from `.lisa.config.json`, never hard-coded; or
#   - an explicit `[lisa-human-gate]` marker, inline or in the `--body-file`
#     the create is about to submit.
#
# That is exactly the machine-checkable content of `ready-role-filing`, and it
# lets `lisa-github-write-issue` / `lisa-jira-write-ticket` /
# `lisa-linear-write-issue` through by construction, because those writers
# always stamp one. A blanket refusal would have blocked Lisa's own writers and
# left the factory unable to file anything.
#
# Creation signatures, per tracker CLI and the two ways around each:
#   gh issue create · gh api POST to .../issues · gh api graphql createIssue
#   linear issue create · jira issue create · acli … workitem/issue create
#   curl/http POST to api.github.com/…/issues, api.linear.app/graphql with
#   issueCreate, or …atlassian.net/rest/api/…/issue
# Reads never fire: `gh issue list`, `gh issue view`, `gh issue edit`,
# `gh pr create`, `gh label create`, a bare `gh api …/issues` GET, and a prose
# mention inside a quoted string are all allowed.
#
# STANDING DOWN
#
#   - No tracker configured (`.lisa.config.json` absent, or carrying no
#     `tracker`). There is no `lisa-tracker-write` to route through, so the
#     guard has nothing to redirect to. This is the bootstrapping case, and it
#     is DETECTED rather than asserted — the operator does not have to remember
#     an env var to bring up a new repo.
#   - `LISA_ALLOW_DIRECT_ISSUE_CREATE` non-empty in the hook's inherited
#     environment. This is the human operator's override, mirroring
#     `LISA_ALLOW_INSTRUCTION_FILE_WRITE`.
#
# The override is honored ONLY from the ambient environment, and is refused
# outright when it appears as an inline assignment in the intercepted command.
# That distinction is the whole point: a tool-call shell is fresh every time
# and its exports do not reach this hook's environment, so the ambient variable
# can only have been set by a human before the session started (shell profile,
# settings env block, CI config). An escape the governed agent reaches by
# typing one more token in front of the command it was just refused is not an
# escape hatch — it is the prose problem with extra steps.
set -euo pipefail

input="$(cat)"

# Probe both interpreters before use and announce a missing one rather than
# swallowing it. Under `set -e` an absent jq aborts with 127, and Claude Code
# treats any non-2 exit as a NON-BLOCKING hook error — so the guard would
# silently permit exactly what it exists to stop. Degrading to "allow" is
# right (a hook that cannot parse its input cannot tell a filing from a read),
# but doing it quietly is not: a guard that is silently absent reads exactly
# like a guard that is passing. Same reasoning as block-no-verify.sh.
for required in jq python3; do
  if ! command -v "$required" >/dev/null 2>&1; then
    printf 'block-direct-issue-create: %s not found; ready-role filing enforcement is NOT active\n' \
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

project_dir="${CLAUDE_PROJECT_DIR:-}"
if [ -z "$project_dir" ]; then
  project_dir="$PWD"
fi

# Merged config, local overlay over base — the same precedence
# `lisa-tracker-read` / `lisa-tracker-write` resolve with, so the guard can
# never disagree with the writer about which tracker a project has.
read_config_value() {
  local filter="$1"
  local value=""
  local file
  for file in "$project_dir/.lisa.config.json" "$project_dir/.lisa.config.local.json"; do
    [ -f "$file" ] || continue
    local candidate
    candidate="$(jq -r "$filter // empty" "$file" 2>/dev/null || true)"
    [ -n "$candidate" ] && value="$candidate"
  done
  printf '%s' "$value"
}

tracker="$(read_config_value '.tracker')"
if [ -z "$tracker" ]; then
  exit 0
fi

# The build-ready role is read from config, never hard-coded: a project that
# renamed its ready lane must still be able to satisfy the guard, and the
# refusal has to name the token that project actually uses.
case "$tracker" in
  github) ready_role="$(read_config_value '.github.labels.build.ready')" ;;
  jira) ready_role="$(read_config_value '.jira.workflow.ready')" ;;
  linear) ready_role="$(read_config_value '.linear.workflow.ready')" ;;
  *) ready_role="" ;;
esac
if [ -z "$ready_role" ]; then
  ready_role="status:ready"
fi

# Ambient-only override. Deliberately read here, from the hook process's own
# environment, and never from the command being inspected.
ambient_override="${LISA_ALLOW_DIRECT_ISSUE_CREATE:-}"

refuse() {
  local signature="$1"
  cat >&2 <<EOF
BLOCKED: refusing \`$signature\` — this filing declares no readiness.

WHY: a work item filed without the build-ready role is an incomplete handoff.
Build-intake scans the ready lane and nothing else, so nothing will ever pick
it up: the write succeeds and the work still dies. An audit of one working
session found 13 of 13 issues filed this way, none of them through Lisa's
filing path. The rule saying not to do this already existed — it did not bind,
so it is now enforced here.

FILE IT THE SANCTIONED WAY — one of these two, always explicit:

1. The item is complete enough to build. Use the filing flow, not the CLI:

     /lisa:track "<what needs building>"

   which resolves or creates exactly one live leaf through
   \`lisa-tracker-write\` with \`build_ready: true\`, validates it before the
   write, and claims it. Complete means the \`work-item-definition-of-ready\`
   bar — reproduction, observed-versus-expected, Gherkin acceptance criteria.

2. A human product call is genuinely pending. Route the same way but pass
   \`human_gate: "<why a human must judge this first>"\`, which stamps the hold
   so it is auditable rather than indistinguishable from an accident:

     Held for a human product call: <reason>.
     <!-- [lisa-human-gate] reason=<short-slug> -->

Filed, not ready, and no \`human_gate\` is the incomplete-handoff case, and
\`build_ready: false\` with no reason is the same omission with a value
attached. See the \`ready-role-filing\` rule for the full contract.

If you must run the CLI directly, the command has to carry one of the two
declarations itself: the configured build-ready role \`$ready_role\` as the
value of a \`--label\` / \`--status\` / \`--state\` flag (not in the title or
body — a role named in prose is not a role applied), or a \`[lisa-human-gate]\`
marker in the body it submits.

OPERATOR ESCAPE: a human can export \`LISA_ALLOW_DIRECT_ISSUE_CREATE=1\` in the
environment before starting the session. It is deliberately not reachable by
setting it inline on this command — an inline assignment is refused.
EOF
  exit 2
}

# The classifier is read into a variable with a top-level here-document rather
# than piped straight in from inside `$( … )`. bash 3.2 — which is what macOS
# still ships as /bin/bash, and therefore what this fleet's hooks run under —
# mis-parses a here-document nested in a command substitution, scanning the
# document body for quotes and parentheses it should be treating as literal.
# The whole script then fails to parse, which is the worst possible failure for
# a guard: a syntax error exits non-zero, and Claude Code reads every non-2
# exit as a non-blocking hook error, so the command runs unchecked.
classifier=""
read -r -d '' classifier <<'PY' || true
import os
import re
import shlex
import sys

command = os.environ.get("LISA_GUARD_COMMAND", "")
ready_role = os.environ.get("LISA_GUARD_READY_ROLE", "")
ambient_override = os.environ.get("LISA_GUARD_AMBIENT_OVERRIDE", "")

OVERRIDE_NAME = "LISA_ALLOW_DIRECT_ISSUE_CREATE"
HUMAN_GATE_MARKER = "[lisa-human-gate]"

# Wrapper programs that prefix a real command rather than being one.
WRAPPERS = {"env", "command", "sudo", "nohup", "time", "nice", "xargs", "exec"}

# Shells that take a whole command as a STRING argument. `bash -c 'gh issue
# create …'` has an argv naming only bash, so nothing about the creation is
# visible without re-tokenizing the nested string. Bounded depth: a guard that
# can be made to recurse forever is its own denial of service.
SHELLS = {"bash", "sh", "zsh", "dash", "ksh"}
MAX_NESTING_DEPTH = 3

# Flags whose value is a label / workflow-state assignment. The build-ready role
# is matched ONLY here, never anywhere in the command text.
#
# This is the lesson of the `block-no-verify` hardening that introduced its own
# bypass (#2469): a token means different things in different positions, so a
# check that ignores position can always be satisfied from the wrong one. A
# free-text scan for the role let `gh issue create --title "status:ready is
# broken"` declare readiness out of a bug report's TITLE.
#
# Long forms only, and deliberately so. Short flags are per-CLI: `-s` is
# `--state` on `gh issue list` and `--summary` on other trackers, and accepting
# it would re-open the same hole one letter smaller. Every Lisa writer emits the
# long form.
LABEL_FLAGS = {"--label", "--labels", "--add-label", "--status", "--state"}

# Flags whose value is a file the create is about to submit as the body. The
# human-gate marker lives in the body, and every Lisa writer composes the body
# in a temp file to avoid quoting hell — so a guard that only read the command
# line would miss the declaration it is asking for.
BODY_FILE_FLAGS = {"--body-file", "-F", "--input", "--data-binary"}

POST_METHOD_FLAGS = {"-X", "--request", "--method"}
# Field/payload flags that imply a write on the CLIs we intercept.
POST_PAYLOAD_FLAGS = {
    "-d",
    "--data",
    "--data-raw",
    "--data-binary",
    "-f",
    "-F",
    "--raw-field",
    "--field",
    "--input",
}

GITHUB_ISSUES_PATH = re.compile(r"repos/[^/\s]+/[^/\s]+/issues/?$")
GITHUB_ISSUES_URL = re.compile(r"api\.github\.com/repos/[^/\s]+/[^/\s]+/issues")
JIRA_ISSUE_URL = re.compile(r"atlassian\.net/rest/api/[^/\s]+/issue")


def strip_heredocs(text):
    """Drop heredoc bodies so quoted prose cannot be read as argv.

    Args:
        text: The raw command string.

    Returns:
        The command with heredoc bodies removed.
    """
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


# The inline-override check runs over the WHOLE raw command text, not over
# parsed tokens, so it catches `X=1 gh …`, `env X=1 gh …`, `export X=1 && gh …`,
# and the same forms buried inside a nested `bash -c '…'` string alike. Any
# appearance of the assignment disqualifies the ambient override: this is the
# one place the guard deliberately over-matches, because a false positive costs
# a human one retry and a false negative costs the entire control.
inline_override = (OVERRIDE_NAME + "=") in command

SEPARATOR_CHARS = set("();&|{}")


def segment(raw_tokens):
    """Split a token stream into individual commands at shell operators.

    Args:
        raw_tokens: Tokens from shlex.

    Returns:
        A list of argv lists, one per command in the pipeline/list.
    """
    segments = []
    current = []
    for token in raw_tokens:
        if token and set(token) <= SEPARATOR_CHARS:
            segments.append(current)
            current = []
            continue
        # Only parentheses and the statement terminator are peeled off the ends
        # of a token. Braces deliberately are NOT: shlex has already collapsed
        # a quoted argument into one token, so `-d '{"query":"mutation{…}"}'`
        # arrives as a single token that both starts and ends with a brace.
        # Peeling those read the JSON payload as a shell group and split the
        # command in half, which silently un-refused every GraphQL creation
        # posted over curl. A bare `{` or `}` used as real shell grouping is
        # still caught by the whole-token separator check above.
        stripped = token.lstrip("(")
        if stripped != token:
            segments.append(current)
            current = []
        token = stripped
        trailing = token.rstrip(");")
        if trailing != token:
            token = trailing
            if token:
                current.append(token)
            segments.append(current)
            current = []
            continue
        if token:
            current.append(token)
    segments.append(current)
    return [item for item in segments if item]


def program_and_args(argv):
    """Strip env assignments and wrapper programs to find the real command.

    Args:
        argv: One command's tokens.

    Returns:
        A (program basename, remaining args) tuple, or (None, []) if empty.
    """
    index = 0
    while index < len(argv):
        token = argv[index]
        if re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", token):
            index += 1
            continue
        if token.rsplit("/", 1)[-1] in WRAPPERS:
            index += 1
            continue
        break
    if index >= len(argv):
        return None, []
    return argv[index].rsplit("/", 1)[-1], argv[index + 1 :]


def non_flag(args):
    """The positional arguments, with flag values removed.

    A bare "does not start with a dash" filter reads a flag's VALUE as a
    positional, which is what let `gh issue --repo o/r create` through: `o/r`
    landed in the positional list and pushed `create` out of the slot a strict
    index check was watching. That form is not hypothetical — gh accepts it,
    because cobra strips a persistent flag before resolving the subcommand.

    A token is treated as a flag value when the token before it is a flag that
    carries no `=`. `--repo=o/r` therefore consumes nothing.

    Args:
        args: A command's arguments (argv without the program).

    Returns:
        The positional arguments, in order.
    """
    positional = []
    previous_takes_value = False
    for token in args:
        if token.startswith("-") and token != "-":
            previous_takes_value = "=" not in token
            continue
        if previous_takes_value:
            previous_takes_value = False
            continue
        positional.append(token)
    return positional


def has_subcommand(positional, first, second):
    """Whether two subcommand words appear adjacently among the positionals.

    Matched as an adjacent PAIR anywhere rather than at a fixed index, because a
    global flag can precede the subcommand chain and shift it.

    Args:
        positional: The filtered positional arguments.
        first: The group subcommand, e.g. "issue".
        second: The verb, e.g. "create".

    Returns:
        True when `first` is immediately followed by `second`.
    """
    return any(
        positional[index] == first and positional[index + 1] == second
        for index in range(len(positional) - 1)
    )


def flag_values(args, names):
    """Every value assigned to one of the named flags.

    Args:
        args: A command's arguments.
        names: The flag spellings to collect.

    Returns:
        The raw values, unsplit and unquoted.
    """
    values = []
    for index, token in enumerate(args):
        if token in names and index + 1 < len(args):
            values.append(args[index + 1])
        if "=" in token:
            head, value = token.split("=", 1)
            if head in names:
                values.append(value)
    return values


def is_write_request(args):
    """Whether the arguments describe an HTTP write rather than a read.

    Args:
        args: A command's arguments.

    Returns:
        True if a POST method or a payload-bearing flag is present.
    """
    for index, token in enumerate(args):
        if token in POST_METHOD_FLAGS:
            if index + 1 < len(args) and args[index + 1].upper() == "POST":
                return True
        if "=" in token:
            head, value = token.split("=", 1)
            if head in POST_METHOD_FLAGS and value.upper() == "POST":
                return True
        if token.upper() in {"-XPOST", "-XPOST="}:
            return True
        if token in POST_PAYLOAD_FLAGS:
            return True
    return False


def creation_signature(program, args):
    """Classify a command as a tracker-creation call.

    Args:
        program: The command's basename.
        args: Its arguments.

    Returns:
        A short human-readable signature, or None when this is not a creation.
    """
    if "--help" in args or "-h" in args:
        return None
    positional = non_flag(args)
    joined = " ".join(args)

    if program == "gh":
        if has_subcommand(positional, "issue", "create"):
            return "gh issue create"
        if positional[:1] == ["api"]:
            if "createIssue" in joined or "issueCreate" in joined:
                return "gh api graphql createIssue"
            if any(GITHUB_ISSUES_PATH.search(token) for token in positional):
                if is_write_request(args):
                    return "gh api POST .../issues"
        return None

    if program in {"linear", "jira"}:
        if has_subcommand(positional, "issue", "create"):
            return "%s issue create" % program
        return None

    if program == "acli":
        if "create" in positional and (
            {"workitem", "workitems", "issue", "issues"} & set(positional)
        ):
            return "acli … create"
        return None

    if program in {"curl", "http", "wget"}:
        if not is_write_request(args):
            return None
        for token in args:
            if GITHUB_ISSUES_URL.search(token):
                return "%s POST api.github.com/…/issues" % program
            if JIRA_ISSUE_URL.search(token):
                return "%s POST …/rest/api/…/issue" % program
            if "api.linear.app/graphql" in token and "issueCreate" in joined:
                return "%s POST api.linear.app/graphql issueCreate" % program
        return None

    return None


def body_file_paths(args):
    """Paths the command will submit as the item body.

    Args:
        args: A command's arguments.

    Returns:
        Candidate file paths, unverified.
    """
    paths = []
    for index, token in enumerate(args):
        if token in BODY_FILE_FLAGS and index + 1 < len(args):
            paths.append(args[index + 1])
        if "=" in token:
            head, value = token.split("=", 1)
            if head in BODY_FILE_FLAGS:
                paths.append(value)
        if token.startswith("@") and len(token) > 1:
            paths.append(token[1:])
    return paths


def before_end_of_options(args):
    """The arguments up to a bare `--`.

    Everything after `--` is an operand, not a flag, so it cannot reach the
    created item — crediting a declaration from there is the same mistake as
    reading the role out of a title, one position over.

    The two installed CLIs disagree about it, which is exactly why the guard
    cannot lean on any of them being strict: gh 2.96.0 rejects a post-`--`
    flag outright, while `acli` parses straight past it and proceeds to create
    the work item with the trailing `--status` silently unapplied. That made
    this a live bypass on the JIRA path, verified by running it. `jira`,
    `linear`, `http`, and `wget` were not installed and are UNVERIFIED, so the
    guard fails closed for every path rather than assuming gh's strictness.

    Args:
        args: A command's arguments.

    Returns:
        The arguments preceding the first bare `--`.
    """
    return args[: args.index("--")] if "--" in args else args


def declares_readiness(raw_args):
    """Whether the create carries one of the two required declarations.

    Args:
        raw_args: The creating command's arguments.

    Returns:
        True when the build-ready role or a human-gate marker is present.
    """
    args = before_end_of_options(raw_args)
    if ready_role:
        for raw in flag_values(args, LABEL_FLAGS):
            candidates = [
                part.strip().strip("'\"") for part in raw.split(",")
            ]
            if ready_role in candidates:
                return True
    # The human-gate marker is matched anywhere, and that asymmetry is
    # deliberate: it is a marker with no other meaning, so its presence in the
    # title or body IS the declaration. The build-ready role is an ordinary
    # string that appears in prose about the queue all the time.
    if HUMAN_GATE_MARKER in " ".join(args):
        return True
    # The human-gate marker lives in the body, and every Lisa writer composes
    # the body in a file. The build-ready role deliberately does NOT count from
    # a file: it is a label applied on the command line, so accepting it from
    # body prose would let the words "status:ready" in a description satisfy a
    # gate about a label.
    for path in body_file_paths(args):
        try:
            with open(path, encoding="utf-8", errors="replace") as handle:
                if HUMAN_GATE_MARKER in handle.read():
                    return True
        except OSError:
            continue
    return False


def scan(command_text, depth):
    """Find the first undeclared creation in a command string.

    Args:
        command_text: A shell command, possibly containing nested `sh -c`.
        depth: Current nesting depth.

    Returns:
        A refusal signature, or None.
    """
    try:
        raw_tokens = shlex.split(strip_heredocs(command_text), posix=True)
    except ValueError:
        return None
    for argv in segment(raw_tokens):
        program, args = program_and_args(argv)
        if program is None:
            continue
        if program in SHELLS:
            if depth >= MAX_NESTING_DEPTH:
                continue
            for index, token in enumerate(args):
                if token == "-c" and index + 1 < len(args):
                    nested = scan(args[index + 1], depth + 1)
                    if nested is not None:
                        return nested
            continue
        signature = creation_signature(program, args)
        if signature is None:
            continue
        # The ambient override is the human operator's. An inline assignment is
        # the agent granting itself the exemption, so it disqualifies the
        # override rather than supplying it — and it does so even when a
        # legitimate ambient override is also present, because at that point the
        # command no longer needs the inline one and its presence is only ever
        # an attempt to reach it.
        if ambient_override and not inline_override:
            continue
        if declares_readiness(args):
            continue
        return signature
    return None


found = scan(command, 0)
if found is not None:
    print("REFUSE %s" % found)
    sys.exit(0)

print("ALLOW")
PY

set +e
verdict="$(
  printf '%s' "$classifier" |
    LISA_GUARD_COMMAND="$command_str" \
      LISA_GUARD_READY_ROLE="$ready_role" \
      LISA_GUARD_AMBIENT_OVERRIDE="$ambient_override" \
      python3 -
)"
python_status=$?
set -e

# A crashed classifier must not be read as "allow" without saying so.
if [ "$python_status" -ne 0 ]; then
  printf 'block-direct-issue-create: classifier failed (exit %s); enforcement is NOT active for this call\n' \
    "$python_status" >&2
  exit 0
fi

case "$verdict" in
  REFUSE*) refuse "${verdict#REFUSE }" ;;
esac

exit 0

#!/usr/bin/env bash
# This file is managed by Lisa and IS replaced on each `lisa` run.
# Do not edit directly — durable changes belong upstream in Lisa.

# PreToolUse hook for Bash: refuse to ARM auto-merge on a pull request that
# GitHub already says is blocked on review.
#
# WHY THIS IS A HOOK AND NOT A RULE
#
# Arming auto-merge is the moment an agent claims "this will merge", and the
# claim can be false at exactly that moment. Measured on this repository: three
# of five open PRs sat armed, fully green, with `reviewDecision =
# CHANGES_REQUESTED`. Nothing surfaced it. `reviewDecision` is not part of the
# check rollup, so the failing-check count read 0, the checks tab was entirely
# green, and three separate agents armed and moved on. One PR had been parked
# for hours before someone queried the field by hand.
#
# The stale case is the one actually observed, and it is the one prose cannot
# help with: the `base` ruleset sets `dismiss_stale_reviews_on_push: false`, so
# a CHANGES_REQUESTED review stays attached to the commit it was made on and
# pushing the fix never clears it, while `required_approving_review_count: 0`
# means no scheduled re-review will ever clear it either. The PR is blocked
# indefinitely and every check-based signal reads ready.
#
# WHAT IT CHECKS, AND WHY THAT AND NOT THE CHECK ROLLUP
#
# The defect class here is a probe that measures what it can see rather than
# what it means. A signal assembled from check-runs reports "ready to merge" on
# a PR that can never merge — that is precisely how this stayed invisible — and
# a code-review gate can arrive as a commit STATUS rather than a check-run, so
# a check-run-only query misses that too. So this guard does not look at checks
# at all. It asks GitHub the one question whose answer is the blocker:
# `reviewDecision`.
#
# `mergeStateStatus` is deliberately NOT read. It is computed rather than
# stored, reports UNKNOWN transiently while GitHub recomputes it, and was
# observed reporting CONFLICTING on two PRs minutes apart where one had a real
# conflict and the other merged cleanly with zero conflicted paths. Same field,
# opposite truths. A guard built on it would refuse honest commands at random,
# which is how a guard gets switched off.
#
# WHAT THIS GUARD DOES *NOT* CLAIM
#
# It answers "is there a standing review verdict blocking this merge?", not
# "can this PR merge?". The difference matters for one measured case that looks
# like this ticket and is not it: a PR opened against a base where reviews are
# disabled gets a review bot reporting `success` with the description "Review
# skipped: reviews are disabled for this base branch", and the repository's two
# review-evidence gates then FAIL. That PR cannot merge either — but it is not
# invisible: the failing-check count is 2, and any check-based signal reports it
# correctly. Only the individual bot's *conclusion* misleads, and nothing here
# reads conclusions.
#
# So that case is deliberately out of scope rather than overlooked, and the
# distinction is the whole reason this guard exists: `CHANGES_REQUESTED` shows
# ZERO failing checks. A guard that also tried to adjudicate check descriptions
# would be re-deriving gates that already run, and would start refusing commands
# on evidence CI already surfaces. The suite pins the boundary with a case, so a
# later reader can see it was decided rather than missed.
#
# SCOPE: `--auto` ONLY
#
# A direct `gh pr merge` against a blocked PR fails loudly and immediately, so
# it is not the invisible failure this exists to close — and refusing it would
# also refuse the deliberate `--admin` override a human reaches for. Only the
# ARMING form is intercepted, because only arming produces a false report of
# success that outlives the command.
#
# The refusal is not a dead end: dismissing a genuinely stale review is a
# supported step of `lisa-drive-pr-to-merge`, and that is what the message
# names. There is deliberately no env-var escape hatch — an override the
# governed agent can set is theatre, and the real remedy is one command away.
#
# SUBSTRATES
#
# Arming has TWO shell spellings, not one. `gh pr merge --auto` is the common
# one; `gh api graphql` running the `enablePullRequestAutoMerge` mutation is the
# same act through the API, and a guard that recognises only the first reports
# safety about both. That is the failure mode CodySwannGT/lisa#3753 records one
# guard over — a control that sees a single substrate and speaks for all of
# them — so both are matched here. The mutation names a node id rather than a
# number, so the probe resolves it through `node(id:)`; a mutation whose id
# cannot be read at all FAILS CLOSED, because silence about an arming this
# guard could not inspect is this ticket's own defect in a new place.
#
# Recorded residual: the guard is registered `matcher: "Bash"`, so a structured
# tool call that arms auto-merge would not reach it. No MCP server provisioned
# here exposes auto-merge arming — the GitHub MCP merges directly, which is out
# of scope by the paragraph above — so the gap is currently unreachable rather
# than open. If one appears, the fix is #3753's: move the registration AND the
# internal `tool_name` gate together, since either alone ships a change that
# nothing fails on. Whether it earns its own `matcher: ""` group is a cost
# question that PR measured and bounded (~11.5ms per non-Bash call, with the
# whole broad set to stay under ~100ms); re-measure rather than assume.
#
# The line below is what lets `lisa apply` tell a downstream copy of this guard
# that is BEHIND from one that is AHEAD. Add a name here in the same commit that
# closes a vector.
# lisa-guard-capabilities: automerge-arm-review-decision, automerge-arm-graphql
set -euo pipefail

input="$(cat)"

# Both interpreters are probed BEFORE use, and a missing one is ANNOUNCED
# rather than swallowed. Under `set -e` an absent jq would abort with 127, and
# Claude Code treats any non-2 exit as a non-blocking hook error — so the guard
# would silently permit the very thing it exists to stop. Degrading to "allow"
# is right (a hook that cannot parse its input cannot tell an arming command
# from an ordinary one); doing it quietly is not.
for required in jq python3; do
  if ! command -v "$required" >/dev/null 2>&1; then
    printf 'block-blind-automerge: %s not found; auto-merge review-gate protection is NOT active\n' \
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

if ! BLOCK_BLIND_AUTOMERGE_COMMAND="$command_str" python3 - <<'PY'
import json
import os
import re
import shlex
import subprocess
import sys

command = os.environ.get("BLOCK_BLIND_AUTOMERGE_COMMAND", "")

# The one verdict that means "GitHub is refusing this merge on review grounds".
BLOCKING_REVIEW_DECISION = "CHANGES_REQUESTED"

# A hook must not become the reason a command hangs. `timeout(1)` is not
# present on every machine this runs on, so the bound is expressed where it is
# always available — and a TimeoutExpired is a NAMED exception, so a slow
# network can never be mistaken for a PR that reads as clean.
GH_TIMEOUT_SECONDS = 20

# gh's persistent flags that take a SEPARATE value token, which must be skipped
# when looking for the subcommand: `gh --repo o/r pr merge` reaches `merge`.
GH_SEPARATE_VALUE = {"-R", "--repo", "--hostname"}

# `gh pr merge` options taking a separate value. Listed so a VALUE is never
# mistaken for the PR selector — `gh pr merge --subject "fix 12" --auto` must
# not read `fix 12` as the PR.
MERGE_SEPARATE_VALUE = {
    "-b", "--body", "-F", "--body-file", "-t", "--subject",
    "--match-head-commit", "--author-email",
}

COMMAND_SEPARATORS = {
    ";", "|", "||", "&", "&&", "(", ")", "<", ">", ">>", "<<", "&|",
}

# Shell wrappers whose `-c` argument is a command in a string rather than argv.
# The outer argv names bash, so the arming is invisible without recursing once.
SHELL_WRAPPERS = {"bash", "sh", "zsh", "dash"}

# The GraphQL mutation that arms auto-merge. Same act as `gh pr merge --auto`,
# reached through the API instead of the porcelain.
AUTO_MERGE_MUTATION = "enablePullRequestAutoMerge"

# gh's field flags. `-f`/`--raw-field` and friends carry `name=value` pairs, so
# both the mutation text and its variables arrive through them.
GH_FIELD_FLAGS = {"-f", "--field", "-F", "--raw-field"}

# How the mutation names its subject, whether inline or as a variable.
PULL_REQUEST_ID_PATTERN = re.compile(
    r"pullRequestId\s*:\s*(?:\"([^\"]+)\"|'([^']+)'|\$([A-Za-z_][A-Za-z0-9_]*))"
)

# A PR node id as GitHub issues them. Matched rather than accepted verbatim so
# a variable reference is never sent to the API as if it were an id.
NODE_ID_PATTERN = re.compile(r"^[A-Za-z0-9_=-]+$")

# The probe that resolves a node id to the same fields `gh pr view` returns.
NODE_QUERY = (
    "query($id:ID!){node(id:$id){... on PullRequest"
    "{number url reviewDecision state}}}"
)

# What a probe spec asks for. `view` and `node` differ only in how the PR is
# named; `unreadable` is an arming whose subject could not be determined.
PROBE_VIEW = "view"
PROBE_NODE = "node"
PROBE_UNREADABLE = "unreadable"


def strip_heredocs(text):
    """Drop heredoc bodies, which are data rather than commands.

    A PR body or commit message pasted into a heredoc can contain the literal
    text of an arming command; running the guard over it would refuse a command
    that arms nothing.

    Args:
        text: The raw command line.

    Returns:
        The command with heredoc payloads removed.
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


def line_boundaries_as_separators(text):
    """Turn newlines into command separators, keeping continuations intact.

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
    lexer.commenters = ""
    return list(lexer)


def is_gh(token):
    """Whether a token invokes the gh CLI.

    Args:
        token: A single shell token.

    Returns:
        True for a bare `gh` or any absolute/relative path ending in `/gh`.
    """
    return token == "gh" or token.endswith("/gh")


def merge_argv_after_gh(tokens, start):
    """Find a `pr merge` invocation's argv within one gh command.

    Args:
        tokens: The operator-aware token list.
        start: Index just past the `gh` token.

    Returns:
        The argv following `merge`, or None when this gh call is not a merge.
    """
    words = []
    index = start
    while index < len(tokens):
        token = tokens[index]
        if token in COMMAND_SEPARATORS:
            break
        if token.startswith("-"):
            # `--repo=o/r` carries its value; `--repo o/r` eats the next token.
            index += 2 if token in GH_SEPARATE_VALUE else 1
            continue
        words.append((token, index))
        index += 1
    for position, entry in enumerate(words):
        if entry[0] == "merge" and position > 0 and words[position - 1][0] == "pr":
            return tokens[entry[1] + 1:]
    return None


def arms_auto_merge(argv):
    """Whether a `gh pr merge` argv carries `--auto`.

    Args:
        argv: Tokens following the `merge` subcommand.

    Returns:
        True if this invocation arms auto-merge rather than merging now.
    """
    index = 0
    while index < len(argv):
        token = argv[index]
        index += 1
        if token in COMMAND_SEPARATORS:
            return False
        if token == "--auto" or token.startswith("--auto="):
            return True
        if token in MERGE_SEPARATE_VALUE:
            index += 1
    return False


def pr_selector(argv):
    """The PR the arming command names, as gh itself would read it.

    Returned verbatim so it can be handed straight back to `gh pr view`, which
    accepts the same number, URL, or branch. When the command names none, gh
    resolves the current branch and so does the probe.

    Args:
        argv: Tokens following the `merge` subcommand.

    Returns:
        The selector token, or None when the command relies on the branch.
    """
    index = 0
    while index < len(argv):
        token = argv[index]
        index += 1
        if token in COMMAND_SEPARATORS:
            return None
        if token in MERGE_SEPARATE_VALUE:
            index += 1
            continue
        if not token.startswith("-"):
            return token
    return None


def repo_flag(tokens, start):
    """The `--repo` value a gh invocation carries, in either spelling.

    Args:
        tokens: The operator-aware token list.
        start: Index just past the `gh` token.

    Returns:
        A list of gh arguments re-expressing the repo, empty when none.
    """
    index = start
    while index < len(tokens):
        token = tokens[index]
        if token in COMMAND_SEPARATORS:
            break
        if token in {"-R", "--repo"} and index + 1 < len(tokens):
            return ["--repo", tokens[index + 1]]
        if token.startswith("--repo="):
            return ["--repo", token.split("=", 1)[1]]
        index += 1
    return []


def gh_invocation_tokens(tokens, start):
    """The tokens belonging to one gh invocation, up to the next separator.

    Args:
        tokens: The operator-aware token list.
        start: Index just past the `gh` token.

    Returns:
        The invocation's own tokens.
    """
    end = start
    while end < len(tokens) and tokens[end] not in COMMAND_SEPARATORS:
        end += 1
    return tokens[start:end]


def field_values(argv):
    """The `name=value` payloads a gh invocation passes as fields.

    Args:
        argv: One gh invocation's tokens.

    Returns:
        A dict of field name to value. Later fields win, as gh does.
    """
    values = {}
    index = 0
    while index < len(argv):
        token = argv[index]
        index += 1
        raw = None
        if token in GH_FIELD_FLAGS and index < len(argv):
            raw = argv[index]
            index += 1
        elif token.startswith("--field=") or token.startswith("--raw-field="):
            raw = token.split("=", 1)[1]
        if raw is not None and "=" in raw:
            name, value = raw.split("=", 1)
            values[name] = value
    return values


def graphql_arming_id(argv):
    """The PR node id a `gh api graphql` auto-merge mutation names.

    Args:
        argv: One gh invocation's tokens, `api` included.

    Returns:
        A pair (is_arming, node_id). `node_id` is None when the mutation arms
        auto-merge but names its subject in a way this cannot resolve — which
        is a refusal, not a pass.
    """
    words = [token for token in argv if not token.startswith("-")]
    if len(words) < 2 or words[0] != "api" or words[1] != "graphql":
        return (False, None)
    fields = field_values(argv)
    query = " ".join(
        value for name, value in fields.items() if AUTO_MERGE_MUTATION in value
    )
    if not query:
        return (False, None)
    match = PULL_REQUEST_ID_PATTERN.search(query)
    if match is None:
        return (True, None)
    inline = match.group(1) or match.group(2)
    if inline:
        return (True, inline if NODE_ID_PATTERN.match(inline) else None)
    # `pullRequestId: $prId` — the id arrives as a separate variable field.
    variable = fields.get(match.group(3))
    if variable and NODE_ID_PATTERN.match(variable):
        return (True, variable)
    return (True, None)


def arming_invocations(text, depth=0):
    """Every auto-merge arming this command line performs.

    Args:
        text: The command line, heredoc payloads already stripped.
        depth: Recursion depth, bounding the `bash -c` unwrap to one level.

    Returns:
        A list of (kind, subject, repo_args) probe specs, one per arming.
    """
    try:
        tokens = shell_tokens(text)
    except ValueError:
        return []
    found = []
    for index, token in enumerate(tokens):
        if depth == 0 and token.split("/")[-1] in SHELL_WRAPPERS:
            # `bash -c '<command>'` hides the whole invocation inside one token.
            if index + 2 < len(tokens) and tokens[index + 1] == "-c":
                found.extend(arming_invocations(tokens[index + 2], depth + 1))
            continue
        if not is_gh(token):
            continue
        repo_args = repo_flag(tokens, index + 1)
        argv = merge_argv_after_gh(tokens, index + 1)
        if argv is not None and arms_auto_merge(argv):
            found.append((PROBE_VIEW, pr_selector(argv), repo_args))
            continue
        is_arming, node_id = graphql_arming_id(
            gh_invocation_tokens(tokens, index + 1)
        )
        if is_arming:
            kind = PROBE_NODE if node_id else PROBE_UNREADABLE
            found.append((kind, node_id, repo_args))
    return found


def probe_args(kind, subject, repo_args):
    """The gh command that answers the review question for one arming.

    Args:
        kind: PROBE_VIEW or PROBE_NODE.
        subject: A PR selector, a node id, or None for the current branch.
        repo_args: gh arguments naming the repository, possibly empty.

    Returns:
        The full gh argv.
    """
    if kind == PROBE_NODE:
        # `--jq` unwraps the envelope so both probes return the same shape.
        return [
            "gh", "api", "graphql",
            "-f", "query=" + NODE_QUERY,
            "-f", "id=" + subject,
            "--jq", ".data.node",
        ]
    args = ["gh", "pr", "view"]
    if subject is not None:
        args.append(subject)
    args.extend(repo_args)
    args.extend(["--json", "number,reviewDecision,state,url"])
    return args


def pull_request_state(kind, subject, repo_args):
    """Ask GitHub for the fields that decide whether a merge can happen.

    Args:
        kind: PROBE_VIEW or PROBE_NODE.
        subject: A PR selector, a node id, or None for the current branch.
        repo_args: gh arguments naming the repository, possibly empty.

    Returns:
        A pair (payload, failure). Exactly one is non-None: `payload` is the
        decoded pull request object, `failure` is a human-readable reason the
        question could not be answered.
    """
    args = probe_args(kind, subject, repo_args)
    try:
        result = subprocess.run(
            args, capture_output=True, text=True, timeout=GH_TIMEOUT_SECONDS
        )
    except FileNotFoundError:
        return (None, "gh not found")
    except subprocess.TimeoutExpired:
        return (None, "gh timed out after %ds" % GH_TIMEOUT_SECONDS)
    except OSError as error:
        return (None, "gh could not be run (%s)" % error)
    if result.returncode != 0:
        return (None, "gh exited %d" % result.returncode)
    try:
        payload = json.loads(result.stdout or "{}")
    except ValueError:
        return (None, "gh returned unreadable JSON")
    if not isinstance(payload, dict):
        return (None, "gh returned unreadable JSON")
    return (payload, None)


def pr_name(payload):
    """The most identifying name available for the PR in a refusal message.

    Args:
        payload: The decoded `gh pr view --json` object.

    Returns:
        A URL, a `#<number>`, or a generic phrase.
    """
    if payload.get("url"):
        return payload["url"]
    if payload.get("number"):
        return "#%s" % payload["number"]
    return "this PR"


REFUSAL = """Blocked: arming auto-merge on %s would report a merge that can never happen.

GitHub reports reviewDecision = CHANGES_REQUESTED. That is a merge blocker with
NO check-run representation: the failing-check count reads 0 and the checks tab
is entirely green while the PR is permanently unmergeable. Where the ruleset
sets dismiss_stale_reviews_on_push: false, pushing the fix does not clear it and
no re-review is scheduled to.

Clear the blocker, then arm:
  - resolve every review thread and address or reply to the feedback
    (`lisa-pull-request-review`);
  - if the review is stale — made on an older head, with the fix already pushed
    — dismiss it (`lisa-drive-pr-to-merge`, review-gate stall), then re-arm.

Do not report the PR as armed-and-merging until this reads anything other than
CHANGES_REQUESTED.
"""

UNREADABLE_REFUSAL = """Blocked: this command arms auto-merge through a GraphQL mutation whose
pullRequestId cannot be read, so whether the PR is blocked on review is
unknowable at the moment the claim "this will merge" is made.

Arm through `gh pr merge <pr> --auto` instead, or pass the node id as a literal
or as a field this command also sets. An arming nobody can inspect is the
failure this guard exists to close, one substrate over.
"""

armings = arming_invocations(strip_heredocs(command))
if not armings:
    sys.exit(0)

for kind, subject, repo_args in armings:
    if kind == PROBE_UNREADABLE:
        # Fails CLOSED, unlike every other unanswerable case below. Those are
        # the guard being unable to run; this is the command refusing to say
        # what it acts on, which is a property of the command.
        sys.stderr.write(UNREADABLE_REFUSAL)
        sys.exit(1)
    payload, failure = pull_request_state(kind, subject, repo_args)
    if failure is not None:
        # A guard that is silently absent reads exactly like a guard that is
        # passing, so say so and let the command through.
        sys.stderr.write(
            "block-blind-automerge: could not read reviewDecision (%s); "
            "auto-merge review-gate protection is NOT active for this command\n"
            % failure
        )
        continue
    if (payload.get("reviewDecision") or "") != BLOCKING_REVIEW_DECISION:
        continue
    sys.stderr.write(REFUSAL % pr_name(payload))
    sys.exit(1)

sys.exit(0)
PY
then
  exit 2
fi

exit 0

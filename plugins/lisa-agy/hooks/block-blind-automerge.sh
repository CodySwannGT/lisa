#!/usr/bin/env bash
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
# THE SECOND VECTOR: A BASE REF NO RULESET COVERS
#
# The paragraphs above answer "is a review verdict blocking this merge?". They
# assume the merge has gates at all. On this repository that assumption is FALSE
# for every ref but four.
#
# Read live from the API, the `base` and `quality checks` rulesets both scope
# `conditions.ref_name.include` to exactly `~DEFAULT_BRANCH`, `refs/heads/dev`,
# `refs/heads/staging`, `refs/heads/main`, with no exclusions. A pull request
# based on ANY other ref — a `stack/**` batching branch, a feature branch —
# therefore has ZERO required checks. Every gate still runs; none of them can
# block. `gh api repos/<o>/<r>/rules/branches/main` returns fifteen required
# contexts; the same call for a stack ref returns `[]`.
#
# Two ordinary, permission-free acts turn that into a merged pull request that
# nobody approved and no gate passed. Both are intercepted here.
#
# 1. ARMING on an uncovered base. `gh pr merge <pr> --auto` on a stack base is
#    a claim that CI will decide, made where CI decides nothing. The merge lands
#    the moment the PR becomes mergeable, with no reader in the path.
# 2. RE-TARGETING a red pull request onto an uncovered base. `gh pr edit <pr>
#    --base stack/x` is a metadata edit any contributor or agent can make. It
#    requires no elevated permission, no `--force`, and no code change.
#    CodySwannGT/lisa#3922 records it executed by accident, by an agent
#    following an approved plan: a pull request BLOCKED by two genuinely failing
#    required checks was re-targeted, both blockers ceased to apply because they
#    were no longer required, the already-armed auto-merge fired, and the head
#    branch was auto-deleted leaving the work reachable from one ref.
#
# WHY THE CONFIGURATION CANNOT ANSWER THIS AND THE API MUST
#
# The resolved Lisa config reads `policy.protect: force_push=true`, which any
# reader takes for "force-push is blocked here". It is not a global switch — it
# configures a ruleset whose ref scope is those four refs. **A policy flag names
# an intent; only the ruleset's ref scope says where it applies.** So coverage
# is read from `GET /repos/{owner}/{repo}/rules/branches/{ref}`, which answers
# for the ONE ref in question and folds in org rulesets, repository rulesets and
# their exclusions. Nothing here reads `.lisa.config.json`.
#
# WHY RE-TARGETING READS CHECKS WHEN ARMING DOES NOT
#
# The section above says this guard reads no check conclusions, and for the
# review question that is right — `CHANGES_REQUESTED` shows zero failing checks,
# so a check-derived signal is the defect rather than the detector. The
# re-target question is the opposite shape: "does this edit remove a live
# blocker?" and a blocker there IS a check by construction. Reading them is not
# re-deriving a gate; it is asking whether one is currently biting.
#
# The condition is deliberately narrow, because re-targeting onto a stack base
# is a SANCTIONED batching workflow and a guard that refused it outright would
# be switched off within a day. A red pull request is refused; a green one is
# announced and allowed. The property protected is "a pull request something is
# currently failing must not be moved onto a base where nothing can block it",
# which holds whatever base it came from — so the current base is not consulted.
#
# WHAT THE REFUSAL ASKS FOR INSTEAD
#
# There is no env-var escape hatch here either, and none is needed: the
# acknowledgement the arming refusal asks for is dropping `--auto`. That is not
# ceremony. `gh pr merge <pr> --merge` on a stack base performs the merge at a
# moment when the advisory results exist and something can read them, which is
# exactly the mitigation #3922 shows is unreachable while auto-merge is armed —
# "the merge lands before any reader exists".
#
# SCOPE: ARMING AND RE-TARGETING, NOT MERGING
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
# lisa-guard-capabilities: automerge-arm-review-decision, automerge-arm-graphql, automerge-arm-uncovered-base, retarget-uncovered-base, retarget-graphql
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
from urllib.parse import quote

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
    "{number url reviewDecision state baseRefName}}}"
)

# What a probe spec asks for. `view` and `node` differ only in how the PR is
# named; `unreadable` is an arming whose subject could not be determined.
PROBE_VIEW = "view"
PROBE_NODE = "node"
PROBE_UNREADABLE = "unreadable"

# What a probe needs to know, per act. The review question and the base-coverage
# question want different fields, and the arming path asks for the second set
# only when the first has already been answered "not blocked" — so a refusal
# still costs exactly one call.
ARM_FIELDS = "number,reviewDecision,state,url,baseRefName"
RETARGET_FIELDS = "number,state,url,baseRefName,statusCheckRollup"

# The two acts this guard intercepts.
ACT_ARM = "arm"
ACT_RETARGET = "retarget"

# The rule type that makes a check able to block a merge. A ref with no rule of
# this type has zero required checks, whatever runs against it.
REQUIRED_STATUS_CHECKS_RULE = "required_status_checks"

# The GraphQL mutation that re-targets a pull request. Same act as
# `gh pr edit --base`, reached through the API instead of the porcelain.
RETARGET_MUTATION = "updatePullRequest"

# How a re-target names its new base, whether inline or as a variable.
BASE_REF_NAME_PATTERN = re.compile(
    r"baseRefName\s*:\s*(?:\"([^\"]+)\"|'([^']+)'|\$([A-Za-z_][A-Za-z0-9_]*))"
)

# `gh pr edit` options taking a SEPARATE value, so a value is never mistaken for
# the PR selector: `gh pr edit --title "fix 12" --base main` must not read
# `fix 12` as the PR.
EDIT_SEPARATE_VALUE = {
    "--add-assignee", "--add-label", "--add-project", "--add-reviewer",
    "-b", "--body", "-F", "--body-file", "-m", "--milestone",
    "--remove-assignee", "--remove-label", "--remove-project",
    "--remove-reviewer", "-t", "--title",
}

# Both spellings of the re-target flag, as `gh pr edit --help` lists them.
BASE_FLAGS = {"-B", "--base"}

# Check outcomes that mean something is currently failing. Read from either
# shape `statusCheckRollup` returns: a CheckRun carries `conclusion`, a
# commit StatusContext carries `state`.
FAILING_CHECK_OUTCOMES = {
    "FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE",
    "ERROR",
}


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


def subcommand_argv_after_gh(tokens, start, verb):
    """Find a `pr <verb>` invocation's argv within one gh command.

    Args:
        tokens: The operator-aware token list.
        start: Index just past the `gh` token.
        verb: The `pr` subcommand to look for, `merge` or `edit`.

    Returns:
        The argv following `verb`, or None when this gh call is not that verb.
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
        if entry[0] == verb and position > 0 and words[position - 1][0] == "pr":
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


def pr_selector(argv, separate_value=MERGE_SEPARATE_VALUE):
    """The PR the command names, as gh itself would read it.

    Returned verbatim so it can be handed straight back to `gh pr view`, which
    accepts the same number, URL, or branch. When the command names none, gh
    resolves the current branch and so does the probe.

    Args:
        argv: Tokens following the `merge` or `edit` subcommand.
        separate_value: Options of that subcommand taking a separate value,
            whose VALUE must never be read as the selector.

    Returns:
        The selector token, or None when the command relies on the branch.
    """
    index = 0
    while index < len(argv):
        token = argv[index]
        index += 1
        if token in COMMAND_SEPARATORS:
            return None
        if token in separate_value or token in BASE_FLAGS:
            index += 1
            continue
        if not token.startswith("-"):
            return token
    return None


def retarget_target(argv):
    """The base ref a `gh pr edit` invocation moves the pull request to.

    Args:
        argv: Tokens following the `edit` subcommand.

    Returns:
        The new base ref, or None when this edit changes no base.
    """
    index = 0
    while index < len(argv):
        token = argv[index]
        index += 1
        if token in COMMAND_SEPARATORS:
            return None
        if token in BASE_FLAGS and index < len(argv):
            return argv[index]
        if token.startswith("--base="):
            return token.split("=", 1)[1]
        if token in EDIT_SEPARATE_VALUE:
            index += 1
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


def graphql_mutation(argv, mutation):
    """The text and fields of one `gh api graphql` call naming a mutation.

    Args:
        argv: One gh invocation's tokens, `api` included.
        mutation: The mutation name to look for.

    Returns:
        A pair (query_text, fields). `query_text` is empty when this call is
        not a graphql invocation running that mutation.
    """
    words = [token for token in argv if not token.startswith("-")]
    if len(words) < 2 or words[0] != "api" or words[1] != "graphql":
        return ("", {})
    fields = field_values(argv)
    query = " ".join(
        value for name, value in fields.items() if mutation in value
    )
    return (query, fields)


def resolved_literal(match, fields, pattern):
    """A mutation argument's value, whether written inline or as a variable.

    Args:
        match: The regex match over the mutation text, or None.
        fields: The gh field payloads the same invocation sets.
        pattern: A compiled pattern the value must satisfy, or None for any.

    Returns:
        The value, or None when it cannot be resolved — which is a refusal
        rather than a pass, because an act whose subject nobody can read is
        this guard's own defect in a new place.
    """
    if match is None:
        return None
    inline = match.group(1) or match.group(2)
    candidate = inline if inline else fields.get(match.group(3))
    if not candidate:
        return None
    if pattern is not None and not pattern.match(candidate):
        return None
    return candidate


def graphql_arming_id(argv):
    """The PR node id a `gh api graphql` auto-merge mutation names.

    Args:
        argv: One gh invocation's tokens, `api` included.

    Returns:
        A pair (is_arming, node_id). `node_id` is None when the mutation arms
        auto-merge but names its subject in a way this cannot resolve — which
        is a refusal, not a pass.
    """
    query, fields = graphql_mutation(argv, AUTO_MERGE_MUTATION)
    if not query:
        return (False, None)
    return (
        True,
        resolved_literal(
            PULL_REQUEST_ID_PATTERN.search(query), fields, NODE_ID_PATTERN
        ),
    )


def graphql_retarget(argv):
    """The subject and new base a `gh api graphql` re-target mutation names.

    `updatePullRequest` also edits titles, bodies and labels, none of which
    move a pull request out from under its gates. Only a mutation that carries
    `baseRefName` is a re-target, so the others are left alone entirely.

    Args:
        argv: One gh invocation's tokens, `api` included.

    Returns:
        A triple (is_retarget, node_id, base_ref). Either of the last two is
        None when the mutation re-targets but names that part in a way this
        cannot resolve.
    """
    query, fields = graphql_mutation(argv, RETARGET_MUTATION)
    if not query:
        return (False, None, None)
    base_match = BASE_REF_NAME_PATTERN.search(query)
    if base_match is None:
        return (False, None, None)
    return (
        True,
        resolved_literal(
            PULL_REQUEST_ID_PATTERN.search(query), fields, NODE_ID_PATTERN
        ),
        resolved_literal(base_match, fields, None),
    )


def guarded_invocations(text, depth=0):
    """Every arming and every re-target this command line performs.

    Args:
        text: The command line, heredoc payloads already stripped.
        depth: Recursion depth, bounding the `bash -c` unwrap to one level.

    Returns:
        A list of (act, kind, subject, repo_args, target_ref) probe specs, one
        per intercepted act. `target_ref` is meaningful only for a re-target.
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
                found.extend(guarded_invocations(tokens[index + 2], depth + 1))
            continue
        if not is_gh(token):
            continue
        repo_args = repo_flag(tokens, index + 1)
        merge_argv = subcommand_argv_after_gh(tokens, index + 1, "merge")
        if merge_argv is not None and arms_auto_merge(merge_argv):
            found.append(
                (ACT_ARM, PROBE_VIEW, pr_selector(merge_argv), repo_args, None)
            )
            continue
        edit_argv = subcommand_argv_after_gh(tokens, index + 1, "edit")
        if edit_argv is not None:
            target = retarget_target(edit_argv)
            if target is not None:
                found.append(
                    (
                        ACT_RETARGET,
                        PROBE_VIEW,
                        pr_selector(edit_argv, EDIT_SEPARATE_VALUE),
                        repo_args,
                        target,
                    )
                )
                continue
        invocation = gh_invocation_tokens(tokens, index + 1)
        is_arming, node_id = graphql_arming_id(invocation)
        if is_arming:
            kind = PROBE_NODE if node_id else PROBE_UNREADABLE
            found.append((ACT_ARM, kind, node_id, repo_args, None))
            continue
        is_retarget, node_id, target = graphql_retarget(invocation)
        if is_retarget:
            kind = (
                PROBE_NODE if node_id and target is not None else PROBE_UNREADABLE
            )
            found.append((ACT_RETARGET, kind, node_id, repo_args, target))
    return found


def probe_args(kind, subject, repo_args, fields):
    """The gh command that answers this guard's questions about one PR.

    Args:
        kind: PROBE_VIEW or PROBE_NODE.
        subject: A PR selector, a node id, or None for the current branch.
        repo_args: gh arguments naming the repository, possibly empty.
        fields: The `--json` field list the act needs.

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
    args.extend(["--json", fields])
    return args


def gh_json(args):
    """Run a gh command and decode its JSON, without throwing.

    Args:
        args: The full gh argv.

    Returns:
        A pair (payload, failure). Exactly one is non-None; `failure` names WHY
        the question could not be answered, because "the box was busy" and "gh
        said no" have different remedies and a killed child returns empty
        streams that read like a clean refusal.
    """
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
        return (json.loads(result.stdout or "{}"), None)
    except ValueError:
        return (None, "gh returned unreadable JSON")


def pull_request_state(kind, subject, repo_args, fields=ARM_FIELDS):
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
    payload, failure = gh_json(probe_args(kind, subject, repo_args, fields))
    if failure is not None:
        return (None, failure)
    if not isinstance(payload, dict):
        return (None, "gh returned unreadable JSON")
    return (payload, None)


def repo_slug(payload, repo_args):
    """The `owner/name` the pull request belongs to.

    Read from the PR's own URL first, because that is the repository GitHub
    says the PR is in — a `--repo` flag is what the caller CLAIMED, and the two
    can differ. The flag is the fallback for a payload with no URL.

    Args:
        payload: The decoded pull request object.
        repo_args: gh arguments naming the repository, possibly empty.

    Returns:
        The slug, or None when neither source names one.
    """
    url = str(payload.get("url") or "")
    parts = url.split("://", 1)[-1].split("/")
    # host / owner / name / "pull" / number
    if len(parts) >= 4 and parts[3] == "pull" and parts[1] and parts[2]:
        return "%s/%s" % (parts[1], parts[2])
    if len(repo_args) == 2 and repo_args[1].count("/") == 1:
        return repo_args[1]
    return None


def branch_rules(repo, ref):
    """Every branch rule GitHub says applies to one ref, read live.

    This is the whole reason the guard asks the API rather than the checked-in
    policy: a `policy.protect` flag names an INTENT, and only the ruleset's ref
    scope says where it applies. This endpoint answers for the one ref in
    question and folds in organisation rulesets, repository rulesets, and every
    exclusion — none of which a config file states.

    Args:
        repo: `owner/name`.
        ref: The branch name, unencoded.

    Returns:
        A pair (rules, failure). Exactly one is non-None.
    """
    payload, failure = gh_json(
        ["gh", "api", "repos/%s/rules/branches/%s" % (repo, quote(ref, safe=""))]
    )
    if failure is not None:
        return (None, failure)
    if not isinstance(payload, list):
        return (None, "gh returned unreadable JSON")
    return (payload, None)


def required_context_count(rules):
    """How many status checks can actually block a merge on that ref.

    A `required_status_checks` rule carrying an empty context list enforces
    nothing, so rules are counted by their CONTEXTS rather than by their
    presence. Counting rules would report a vacuous rule as protection.

    Args:
        rules: The rule objects the API returned for one ref.

    Returns:
        The number of distinct required contexts.
    """
    contexts = set()
    for rule in rules:
        if not isinstance(rule, dict):
            continue
        if rule.get("type") != REQUIRED_STATUS_CHECKS_RULE:
            continue
        parameters = rule.get("parameters")
        listed = (parameters or {}).get(REQUIRED_STATUS_CHECKS_RULE) or []
        for entry in listed:
            if isinstance(entry, dict) and entry.get("context"):
                contexts.add(entry["context"])
    return len(contexts)


def failing_check_names(payload):
    """Every check on the pull request that is currently reporting failure.

    Both shapes `statusCheckRollup` returns are read: a CheckRun carries
    `conclusion` and `name`, a commit status carries `state` and `context`. A
    guard that read one of them would report a clean pull request whenever the
    blocker arrived on the other substrate.

    Args:
        payload: The decoded pull request object.

    Returns:
        The names of the failing checks, in the order GitHub listed them.
    """
    rollup = payload.get("statusCheckRollup")
    names = []
    for entry in rollup if isinstance(rollup, list) else []:
        if not isinstance(entry, dict):
            continue
        outcome = str(entry.get("conclusion") or entry.get("state") or "").upper()
        if outcome in FAILING_CHECK_OUTCOMES:
            names.append(str(entry.get("name") or entry.get("context") or "?"))
    return names


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

UNREADABLE_REFUSAL = """Blocked: this command acts on a pull request through a GraphQL mutation whose
pullRequestId cannot be read, so what it does is unknowable at the moment the
claim "this will merge" is made.

Use `gh pr merge <pr> --auto` or `gh pr edit <pr> --base <ref>` instead, or pass
the node id as a literal or as a field this command also sets. An act nobody can
inspect is the failure this guard exists to close, one substrate over.
"""

UNCOVERED_ARM_REFUSAL = """Blocked: arming auto-merge on %s would merge it with NO required checks.

Its base branch is "%s", and GitHub reports ZERO required status checks on that
ref. Every gate still RUNS against this PR; none of them can block the merge.
Auto-merge therefore lands the moment the PR is mergeable, before any advisory
result has a reader — which is exactly how a PR blocked by two failing required
checks reached a merged state without either being fixed or waived
(CodySwannGT/lisa#3922).

This is not the checks being red. It is the checks being unable to say no.

Merge it deliberately instead, at a moment when the results exist:
  - read them — `gh pr checks %s` — and merge only if you accept every one;
  - `gh pr merge %s --merge` performs the merge now, with you as the reader
    auto-merge would have removed from the path;
  - or re-target onto a covered base — the default branch, or any ref the
    rulesets name — and arm there, where the ruleset enforces the gates for you.
"""

UNCOVERED_RETARGET_REFUSAL = """Blocked: re-targeting %s onto "%s" would evaporate its failing checks.

GitHub reports ZERO required status checks on that ref, and this PR is
currently failing:
%s

Those failures would not be fixed and would not be waived — they would simply
stop being required, and an armed auto-merge would then fire. That is a
permission-free bypass of every gate: no --force, no --admin, no code change,
one metadata edit (CodySwannGT/lisa#3922).

Do one of these instead:
  - fix the failing checks, then re-target; a green PR may be batched freely;
  - leave the PR on its covered base and merge it there.
"""

UNCOVERED_RETARGET_NOTICE = (
    "block-blind-automerge: %s is being re-targeted onto \"%s\", a ref with ZERO "
    "required status checks; its gates will run but cannot block a merge\n"
)


def degraded(question, failure):
    """Announce that the guard could not measure, rather than passing silently.

    Args:
        question: What could not be read.
        failure: Why not.
    """
    sys.stderr.write(
        "block-blind-automerge: could not read %s (%s); auto-merge protection "
        "is NOT active for this command\n" % (question, failure)
    )


def base_is_uncovered(payload, repo_args, base_ref):
    """Whether a ref has zero required status checks, read live from GitHub.

    Args:
        payload: The decoded pull request object.
        repo_args: gh arguments naming the repository, possibly empty.
        base_ref: The ref to ask about.

    Returns:
        True only when GitHub answered and the answer was zero. Every
        unanswerable case returns False and announces itself, because a guard
        that is silently absent reads exactly like a guard that is passing.
    """
    if not base_ref:
        degraded("the base branch", "the PR payload named none")
        return False
    repo = repo_slug(payload, repo_args)
    if repo is None:
        degraded("the repository", "neither the PR URL nor --repo named one")
        return False
    rules, failure = branch_rules(repo, base_ref)
    if failure is not None:
        degraded("the branch rules for %s" % base_ref, failure)
        return False
    return required_context_count(rules) == 0


acts = guarded_invocations(strip_heredocs(command))
if not acts:
    sys.exit(0)

for act, kind, subject, repo_args, target_ref in acts:
    if kind == PROBE_UNREADABLE:
        # Fails CLOSED, unlike every other unanswerable case below. Those are
        # the guard being unable to run; this is the command refusing to say
        # what it acts on, which is a property of the command.
        sys.stderr.write(UNREADABLE_REFUSAL)
        sys.exit(1)
    fields = ARM_FIELDS if act == ACT_ARM else RETARGET_FIELDS
    payload, failure = pull_request_state(kind, subject, repo_args, fields)
    if failure is not None:
        degraded(
            "reviewDecision" if act == ACT_ARM else "the pull request", failure
        )
        continue
    if act == ACT_RETARGET:
        # The current base is deliberately NOT consulted. The property is "a PR
        # something is currently failing must not be moved onto a ref where
        # nothing can block it", which holds whatever base it came from.
        if not base_is_uncovered(payload, repo_args, target_ref):
            continue
        failing = failing_check_names(payload)
        if not failing:
            # A green PR moving onto a stack base is the sanctioned batching
            # workflow. Announced, not refused — a guard that refused it would
            # be switched off within a day.
            sys.stderr.write(
                UNCOVERED_RETARGET_NOTICE % (pr_name(payload), target_ref)
            )
            continue
        sys.stderr.write(
            UNCOVERED_RETARGET_REFUSAL
            % (
                pr_name(payload),
                target_ref,
                "\n".join("  - %s" % name for name in failing),
            )
        )
        sys.exit(1)
    if (payload.get("reviewDecision") or "") == BLOCKING_REVIEW_DECISION:
        sys.stderr.write(REFUSAL % pr_name(payload))
        sys.exit(1)
    base_ref = payload.get("baseRefName")
    if not base_is_uncovered(payload, repo_args, base_ref):
        continue
    selector = subject if subject is not None else str(payload.get("number") or "")
    sys.stderr.write(
        UNCOVERED_ARM_REFUSAL
        % (pr_name(payload), base_ref, selector, selector)
    )
    sys.exit(1)

sys.exit(0)
PY
then
  exit 2
fi

exit 0

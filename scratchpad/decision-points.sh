#!/usr/bin/env bash
# Decision-point probe harness for block-direct-issue-create.
#
# Usage: bash scratchpad/decision-points.sh [path-to-hook]
#
# Enumerates the PARSER'S BRANCHES rather than a list of attacks somebody
# thought of. That distinction is the whole lesson of this file: probing 21
# command SHAPES scored 21/21 while the guard was bypassable by a POSIX
# `nice` prefix and by two appended characters. Probing the branches —
# tokenise, segment, resolve program, strip flags, classify, declare — found
# every one of those in a single pass.
#
# Installed-tool status on the machine this was written for: `nice` and
# `stdbuf` ARE present, `timeout` / `setsid` / `doas` / `proxychains` / `watch`
# are NOT. That matters for proving EXPLOITABILITY but not for testing the
# guard, which classifies text and never executes it — so every prefix below is
# probed regardless of whether it could run here. A harness that skipped the
# absent ones would report green on the wrong subset.
set -uo pipefail

HOOK="${1:-plugins/src/base/hooks/block-direct-issue-create.sh}"
# Resolved to an absolute path BEFORE any probe changes directory. The probes
# run from a throwaway project dir, and joining `$OLDPWD` onto an already
# absolute path produced a nonexistent one — the hook then failed to start,
# every expected BLOCK read as ALLOW, and the harness reported 81 failures for
# a guard that was fine. Pointing this at a saved copy of the previous guard is
# the whole differential workflow, so it has to accept an absolute path.
case "$HOOK" in
  /*) ;;
  *) HOOK="$PWD/$HOOK" ;;
esac
[ -f "$HOOK" ] || {
  echo "decision-points: no hook at $HOOK" >&2
  exit 1
}
WORKDIR="$(mktemp -d)"
printf '%s\n' '{"tracker":"github","github":{"labels":{"build":{"ready":"status:ready"}}}}' \
  >"$WORKDIR/.lisa.config.json"

pass=0
fail=0

# probe <expected BLOCK|ALLOW> <label> <command>
probe() {
  local expected="$1" label="$2" command="$3"
  local payload status verdict
  payload="$(jq -cn --arg c "$command" '{tool_name:"Bash",tool_input:{command:$c}}')"
  ( cd "$WORKDIR" && printf '%s' "$payload" |
    CLAUDE_PROJECT_DIR="" LISA_ALLOW_DIRECT_ISSUE_CREATE="" \
      /bin/bash "$HOOK" >/dev/null 2>&1 )
  status=$?
  if [ "$status" -eq 2 ]; then verdict="BLOCK"; else verdict="ALLOW"; fi
  if [ "$verdict" = "$expected" ]; then
    pass=$((pass + 1))
    printf '  ok   %-6s %-38s %s\n' "$verdict" "$label" "$command"
  else
    fail=$((fail + 1))
    printf '  FAIL want=%-6s got=%-6s %-30s %s\n' "$expected" "$verdict" "$label" "$command"
  fi
}

CREATE='gh issue create --title x --body y'

echo "== DP0 control =="
probe BLOCK "bare create"            "$CREATE"
probe ALLOW "declared create"        "$CREATE --label status:ready"
probe ALLOW "read"                   "gh issue list --state open"
probe ALLOW "unrelated"              "ls -la /tmp"
probe ALLOW "prose mention"          'git commit -m "the gh issue create guard"'

echo "== DP1 unlisted prefix (program resolution) =="
for prefix in timeout stdbuf setsid ionice chrt taskset unbuffer torsocks \
  firejail systemd-run busybox strace watch doas proxychains ktrace \
  catchsegv retry pv; do
  probe BLOCK "$prefix" "$prefix $CREATE"
done

echo "== DP2 listed wrapper carrying a flag =="
probe BLOCK "env -i"                 "env -i $CREATE"
probe BLOCK "nice -n 10"             "nice -n 10 $CREATE"
probe BLOCK "sudo -u nobody"         "sudo -u nobody $CREATE"
probe BLOCK "xargs -I{}"             "xargs -I {} $CREATE"
probe BLOCK "time -p"                "time -p $CREATE"
probe BLOCK "command -p"             "command -p $CREATE"
probe BLOCK "stdbuf -oL (installed)" "stdbuf -oL $CREATE"
probe BLOCK "nice -n 10 gh api"      "nice -n 10 gh api repos/o/r/issues -f title=x"
probe BLOCK "env -i jira"            "env -i jira issue create --summary x"

echo "== DP3 end of options =="
probe BLOCK "post-dashdash label"    "$CREATE -- --label status:ready"
probe BLOCK "post-dashdash acli"     "acli jira workitem create --summary x -- --status status:ready"
probe ALLOW "pre-dashdash label"     "$CREATE --label status:ready -- trailing"

echo "== DP4 tokenisation failure =="
probe BLOCK "trailing single quote"  "$CREATE #'"
probe BLOCK "trailing double quote"  "$CREATE #\""
probe BLOCK "unbalanced quote"       "gh issue create --title 'x"
probe BLOCK "line continuation"      "$CREATE \\"
probe ALLOW "unparseable, no tracker" "echo 'it's fine"

echo "== DP5 nesting =="
probe BLOCK "bash -c"                "bash -c '$CREATE'"
probe BLOCK "bash -c + wrapper"      "bash -c 'env -i $CREATE'"
probe BLOCK "sh -c + unlisted"       "sh -c 'timeout $CREATE'"
# DOCUMENTED LIMIT, not a gap: intercepting this means recursing into arbitrary
# trailing quoted operands, which re-refuses `git commit -m "the gh issue create
# guard"`. Remote execution runs against another host's tracker config and needs
# that host's own guard. Stated in the rule beside the settings.json boundary.
probe ALLOW "ssh (documented limit)" "ssh host '$CREATE'"
probe BLOCK "eval builtin"           "eval \"$CREATE\""
probe BLOCK "depth-4 nesting"        "bash -c \"bash -c \\\"bash -c \\\\\\\"$CREATE\\\\\\\"\\\"\""

echo "== DP8 glued operators and gh api parsing =="
probe BLOCK "glued &&"               "true&&$CREATE"
probe BLOCK "glued ;"                "true;$CREATE"
probe BLOCK "api boolean flag"       "gh api -X POST --silent repos/o/r/issues -f title=x"
probe BLOCK "api global flag first"  "gh --verbose api repos/o/r/issues -f title=x"
probe ALLOW "endpoint as payload"    "gh api repos/o/r/comments -f path=repos/o/r/issues"
probe ALLOW "api read"               "gh api repos/o/r/issues"
probe ALLOW "prose issueCreate"      'git commit -m "fix issueCreate typo"'

echo "== DP6 path forms =="
probe BLOCK "absolute path"          "/opt/homebrew/bin/$CREATE"
probe BLOCK "unlisted + absolute"    "timeout /opt/homebrew/bin/$CREATE"
probe BLOCK "nice + absolute"        "nice -n 5 /usr/local/bin/$CREATE"

echo "== DP7 override reachability =="
probe BLOCK "inline assignment"      "LISA_ALLOW_DIRECT_ISSUE_CREATE=1 $CREATE"
probe BLOCK "env -i with override"   "env LISA_ALLOW_DIRECT_ISSUE_CREATE=1 $CREATE"
probe BLOCK "export then create"     "export LISA_ALLOW_DIRECT_ISSUE_CREATE=1 && $CREATE"

echo "== DP9 locate: the operand of an interpreter =="
# The branch this section exists for is RESOLUTION STOPPING AT THE WRAPPER.
# `bash /path/create.sh` shows the classifier two tokens, `bash` and a path,
# and the creation is one file away. Enumerating interpreters is the unbounded
# question all over again, so the alphabet below deliberately includes ones
# nobody would list — a made-up runner, a bare path, `source` — and they must
# all refuse for the same reason rather than for a per-interpreter rule.
CREATE_SH="$WORKDIR/create.sh"
{
  printf '%s\n' '#!/usr/bin/env bash'
  printf '%s\n' 'curl -X POST https://api.linear.app/graphql \'
  printf '%s\n' '  -d "{\"query\":\"mutation{issueCreate(input:{}){success}}\"}"'
} >"$CREATE_SH"

CREATE_JS="$WORKDIR/wrapper.mjs"
{
  printf '%s\n' 'await fetch("https://api.linear.app/graphql", {'
  printf '%s\n' '  method: "POST",'
  printf '%s\n' '  body: JSON.stringify({ query: "mutation{issueCreate(input:{}){id}}" }),'
  printf '%s\n' '});'
} >"$CREATE_JS"

# The same script, declaring readiness. The point of the guard is that an
# HONEST filing passes, so every refusal above has to have a matching allow.
DECLARED_SH="$WORKDIR/declared.sh"
{
  printf '%s\n' '#!/usr/bin/env bash'
  printf '%s\n' 'gh issue create --title x --body y --label status:ready'
} >"$DECLARED_SH"

GATED_SH="$WORKDIR/gated.sh"
{
  printf '%s\n' '#!/usr/bin/env bash'
  printf '%s\n' '# [lisa-human-gate] reason=pricing'
  printf '%s\n' 'curl -X POST https://api.linear.app/graphql \'
  printf '%s\n' '  -d "{\"query\":\"mutation{issueCreate(input:{}){success}}\"}"'
} >"$GATED_SH"

PAYLOAD_JSON="$WORKDIR/payload.json"
printf '%s\n' '{"query":"mutation{issueCreate(input:{}){success}}"}' >"$PAYLOAD_JSON"

# An ordinary file that merely TALKS about creations. The conjunction — a
# tracker endpoint AND a creation verb — is what keeps prose out.
PROSE_MD="$WORKDIR/notes.md"
{
  printf '%s\n' '# Notes'
  printf '%s\n' 'The guard refuses `gh issue create` and the GraphQL `issueCreate`.'
} >"$PROSE_MD"

for runner in bash sh zsh ksh dash /bin/bash "bash -x" "bash --norc" \
  source . "env bash" "nice -n 5 bash" "xargs -I{} bash" python3 node bun \
  "deno run" ruby perl osascript madeup-runner; do
  probe BLOCK "$runner <script>" "$runner $CREATE_SH"
done
probe BLOCK "bare path"              "$CREATE_SH"
probe BLOCK "node wrapper.mjs"       "node $CREATE_JS"
probe BLOCK "bash -c 'bash <script>'" "bash -c 'bash $CREATE_SH'"
probe ALLOW "declared inside script" "bash $DECLARED_SH"
probe ALLOW "human gate inside script" "bash $GATED_SH"
probe ALLOW "prose about creations"  "bash $PROSE_MD"

echo "== DP10 locate: the payload the request submits =="
probe BLOCK "curl --data-binary @file" \
  "curl -X POST https://api.linear.app/graphql --data-binary @$PAYLOAD_JSON"
probe BLOCK "curl -d @file" \
  "curl -X POST https://api.linear.app/graphql -d @$PAYLOAD_JSON"
probe BLOCK "gh api graphql --input file" \
  "gh api graphql --input $PAYLOAD_JSON"
probe BLOCK "jq | curl --data-binary @-" \
  "jq -n '{query:\"mutation{issueCreate(input:{}){id}}\"}' | curl -X POST https://api.linear.app/graphql --data-binary @-"
probe ALLOW "payload file, no endpoint" "cat $PAYLOAD_JSON"

echo "== DP11 declare: a state-based tracker's ready role =="
# GitHub's ready role is a LABEL and labels are argv-native, so an honest
# command has always existed there. JIRA's and Linear's are workflow STATES
# living in the request payload, and `curl` has no flag that carries one — so
# until this section existed the only declaration that passed on those trackers
# was `[lisa-human-gate]`, which is a lie about a build-ready item. A guard
# that leaves an honest operator no compliant command and one dishonest one is
# failing in the harmful direction.
STATEDIR="$(mktemp -d)"
printf '%s\n' '{"tracker":"linear","linear":{"workflow":{"ready":"Ready"}}}' \
  >"$STATEDIR/.lisa.config.json"

state_probe() {
  local expected="$1" label="$2" command="$3"
  local payload status verdict
  payload="$(jq -cn --arg c "$command" '{tool_name:"Bash",tool_input:{command:$c}}')"
  ( cd "$STATEDIR" && printf '%s' "$payload" |
    CLAUDE_PROJECT_DIR="$STATEDIR" LISA_ALLOW_DIRECT_ISSUE_CREATE="" \
      /bin/bash "$HOOK" >/dev/null 2>&1 )
  status=$?
  if [ "$status" -eq 2 ]; then verdict="BLOCK"; else verdict="ALLOW"; fi
  if [ "$verdict" = "$expected" ]; then
    pass=$((pass + 1))
    printf '  ok   %-6s %-38s %s\n' "$verdict" "$label" "$command"
  else
    fail=$((fail + 1))
    printf '  FAIL want=%-6s got=%-6s %-30s %s\n' "$expected" "$verdict" "$label" "$command"
  fi
}

LINEAR_MUTATION='{"query":"mutation{issueCreate(input:{}){success}}"}'
state_probe BLOCK "linear curl, undeclared" \
  "curl -X POST https://api.linear.app/graphql -d '$LINEAR_MUTATION'"
state_probe ALLOW "linear curl, lifecycle_role" \
  "LIFECYCLE_ROLE=ready curl -X POST https://api.linear.app/graphql -d '$LINEAR_MUTATION'"
state_probe ALLOW "linear cli --state" \
  "linear issue create --title x --state Ready"
state_probe BLOCK "linear curl, wrong role" \
  "LIFECYCLE_ROLE=blocked curl -X POST https://api.linear.app/graphql -d '$LINEAR_MUTATION'"
# The escape must not become a second, weaker spelling on the tracker where a
# real one already exists.
probe BLOCK "github create, lifecycle_role only" \
  "$CREATE --body 'lifecycle_role:ready'"

rm -rf "$WORKDIR" "$STATEDIR"
printf '\n%s\n' "pass=$pass fail=$fail"
[ "$fail" -eq 0 ]

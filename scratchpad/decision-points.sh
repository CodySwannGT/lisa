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
      /bin/bash "$OLDPWD/$HOOK" >/dev/null 2>&1 )
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

rm -rf "$WORKDIR"
printf '\n%s\n' "pass=$pass fail=$fail"
[ "$fail" -eq 0 ]

#!/usr/bin/env bash
# Exercise the falsifiable-checks scratch-copy recipe (committed at 3db6ceec) verbatim
# in a throwaway repo: a modified tracked binary and an untracked new file must both land in "$tmp".
set -u
J=/Users/codysai/.claude/jobs/783bf208/tmp
R="$J/recipe-repo"
rm -rf "$R"
mkdir -p "$R"
cd "$R" || exit 1
git init -q
git config user.email t@example.invalid
git config user.name t
printf 'node_modules/\n' > .gitignore
head -c 256 /dev/urandom > bin.dat
printf 'hello\n' > text.txt
git add -A
git commit -qm init
mkdir node_modules
printf 'dep\n' > node_modules/marker
# uncommitted state under test
head -c 512 /dev/urandom > bin.dat
printf 'changed\n' >> text.txt
mkdir -p newdir
printf 'brand new\n' > newdir/untracked.txt
SRC_BIN_SHA=$(shasum -a 256 bin.dat | cut -d' ' -f1)

echo "--- recipe lines 1-6 verbatim"
# shellcheck disable=SC1090
eval "$(head -n 6 "$J/recipe.sh")"
echo "tmp=$tmp"

echo "--- checks in \$tmp"
fail=0
TMP_BIN_SHA=$(shasum -a 256 "$tmp/bin.dat" | cut -d' ' -f1)
[ "$SRC_BIN_SHA" = "$TMP_BIN_SHA" ] && echo "PASS binary change landed ($TMP_BIN_SHA)" || { echo "FAIL binary: src=$SRC_BIN_SHA tmp=$TMP_BIN_SHA"; fail=1; }
cmp -s text.txt "$tmp/text.txt" && echo "PASS tracked text change landed" || { echo "FAIL text"; fail=1; }
cmp -s newdir/untracked.txt "$tmp/newdir/untracked.txt" && echo "PASS untracked file landed" || { echo "FAIL untracked"; fail=1; }
[ -L "$tmp/node_modules" ] && [ -f "$tmp/node_modules/marker" ] && echo "PASS node_modules linked" || { echo "FAIL node_modules"; fail=1; }

echo "--- bite control: the same checks against a bare worktree (no apply/rsync) must FAIL"
ctl=$(mktemp -d)
git worktree add -q --detach "$ctl" HEAD
[ "$SRC_BIN_SHA" = "$(shasum -a 256 "$ctl/bin.dat" | cut -d' ' -f1)" ] && echo "CONTROL-UNEXPECTED binary matched" || echo "CONTROL-OK binary differs without apply"
[ -f "$ctl/newdir/untracked.txt" ] && echo "CONTROL-UNEXPECTED untracked present" || echo "CONTROL-OK untracked absent without rsync"
git worktree remove --force "$ctl"

echo "--- recipe last line verbatim"
eval "$(tail -n 1 "$J/recipe.sh")"
[ -e "$tmp" ] && { echo "FAIL tmp still exists"; fail=1; } || echo "PASS tmp removed"
git worktree list
git status --short
echo "result fail=$fail"
exit $fail

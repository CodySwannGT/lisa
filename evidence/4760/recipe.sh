tmp=$(mktemp -d)
git worktree add --detach "$tmp" HEAD
git diff --binary HEAD | git -C "$tmp" apply --allow-empty   # tracked changes, binaries included
git ls-files --others --exclude-standard -z |
  rsync -a --from0 --files-from=- ./ "$tmp"/                 # untracked new files
ln -s "$PWD/node_modules" "$tmp/node_modules"                # dependencies (or run the project's install in "$tmp")
# 1. baseline: run the check in "$tmp" BEFORE breaking anything; it must be green
# 2. break the property in "$tmp", run the check there, read the failure
git worktree remove --force "$tmp"                           # discarding the copy is the restore

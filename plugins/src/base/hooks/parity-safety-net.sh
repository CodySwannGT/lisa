#!/usr/bin/env bash
# PreToolUse hook for Bash: a safety net that blocks destructive shell commands
# before they run. Lisa-native reimplementation of the upstream
# `safety-net@cc-marketplace` plugin's PreToolUse Bash-guard (parity work,
# issues #1059 and #1960). It does NOT port upstream code — it re-expresses the
# behavior in Lisa's hook conventions, modeled on block-no-verify.sh.
#
# It reads the hook stdin JSON, inspects the proposed Bash command, and EXITS
# NON-ZERO (2) to BLOCK when a known-destructive pattern matches:
#   - `rm -rf` of a root / home / wildcard path (quote-aware boundaries, so
#     `bash -c "rm -rf /"` and interpreter one-liners are caught too; the rm
#     guards also match path-prefixed invocations like `/bin/rm` and `./rm`)
#   - `rm -rf` of the cwd (`.`), a `..`-traversal path, a `~/`-anchored path,
#     an absolute path outside the project (with a /tmp, /var/tmp, $TMPDIR
#     allowance), a `$VAR` target other than $TMPDIR, or ANY recursive forced
#     delete while cwd is $HOME
#   - force-pushing a protected branch (main/master/production/prod/release) —
#     feature-branch force-push stays allowed (sanctioned rebase workflow;
#     deliberate divergence from upstream's any-branch block). Every git guard
#     sees through leading git GLOBAL options (`-C <path>`, `-c <k>=<v>`,
#     `--git-dir[=…]`, `--no-pager`, …), so `git -C /path <destructive>` cannot
#     dodge the subcommand anchor
#   - `git reset --hard` / `--merge` while the working tree is dirty. Deliberate
#     divergence: upstream blocks unconditionally; Lisa allows clean-tree resets.
#     Residual risk (documented, accepted): the dirty check runs in the hook's
#     cwd at hook time, so a `cd elsewhere && git reset --hard` evades it.
#   - `git rebase --abort`/`--quit` while the in-progress rebase holds
#     human-made conflict resolutions (AUTO_MERGE discriminator; issue #1956).
#     Clean or untouched rebase state stays abortable; the apply backend and a
#     missing AUTO_MERGE ref fail closed. Deliberate divergence: upstream
#     blocks `rebase --abort` unconditionally, which strands agents mid-rebase.
#   - `git checkout` discards (`--`, `-f/--force`, `--pathspec-from-file`,
#     bare `.` — the bare-`.` block exceeds upstream)
#   - `git switch --discard-changes` / `-f/--force`
#   - `git restore` touching the worktree (allowed only with `--staged` and
#     without `--worktree`)
#   - `git stash drop` / `git stash clear`
#   - `git clean` with force and no dry-run (`-n`/`--dry-run` anywhere wins)
#   - `git branch -D` (or `-d` + `-f` in any spelling)
#   - `git tag -d`, `git reflog delete`, `git worktree remove --force`
#   - `find ... -delete`, `find ... -exec rm -rf`, `xargs ... rm -rf`
#   - disk destroyers: `dd of=/dev/...`, `mkfs ... /dev/...`, `shred`
#   - dropping or truncating a database/schema/table (Lisa-only guard)
# Otherwise it exits 0 and the command proceeds. Malformed hook input fails
# CLOSED: any parse error exits 2 (a non-2 exit would be a non-blocking hook
# error in Claude Code, silently failing open).
#
# Known accepted false-positive class: this is a text scan, not a shell engine,
# so display commands quoting a destructive string (`echo "docs about rm -rf /"`)
# can match. Upstream exempts those via an engine-only DISPLAY_COMMANDS list a
# grep hook cannot replicate. Workaround: quote-break the string or use the
# gh-writer heredoc form, whose payload is stripped before the guards run.
#
# Operators extend the built-in rules with a project-local rule file — one
# extended-regex (ERE) per line, blank lines and `#` comments ignored — managed
# by the parity-safety-net-rules skill. Default location (overridable via
# SAFETY_NET_RULES_FILE):
#   ${CLAUDE_PROJECT_DIR:-$PWD}/.claude/safety-net-rules.txt
set -euo pipefail

# Fail CLOSED on any unexpected error (malformed JSON, missing jq, …): exit 2 so
# the tool call is denied instead of surfacing a non-blocking hook warning.
# Deliberately NOT `set -E`: errtrace would propagate this trap into command
# substitutions (e.g. the heredoc parser call, whose non-zero exit codes are
# meaningful protocol) and rewrite their status to 2 before it can be read.
trap 'printf "%s\n" "Blocked by safety-net: hook failed while parsing its input; denying fail-closed." >&2; exit 2' ERR

input="$(cat)"

tool_name="$(printf '%s' "$input" | jq -r '.tool_name // empty')"
if [ "$tool_name" != "Bash" ]; then
  exit 0
fi

command_str="$(printf '%s' "$input" | jq -r '.tool_input.command // empty')"
if [ -z "$command_str" ]; then
  exit 0
fi

# block() prints the reason to stderr (surfaced to the model) and exits 2 so the
# Bash tool call is denied. $1 = human-readable reason for the block.
block() {
  cat >&2 <<EOF
Blocked by safety-net: $1

This command matched a destructive-operation guard. If it is genuinely safe and
intentional, ask the user to confirm, then run it manually outside the agent, or
narrow the command so it no longer matches the guard.
EOF
  exit 2
}

# Heredoc payloads are data only for a deliberately narrow set of GitHub CLI
# write commands. A companion parser proves that shape before removing payload
# text from the destructive-command scans below. Unknown executable heredocs
# remain visible to every built-in and custom rule. Ambiguous or malformed
# heredocs fail closed instead of guessing which text the shell would execute.
#
# block_heredoc() teaches the remediation the moment the wall is hit: a bare
# denial strands the agent with no path forward (gardener #1789). The remedy
# depends on the command shape (issue #1958): `git commit -m "$(cat <<EOF …)"`
# attempts get the commit -F text; every other heredoc denial gets the
# file-based execution guidance instead — the commit text is misleading there.
# The git-commit detection inlines the GIT_GLOBAL_OPTS shape (defined later in
# this file, after the heredoc dispatch runs) so `git -C <path> commit` and
# `git -c k=v commit` spellings are still recognized.
block_heredoc() {
  if printf '%s' "$command_str" \
    | grep -Eq -- '(^|[^[:alnum:]_-])git[[:space:]]+(-[^;&|[:space:]]+([[:space:]]+[^-;&|[:space:]][^;&|[:space:]]*)?[[:space:]]+)*commit([^[:alnum:]_-]|$)'; then
    block "$1
Heredoc commit invocations are blocked (the payload is executable shell).
Fix: write the commit message to a file and run \`git commit -F <file>\`.
Every commit must also carry a Co-authored-by trailer for a supported agent
(Claude/Codex/OpenCode) — the commit-msg hook enforces this."
  fi
  block "$1
Heredoc payloads are blocked here (the payload is executable shell).
Fix: write the payload to a file with the Write tool, then execute that file
directly (for example \`python3 <file>\` or \`bash <file>\`)."
}

command_for_guards="$command_str"
case "$command_str" in
  *'<<'*)
    hook_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    heredoc_parser="$hook_dir/parity-safety-net-heredoc.py"
    if ! command -v python3 >/dev/null 2>&1 || [ ! -r "$heredoc_parser" ]; then
      block_heredoc "cannot safely classify heredoc command because its parser runtime is unavailable"
    fi
    if ! printf '%s\n' "$command_str" | /bin/bash -n >/dev/null 2>&1; then
      block_heredoc "malformed heredoc command failed shell syntax validation"
    fi

    parser_status=0
    if parser_output="$(printf '%s' "$command_str" | python3 "$heredoc_parser" 2>/dev/null)"; then
      parser_status=0
    else
      parser_status=$?
    fi

    case "$parser_status" in
      0) command_for_guards="$parser_output" ;;
      10) command_for_guards="$command_str" ;;
      20) block_heredoc "malformed or ambiguous heredoc command cannot be safely classified" ;;
      *) block_heredoc "heredoc parser failed; command was denied fail-closed" ;;
    esac
    ;;
esac

# matches / matches_cs run an ERE against the guarded command text. matches is
# case-insensitive (the default for these guards); matches_cs is case-SENSITIVE
# for guards where flag case is meaningful (`git branch -d` vs `-D`).
matches() {
  printf '%s' "$command_for_guards" | grep -Eiq -- "$1"
}
matches_cs() {
  printf '%s' "$command_for_guards" | grep -Eq -- "$1"
}

# Normalize bash line-continuations (a trailing backslash + newline → space)
# before segmenting the command. Without this, "git push --force origin
# \<newline>main" splits into a segment matching --force but not `main`, letting a
# protected force-push slip past. Uses awk (POSIX) instead of a GNU-only
# `sed ':a;N;$!ba;…'`, which errors on BSD sed (macOS) and there silently no-ops.
normalized_command_str="$(printf '%s' "$command_for_guards" \
  | awk '{ if (sub(/\\$/, "")) printf "%s ", $0; else print }')"

# Shared ERE fragments. GIT_TOKENS walks over intermediate argv tokens without
# crossing a statement separator, so a flag in a LATER statement can never be
# attributed to an earlier git subcommand.
readonly GIT_TOKENS='([[:space:]]+[^;&|[:space:]]+)*[[:space:]]+'
# Git GLOBAL options (`-C <path>`, `-c <k>=<v>`, `--git-dir[=…]`, `--no-pager`,
# …) legally sit between `git` and its subcommand, so every subcommand guard
# consumes them — otherwise `git -C /path checkout -- f` dodges the anchor
# (issue #1960 security review F1). Shape: zero or more dash-led tokens, each
# optionally followed by ONE non-dash value token, which covers both the
# `--git-dir=/x` and `--git-dir /x` spellings without naming every option.
readonly GIT_GLOBAL_OPTS='(-[^;&|[:space:]]+([[:space:]]+[^-;&|[:space:]][^;&|[:space:]]*)?[[:space:]]+)*'
# Anchor for every git subcommand guard: word-bounded `git`, whitespace, then
# any run of global options. Callers append the subcommand name directly.
readonly GIT_CMD='(^|[^[:alnum:]_-])git[[:space:]]+'"$GIT_GLOBAL_OPTS"
# An rm invocation: bare `rm` or a path whose basename is exactly `rm`
# (`/bin/rm`, `./rm`) — issue #1960 security review F2. The optional prefix must
# END IN `/` immediately before `rm`, so charm/confirm/informant/rmdir never
# match. The preceding-char class still excludes `.`, `/`, and `-` to keep
# `--rm`-style flags and `foo.rm` names out.
readonly RM_CMD='(^|[^[:alnum:]_./-])([[:alnum:]_./-]*/)?rm'
# rm invoked with BOTH a recursive and a force flag — clustered (-rf/-fr, any
# extra letters) or split, in either order. The split gate pairs ANY recursive
# form (short cluster containing r, or --recursive) with ANY force form (short
# cluster containing f, or --force), so mixed spellings like `rm -r --force /`
# and `rm --recursive -f /` cannot slip between the short/short and long/long
# alternations (PR #1976 review).
readonly RM_RF_CLUSTER="$RM_CMD"'([[:space:]]+-[[:alnum:]-]+)*[[:space:]]+(-[[:alnum:]]*r[[:alnum:]]*f|-[[:alnum:]]*f[[:alnum:]]*r)([[:space:]]|$)'
readonly RM_RF_SPLIT="$RM_CMD"'(([[:space:]][^;&|]*)?[[:space:]](-[[:alnum:]]*r[[:alnum:]]*|--recursive)([[:space:]][^;&|]*)?[[:space:]](-[[:alnum:]]*f[[:alnum:]]*|--force)([[:space:]]|$)|([[:space:]][^;&|]*)?[[:space:]](-[[:alnum:]]*f[[:alnum:]]*|--force)([[:space:]][^;&|]*)?[[:space:]](-[[:alnum:]]*r[[:alnum:]]*|--recursive)([[:space:]]|$))'

# 1. Recursive forced delete (`rm -rf`) of a filesystem root, home, or top-level
#    wildcard. Two gates ANDed: the statement must invoke `rm` with BOTH a
#    recursive and a force flag, AND name a catastrophic target. Splitting the
#    flag check from the target check keeps each regex legible and testable.
#    The target boundary classes include quote characters (issue #1960): without
#    them, `bash -c "rm -rf /"` and interpreter one-liners like
#    `python -c "… os.system('rm -rf /')"` slip through because the target is
#    quote-adjacent instead of space-bounded.
#    Both gates run PER STATEMENT inside the shared rm loop below (quality
#    review S1): a harmless `/` in a LATER statement (`rm -rf build && cd /`)
#    is never attributed to the rm in an earlier one.
qc="'\""
readonly RM_CATASTROPHIC_TARGET='([[:space:]='"$qc"'])(/|/\*|/\.\*?|~|~/\*?|\$HOME\b|\$\{HOME\}|\*)([[:space:]'"$qc"']|/?\*?['"$qc"']?$)'

# 1b. rm target hardening (issue #1960). For every statement that invokes rm
#     with recursive+force flags, additionally block when:
#       - cwd is $HOME (any target is one argument away from wiping home), or
#       - the target is the cwd itself (`.` / `./`), or
#       - the target traverses out via `..`, or
#       - the target is home-anchored (`~/…` — the shell expands it to $HOME at
#         execution time, so it is always outside the project), or
#       - the target is an absolute path outside the project — with an allowance
#         for /tmp, /var/tmp, and $TMPDIR — or
#       - the target is a `$VAR` expansion other than the sanctioned $TMPDIR.
#     Globbing is disabled around the token walk so a literal `*` in the command
#     is never expanded against the hook's own cwd.
project_dir="${CLAUDE_PROJECT_DIR:-$PWD}"
tmp_dir_allow="${TMPDIR:-/tmp}"
tmp_dir_allow="${tmp_dir_allow%/}"
[ -n "$tmp_dir_allow" ] || tmp_dir_allow="/tmp"
while IFS= read -r rm_stmt; do
  if ! printf '%s' "$rm_stmt" | grep -Eiq -- "$RM_RF_CLUSTER" \
    && ! printf '%s' "$rm_stmt" | grep -Eiq -- "$RM_RF_SPLIT"; then
    continue
  fi
  # Guard 1: catastrophic target named in the SAME statement as the rm -rf.
  if printf '%s' "$rm_stmt" | grep -Eq -- "$RM_CATASTROPHIC_TARGET"; then
    block "recursive forced delete of a root, home, or wildcard path (rm -rf)"
  fi
  # Physical-path comparison (pwd -P): on macOS $HOME or the cwd may arrive via
  # a symlink (/var → /private/var), and a string compare would miss the match.
  if [ -n "${HOME:-}" ] \
    && [ "$(pwd -P)" = "$(cd -- "$HOME" 2>/dev/null && pwd -P)" ]; then
    block "recursive forced delete while the working directory is \$HOME (cd into a project first)"
  fi
  set -f
  seen_rm=0
  for raw_token in $rm_stmt; do
    token="${raw_token#\"}"
    token="${token#\'}"
    token="${token%\"}"
    token="${token%\'}"
    if [ "$seen_rm" -eq 0 ]; then
      # Path-prefixed spellings (`/bin/rm`, `./rm`) are still rm (F2).
      case "$token" in
        rm | */rm) seen_rm=1 ;;
      esac
      continue
    fi
    case "$token" in
      -*) continue ;;
      . | ./)
        set +f
        block "recursive forced delete of the current directory (rm -rf .)"
        ;;
      .. | ../* | */.. | */../*)
        set +f
        block "recursive forced delete of a path outside the project (.. traversal)"
        ;;
      '~' | '~'/*)
        set +f
        block "recursive forced delete of a home-anchored path (~/…) outside the project"
        ;;
      /*)
        case "$token" in
          "$project_dir" | "$project_dir"/* | /tmp | /tmp/* | /var/tmp | /var/tmp/* | "$tmp_dir_allow" | "$tmp_dir_allow"/*) : ;;
          *)
            set +f
            block "recursive forced delete of an absolute path outside the project (only the project, /tmp, /var/tmp, and \$TMPDIR are allowed)"
            ;;
        esac
        ;;
      *'$'*)
        case "$token" in
          '$TMPDIR' | '$TMPDIR'/* | '${TMPDIR}' | '${TMPDIR}'/*) : ;;
          *)
            set +f
            block "recursive forced delete of a variable-expanded target (unset or mistyped variables can point anywhere; \$TMPDIR is the only sanctioned dynamic target)"
            ;;
        esac
        ;;
    esac
  done
  set +f
done < <(printf '%s' "$normalized_command_str" | tr '&|;' '\n' \
  | grep -Ei -- "$RM_CMD"'([[:space:]]|$)' || true)

# 2. Force-pushing a protected branch. `--force-with-lease` is the safe,
#    non-clobbering alternative and is intentionally NOT blocked. Deliberate
#    divergence from upstream (which blocks force-push on ANY branch):
#    feature-branch force-push is a sanctioned rebase-and-push agent workflow.
#
#    The force flag AND the protected-branch name must appear in the SAME
#    `git push` statement. Checking them independently over the whole command is
#    a false-positive magnet: an unrelated `-f` (a `[ -f file ]` test, `rm -f`,
#    `grep -f`, `tail -f`) plus an unrelated protected name (`--base main`,
#    `origin/main`, `git fetch origin main`) alongside any feature-branch
#    `git push` would wrongly block. So split the command into statements
#    (`;`, `&&`, `||`, `|`, newlines), keep only the `git push` segments, and
#    inspect each in isolation — a real `git push --force origin main` still
#    matches, while a feature-branch push next to `[ -f ]`/`--base main` passes.
while IFS= read -r push_stmt; do
  if printf '%s' "$push_stmt" \
    | grep -Eiq '(--force([[:space:]]|=|$)|[[:space:]]-f([[:space:]]|$))' \
    && ! printf '%s' "$push_stmt" | grep -Eiq -- '--force-with-lease' \
    && printf '%s' "$push_stmt" \
    | grep -Eiq '(^|[^[:alnum:]_/-])(main|master|production|prod|release)([^[:alnum:]_/-]|$)'; then
    block "force-pushing a protected branch (use --force-with-lease, or push a feature branch)"
  fi
done < <(printf '%s' "$normalized_command_str" | tr '&|;' '\n' \
  | grep -Ei -- "${GIT_CMD}push\b" || true)

# 3. `git reset --hard` / `git reset --merge` while the working tree has
#    uncommitted changes — both silently discard them. Only blocks when the tree
#    is actually dirty, so a clean-tree reset (a legitimate workflow) passes.
#    Deliberate divergence from upstream's unconditional block; the accepted
#    residual risk (dirty check runs at hook time in the hook's cwd) is
#    documented in the header.
if matches "${GIT_CMD}"'reset\b.*--(hard|merge)\b'; then
  if git rev-parse --is-inside-work-tree >/dev/null 2>&1 \
    && [ -n "$(git status --porcelain 2>/dev/null)" ]; then
    block "git reset --hard/--merge on a dirty working tree would discard uncommitted changes (stash or commit first)"
  fi
fi

# 3b. `git rebase --abort` / `--quit` ONLY while human/agent conflict
#     resolutions exist (issue #1956). `--abort` restores the pre-rebase branch
#     and discards every resolution; `--quit` deletes the rebase bookkeeping
#     (head-name, todo) while stranding a detached HEAD, making recovery
#     ambiguous — both are treated the same, conditionally. A rebase state with
#     nothing human-made in it (a clean-pick wedge, or a conflict stop nobody
#     has touched) is agent-recoverable, so aborting it stays ALLOWED.
#     Discriminator (empirical, git 2.53): diff the worktree/index against the
#     AUTO_MERGE ref (the merge-ort recorded conflicted tree). Abort-safe ⇔
#     worktree diff is quiet AND (the cached diff is quiet OR unmerged index
#     entries exist — an untouched conflict stop has unmerged entries that make
#     the cached diff non-quiet without any human edit). Fail CLOSED on the
#     rebase-apply backend (no AUTO_MERGE contract) and on a missing AUTO_MERGE
#     ref while rebase-merge state exists. Same accepted residual risk as
#     guard 3: the probes run in the hook's cwd at hook time.
if matches "${GIT_CMD}"'rebase'"${GIT_TOKENS}"'--(abort|quit)([[:space:]]|$)'; then
  rebase_apply_dir="$(git rev-parse --git-path rebase-apply 2>/dev/null || true)"
  rebase_merge_dir="$(git rev-parse --git-path rebase-merge 2>/dev/null || true)"
  if [ -n "$rebase_apply_dir" ] && [ -d "$rebase_apply_dir" ]; then
    block "git rebase --abort/--quit on an apply-backend rebase cannot prove no conflict resolutions would be lost (fail closed; finish or continue the rebase instead)"
  fi
  if [ -n "$rebase_merge_dir" ] && [ -d "$rebase_merge_dir" ]; then
    if ! git rev-parse -q --verify AUTO_MERGE >/dev/null 2>&1; then
      block "git rebase --abort/--quit with an unresolvable AUTO_MERGE ref cannot prove no conflict resolutions would be lost (fail closed)"
    fi
    if ! git diff --quiet AUTO_MERGE 2>/dev/null; then
      block "git rebase --abort/--quit would discard conflict resolutions in the working tree (finish resolving and run git rebase --continue instead)"
    fi
    unmerged_entries="$(git ls-files -u 2>/dev/null || true)"
    if [ -z "$unmerged_entries" ] \
      && ! git diff --cached --quiet AUTO_MERGE 2>/dev/null; then
      block "git rebase --abort/--quit would discard staged conflict resolutions (finish resolving and run git rebase --continue instead)"
    fi
  fi
fi

# 4. `git checkout` worktree discards: the `--` pathspec form (with or without a
#    ref), `-f/--force`, `--pathspec-from-file`, and bare `git checkout .`.
#    Blocking bare `.` exceeds upstream (which allows any single positional) —
#    issue #1960 names it explicitly: it discards the entire tree. Branch
#    switches and creation (`-b`/`-B`) stay allowed.
readonly GIT_CHECKOUT="${GIT_CMD}checkout"
if matches "${GIT_CHECKOUT}${GIT_TOKENS}"'--([[:space:]]|$)' \
  || matches "${GIT_CHECKOUT}${GIT_TOKENS}"'(-[[:alnum:]]*f[[:alnum:]]*|--force)([[:space:]]|=|$)' \
  || matches "${GIT_CHECKOUT}"'[[:space:]][^;&|]*--pathspec-from-file' \
  || matches "${GIT_CHECKOUT}"'[[:space:]]+\.(/)?([[:space:]]|$)'; then
  block "git checkout discarding local changes (--, -f/--force, --pathspec-from-file, or bare .) — use git stash to preserve work first"
fi

# 5. `git switch` discards: `--discard-changes` and its `-f/--force` aliases.
if matches "${GIT_CMD}switch${GIT_TOKENS}"'(--discard-changes|--force|-f)([[:space:]]|=|$)'; then
  block "git switch discarding local changes (--discard-changes/-f/--force)"
fi

# 6. `git restore` defaults to overwriting the WORKTREE — a silent discard. Only
#    the pure staging-area form is safe: `--staged` present and `--worktree`
#    absent. Two conditions, because an ERE has no lookahead: `--staged
#    --worktree` still discards, so `--worktree` blocks regardless of `--staged`.
if matches "${GIT_CMD}"'restore([[:space:]]|$)'; then
  if matches "${GIT_CMD}"'restore[^;&|]*--worktree' \
    || ! matches "${GIT_CMD}"'restore[^;&|]*--staged'; then
    block "git restore overwriting worktree files (only 'git restore --staged <path>' without --worktree is allowed)"
  fi
fi

# 7. `git stash drop` / `git stash clear` destroy stashed work. push/pop/list/
#    apply — the safe alternatives the reset guard recommends — stay allowed.
if matches "${GIT_CMD}"'stash[[:space:]]+(drop|clear)([[:space:]]|$)'; then
  block "git stash drop/clear destroys stashed work"
fi

# 8. `git clean` with a force flag wipes untracked files. A dry-run flag
#    (`-n`/`--dry-run`) ANYWHERE wins — git itself performs no deletion under
#    dry-run, so `git clean -fdn` is a safe preview.
readonly GIT_CLEAN="${GIT_CMD}clean"
if matches "${GIT_CLEAN}${GIT_TOKENS}"'(-[[:alnum:]]*f[[:alnum:]]*|--force)([[:space:]]|=|$)' \
  && ! matches "${GIT_CLEAN}${GIT_TOKENS}"'(-[[:alnum:]]*n[[:alnum:]]*|--dry-run)([[:space:]]|=|$)'; then
  block "git clean --force deletes untracked files (preview with git clean -n first)"
fi

# 9. `git branch` force-delete loses unmerged commits: `-D`, `-d` combined with
#    `-f` (clustered or split), or `--delete` + `--force`. Case-SENSITIVE so the
#    safe `-d` (which refuses unmerged work) and rename `-m` stay allowed.
readonly GIT_BRANCH="${GIT_CMD}branch"
if matches_cs "${GIT_BRANCH}${GIT_TOKENS}"'-[[:alnum:]]*D[[:alnum:]]*([[:space:]]|$)' \
  || { matches_cs "${GIT_BRANCH}${GIT_TOKENS}"'-[[:alnum:]]*d[[:alnum:]]*([[:space:]]|$)' \
    && matches_cs "${GIT_BRANCH}${GIT_TOKENS}"'-[[:alnum:]]*f[[:alnum:]]*([[:space:]]|$)'; } \
  || { matches "${GIT_BRANCH}"'[^;&|]*--delete' && matches "${GIT_BRANCH}"'[^;&|]*--force'; }; then
  block "git branch force-delete (-D) loses unmerged commits (use -d, which refuses unmerged work)"
fi

# 10. Cheap destructive-ref guards: `git tag -d` (tags are shared refs),
#     `git reflog delete` (erases recovery history), and
#     `git worktree remove --force` (discards a dirty worktree). Tag deletion is
#     case-SENSITIVE so annotated-tag `-a` and message `-m` flags never match.
if matches_cs "${GIT_CMD}tag${GIT_TOKENS}"'(-[[:alnum:]]*d[[:alnum:]]*([[:space:]]|$)|--delete([[:space:]]|=|$))'; then
  block "git tag -d deletes a shared ref"
fi
if matches "${GIT_CMD}"'reflog[[:space:]]+delete([[:space:]]|$)'; then
  block "git reflog delete erases recovery history"
fi
if matches "${GIT_CMD}"'worktree[[:space:]]+remove[^;&|]*(--force([[:space:]]|=|$)|[[:space:]]-[[:alnum:]]*f[[:alnum:]]*([[:space:]]|$))'; then
  block "git worktree remove --force discards a dirty worktree (remove without --force, which refuses dirty trees)"
fi

# 11. Deletion through find/xargs, where the target never appears as a literal
#     argument: `find … -delete`, `find … -exec rm -rf`, and `xargs … rm -rf`
#     (targets arrive from dynamic stdin — unauditable). Plain `rm` (no
#     recursive+force) on find/xargs output stays allowed for normal cleanups.
if matches '(^|[^[:alnum:]_./-])find[[:space:]][^;&|]*[[:space:]]-delete([[:space:]]|$)'; then
  block "find -delete removes files tree-wide (use -print to preview, or an explicit rm on reviewed paths)"
fi
if matches '(^|[^[:alnum:]_./-])find[[:space:]][^;&|]*-exec[[:space:]]+rm[[:space:]]+(-[[:alnum:]]*r[[:alnum:]]*f|-[[:alnum:]]*f[[:alnum:]]*r)([[:space:]]|$)'; then
  block "find -exec rm -rf performs a recursive forced delete on unreviewed paths"
fi
if matches '(^|[^[:alnum:]_./-])xargs[[:space:]]([^;&|]*[[:space:]])?rm[[:space:]]+(-[[:alnum:]]*r[[:alnum:]]*f|-[[:alnum:]]*f[[:alnum:]]*r)([[:space:]]|$)'; then
  block "xargs rm -rf performs a recursive forced delete on dynamic stdin input"
fi

# 12. Disk destroyers, always on (exceeds upstream, which only scans these
#     inside interpreter one-liners): writing to a raw /dev node via dd,
#     formatting a device with mkfs, and shred's unrecoverable overwrite.
#     dd/mkfs against regular files (imaging) stays allowed.
if matches '(^|[^[:alnum:]_./-])dd[[:space:]]+([^;&|]*[[:space:]])?of=/dev/'; then
  block "dd writing to a raw device (of=/dev/…) destroys it"
fi
if matches '(^|[^[:alnum:]_./-])mkfs(\.[[:alnum:]]+)?[[:space:]][^;&|]*/dev/'; then
  block "mkfs formatting a device erases it"
fi
if matches '(^|[^[:alnum:]_./-])shred([[:space:]]|$)'; then
  block "shred overwrites files unrecoverably"
fi

# 13. Dropping or truncating a database / schema / table (Lisa-only guard —
#     upstream has no SQL protection; keep).
if matches '\b(drop[[:space:]]+(database|schema|table)|truncate[[:space:]]+(table[[:space:]]+)?[[:alnum:]_."`]+)\b'; then
  block "destructive SQL (DROP/TRUNCATE) detected"
fi

# 14. Project-local custom rules. Each non-comment line is an ERE; a match blocks.
rules_file="${SAFETY_NET_RULES_FILE:-${CLAUDE_PROJECT_DIR:-$PWD}/.claude/safety-net-rules.txt}"
if [ -f "$rules_file" ]; then
  while IFS= read -r rule || [ -n "$rule" ]; do
    case "$rule" in
      '' | '#'*) continue ;;
    esac
    if printf '%s' "$command_for_guards" | grep -Eiq -- "$rule"; then
      block "matched a project custom safety rule (${rules_file##*/}): $rule"
    fi
  done <"$rules_file"
fi

exit 0

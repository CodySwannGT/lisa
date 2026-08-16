#!/usr/bin/env bash
# PreToolUse hook: refuse agent writes to files Lisa overwrites on every apply.
#
# Lisa ships templates in three modes, and only one of them is unsafe to edit:
#
#   copy-overwrite — see below; the harm depends on the file.
#   copy-contents  — Lisa APPENDS its lines; host content survives.
#   create-only    — skipped when the file exists; the host owns it outright.
#
# So this guard covers copy-overwrite and nothing else. Blocking the other two
# would stop agents editing files they are supposed to own, which is worse than
# the problem being solved.
#
# The name `copy-overwrite` is misleading, and two successive versions of this
# guard got the consequence wrong by trusting it. MEASURED, by mutating four
# files in a scratch project and running a real `lisa apply` against them:
#
#   scripts/lisa-gates.mjs   (ledger-tracked)  → SURVIVED
#   .lintstagedrc.json       (untracked, JSON) → SURVIVED
#   .prettierignore          (untracked, text) → SURVIVED
#   .yamllint                (untracked, text) → SURVIVED
#
#   Summary line: `Overwritten: 0 files` / `Out of date: 3 files (managed
#   templates changed; NOT updated)`.
#
# copy-overwrite overwrites an UNMODIFIED copy — it refreshes. It does not
# overwrite a host-edited one, in any population tested. So the harm is the same
# for both, and it is not deletion:
#
#   THE FILE SILENTLY FORKS. It keeps looking current while every upstream fix
#   stops reaching it. Nothing is lost, which is exactly what makes it invisible.
#
# Ledger membership changes the MESSAGE apply prints, not the outcome — tracked
# files get a provenance verdict naming the fork and offering
# `lisa-guard-capabilities:`; untracked ones get a bare "Out of date" warning.
# The refusal branches on that so the reader sees the words apply will use.
#
# Measured, not hypothetical. Nothing enforced this, so downstream copies were
# edited and then silently diverged: `classify-maestro-failures.mjs` reached
# 36,061 bytes in one fleet repo against 29,586 shipped, and five gate files in
# another stopped receiving upstream fixes — one over roughly 138 bytes of
# cosmetic change. The edits were made in good faith; nothing told anyone the
# file was not theirs.
#
# ## Why the path, not a banner comment
#
# 103 of Lisa's 145 copy-overwrite files carry a "managed by Lisa" header, and
# the other 42 CANNOT: 30 are `.json` (no comment syntax), 8 are `.gitkeep` /
# `.keep` placeholders, and the rest are bare-value files like `.nvmrc`. A guard
# keyed on the banner would miss every one of them, so this resolves the path
# against the installed package instead and covers all 145 regardless of format.
#
# Blocked signatures:
#   1. Write / Edit / MultiEdit / NotebookEdit whose target resolves to a
#      copy-overwrite template in the installed Lisa package;
#   2. Bash output redirection (`>`, `>>`, `>|`), `tee`, or `sed -i` aimed at
#      one. Reads never fire.
#
# Exemptions (allowed):
#   - `LISA_ALLOW_MANAGED_FILE_WRITE` set — the operator's explicit override,
#     named in the refusal;
#   - paths under `node_modules/` or `dist/` — vendored copies, not the host's;
#   - the Lisa source repository itself, where these files are the originals and
#     editing them is the entire point.
set -euo pipefail

input="$(cat)"

command -v jq >/dev/null 2>&1 || exit 0

# The operator's override, checked first so it is always the cheapest way out.
if [ -n "${LISA_ALLOW_MANAGED_FILE_WRITE:-}" ]; then
  exit 0
fi

tool_name="$(printf '%s' "$input" | jq -r '.tool_name // empty')"
[ -n "$tool_name" ] || exit 0

project_root="${CLAUDE_PROJECT_DIR:-$PWD}"
package_root="$project_root/node_modules/@codyswann/lisa"

# No installed Lisa means nothing to classify against. Silent, because a project
# that has not installed Lisa is not doing anything wrong.
[ -d "$package_root" ] || exit 0

# In Lisa's own repository these files ARE the originals. Blocking here would
# make the templates uneditable by the only agents that should edit them.
if [ -f "$project_root/package.json" ] &&
  grep -q '"name": *"@codyswann/lisa"' "$project_root/package.json" 2>/dev/null; then
  exit 0
fi

# Whether the project has claimed a path in `.lisaignore`.
#
# THIS IS THE OWNERSHIP QUESTION, and it decides whether blocking is right at
# all. `lisa apply` skips an ignored path — it logs `Kept (.lisaignore)` and
# counts it as ignored rather than overwritten — so the file is the project's,
# its edits survive, and refusing them would be refusing someone access to their
# own file. `doctor-lisa-owned-artifacts` already consults this list; this guard
# did not, which would have blocked deliberate forks.
#
# The real matcher is minimatch in `src/utils/ignore-patterns.ts` and cannot be
# reproduced faithfully in shell. This covers the common shapes — exact path,
# directory prefix, glob, and a bare pattern matching any segment — and where it
# is unsure it ALLOWS. Wrongly allowing costs an edit that apply may overwrite,
# which is the behaviour before this guard existed; wrongly blocking locks
# someone out of a file they own.
lisaignored() {
  local rel="$1"
  local list="$project_root/.lisaignore"
  [ -f "$list" ] || return 1
  local pattern
  while IFS= read -r pattern || [ -n "$pattern" ]; do
    pattern="${pattern#"${pattern%%[![:space:]]*}"}"
    pattern="${pattern%"${pattern##*[![:space:]]}"}"
    [ -n "$pattern" ] || continue
    case "$pattern" in \#*) continue ;; esac
    # A leading `!` is not gitignore negation here. The real matcher passes
    # patterns to minimatch, which negates by default, and it combines them with
    # `.some()` — so a single `!scripts/a.mjs` line reports EVERY OTHER PATH as
    # ignored. Measured:
    #
    #   patterns=["!scripts/a.mjs"]  path=scripts/a.mjs -> ignored=false
    #   patterns=["!scripts/a.mjs"]  path=scripts/b.mjs -> ignored=TRUE
    #
    # Reproducing that faithfully would mean disabling this guard on a typo.
    # Reproducing the intuitive gitignore reading would mean blocking files the
    # matcher considers ignored. Both are wrong, so the file is treated as
    # claimed and the write is allowed — the same direction this function errs
    # everywhere else. Filed upstream; when the matcher stops negating, delete
    # this branch rather than teaching it a second wrong answer.
    case "$pattern" in !*) return 0 ;; esac
    case "$pattern" in
      */)
        case "$rel" in "${pattern%/}"/* | "${pattern%/}") return 0 ;; esac
        ;;
    esac
    # shellcheck disable=SC2254 -- the pattern is a glob on purpose.
    case "$rel" in $pattern) return 0 ;; esac
    case "$pattern" in
      */*) ;;
      *)
        # shellcheck disable=SC2254 -- ditto, matched against the basename.
        case "${rel##*/}" in $pattern) return 0 ;; esac
        ;;
    esac
  done <"$list"
  return 1
}

# A candidate rewritten relative to the project, so an absolute target from a
# tool payload and a relative one from a shell command classify identically.
relative_path() {
  local rel="${1#"$project_root"/}"
  printf '%s' "${rel#./}"
}

# Whether a host-relative path is shipped as a copy-overwrite template.
#
# A few stat calls rather than an enumeration: the same relative path is probed
# under each stack's copy-overwrite tree, so cost does not grow with the 145
# templates.
managed_source() {
  local candidate="$1"
  case "$candidate" in
    */node_modules/* | node_modules/* | */dist/* | dist/*) return 1 ;;
  esac
  local rel
  rel="$(relative_path "$candidate")"
  [ -n "$rel" ] || return 1
  # Claimed by the project, so not ours to refuse.
  lisaignored "$rel" && return 1
  local stack
  for stack in "$package_root"/*/copy-overwrite; do
    [ -d "$stack" ] || continue
    if [ -e "$stack/$rel" ]; then
      printf '%s' "${stack#"$package_root"/}/$rel"
      return 0
    fi
  done
  return 1
}

# Whether a destination is a ledger-tracked Lisa-owned guard.
#
# Both populations are PRESERVED once edited (measured — see the header). What
# membership changes is what apply prints and what the escape hatch is: a tracked
# guard gets a provenance verdict and can declare `lisa-guard-capabilities:`,
# while an untracked template gets a bare "Out of date" line and `.lisaignore`.
# The refusal quotes the words the reader will actually see, so it has to know
# which side it is on.
ledger_tracked() {
  local rel="$1"
  local ledger="$package_root/dist/core/lisa-owned-hash-ledger.js"
  [ -f "$ledger" ] || return 1
  grep -q "\"$rel\"" "$ledger" 2>/dev/null
}

refuse() {
  local target="$1"
  local source="$2"
  local rel="$3"
  local consequence
  if ledger_tracked "$rel"; then
    consequence="\`lisa apply\` will KEEP your edit — this is a Lisa-owned guard,
and apply says so: \"its contents match no Lisa release, so Lisa cannot tell
whether it is out of date or deliberately stronger. Kept yours.\"

That is the trap. Nothing is deleted; the file silently FORKS. It keeps looking
current while every upstream fix stops reaching it. One repository in this fleet
carries 243 lines of divergence nobody knew about, in a guard that had quietly
stopped receiving fixes."
  else
    consequence="\`lisa apply\` will KEEP your edit and report the file as
\"Out of date, not updated\" on every run from now on.

That is the trap. Nothing is deleted; the file silently FORKS, stops receiving
upstream changes, and adds a permanent warning line that the next person learns
to scroll past."
  fi
  cat >&2 <<EOF
BLOCKED: refusing to write \`$target\`.

WHY: this file is Lisa-managed, shipped as a **copy-overwrite** template
(\`$source\` in the installed package).

$consequence

WHERE IT GOES INSTEAD — take the first one that fits:

1. The change should apply everywhere. Edit the template upstream in Lisa and
   release it — \`/lisa:cross-pollinate\`, or an issue on CodySwannGT/lisa.
   That is the only edit that survives an install.

2. Only this project needs to differ. Look for the local escape hatch beside the
   file — Lisa ships \`.local\` variants for the configs that support one
   (\`eslint.config.local.ts\`, \`tsconfig.local.json\`, \`audit.ignore.local.json\`,
   and others). Those are yours and are never overwritten.

3. The behaviour is configurable rather than hardcoded. Check \`.lisa.config.json\`
   — the \`gates\` block in particular decides which checks run and what command
   proves each one, so a project can substitute its own task without touching a
   shipped file.

4. This project has deliberately FORKED this file and means to keep its own
   version. Apply already preserves the edit either way, so what is left to
   choose is whether the fork stays VISIBLE. Keeping it visible is the point:

   - **A Lisa-owned guard (hash-tracked).** Do NOT add it to \`.lisaignore\`.
     Apply preserves your version regardless, so ignoring it buys nothing — and
     it silences the standoff \`lisa doctor\` reports on every run, replacing a
     true warning with the line "Enforcement guards match the installed Lisa
     version", which is then false. A visible, resolvable fork becomes a silent
     permanent one. Instead declare what your version defends with a
     \`lisa-guard-capabilities:\` line; apply then classifies it \`host-ahead\`
     and says so by name, rather than reporting that it cannot tell.
   - **Any other template.** \`.lisaignore\` records the divergence where the
     next person can see it and stops the recurring "Out of date" line. It does
     not preserve the file — apply already does — so use it to DECLARE a fork
     you have decided on, never to quiet one you have not.

5. You believe this file should not be Lisa-managed at all. That is a real
   argument and it belongs upstream, not in a local edit that will be erased.

If a human explicitly asked for this edit, they can re-run with
\`LISA_ALLOW_MANAGED_FILE_WRITE=1\` set, which bypasses this guard.
EOF
  exit 2
}

case "$tool_name" in
  Write | Edit | MultiEdit | NotebookEdit | Update)
    paths="$(printf '%s' "$input" | jq -r '
      [ .tool_input.file_path?,
        .tool_input.path?,
        .tool_input.notebook_path?,
        (.tool_input.edits? // [] | .[].file_path?)
      ] | map(select(. != null and . != "")) | .[]' 2>/dev/null || true)"
    while IFS= read -r candidate; do
      [ -n "$candidate" ] || continue
      if source_path="$(managed_source "$candidate")"; then
        refuse "$candidate" "$source_path" "$(relative_path "$candidate")"
      fi
    done <<EOF
$paths
EOF
    ;;
  Bash)
    command_str="$(printf '%s' "$input" | jq -r '.tool_input.command // empty')"
    [ -n "$command_str" ] || exit 0
    # Write signatures only. A bare mention is a read and stays allowed — the
    # path has to be the target of a redirection, a tee, or an in-place sed.
    # `>>?\|?` covers `>`, `>>`, and the noclobber override `>|`.
    while IFS= read -r token; do
      [ -n "$token" ] || continue
      if source_path="$(managed_source "$token")"; then
        refuse "$token" "$source_path" "$(relative_path "$token")"
      fi
    done <<EOF
$(printf '%s' "$command_str" |
  grep -Eo ">>?\|?[[:space:]]*['\"]?[^ |;&'\"]+|tee([[:space:]]+-[a-zA-Z]+)*[[:space:]]+['\"]?[^ |;&'\"]+|sed[[:space:]]+[^|;&]*-i[^|;&]*[[:space:]]['\"]?[^ |;&'\"]+" 2>/dev/null |
  sed -E "s/^(>>?\|?|tee([[:space:]]+-[a-zA-Z]+)*|sed[[:space:]]+[^|;&]*-i[^|;&]*)[[:space:]]*//" |
  tr -d "\"'" || true)
EOF
    ;;
esac

exit 0

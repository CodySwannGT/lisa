#!/usr/bin/env bash
# PreToolUse hook: refuse agent writes to files Lisa overwrites on every apply.
#
# Lisa ships templates in three modes, and only one of them destroys host edits:
#
#   copy-overwrite — replaced wholesale on every `lisa apply`. An edit here is
#                    gone at the next `bun install`, silently.
#   copy-contents  — Lisa APPENDS its lines; host content survives.
#   create-only    — skipped when the file exists; the host owns it outright.
#
# So this guard covers copy-overwrite and nothing else. Blocking the other two
# would stop agents editing files they are supposed to own, which is worse than
# the problem being solved.
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
  # Normalise to a project-relative path so an absolute target still matches.
  local rel="${candidate#"$project_root"/}"
  rel="${rel#./}"
  [ -n "$rel" ] || return 1
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

refuse() {
  local target="$1"
  local source="$2"
  cat >&2 <<EOF
BLOCKED: refusing to write \`$target\`.

WHY: this file is Lisa-managed. It is shipped as a **copy-overwrite** template
(\`$source\` in the installed package) and is replaced wholesale on every
\`lisa apply\` — which runs on every \`bun install\`. Your edit would survive
until the next install and then vanish, with nothing reporting that it had.

That is not hypothetical: downstream copies edited this way diverged silently
until they stopped receiving upstream fixes entirely.

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

4. You believe this file should not be Lisa-managed at all. That is a real
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
        refuse "$candidate" "$source_path"
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
        refuse "$token" "$source_path"
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

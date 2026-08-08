#!/usr/bin/env bash
# PreToolUse hook: refuse agent writes to the session-instruction files.
#
# `AGENTS.md`, `CLAUDE.md`, and `.github/copilot-instructions.md` are the files
# every agent loads at session start. They are human-authored and curated on
# purpose — Lisa's own contract says so in two places:
#   - plugins/src/base/rules/reference/project-learnings.md
#   - plugins/src/base/skills/lisa-debrief-apply/SKILL.md ("CLAUDE.md is
#     human-authored ... apply never writes to any of the three")
#
# Nothing enforced it, so agents appended their own findings anyway: one fleet
# repo reached 949 lines of ticket-keyed trap dumps in `AGENTS.md` while its
# learnings ledger held 22. Every one of those lines is charged to the context
# of every later session in that project, forever. Prose did not hold; this is
# the executable control that does.
#
# Blocked signatures:
#   1. Write / Edit / MultiEdit / NotebookEdit whose target basename is one of
#      the instruction files;
#   2. Bash output redirection (`>`, `>>`), `tee`, or `sed -i` aimed at one.
#      Reads (`cat AGENTS.md`, `rg pattern AGENTS.md`) never fire.
#
# Exemptions (allowed):
#   - `LISA_ALLOW_INSTRUCTION_FILE_WRITE` set — the operator's explicit override,
#     named in the refusal so a human who really wants the edit can take it;
#   - payloads carrying a `<!-- LISA_` marker: Lisa's own marker-bounded regions
#     (the agy project-learnings bridge, cross-pollinate's rule section) replace
#     in place on re-run and cannot grow the file;
#   - paths under `node_modules/` or `dist/` — vendored copies, not the host's.
set -euo pipefail

input="$(cat)"

command -v jq >/dev/null 2>&1 || exit 0

# The operator's override. Checked before anything else so it is always the
# cheapest way out of a refusal a human deliberately wants to overrule.
if [ -n "${LISA_ALLOW_INSTRUCTION_FILE_WRITE:-}" ]; then
  exit 0
fi

tool_name="$(printf '%s' "$input" | jq -r '.tool_name // empty')"
[ -n "$tool_name" ] || exit 0

# Lisa's own bounded bridges write marked regions — the agy project-learnings
# bridge and cross-pollinate's rule section. The premise of their exemption, as
# originally stated, is that they "replace in place and cannot grow the file".
# This enforces that premise rather than trusting it.
#
# Both sides have to be a marked region and nothing else:
#
#   - old_string bounded proves the region really is on disk. Scanning the whole
#     payload was trivially forgeable — any caller could put `<!-- LISA_` in the
#     content it was WRITING and walk past the guard.
#   - new_string bounded is what makes it a replacement rather than an append.
#     old_string alone does not authorize anything: a caller can read a genuine
#     marked region, echo it back verbatim, and still smuggle unbounded prose in
#     after the closing marker. Requiring the written text to be exactly one
#     marked region — whitespace aside — leaves nowhere to put it.
#
# Every edit in a MultiEdit must qualify; one unbounded edit taints the batch.
# Write is absent by construction: it has no old_string and clobbers the whole
# file, which is precisely the unbounded case.
case "$tool_name" in
  Edit | MultiEdit)
    if printf '%s' "$input" |
      jq -e '
        def bounded:
          type == "string"
          and test("^\\s*<!-- LISA_[A-Z_]+ -->[\\s\\S]*<!-- LISA_[A-Z_]+ -->\\s*$");
        def replacement_pairs:
          if .tool_input.edits? then [.tool_input.edits[]?]
          else [.tool_input] end;
        replacement_pairs
        | length > 0
        and all(.[]; (.old_string | bounded) and (.new_string | bounded))
      ' >/dev/null 2>&1; then
      exit 0
    fi
    ;;
esac

# Basename match, case-insensitively: `agents.md` and `AGENTS.md` are the same
# file on the macOS checkouts this fleet runs on.
is_instruction_file() {
  local candidate="$1"
  case "$candidate" in
    */node_modules/* | node_modules/* | */dist/* | dist/*) return 1 ;;
  esac
  local base="${candidate##*/}"
  case "$(printf '%s' "$base" | tr '[:upper:]' '[:lower:]')" in
    agents.md | claude.md | copilot-instructions.md) return 0 ;;
  esac
  return 1
}

refuse() {
  local target="$1"
  cat >&2 <<EOF
BLOCKED: refusing to write \`$target\`.

WHY: this is a session-instruction file, not a place to record what you just
learned. Every line in it is loaded into the context of every agent, in every
future session, in this project, forever. It is human-curated on purpose. An
agent appending its own findings is how these files grow into hundreds of lines
of stale, ticket-specific trivia that every later session pays for and half of
which was only ever true once.

WHERE IT GOES INSTEAD — take the first one that fits:

1. Every agent genuinely needs this in every session, and only in this project.
   That is a project rule — but do not write it yourself. Capture it with
   \`/lisa:persist-learning\` so it lands in the learnings ledger with provenance
   and a confidence score. The gardener (\`/lisa:learnings:audit\`) then proposes
   promotion into \`.claude/rules/PROJECT_RULES.md\` as a human-gated ticket.

2. It changes how an existing skill should behave. Edit that skill's SKILL.md.
   Knowledge belongs next to the procedure it modifies, not in a global preamble.

3. It is true beyond this project. Propose it upstream to Lisa via
   \`/lisa:cross-pollinate\`, or open an issue on CodySwannGT/lisa. A local copy of
   a general rule silently drifts the moment upstream changes.

4. None of the above — it is background someone may want to look up, not a
   standing instruction. Write it into the project documentation (\`wiki/\` or
   \`docs/\`).

If a human explicitly asked for this edit, they can re-run with
\`LISA_ALLOW_INSTRUCTION_FILE_WRITE=1\` set, which bypasses this guard.
EOF
  exit 2
}

case "$tool_name" in
  Write | Edit | MultiEdit | NotebookEdit | Update)
    # `file_path` covers Write/Edit; `edits[].file_path` covers the MultiEdit
    # shapes that carry a path per edit; `notebook_path` covers NotebookEdit.
    paths="$(printf '%s' "$input" | jq -r '
      [ .tool_input.file_path?,
        .tool_input.path?,
        .tool_input.notebook_path?,
        (.tool_input.edits? // [] | .[].file_path?)
      ] | map(select(. != null and . != "")) | .[]' 2>/dev/null || true)"
    while IFS= read -r candidate; do
      [ -n "$candidate" ] || continue
      if is_instruction_file "$candidate"; then
        refuse "$candidate"
      fi
    done <<EOF
$paths
EOF
    ;;
  Bash)
    command_str="$(printf '%s' "$input" | jq -r '.tool_input.command // empty')"
    [ -n "$command_str" ] || exit 0
    # Fast path: no instruction filename mentioned means nothing to classify.
    if ! printf '%s' "$command_str" |
      grep -Eqi '(agents|claude|copilot-instructions)\.md'; then
      exit 0
    fi
    # Write signatures only. A bare mention (`cat AGENTS.md`, `rg x AGENTS.md`)
    # is a read and must stay allowed — the filename has to appear as the target
    # of a redirection, a tee, or an in-place sed.
    # `>>?\|?` covers `>`, `>>`, and the noclobber override `>|`. The bare-`>`
    # branch already catches explicit fd forms such as `1>` / `2>>` because the
    # pattern is unanchored and matches the `>` inside them; `>|` was the real
    # gap, since `|` is excluded by the target class and so terminated the match.
    write_target='[^ |;&]*(agents|claude|copilot-instructions)\.md'
    if printf '%s' "$command_str" |
      grep -Eqi ">>?\|?[[:space:]]*['\"]?$write_target|tee([[:space:]]+-[a-z]+)*[[:space:]]+['\"]?$write_target|sed[[:space:]]+[^|;&]*-i[^|;&]*$write_target"; then
      refuse "$(printf '%s' "$command_str" |
        grep -Eoi "$write_target" | head -1)"
    fi
    ;;
esac

exit 0

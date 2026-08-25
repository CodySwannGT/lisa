#!/bin/bash
# This file is managed by Lisa.
# Do not edit directly — changes will be overwritten on the next `lisa` run.

# PreToolUse hook: block Write/Edit on TypeORM migration files.
# NestJS projects must use `bun run migration:generate` to create migrations
# from entity diffs. Hand-written migrations drift from entity metadata and
# break the schema/migration contract.
# Reference: https://docs.claude.com/en/docs/claude-code/hooks
# Exit code 2 blocks the tool call and surfaces stderr to Claude.
#
# WHAT A REFUSAL HOOK OWES THAT AN ON-EDIT HOOK DOES NOT. The five PostToolUse
# scripts may bail out when they cannot run: the write has already happened and
# a skipped lint is a missed report. This one decides whether the write happens
# at all, so a bail-out is a PERMIT — it lets through exactly the edit it exists
# to stop, while reporting success. Every exit below is therefore one of three
# things and never a fourth: out of scope (nothing to judge), judged by the
# project's declared task, or judged by the built-in. "Could not judge" refuses.

JSON_INPUT=$(cat)

# Project rule (host rules, .agents/rules/): never parse JSON in shell with
# grep/sed/cut/awk — always use jq.
#
# FAIL CLOSED, reversed from the `exit 0` this shipped with. Without jq the
# payload cannot be read at all, so the hook cannot tell a migration edit from
# any other write — and it said so on stderr while permitting the edit anyway,
# which is a guard announcing that it did not check and then waving the write
# through. The refusal is unscoped for the same reason: with no parse there is
# no path to scope it to.
if ! command -v jq >/dev/null 2>&1; then
  cat >&2 <<'MSG'
❌ Blocked: block-migration-edits cannot inspect this write.

`jq` is not installed, so the tool payload cannot be parsed — this hook cannot
tell whether the write targets a TypeORM migration. It refuses rather than
permitting an edit it was unable to check.

Install jq (`brew install jq`, `apt-get install jq`), or declare the
`migration-provenance` gate at `pre-tool` in .lisa.config.json to have your own
check decide instead.
MSG
  exit 2
fi

FILE_PATH=$(printf '%s' "$JSON_INPUT" | jq -r '.tool_input.file_path // empty')

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# Scope. Outside a migration path this hook does nothing at all, so there is
# nothing here for a declaration to take over — the same reason the sibling
# on-edit hook filters by file type and source directory BEFORE it consults.
case "$FILE_PATH" in
  */migrations/*.ts | */migrations/*.js) ;;
  *) exit 0 ;;
esac

# Where this script lives, resolved BEFORE any `cd`. `$0` is the path the
# harness invoked, and the façade helper ships beside it.
LISA_HOOK_DIR="$(cd "$(dirname "$0")" 2>/dev/null && pwd)"

# ---------------------------------------------------------------------------
# Gate façade. The project's declaration decides BEFORE the built-in refuses.
# Full contract, and why an undeclared project sees no change at all, in
# lisa-edit-gate.sh beside this file.
#
# THE WORKING DIRECTORY IS PART OF THE WIRING HERE, which is why this hook was
# left out of the change that wired the five on-edit ones. Those hooks already
# `cd "$CLAUDE_PROJECT_DIR"` to run a tool against the tree; this one acts on
# the payload and never establishes a directory at all. The helper resolves
# .lisa.config.json and the gate registry RELATIVE to the current directory, so
# without the `cd` it would read whatever directory the harness happened to
# launch in and report "nothing declared" for a project that had declared.
#
# The `cd` is safe for the built-in below because the built-in reads only the
# path out of the payload — nothing it does depends on the working directory.
# That is what keeps an undeclared project on exactly the command, and exactly
# the exit status, it had before.
#
# ONE PROPERTY, so there is no all-or-nothing question here: this hook proves
# `migration-provenance` and nothing else.
# ---------------------------------------------------------------------------
if [ -n "${CLAUDE_PROJECT_DIR:-}" ] &&
  [ -f "$LISA_HOOK_DIR/lisa-edit-gate.sh" ] &&
  cd "$CLAUDE_PROJECT_DIR" 2>/dev/null; then
  # shellcheck source=/dev/null
  . "$LISA_HOOK_DIR/lisa-edit-gate.sh"
  if LISA_GATE_COMMANDS="$(lisa_edit_gate_tasks pre-tool migration-provenance)"; then
    # The declared task's own exit status decides the write: non-zero refuses,
    # exactly as the built-in's outright refusal does. A project that declares
    # this gate is saying its own check knows which migrations came from the
    # model, which is the judgement the built-in makes by refusing them all.
    lisa_edit_gate_run "$FILE_PATH" "$LISA_GATE_COMMANDS"
    exit $?
  fi
fi

cat >&2 <<EOF
❌ Blocked: Direct edits to TypeORM migration files are not allowed.

File: $FILE_PATH

Entity files (src/database/entities/*.ts) are the single source of
truth for the database schema in this project. Migrations are a derived
artifact — generate them from entity diffs:

  1. Edit the entity to express the desired schema.
  2. Run: bun run migration:generate --name=<DescriptiveName>
  3. Review the generated migration; commit entity + migration together.

If a schema change cannot be expressed via the entity model, the entity
model is wrong — fix the entity, do not hand-write the migration.

OUT-OF-BAND MIGRATIONS (seed data, backfills, data transformations,
one-off cleanup): these genuinely cannot come from entity diffs. They
are legitimate but they bypass the entity-as-source-of-truth contract.

If you believe this edit is an out-of-band migration:
  1. STOP and tell the user what change is needed and why it cannot
     be expressed via the entity model.
  2. Get explicit approval before proceeding.
  3. Document the rationale in the migration's class comment.

Do NOT silently hand-write a migration. See the nestjs-rules skill
for the full rationale.
EOF
exit 2

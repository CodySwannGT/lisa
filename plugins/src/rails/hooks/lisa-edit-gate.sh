#!/bin/bash
# This file is managed by Lisa.
# Do not edit directly — changes will be overwritten on the next `lisa` run.
# =============================================================================
# Edit-time gate façade
# =============================================================================
# Sourced by every on-edit hook. Answers one question before the hook runs
# anything: has the project declared what proves this property at this moment,
# and if so what should run instead of Lisa's written-in tool?
#
# WHY THIS EXISTS. Edit time is the highest-frequency enforcement surface Lisa
# owns and was the one surface with no configurability at all. The scripts
# resolved a RUNNER (`./node_modules/.bin/oxlint`, else `bunx`/`npx`) and
# hardcoded the TOOL, which is the inversion the gate registry exists to fix.
# Worse, they exit 2 — refusing the edit — when the written-in binary or config
# filename is absent, so a project that lints correctly with something else had
# every agent write refused until it installed Lisa's choice.
#
# THE CONTRACT, and the two halves that matter equally:
#
#   declared   -> the project's task runs and the hook's written-in tool is
#                 never consulted, so a missing binary cannot refuse the edit.
#   undeclared -> NOTHING changes. The resolver is not even invoked when no
#                 registry is installed, and the hook falls through to exactly
#                 the command it ran before. That is the overwhelming majority
#                 of projects, and it is the case a façade silently breaks.
#
# ALL OR NOTHING FOR A MULTI-PROPERTY SCRIPT. `lisa_edit_gate_tasks` takes every
# property its caller proves and resolves only when EVERY one is declared. The
# Rails hook runs `rubocop -a` and then a second pass for unfixable errors — its
# own header calls it both formatter and linter — so standing down on `code-style`
# alone would silently stop proving `format-conformance`. Same shape as
# `lisa_gate_covers test-correctness coverage-adequacy` in the pre-push hook.
#
# HOW THE DECLARED TASK LEARNS WHICH FILE WAS EDITED. It does not take an
# argument: `<runner> <task>` with no arguments is the invocation every other
# Lisa façade uses, and adding a positional here would make the declaration
# mean something different at this moment than at every other one. The path is
# exported as LISA_EDITED_FILE instead, so a project that wants a per-file run
# can scope its own task and one that does not gets a whole-project run.
# =============================================================================

# Where the gate registry may be installed, in resolution order.
lisa_edit_gate_registry() {
    for _lisa_candidate in \
        "node_modules/@codyswann/lisa/all/copy-overwrite/scripts/lisa-gates.mjs" \
        "scripts/lisa-gates.mjs" \
        "all/copy-overwrite/scripts/lisa-gates.mjs"
    do
        if [ -f "$_lisa_candidate" ]; then
            printf '%s' "$_lisa_candidate"
            unset _lisa_candidate
            return 0
        fi
    done
    unset _lisa_candidate
    return 1
}

# lisa_edit_gate_tasks <moment> <gate-id>...
#
# Prints one `<runner> <task>` line per DISTINCT declared task and returns 0,
# but only when every named gate resolves to a runnable task at <moment>.
# Returns 1 and prints nothing otherwise — including when no registry is
# installed, when node is unavailable, and when the resolver itself fails.
#
# Fail-safe in the direction that keeps proving things: any doubt returns 1 and
# the caller runs its built-in. A resolver that could not answer must never read
# as "the project has this covered".
lisa_edit_gate_tasks() {
    _lisa_moment="$1"
    shift
    [ -n "$_lisa_moment" ] || { unset _lisa_moment; return 1; }
    [ "$#" -gt 0 ] || { unset _lisa_moment; return 1; }
    command -v node >/dev/null 2>&1 || { unset _lisa_moment; return 1; }

    _lisa_registry="$(lisa_edit_gate_registry)" || {
        unset _lisa_moment _lisa_registry
        return 1
    }

    # EXPORTED, not prefixed. An assignment prefix reaches only the FIRST
    # command of a pipeline, and the filter that reads it is the second — so
    # the prefixed form resolved an empty want-list and every script fell
    # silently back to its built-in, which is a façade that looks wired and is
    # not.
    LISA_GATE_IDS="$*"
    export LISA_GATE_IDS
    _lisa_out="$(
        node "$_lisa_registry" list \
            --moment="$_lisa_moment" --json 2>/dev/null | node -e '
let raw = "";
process.stdin.on("data", chunk => { raw += chunk }).on("end", () => {
  let resolved;
  try { resolved = JSON.parse(raw || "[]"); } catch { process.exit(1); }
  const wanted = (process.env.LISA_GATE_IDS || "").split(" ").filter(Boolean);
  const commands = [];
  for (const id of wanted) {
    const hit = resolved.find(gate => gate.id === id);
    // `run` mode with a task is the only shape that PROVES anything here. An
    // awaited gate proves nothing at edit time and an intercepted one is
    // Lisa running it elsewhere; both must leave the built-in in charge.
    if (!hit || hit.mode !== "run" || !hit.command) process.exit(1);
    if (!commands.includes(hit.command)) commands.push(hit.command);
  }
  if (commands.length === 0) process.exit(1);
  process.stdout.write(commands.join("\n"));
});
'
    )" || {
        unset _lisa_moment _lisa_registry _lisa_out
        return 1
    }

    [ -n "$_lisa_out" ] || {
        unset _lisa_moment _lisa_registry _lisa_out
        return 1
    }
    printf '%s' "$_lisa_out"
    unset _lisa_moment _lisa_registry _lisa_out
    return 0
}

# lisa_edit_gate_run <edited-file> <commands>
#
# Runs each resolved command with LISA_EDITED_FILE exported. Exits 2 on the
# first failure, which is the same refusal the built-in path uses, so a
# declared task that finds a real problem still stops the agent.
lisa_edit_gate_run() {
    _lisa_file="$1"
    shift
    LISA_EDITED_FILE="$_lisa_file"
    export LISA_EDITED_FILE
    printf '%s\n' "$*" | while IFS= read -r _lisa_command; do
        [ -n "$_lisa_command" ] || continue
        echo "Running declared gate task: $_lisa_command"
        # Deliberate word split: the resolver validated both halves as plain
        # words, so no shell metacharacter reaches argv.
        # shellcheck disable=SC2086
        $_lisa_command || exit 2
    done
    _lisa_status=$?
    unset _lisa_file _lisa_command
    return $_lisa_status
}

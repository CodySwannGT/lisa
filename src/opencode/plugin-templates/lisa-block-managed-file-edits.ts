/**
 * Lisa-managed OpenCode plugin (tool.execute.before).
 *
 * Refuses agent writes to files Lisa overwrites on every apply. Lisa ships
 * templates in three modes and only `copy-overwrite` is unsafe to edit:
 * `copy-contents` appends, so host content survives, and `create-only` is
 * skipped when the file exists, so the host owns it outright.
 *
 * The harm is not deletion, which is what makes it invisible. Measured by
 * mutating four files in a scratch project and running a real `lisa apply`:
 * every edit SURVIVED, and apply reported `Overwritten: 0 files` /
 * `Out of date: 3 files`. So the file silently FORKS — it keeps looking current
 * while every upstream fix stops reaching it, and the only trace is a warning
 * line the next person learns to scroll past.
 *
 * ## Why it shells out
 *
 * Policy stays single-sourced in `block-managed-file-edits.sh`, the canonical
 * guard Claude, Codex, Cursor and Copilot already run, copied beside this module
 * by the installer exactly as `block-no-verify.sh` is. That guard resolves a
 * candidate path against the installed package's `copy-overwrite` trees, the
 * generated-paths module, and the Lisa-owned hash ledger, and it follows a
 * command into the contents of any script it executes. Reimplementing that in
 * TypeScript would be a second thing to harden, and the two would diverge at the
 * first vector closed in only one of them. This adapter converts OpenCode's
 * `bash` tool input into Lisa's canonical Claude Bash-hook envelope, runs the
 * script, and surfaces its refusal.
 *
 * Bash arm only, and deliberately so: OpenCode exposes the shell as the `bash`
 * tool, which is the surface this intercepts. That is the same scope the agy
 * adapter has.
 *
 * NOTE: Lisa copies this template verbatim into `.opencode/plugin/`. It runs
 * under OpenCode's Bun runtime and is excluded from this repository's tsconfig.
 */
export const LisaBlockManagedFileEdits = async () => ({
  "tool.execute.before": async (
    input: { tool: string },
    output: { args?: { command?: string } }
  ) => {
    if (input.tool !== "bash") return;
    const command = String(output.args?.command ?? "");
    if (!command) return;

    const hookPath = `${import.meta.dir}/block-managed-file-edits.sh`;
    const processHandle = Bun.spawn(["/bin/bash", hookPath], {
      env: { ...process.env, CLAUDE_PROJECT_DIR: process.cwd() },
      stdin: "pipe",
      stdout: "ignore",
      stderr: "pipe",
      timeout: 2_000,
      killSignal: "SIGKILL",
    });
    processHandle.stdin.write(
      JSON.stringify({ tool_name: "Bash", tool_input: { command } })
    );
    processHandle.stdin.end();

    const [status, reason] = await Promise.all([
      processHandle.exited,
      new Response(processHandle.stderr).text(),
    ]);
    // Exit 0 is ALLOW, including the canonical script's degraded path when jq
    // or python3 is missing — it says so on stderr and permits the command,
    // which is why stderr alone must never be read as a refusal. Any non-zero
    // status fails closed. Exit 2 is the guard's own policy refusal; any other
    // non-zero status is an adapter/environment failure and must say so rather
    // than falsely accusing the requested command of editing a managed file.
    if (status === 0) return;
    if (status !== 2) {
      throw new Error(
        `block-managed-file-edits: guard environment failure (status ${status}) at ${hookPath}` +
          (reason.trim() ? `: ${reason.trim()}` : "")
      );
    }
    throw new Error(
      reason.trim() ||
        "block-managed-file-edits: this file is Lisa-managed and is replaced by " +
          "`lisa apply`. Edit the template upstream in Lisa, or use the local " +
          "escape hatch beside the file."
    );
  },
});

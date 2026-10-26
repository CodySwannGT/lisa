/**
 * Lisa-managed OpenCode plugin (tool.execute.before).
 *
 * This adapter converts OpenCode's `bash` tool input to Lisa's canonical
 * Claude Bash-hook envelope, runs the canonical parity-safety-net.sh copied
 * beside this module, and surfaces its denial reason. Policy stays single-
 * sourced in the shell hook and its heredoc parser.
 *
 * NOTE: Lisa copies this template verbatim into `.opencode/plugin/`. It runs
 * under OpenCode's Bun runtime and is excluded from this repository's tsconfig.
 */
export const LisaParitySafetyNet = async () => ({
  "tool.execute.before": async (
    input: { tool: string },
    output: { args?: { command?: string } }
  ) => {
    if (input.tool !== "bash") return;
    const command = String(output.args?.command ?? "");
    if (!command) return;

    const hookPath = `${import.meta.dir}/parity-safety-net.sh`;
    const processHandle = Bun.spawn(["/bin/bash", hookPath], {
      env: { ...process.env, CLAUDE_PROJECT_DIR: process.cwd() },
      stdin: "pipe",
      stdout: "ignore",
      stderr: "pipe",
    });
    // A guard that exits before reading its input closes the pipe, and on
    // Linux the write then fails with EPIPE. That is the guard's own failure,
    // which its exit status below reports.
    try {
      await processHandle.stdin.write(
        JSON.stringify({ tool_name: "Bash", tool_input: { command } })
      );
      await processHandle.stdin.end();
    } catch {
      // Judged by the exit status, which still fails closed.
    }

    const [status, reason] = await Promise.all([
      processHandle.exited,
      new Response(processHandle.stderr).text(),
    ]);
    if (status === 0) return;
    throw new Error(
      reason.trim() ||
        "Blocked by safety-net: the canonical safety policy failed closed."
    );
  },
});

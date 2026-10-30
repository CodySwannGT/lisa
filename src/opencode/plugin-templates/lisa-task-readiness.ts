/** OpenCode's actual before-tool cancellation adapter for the shared decision. */
export const LisaTaskReadiness = async () => ({
  "tool.execute.before": async (
    input: { tool: string },
    output: { args?: Record<string, unknown> }
  ) => {
    const names: Record<string, string> = {
      bash: "Bash",
      read: "Read",
      glob: "Glob",
      grep: "Grep",
      write: "Write",
      edit: "Edit",
    };
    const child = Bun.spawn(
      ["/bin/bash", `${import.meta.dir}/task-readiness-guard.sh`],
      {
        stdin: "pipe",
        stdout: "ignore",
        stderr: "pipe",
        timeout: 120000,
        killSignal: "SIGKILL",
      }
    );
    try {
      await child.stdin.write(
        JSON.stringify({
          hook_event_name: "PreToolUse",
          cwd: process.cwd(),
          tool_name: names[input.tool] ?? input.tool,
          tool_input: output.args ?? {},
        })
      );
      await child.stdin.end();
    } catch {
      /* The exit status below fails closed. */
    }
    const [status, diagnostic] = await Promise.all([
      child.exited,
      new Response(child.stderr).text(),
    ]);
    if (status !== 0 || diagnostic.startsWith("NATIVE_OWNER_REQUIRED: "))
      throw new Error(
        "Required task access remains unproven. Run the shared readiness check and follow its recovery action before affected work."
      );
  },
});

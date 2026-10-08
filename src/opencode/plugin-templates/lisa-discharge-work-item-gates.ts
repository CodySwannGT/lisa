/**
 * Lisa-managed OpenCode adapter for the shared PostToolUse PR hook.
 * Uses the canonical shell policy rather than copying its version-skew logic.
 * The after-hook's command is input.args.command; a throw surfaces the failed
 * gate to the agent after the PR operation has already run. Antigravity has no
 * equivalent after-hook surface; the shared push report and CI retain its gates.
 */
export const LisaDischargeWorkItemGates = async ({
  directory,
}: {
  directory: string;
}) => ({
  "tool.execute.after": async (input: {
    tool: string;
    args?: { command?: string; workdir?: string };
  }) => {
    if (input.tool !== "bash") return;
    const command = String(input.args?.command ?? "");
    // Avoid spawning on ordinary shell calls; routing remains in the shared hook.
    if (!command.includes("gh pr ")) return;
    const { resolve } = await import("node:path");
    const cwd = resolve(directory, input.args?.workdir ?? ".");
    const hook = Bun.spawn(
      ["/bin/bash", `${import.meta.dir}/discharge-work-item-gates.sh`],
      { cwd, stdin: "pipe", stdout: "ignore", stderr: "pipe" }
    );
    hook.stdin.write(
      JSON.stringify({ tool_name: "Bash", tool_input: { command } })
    );
    hook.stdin.end();
    const [status, reason] = await Promise.all([
      hook.exited,
      new Response(hook.stderr).text(),
    ]);
    if (status === 0) {
      if (reason.trim()) console.warn(reason.trim());
      return;
    }
    throw new Error(
      reason.trim() || `Lisa PR check failed to run (status ${status}).`
    );
  },
});

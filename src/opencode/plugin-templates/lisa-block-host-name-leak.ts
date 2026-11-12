/**
 * Lisa-managed OpenCode tool.execute.before adapter for the canonical host-name
 * guard. Command text is sent as data to the Bash wrapper; it is never executed.
 *
 * The installed wrapper, classifier and context helper stay beside this module.
 * Target resolution remains canonical: known host writes are allowed; Lisa and
 * unknown-target writes retain inspection. Literal one-level sh/bash -c support
 * and its dynamic/deeper/other-launcher limits are the same on every surface.
 * Exit0 allows (including explicitly announced inactive enforcement), exit2
 * refuses, and any other exit reports an environment failure. Inactive warnings
 * must remain visible instead of turning a missing guard into a quiet pass.
 *
 * Copied verbatim into .opencode/plugin/ and run by OpenCode's Bun runtime.
 */
export const LisaBlockHostNameLeak = async () => ({
  "tool.execute.before": async (
    input: { tool: string },
    output: { args?: { command?: string; workdir?: string } }
  ) => {
    if (input.tool !== "bash") return;
    const command = String(output.args?.command ?? "");
    if (!command) return;

    const hookPath = `${import.meta.dir}/block-host-name-leak.sh`;
    const processHandle = Bun.spawn(["/bin/bash", hookPath], {
      cwd: output.args?.workdir || process.cwd(),
      env: { ...process.env, CLAUDE_PROJECT_DIR: process.cwd() },
      stdin: "pipe",
      stdout: "ignore",
      stderr: "pipe",
      // The canonical local repository probe retains its own five-second
      // bound. This adapter separately bounds the entire guard and fails closed.
      timeout: 10_000,
      killSignal: "SIGKILL",
    });
    try {
      await processHandle.stdin.write(
        JSON.stringify({ tool_name: "Bash", tool_input: { command } })
      );
      await processHandle.stdin.end();
    } catch {
      // An early exit can close stdin; the real status below owns the verdict.
    }
    const [status, reason] = await Promise.all([
      processHandle.exited,
      new Response(processHandle.stderr).text(),
    ]);
    if (status === 0) {
      if (reason.trim()) console.error(reason.trim());
      return;
    }
    if (status !== 2) {
      throw new Error(
        `block-host-name-leak: guard environment failure (status ${status}) at ${hookPath}` +
          (reason.trim() ? `: ${reason.trim()}` : "")
      );
    }
    throw new Error(
      reason.trim() || "block-host-name-leak: tracker write refused."
    );
  },
});

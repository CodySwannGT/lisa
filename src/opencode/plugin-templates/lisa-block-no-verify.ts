/**
 * Lisa-managed OpenCode plugin (tool.execute.before).
 *
 * Blocks commands that bypass git's verification hooks — `--no-verify` and any
 * prefix abbreviation git accepts for it, the short `git commit -n` (bare or
 * bundled into a cluster such as `-nm "msg"`), `HUSKY=0` / `HUSKY_SKIP_HOOKS=`,
 * and every spelling of `core.hooksPath` that points hooks somewhere that
 * disables them.
 *
 * ## Why a plugin rather than more deny globs
 *
 * OpenCode's `permission.bash` map matches SPELLINGS. Lisa's emit shipped
 * `"*--no-verify*"` and two `git commit -n` prefixes, and that is a filter on
 * how the bypass was typed, not on what git will do with it: `git commit
 * --no-veri` is an unambiguous abbreviation git resolves to `--no-verify` and
 * matched no glob at all. Adding `*--no-veri*` would close that one spelling
 * and leave the class open, because the set of abbreviations git accepts is a
 * property of git's own parser. It also cannot be closed by widening: a glob
 * broad enough to catch `-n` late on a line refuses `grep -n`.
 *
 * The distinction the globs cannot draw is between a token that IS an option
 * and a token that merely CONTAINS the text of one, and drawing it requires
 * tokenizing the command. OpenCode fires `tool.execute.before` for the `bash`
 * tool before the command runs, and a throw from it cancels the call — so the
 * capability was there; the emit was not using it.
 *
 * ## Why it shells out
 *
 * Policy stays single-sourced in `block-no-verify.sh`, the canonical guard
 * Claude, Codex, Cursor and Copilot already run, copied beside this module by
 * the installer exactly as `parity-safety-net.sh` is. A second implementation
 * of git's option grammar in TypeScript would be a second thing to harden, and
 * the two would diverge at the first vector closed in only one of them. This
 * adapter converts OpenCode's `bash` tool input into Lisa's canonical Claude
 * Bash-hook envelope, runs the script, and surfaces its refusal.
 *
 * The `permission.bash` deny globs stay in the emit as a FLOOR, not as the
 * guard: if this plugin fails to load, the literal spellings are still refused.
 * A coarse guard that is present beats a precise one that is absent.
 *
 * NOTE: Lisa copies this template verbatim into `.opencode/plugin/`. It runs
 * under OpenCode's Bun runtime and is excluded from this repository's tsconfig.
 */
export const LisaBlockNoVerify = async () => ({
  "tool.execute.before": async (
    input: { tool: string },
    output: { args?: { command?: string } }
  ) => {
    if (input.tool !== "bash") return;
    const command = String(output.args?.command ?? "");
    if (!command) return;

    const hookPath = `${import.meta.dir}/block-no-verify.sh`;
    const processHandle = Bun.spawn(["/bin/bash", hookPath], {
      env: { ...process.env, CLAUDE_PROJECT_DIR: process.cwd() },
      stdin: "pipe",
      stdout: "ignore",
      stderr: "pipe",
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
    // status is a block: 2 is the guard's own refusal, and anything else means
    // the guard could not complete, which is not a state to run a bypass in.
    if (status === 0) return;
    throw new Error(
      reason.trim() ||
        "block-no-verify: this command bypasses git's verification hooks. " +
          "Fix the underlying failure instead of skipping the check."
    );
  },
});

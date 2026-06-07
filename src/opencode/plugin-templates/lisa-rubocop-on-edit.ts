/**
 * Lisa-managed OpenCode plugin (tool.execute.after).
 *
 * Runs RuboCop -a (safe autocorrect) on every just-edited Ruby file, then
 * re-checks for remaining unfixable offenses. If any remain, throws so OpenCode
 * marks the tool call failed and the agent fixes them. Prefers `bundle exec
 * rubocop` when a Gemfile is present. Fails open when RuboCop isn't installed.
 *
 * Port of Lisa's Codex hook `rubocop-on-edit.sh`.
 *
 * NOTE: This file is a template Lisa copies verbatim into a host project's
 * `.opencode/plugin/`. It is intentionally excluded from this repo's tsconfig
 * and eslint config — it runs under OpenCode's Bun runtime, not here.
 */
export const LisaRubocopOnEdit = async ({
  $,
  directory,
}: {
  $: (strings: TemplateStringsArray, ...exprs: unknown[]) => any;
  directory: string;
}) => {
  const EXTS = new Set(["rb", "rake"]);
  const extOf = (p: string) => p.split(".").pop()?.toLowerCase() ?? "";
  const { existsSync } = await import("node:fs");
  const resolveRunner = (): string[] | null => {
    const bundle = Bun.which("bundle");
    if (bundle && existsSync(`${directory}/Gemfile`)) {
      return [bundle, "exec", "rubocop"];
    }
    const rubocop = Bun.which("rubocop");
    return rubocop ? [rubocop] : null;
  };
  return {
    "tool.execute.after": async (input: {
      tool: string;
      args?: { filePath?: string };
    }) => {
      if (input.tool !== "edit" && input.tool !== "write") return;
      const filePath = String(input.args?.filePath ?? "");
      if (!filePath || !EXTS.has(extOf(filePath))) return;
      const runner = resolveRunner();
      if (!runner) return; // fail open — no RuboCop installed
      const [bin, ...rest] = runner;
      await $`${bin} ${rest} -a ${filePath}`.quiet().nothrow();
      const res = await $`${bin} ${rest} ${filePath}`.quiet().nothrow();
      if (res.exitCode === 0) return;
      const out =
        `${res.stdout?.toString() ?? ""}${res.stderr?.toString() ?? ""}`.trim();
      throw new Error(
        `rubocop-on-edit: RuboCop reported unfixable offenses in ${filePath}:\n${out}`
      );
    },
  };
};

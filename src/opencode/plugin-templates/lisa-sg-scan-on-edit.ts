/**
 * Lisa-managed OpenCode plugin (tool.execute.after).
 *
 * Runs `ast-grep scan` on every just-edited source file (TypeScript/JS or
 * Ruby) when the project ships an `sgconfig.yml`. If ast-grep reports findings,
 * throws so OpenCode marks the tool call failed and the agent fixes them.
 * Fails open when ast-grep or sgconfig.yml is absent.
 *
 * Port of Lisa's Codex hook `sg-scan-on-edit.sh`.
 *
 * NOTE: This file is a template Lisa copies verbatim into a host project's
 * `.opencode/plugin/`. It is intentionally excluded from this repo's tsconfig
 * and eslint config — it runs under OpenCode's Bun runtime, not here.
 */
export const LisaSgScanOnEdit = async ({
  $,
  directory,
}: {
  $: (strings: TemplateStringsArray, ...exprs: unknown[]) => any;
  directory: string;
}) => {
  const EXTS = new Set(["ts", "tsx", "js", "jsx", "mjs", "cjs", "rb", "rake"]);
  const extOf = (p: string) => p.split(".").pop()?.toLowerCase() ?? "";
  const { existsSync } = await import("node:fs");
  const resolveBin = (): string | null => {
    const local = `${directory}/node_modules/.bin/ast-grep`;
    if (existsSync(local)) return local;
    return Bun.which("ast-grep") ?? Bun.which("sg");
  };
  return {
    "tool.execute.after": async (input: {
      tool: string;
      args?: { filePath?: string };
    }) => {
      if (input.tool !== "edit" && input.tool !== "write") return;
      const filePath = String(input.args?.filePath ?? "");
      if (!filePath || !EXTS.has(extOf(filePath))) return;
      if (!existsSync(`${directory}/sgconfig.yml`)) return; // fail open
      const astGrep = resolveBin();
      if (!astGrep) return; // fail open — no ast-grep installed
      const res = await $`${astGrep} scan ${filePath}`.quiet().nothrow();
      if (res.exitCode === 0) return;
      const out =
        `${res.stdout?.toString() ?? ""}${res.stderr?.toString() ?? ""}`.trim();
      throw new Error(
        `sg-scan-on-edit: ast-grep reported findings in ${filePath}:\n${out}`
      );
    },
  };
};

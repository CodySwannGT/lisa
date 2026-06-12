/**
 * Lisa-managed OpenCode plugin (tool.execute.after).
 *
 * Runs oxlint on every just-edited JS/TS file. If problems remain, throws so
 * OpenCode marks the tool call failed and the agent self-corrects (the
 * equivalent of the Codex hook's non-zero exit). Fails open when oxlint isn't
 * installed. Full ESLint remains enforced at the commit/CI chokepoint.
 *
 * Port of Lisa's Codex hook `lint-on-edit.sh`. OpenCode passes the edited file
 * via `input.args.filePath`; `tool.execute.after` runs after a successful
 * edit/write (verified-by-run on opencode 1.16.2: a throw here surfaces the
 * message to the agent).
 *
 * NOTE: This file is a template Lisa copies verbatim into a host project's
 * `.opencode/plugin/`. It is intentionally excluded from this repo's tsconfig
 * and eslint config — it runs under OpenCode's Bun runtime, not here.
 */
export const LisaLintOnEdit = async ({
  $,
  directory,
}: {
  $: (strings: TemplateStringsArray, ...exprs: unknown[]) => any;
  directory: string;
}) => {
  const EXTS = new Set(["ts", "tsx", "js", "jsx", "mjs", "cjs"]);
  const extOf = (p: string) => p.split(".").pop()?.toLowerCase() ?? "";
  const { existsSync } = await import("node:fs");
  const resolveBin = (name: string): string | null => {
    const local = `${directory}/node_modules/.bin/${name}`;
    if (existsSync(local)) return local;
    return Bun.which(name);
  };
  return {
    "tool.execute.after": async (input: {
      tool: string;
      args?: { filePath?: string };
    }) => {
      if (input.tool !== "edit" && input.tool !== "write") return;
      const filePath = String(input.args?.filePath ?? "");
      if (!filePath || !EXTS.has(extOf(filePath))) return;
      const oxlint = resolveBin("oxlint");
      if (!oxlint) return; // fail open - no oxlint installed
      const res = await $`${oxlint} --quiet ${filePath}`.quiet().nothrow();
      if (res.exitCode === 0) return;
      const out =
        `${res.stdout?.toString() ?? ""}${res.stderr?.toString() ?? ""}`.trim();
      if (
        out.includes("No files found to lint") ||
        out.includes(" on 0 files") ||
        out.includes(" on 0 file")
      ) {
        return;
      }
      throw new Error(
        `lint-on-edit: oxlint reported problems in ${filePath}:\n${out}`
      );
    },
  };
};

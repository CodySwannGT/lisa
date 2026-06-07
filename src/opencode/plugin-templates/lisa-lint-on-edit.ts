/**
 * Lisa-managed OpenCode plugin (tool.execute.after).
 *
 * Runs ESLint --fix on every just-edited JS/TS file, then re-checks. If
 * unfixable problems remain, throws so OpenCode marks the tool call failed and
 * the agent self-corrects (the equivalent of the Codex hook's non-zero exit).
 * Fails open when ESLint isn't installed.
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
      const eslint = resolveBin("eslint");
      if (!eslint) return; // fail open — no ESLint installed
      await $`${eslint} --fix ${filePath}`.quiet().nothrow();
      const res = await $`${eslint} --quiet ${filePath}`.quiet().nothrow();
      if (res.exitCode === 0) return;
      const out =
        `${res.stdout?.toString() ?? ""}${res.stderr?.toString() ?? ""}`.trim();
      throw new Error(
        `lint-on-edit: ESLint reported unfixable problems in ${filePath}:\n${out}`
      );
    },
  };
};

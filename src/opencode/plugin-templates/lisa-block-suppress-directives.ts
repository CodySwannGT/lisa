/**
 * Lisa-managed OpenCode plugin (tool.execute.before).
 *
 * Blocks adding error-suppression directives (@ts-ignore, @ts-nocheck,
 * eslint-disable, biome-ignore, prettier-ignore) to JS/TS source. Suppressing
 * the type checker, linter, or formatter hides real defects — fix the
 * underlying error. @ts-expect-error is intentionally NOT matched (it is the
 * safer alternative).
 *
 * Port of Lisa's Codex hook `block-suppress-directives.sh`. OpenCode exposes
 * `edit` (oldString/newString) and `write` (content) tools — there is no
 * multi-file apply_patch — so the new text comes straight from the tool args.
 * Throwing in `tool.execute.before` cancels the call and surfaces the message
 * to the agent (verified-by-run on opencode 1.16.2).
 *
 * NOTE: This file is a template Lisa copies verbatim into a host project's
 * `.opencode/plugin/`. It is intentionally excluded from this repo's tsconfig
 * and eslint config — it runs under OpenCode's Bun runtime, not here.
 */
export const LisaBlockSuppressDirectives = async () => {
  // Comment-syntax-only match: // or /* opener, optional whitespace, directive.
  const DIRECTIVE_RE =
    /(\/\/|\/\*)\s*(@ts-(ignore|nocheck)|eslint-disable|biome-ignore|prettier-ignore)/;
  const JS_TS = new Set(["ts", "tsx", "js", "jsx", "mjs", "cjs"]);
  const extOf = (p: string) => p.split(".").pop()?.toLowerCase() ?? "";
  return {
    "tool.execute.before": async (
      input: { tool: string },
      output: {
        args?: { filePath?: string; content?: string; newString?: string };
      }
    ) => {
      if (input.tool !== "edit" && input.tool !== "write") return;
      const filePath = String(output.args?.filePath ?? "");
      if (!filePath || !JS_TS.has(extOf(filePath))) return;
      const newText =
        input.tool === "write"
          ? String(output.args?.content ?? "")
          : String(output.args?.newString ?? "");
      if (!DIRECTIVE_RE.test(newText)) return;
      throw new Error(
        [
          `block-suppress-directives: refusing to add an error-suppression directive to ${filePath}.`,
          "",
          "@ts-ignore / @ts-nocheck / eslint-disable / biome-ignore / prettier-ignore",
          "silence the type checker, linter, or formatter instead of fixing the problem.",
          "Fix the underlying type/lint error — add the missing annotation, narrow the",
          "type, or restructure the code so the rule passes.",
          "",
          "Suppression is a last resort. If there is genuinely no other way, STOP and get",
          "the user's approval first, prefer @ts-expect-error over @ts-ignore, scope the",
          'disable to one line and one rule, and add a "-- <reason>" description.',
        ].join("\n")
      );
    },
  };
};

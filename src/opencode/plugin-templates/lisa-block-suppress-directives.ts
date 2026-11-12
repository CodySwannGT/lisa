/**
 * Lisa-managed OpenCode plugin (tool.execute.before).
 *
 * Blocks adding error-suppression directives (@ts-ignore, @ts-nocheck,
 * eslint-disable, biome-ignore, prettier-ignore) to JS/TS source. Suppressing
 * the type checker, linter, or formatter hides real defects — fix the
 * underlying error. @ts-expect-error is intentionally NOT matched (it is the
 * safer alternative).
 *
 * Refuses only directive GROWTH, never mere presence (CodySwannGT/lisa#4492):
 * the directives before the call (the file on disk for `write`, `oldString`
 * for `edit`) are compared with those after it, and the call is refused when
 * the after text carries one the before text does not — a new directive,
 * another copy of one, or a reworded (widened) one. Each directive is taken
 * from its comment opener to the end of its line. A `write` over something
 * that exists but cannot be read, or an `edit` that brings a directive with no
 * `oldString`, cannot be judged and is refused.
 *
 * Port of Lisa's Codex hook `block-suppress-directives.sh`. OpenCode exposes
 * `edit` (oldString/newString) and `write` (content) tools — there is no
 * MultiEdit and no multi-file apply_patch — so the texts come straight from
 * the tool args. Throwing in `tool.execute.before` cancels the call and
 * surfaces the message to the agent (verified-by-run on opencode 1.16.2).
 *
 * NOTE: This file is a template Lisa copies verbatim into a host project's
 * `.opencode/plugin/`. It is intentionally excluded from this repo's tsconfig
 * and eslint config — it runs under OpenCode's Bun runtime, not here.
 */
export const LisaBlockSuppressDirectives = async ({
  directory,
}: { directory?: string } = {}) => {
  // Comment-syntax-only match: // or /* opener, optional whitespace, directive.
  const DIRECTIVE_RE =
    /(\/\/|\/\*)\s*(@ts-(ignore|nocheck)|eslint-disable|biome-ignore|prettier-ignore).*/g;
  const JS_TS = new Set(["ts", "tsx", "js", "jsx", "mjs", "cjs"]);
  const extOf = (p: string) => p.split(".").pop()?.toLowerCase() ?? "";
  const directivesIn = (text: string) =>
    (text.match(DIRECTIVE_RE) ?? []).map(d => d.trimEnd());
  // True when `after` carries a directive `before` does not, counting copies.
  const grows = (before: string, after: string) => {
    const remaining = directivesIn(before);
    return directivesIn(after).some(d => {
      const at = remaining.indexOf(d);
      if (at === -1) return true;
      remaining.splice(at, 1);
      return false;
    });
  };
  // The file a write replaces; "" when absent, undefined when unreadable.
  const readBefore = async (filePath: string) => {
    const { lstat, readFile } = await import("node:fs/promises");
    const { resolve } = await import("node:path");
    const target = resolve(directory ?? process.cwd(), filePath);
    const exists = await lstat(target).then(
      () => true,
      () => false
    );
    if (!exists) return "";
    return readFile(target, "utf8").catch(() => undefined);
  };
  const refusal = (filePath: string) =>
    new Error(
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
  return {
    "tool.execute.before": async (
      input: { tool: string },
      output: {
        args?: {
          filePath?: string;
          content?: string;
          oldString?: string;
          newString?: string;
        };
      }
    ) => {
      if (input.tool !== "edit" && input.tool !== "write") return;
      const filePath = String(output.args?.filePath ?? "");
      if (!filePath || !JS_TS.has(extOf(filePath))) return;
      const after =
        input.tool === "write"
          ? String(output.args?.content ?? "")
          : String(output.args?.newString ?? "");
      if (directivesIn(after).length === 0) return;
      const before =
        input.tool === "write"
          ? await readBefore(filePath)
          : output.args?.oldString;
      if (typeof before !== "string" || grows(before, after)) {
        throw refusal(filePath);
      }
    },
  };
};

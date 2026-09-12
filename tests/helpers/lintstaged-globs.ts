/**
 * Shared parsing for `.lintstagedrc.json` matcher globs.
 *
 * Two guards depend on knowing which extensions a matcher claims — the
 * ordering guard (no extension may be routed through two concurrent matchers)
 * and the ast-grep reach guard (every shipped rule language must be handed to
 * `ast-grep scan` by some matcher). They must agree on what a glob means, so
 * the parser lives in one place rather than in each of them.
 */

/**
 * Extensions a lint-staged glob matches.
 * @param pattern - A lint-staged matcher such as `*.{js,ts}`
 * @returns The extension set
 */
export function extensionsOf(pattern: string): ReadonlySet<string> {
  // Sliced rather than matched with a regex: `sonarjs/slow-regex` rejects the
  // braced-group pattern as backtracking-vulnerable, and a matcher glob is
  // simple enough that indexOf is both faster and unambiguous.
  const open = pattern.indexOf("{");
  const close = pattern.indexOf("}", open + 1);
  if (open === -1 || close === -1) {
    // A single-extension matcher (`*.rb`) still names an extension; returning
    // the raw glob would make every membership check against it miss.
    return new Set([pattern.startsWith("*.") ? pattern.slice(2) : pattern]);
  }
  return new Set(
    pattern
      .slice(open + 1, close)
      .split(",")
      .map(entry => entry.trim())
  );
}

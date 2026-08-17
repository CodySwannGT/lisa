/**
 * `.lintstagedrc.json` matchers must not race each other over the same file.
 *
 * lint-staged runs DIFFERENT matchers concurrently. The shipped config used to
 * glob `mjs`, `js`, `ts` and `tsx` in two matchers at once — one running
 * `oxlint --fix` (which can emit single-quoted strings when a consumer's rule
 * set includes a string-producing autofix) and the other running
 * `prettier --write` (which normalizes them). Whichever finished last decided
 * what was committed.
 *
 * Two costs, and the second is the one that made this worth a guard:
 *
 * 1. `prettier --check` reds in CI for any project with `singleQuote: false`.
 * 2. It permanently freezes a `copy-overwrite` asset. oxlint rewrites Lisa's
 *    shipped form on every commit that stages the file, so it can never stay
 *    byte-identical upstream. It becomes `host-modified`, which
 *    `mayRefreshLisaOwned` PRESERVES — measured downstream, a 3.27.0 → 3.28.2
 *    bump did not refresh the file because apply skipped it as host-modified.
 *    The consumer is severed from every future fix to that file, silently.
 *
 * Reported by a fleet session after it cost two misdiagnoses. The fix is
 * ordering, not rule-tuning: formatting runs last, in the same task list, so it
 * always observes whatever the fixers produced.
 */
import { readFileSync } from "node:fs";
import * as path from "node:path";

const CONFIGS = [
  ".lintstagedrc.json",
  "typescript/copy-overwrite/.lintstagedrc.json",
];

/**
 * Extensions a lint-staged glob matches.
 * @param pattern - A lint-staged matcher such as `*.{js,ts}`
 * @returns The extension set
 */
function extensionsOf(pattern: string): ReadonlySet<string> {
  // Sliced rather than matched with a regex: `sonarjs/slow-regex` rejects the
  // braced-group pattern as backtracking-vulnerable, and a matcher glob is
  // simple enough that indexOf is both faster and unambiguous.
  const open = pattern.indexOf("{");
  const close = pattern.indexOf("}", open + 1);
  if (open === -1 || close === -1) {
    return new Set([pattern]);
  }
  return new Set(
    pattern
      .slice(open + 1, close)
      .split(",")
      .map(entry => entry.trim())
  );
}

describe.each(CONFIGS)("%s matcher ordering", configPath => {
  const config = JSON.parse(
    readFileSync(path.join(process.cwd(), configPath), "utf8")
  ) as Record<string, readonly string[]>;
  const patterns = Object.keys(config);

  it("never routes one extension through two matchers", () => {
    // Two matchers over the same extension means two concurrent processes
    // rewriting one file with no ordering between them.
    const pairs = patterns.flatMap((left, index) =>
      patterns.slice(index + 1).map(right => [left, right] as const)
    );
    for (const [left, right] of pairs) {
      const shared = [...extensionsOf(left)].filter(extension =>
        extensionsOf(right).has(extension)
      );
      expect(shared).toEqual([]);
    }
  });

  it("runs the formatter last wherever a fixer also runs", () => {
    // Ordering WITHIN a task list is sequential and guaranteed, which is the
    // whole reason the formatter belongs here rather than in its own matcher.
    for (const [pattern, tasks] of Object.entries(config)) {
      const fixes = tasks.some(task => task.includes("--fix"));
      if (!fixes) continue;
      // Pattern is named in the message so a failure says WHICH matcher.
      expect(`${pattern}: ${tasks.at(-1)}`).toContain("prettier --write");
    }
  });

  it("still formats the non-code files that have no fixer", () => {
    const formatted = Object.entries(config).flatMap(([pattern, tasks]) =>
      tasks.some(task => task.includes("prettier"))
        ? [...extensionsOf(pattern)]
        : []
    );
    for (const extension of ["json", "md", "yaml", "css"]) {
      expect(formatted).toContain(extension);
    }
  });
});

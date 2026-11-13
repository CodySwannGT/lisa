/**
 * Falsification mutations must run on a scratch copy (CodySwannGT/lisa#4760).
 *
 * A falsification step breaks the guarded property, confirms the check fails,
 * and restores. Run in place inside a shared worktree, that break is a write
 * into another agent's files: a verifier's mutate/restore once raced a
 * builder's concurrent edits and briefly deleted code the builder had just
 * written, and a revert that lands after the builder's next save can delete or
 * commit their work. Every surface that tells an agent to "break it and
 * restore" must therefore say where: on a scratch copy (a throwaway detached
 * `git worktree add` or a temp copy of the touched files), never in a worktree
 * another agent is editing.
 *
 * Every shipped copy is checked, not just the canonical source, because each
 * coding agent reads its own generated copy: a variant whose generator dropped
 * the clause would leave that agent mutating shared trees. The expected copies
 * come from a per-variant layout table, so a missing copy FAILS rather than
 * being skipped, and a discovery sweep over `plugins/` proves the table names
 * every copy that actually ships, so a new variant cannot slip past unchecked.
 * @module tests/unit/strategies/falsification-scratch-copy
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/** One instruction surface, by its canonical path under `plugins/src/base`. */
interface Surface {
  /** Canonical path relative to the plugin root. */
  readonly rel: string;
  /** Path suffixes that identify a shipped copy of this surface. */
  readonly shippedAs: readonly string[];
}

const SURFACES: readonly Surface[] = [
  {
    rel: "agents/verification-specialist.md",
    shippedAs: [
      "/agents/verification-specialist.md",
      "/agents/verification-specialist.agent.md",
    ],
  },
  {
    rel: "agents/test-specialist.md",
    shippedAs: [
      "/agents/test-specialist.md",
      "/agents/test-specialist.agent.md",
    ],
  },
  {
    rel: "rules/eager/falsifiable-checks.md",
    shippedAs: [
      "/rules/eager/falsifiable-checks.md",
      "/rules/falsifiable-checks.mdc",
    ],
  },
  {
    rel: "rules/reference/falsifiable-checks.md",
    shippedAs: [
      "/rules/reference/falsifiable-checks.md",
      "/rules/falsifiable-checks-reference.mdc",
    ],
  },
  {
    rel: "rules/reference/verification.md",
    shippedAs: [
      "/rules/reference/verification.md",
      "/rules/verification-reference.mdc",
    ],
  },
  {
    rel: "skills/lisa-codify-verification/SKILL.md",
    shippedAs: ["/skills/lisa-codify-verification/SKILL.md"],
  },
];

/**
 * Where each plugin variant ships a canonical path, or null when that variant
 * does not ship that kind of surface (Antigravity carries no rules; the Codex
 * plugin carries only skills).
 */
const VARIANTS: Readonly<Record<string, (rel: string) => string | null>> = {
  "plugins/src/base": rel => rel,
  "plugins/lisa": rel => rel,
  "plugins/lisa/.codex-plugin": rel => (rel.startsWith("skills/") ? rel : null),
  "plugins/lisa-agy": rel => (rel.startsWith("rules/") ? null : rel),
  "plugins/lisa-copilot": rel =>
    rel.replace(/^(agents\/.+)\.md$/, "$1.agent.md"),
  "plugins/lisa-cursor": rel =>
    rel
      .replace(/^rules\/eager\/(.+)\.md$/, "rules/$1.mdc")
      .replace(/^rules\/reference\/(.+)\.md$/, "rules/$1-reference.mdc"),
  "plugins/lisa-devin": rel => rel,
};

/**
 * Every expected shipped copy of a surface, from the variant layout table.
 * @param surface - The surface
 * @returns Repository-relative paths
 */
const expectedCopies = (surface: Surface): string[] =>
  Object.entries(VARIANTS).flatMap(([root, layout]) => {
    const rel = layout(surface.rel);
    return rel === null ? [] : [`${root}/${rel}`];
  });

/**
 * Every file under `plugins/` (excluding dependency directories and the
 * non-base stack sources, which do not carry these surfaces).
 * @returns Repository-relative paths
 */
const shippedFiles = (): string[] =>
  (readdirSync("plugins", { recursive: true }) as string[])
    .map(entry => `plugins/${entry.split(path.sep).join("/")}`)
    .filter(
      file =>
        !file.includes("/node_modules/") &&
        (!file.startsWith("plugins/src/") ||
          file.startsWith("plugins/src/base/"))
    );

const ALL_FILES = shippedFiles();

const SCRATCH_COPY = /scratch copy/i;
const NOT_SHARED = /never in a worktree another agent is editing/i;

/**
 * A copy's text; fails (rather than skipping) when the copy is missing.
 * @param file - Repository-relative path
 * @returns The file text
 */
const readCopy = (file: string): string => {
  expect(existsSync(file), `${file} is missing`).toBe(true);
  return readFileSync(file, "utf8");
};

describe("falsification runs on a scratch copy", () => {
  describe.each(SURFACES.map(surface => [surface.rel, surface] as const))(
    "%s",
    (_rel, surface) => {
      const copies = expectedCopies(surface);

      it("the layout table names every copy that ships", () => {
        const discovered = ALL_FILES.filter(file =>
          surface.shippedAs.some(suffix => file.endsWith(suffix))
        ).sort((a, b) => a.localeCompare(b));
        expect(discovered).toEqual(
          [...copies].sort((a, b) => a.localeCompare(b))
        );
      });

      it.each(copies)("%s names the scratch-copy requirement", file => {
        const text = readCopy(file);
        expect(text, file).toMatch(SCRATCH_COPY);
        expect(text, file).toMatch(NOT_SHARED);
      });
    }
  );

  const reference = SURFACES.find(
    surface => surface.rel === "rules/reference/falsifiable-checks.md"
  )!;
  it.each(expectedCopies(reference))(
    "%s gives a complete, baselined scratch-copy recipe",
    file => {
      const text = readCopy(file);
      expect(text).toContain("git worktree add --detach");
      expect(text).toContain("git diff --binary HEAD");
      expect(text).toContain("apply --allow-empty");
      expect(text).toContain("git ls-files --others --exclude-standard -z");
      expect(text).toContain("node_modules");
      expect(text).toMatch(/BEFORE breaking anything/);
      expect(text).toMatch(/red baseline means the copy is incomplete/i);
      expect(text).toMatch(/workspace monorepo, install in the copy/i);
      expect(text).toContain("git worktree remove --force");
      expect(text).toMatch(/address it by absolute path/);
      expect(text).toMatch(
        /Never use a harness tool that switches the session's working directory into it/
      );
      expect(text).toContain("EnterWorktree");
      expect(text).not.toMatch(/Revert, and confirm green again/);
      expect(text).not.toMatch(/Restore, and confirm green again/);
      // No unscoped in-place break may survive anywhere in the reference body.
      expect(text).not.toMatch(/Break the thing being guarded, confirm/);
      expect(text).not.toMatch(
        /Neuter the protection \*\*in production code\*\*, run/
      );
    }
  );

  const skill = SURFACES.find(
    surface => surface.rel === "skills/lisa-codify-verification/SKILL.md"
  )!;
  it.each(expectedCopies(skill))(
    "%s never breaks the property in place and baselines the copy",
    file => {
      const text = readCopy(file);
      expect(text).not.toMatch(/Break the property in place/i);
      expect(text).not.toMatch(/return to the fix branch/i);
      expect(text).toMatch(/red baseline means the copy is incomplete/i);
      expect(text).toMatch(/fails \*\*at the assertion\*\*, not on an import/);
      expect(text).toMatch(/every new helper or fixture it imports/);
    }
  );
});

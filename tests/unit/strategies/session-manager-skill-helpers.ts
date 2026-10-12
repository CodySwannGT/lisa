/**
 * Shared fixtures for the session-manager skill suites (CodySwannGT/lisa#4448):
 * the variant roots both suites walk and a section reader that keeps an
 * assertion inside the section it is about.
 * @module tests/unit/strategies/session-manager-skill-helpers
 */
import { readFileSync } from "node:fs";
import path from "node:path";

/** The two skills this feature ships. */
export const SKILLS = [
  "lisa-session-manager",
  "lisa-setup-session-manager",
] as const;

/** Canonical source root; every other root is generated from it. */
export const SOURCE_ROOT = "plugins/src/base/skills";

/** Codex rewrites SKILL.md frontmatter, so it is not a verbatim copy. */
export const CODEX_ROOT = "plugins/lisa/.codex-plugin/skills";

/** Roots whose generator copies the skill folder byte for byte. */
export const VERBATIM_ROOTS = [
  "plugins/lisa/skills",
  "plugins/lisa-cursor/skills",
  "plugins/lisa-agy/skills",
  "plugins/lisa-copilot/skills",
  "plugins/lisa-devin/skills",
] as const;

/** Every checked-in skill root: the source plus each runtime projection. */
export const ALL_ROOTS = [SOURCE_ROOT, ...VERBATIM_ROOTS, CODEX_ROOT] as const;

/** The manager CLI's entrypoint, relative to a skill root. */
export const ENTRYPOINT = "lisa-session-manager/scripts/session-manager.mjs";

/**
 * Read a repo-relative file.
 * @param relativePath - Path from the repository root
 * @returns File contents
 */
export const read = (relativePath: string): string =>
  readFileSync(path.resolve(relativePath), "utf8");

/**
 * Return one `##` section, so an assertion cannot be met by wording that
 * belongs to a neighbouring section.
 * @param text - Markdown document
 * @param heading - Exact `##` heading line
 * @returns Section text from the heading up to the next `##` heading
 * @throws {Error} When the heading is absent, so a missing section fails loudly
 */
export function section(text: string, heading: string): string {
  const start = text.indexOf(`\n${heading}\n`);
  if (start === -1) throw new Error(`missing heading: ${heading}`);
  const next = text.indexOf("\n## ", start + heading.length + 2);
  return next === -1 ? text.slice(start) : text.slice(start, next);
}

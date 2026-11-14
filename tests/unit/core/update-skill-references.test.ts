/**
 * The fleet-update skill must cite only Lisa files that exist and say the same
 * thing in every tracked copy (CodySwannGT/lisa#4644).
 *
 * Three defects motivated this file:
 *
 * - step 12 named `scripts/migrate-deploy-order.sh` as "the reference" months
 *   after that script was deleted, and step 8 mapped host workflows onto
 *   `reusable-claude*.yml` files Lisa no longer ships — so an agent following
 *   the skill went looking for files that are not there;
 * - step 8 described callers only as `…@main`, while Lisa's pinner writes
 *   `…@<40-char sha> # v<version>` (`src/core/reusable-workflow-pin.ts`) —
 *   guidance prose, reviewed rather than pinned (#4867);
 * - the copies are hand-maintained and had drifted before.
 *
 * Per the Test Isolation house rule, expected values are HARDCODED.
 *
 * @module tests/unit/core/update-skill-references
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/** Repository root, resolved from this file rather than from cwd. */
const ROOT = path.resolve(__dirname, "../../..");

/** Every tracked copy of the fleet-update skill. The first is the reference. */
const SKILL_COPIES = [
  ".claude/skills/lisa-update-projects/SKILL.md",
  ".agents/skills/lisa-update-projects/SKILL.md",
  ".claude-pr/.claude/skills/lisa-update-projects/SKILL.md",
] as const;

/**
 * Leading directories that denote a file in the Lisa repository itself.
 * `all/`, `typescript/` and `rails/` are the stack template trees the skill
 * points at as the source of truth for a host's workflow files.
 */
const LISA_PREFIXES = [
  "scripts/",
  "src/",
  "plugins/",
  "tests/",
  ".claude/",
  ".agents/",
  "wiki/",
  "all/",
  "typescript/",
  "rails/",
] as const;

/**
 * Tokens that LOOK like Lisa paths but name a file in the HOST project the
 * skill is updating. Each is excluded deliberately, and the test below fails
 * if one stops appearing in the skill, so this list cannot silently rot.
 */
const HOST_PATHS: ReadonlySet<string> = new Set([
  // Step 10: the host's own Claude settings, which the skill edits with jq.
  ".claude/settings.json",
  // Step 10: the host directory older Lisa versions installed hooks into.
  ".claude/hooks/",
  // Step 14: run "from the project checkout" — the host's copy, distributed
  // from all/copy-overwrite/scripts/.
  "scripts/check-third-party-review-evidence.mjs",
]);

/** Lisa's own reusable workflows, cited by bare file name (`quality.yml@…`). */
const BARE_LISA_WORKFLOW =
  /^(?:reusable-[\w.-]+|quality(?:-[\w-]+)?|release(?:-[\w-]+)?|gates)\.ya?ml$/;

/** A caller line's owner/repo prefix, which makes the rest a Lisa path. */
const LISA_REPO_PREFIX = "CodySwannGT/lisa/";

/**
 * Read one skill copy.
 * @param copy - repository-relative path
 * @returns the file's text
 */
const read = (copy: string): string =>
  readFileSync(path.join(ROOT, copy), "utf8");

/**
 * Drop sentence punctuation that trails a token in prose (`file.mjs.`).
 * @param token - token as it appears in the skill
 * @returns the token without trailing `.`, `,`, `:` or `;`
 */
const trimPunctuation = (token: string): string =>
  token.length > 0 && ".,:;".includes(token.slice(-1))
    ? trimPunctuation(token.slice(0, -1))
    : token;

/**
 * Turn one punctuation-trimmed token into the Lisa repository path it cites,
 * or null when it cites no Lisa file.
 * @param token - trimmed token
 * @returns repository-relative path, or null
 */
const toLisaPath = (token: string): string | null => {
  const unowned = token.startsWith(LISA_REPO_PREFIX)
    ? token.slice(LISA_REPO_PREFIX.length)
    : token;
  const at = unowned.indexOf("@");
  const withoutRef = at === -1 ? unowned : unowned.slice(0, at);
  if (BARE_LISA_WORKFLOW.test(withoutRef)) {
    return `.github/workflows/${withoutRef}`;
  }
  if (withoutRef.startsWith(".github/workflows/") && unowned !== token) {
    return withoutRef;
  }
  return LISA_PREFIXES.some(prefix => withoutRef.startsWith(prefix))
    ? withoutRef
    : null;
};

/**
 * Every Lisa path one copy cites, after removing deliberate host paths.
 * @param text - skill text
 * @returns unique repository-relative paths
 */
const citedLisaPaths = (text: string): readonly string[] => [
  ...new Set(
    text
      .split(/[\s`'"()[\]]/)
      .map(trimPunctuation)
      .filter(token => token.length > 0 && !HOST_PATHS.has(token))
      .map(toLisaPath)
      .filter((cited): cited is string => cited !== null)
  ),
];

/**
 * Whether a cited path exists. A path holding a glob or a `<placeholder>`
 * is checked by the directory that precedes the first wildcard.
 * @param cited - repository-relative path
 * @returns true when the file or directory is present
 */
const exists = (cited: string): boolean => {
  const wildcard = cited.search(/[*<]/);
  const concrete =
    wildcard === -1 ? cited : cited.slice(0, cited.lastIndexOf("/", wildcard));
  return existsSync(path.join(ROOT, concrete));
};

/**
 * The numbered top-level steps and headings of one copy — the procedure an
 * agent follows — with the runtime's skill sigil normalised, so a future
 * `$lisa-` rename in one runtime does not read as drift.
 * @param text - skill text
 * @returns heading and step lines, in order
 */
const procedure = (text: string): readonly string[] =>
  text
    .split("\n")
    .filter(line => /^(?:#{1,6} |\d+\. )/.test(line))
    .map(line => line.replaceAll("$lisa-", "/lisa-"));

describe("lisa-update-projects skill: references and parity", () => {
  it("has every copy present, so a renamed path cannot empty this file", () => {
    expect(
      SKILL_COPIES.filter(copy => !existsSync(path.join(ROOT, copy)))
    ).toEqual([]);
  });

  it.each(SKILL_COPIES)("%s cites only Lisa paths that exist", copy => {
    const cited = citedLisaPaths(read(copy));
    expect(cited.length).toBeGreaterThan(0);
    expect(cited.filter(entry => !exists(entry))).toEqual([]);
  });

  it.each(SKILL_COPIES)(
    "%s still cites every host-path exclusion, so none is stale",
    copy => {
      const text = read(copy);
      expect([...HOST_PATHS].filter(entry => !text.includes(entry))).toEqual(
        []
      );
    }
  );

  it.each(SKILL_COPIES.slice(1))(
    "%s has the same numbered steps and headings as the .claude copy",
    copy => {
      expect(procedure(read(copy))).toEqual(procedure(read(SKILL_COPIES[0])));
    }
  );

  it.each(SKILL_COPIES.slice(1))(
    "%s carries the same step bodies as the .claude copy, not only the same headings",
    copy => {
      const body = (text: string): string =>
        text.replaceAll("$lisa-", "/lisa-");
      expect(body(read(copy))).toBe(body(read(SKILL_COPIES[0])));
    }
  );
});

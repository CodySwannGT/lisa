/**
 * Every tracked copy of the fleet-update skill must carry the canary-first
 * rollout (CodySwannGT/lisa#4604).
 *
 * The plan script's behaviour is pinned by
 * `tests/unit/scripts/lisa-update-projects-plan.test.ts`; this file pins the
 * PROSE that tells an agent to use it. The copies are hand-maintained, and
 * before #4604 two of them had drifted far enough to read a config file that
 * no longer exists, so each load-bearing instruction is asserted in every copy:
 *
 * - the plan-script invocation, so hosts are never parsed by hand;
 * - the bounded required-check watch;
 * - `exec @ARGV or die` in the perl fallback — without `or die` a failed exec
 *   exits 0 and reads as a passing canary;
 * - the halt rule, which also skips Lisa's self-upgrade (step 17);
 * - the report's Canary section.
 *
 * Per the Test Isolation house rule, expected values are HARDCODED.
 *
 * @module tests/unit/core/update-skill-canary
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/** Repository root, resolved from this file rather than from cwd. */
const ROOT = path.resolve(__dirname, "../../..");

/** Every tracked copy of the fleet-update skill. */
const SKILL_COPIES = [
  ".claude/skills/lisa-update-projects/SKILL.md",
  ".agents/skills/lisa-update-projects/SKILL.md",
  ".claude-pr/.claude/skills/lisa-update-projects/SKILL.md",
] as const;

/** Instructions each copy must contain, verbatim. */
const REQUIRED_TEXT = [
  "node scripts/lisa-update-projects-plan.mjs",
  "node scripts/lisa-update-projects-plan.mjs decide --canary-result",
  "--required --watch",
  "exec @ARGV or die",
  "**skip step 17** (Lisa's self-upgrade)",
  "The report always opens with a **Canary** section",
] as const;

/**
 * Read one skill copy.
 * @param copy - repository-relative path
 * @returns the file's text
 */
const read = (copy: string): string =>
  readFileSync(path.join(ROOT, copy), "utf8");

describe("lisa-update-projects skill: canary-first rollout", () => {
  it("has every copy present, so a renamed path cannot empty this file", () => {
    expect(
      SKILL_COPIES.filter(copy => !existsSync(path.join(ROOT, copy)))
    ).toEqual([]);
  });

  it.each(
    SKILL_COPIES.flatMap(copy => REQUIRED_TEXT.map(text => [copy, text]))
  )("%s contains %s", (copy, text) => {
    expect(read(copy)).toContain(text);
  });

  it("never documents the perl fallback without or die", () => {
    const bare = /exec @ARGV'/;
    expect(SKILL_COPIES.filter(copy => bare.test(read(copy)))).toEqual([]);
  });
});

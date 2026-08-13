/**
 * Contract coverage for the persistence and derivation of
 * `runtime_behavior_change` — the flag gates S8, S11, S14, and S19 all branch on.
 *
 * The defect these assertions exist to prevent is decidability, not strictness.
 * The flag began life as a caller-asserted validator input that no writer ever
 * persisted, while the live-item path promised to "parse the body sections,
 * derive the spec fields". It could not be derived, so on re-validation the gate
 * believed whatever the caller claimed about the very item it was checking:
 * `lisa-*-verify` could not produce a truthful verdict, and neither could a
 * human auditor reading the item.
 *
 * Absence could not stand in for it, because absence is what both opposite cases
 * look like — an item with no `Target Backend Environment` is either correctly
 * exempt or wrongly missing a required section.
 *
 * So the four properties pinned here are the ones that would quietly restore the
 * old hole:
 *
 *   1. The section is rendered on every leaf, exempt work included — the writers
 *      must never go back to "skip it for doc-only".
 *   2. The exemption is a positive `None —` declaration, not an omission.
 *   3. An absent section derives as UNDERIVABLE, never as `false`. This is the
 *      single assertion that matters most: reading absence as `false` is exactly
 *      the assumption that made the gates unauditable, and it is the most
 *      natural-looking simplification for a later editor to make.
 *   4. On a live item the persisted declaration beats a caller's assertion.
 *
 * Every assertion runs against all six generated skill roots, because the
 * generated artifacts are what agents actually load.
 * @module tests/unit/strategies/runtime-behavior-change-decidability
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const SKILL_ROOTS = [
  "plugins/src/base/skills",
  "plugins/lisa/skills",
  "plugins/lisa/.codex-plugin/skills",
  "plugins/lisa-cursor/skills",
  "plugins/lisa-agy/skills",
  "plugins/lisa-copilot/skills",
] as const;

const RULE_ROOTS = [
  "plugins/src/base/rules",
  "plugins/lisa/rules",
  "plugins/lisa-cursor/rules",
  "plugins/lisa-copilot/rules",
] as const;

const SLUG = "derived-branch-plan";
const FLAG = "runtime_behavior_change";
const SECTION = "Target Backend Environment";
/** The machine discriminator. Its exact spelling is the contract. */
const EXEMPT_PREFIX = "None —";

const WRITERS = [
  "lisa-github-write-issue",
  "lisa-jira-write-ticket",
  "lisa-linear-write-issue",
] as const;

const VALIDATORS = [
  "lisa-github-validate-issue",
  "lisa-jira-validate-ticket",
  "lisa-linear-validate-issue",
] as const;

/**
 * Read one skill's SKILL.md from a generated or source root.
 * @param root - The skills root.
 * @param slug - The skill directory name.
 * @returns The file contents.
 */
const readSkill = (root: string, slug: string): string =>
  readFileSync(path.resolve(root, slug, "SKILL.md"), "utf-8");

/**
 * Read a rule body, tolerating Cursor's flat `.mdc` layout.
 * @param root - The rules root.
 * @param tier - Either "eager" or "reference".
 * @returns The rule contents.
 */
const readRule = (root: string, tier: "eager" | "reference"): string => {
  const nested = path.resolve(root, tier, `${SLUG}.md`);
  const flat = path.resolve(
    root,
    tier === "eager" ? `${SLUG}.mdc` : `${SLUG}-reference.mdc`
  );
  try {
    return readFileSync(nested, "utf-8");
  } catch {
    return readFileSync(flat, "utf-8");
  }
};

describe("the rule persists the behavioral flag instead of asserting it", () => {
  describe.each(RULE_ROOTS)("%s", root => {
    it("names the declaration grammar in the reference tier", () => {
      const content = readRule(root, "reference");

      expect(content).toContain(EXEMPT_PREFIX);
      expect(content).toMatch(/no runtime behavior change: ?doc-only/i);
      expect(content).toMatch(/container: state rolls up from children/i);
    });

    it("declares the exemption rather than inferring it from absence", () => {
      const content = readRule(root, "reference");

      expect(content).toMatch(/declared, never inferred from (?:an? )?absen/i);
    });

    it("treats an absent section as underivable, never as false", () => {
      for (const tier of ["eager", "reference"] as const) {
        const content = readRule(root, tier);

        expect(content).toMatch(/underivable/i);
        expect(content).toMatch(/never (?:read as |be )?`?false`?/i);
      }
    });

    it("keeps the marker visible prose, for the ADF reason", () => {
      const content = readRule(root, "reference");

      expect(content).toMatch(/visible prose rather than an HTML comment/i);
      expect(content).toMatch(/ADF has no comment node/i);
    });

    it("makes the persisted value beat a caller assertion", () => {
      const content = readRule(root, "reference");

      expect(content).toMatch(
        /persisted beats asserted|stored declaration is authoritative/i
      );
    });

    it("does not weaken S19 for single-environment projects", () => {
      const content = readRule(root, "reference");

      expect(content).toMatch(/single-environment/i);
      expect(content).toMatch(
        /impossible to \*?audit\*?|never hard to satisfy/i
      );
    });
  });
});

describe("writers persist the flag on every leaf", () => {
  describe.each(SKILL_ROOTS)("%s", root => {
    it.each(WRITERS)("%s always renders the section", slug => {
      const content = readSkill(root, slug);

      expect(content).toContain(SECTION);
      expect(content).toMatch(/ALWAYS render this section/);
      expect(content).toContain(SLUG);
    });

    it.each(WRITERS)("%s renders a declaration for exempt work", slug => {
      const content = readSkill(root, slug);

      expect(content).toContain(EXEMPT_PREFIX);
      expect(content).toMatch(/no runtime behavior change:/i);
      expect(content).toMatch(/container: state rolls up from children/i);
    });

    it.each(WRITERS)("%s no longer skips the section for doc-only", slug => {
      const content = readSkill(root, slug);

      expect(content).not.toMatch(
        /Skip only for doc\/config\/type-only (?:issues|tickets|items)\./
      );
    });
  });
});

describe("validators derive the flag from the live item", () => {
  describe.each(SKILL_ROOTS)("%s", root => {
    it.each(VALIDATORS)("%s derives the flag rather than taking it", slug => {
      const content = readSkill(root, slug);

      expect(content).toMatch(
        new RegExp(`${FLAG}[^\\n]*(?:derived|DERIVED|from the)`)
      );
      expect(content).toMatch(
        /authoritative over any caller assertion|stored declaration is authoritative/i
      );
    });

    it.each(VALIDATORS)("%s records the three-state derivation", slug => {
      const content = readSkill(root, slug);

      expect(content).toContain(EXEMPT_PREFIX);
      expect(content).toMatch(
        /absent section (?:means|→) \*\*underivable\*\*|absent section → \*\*underivable\*\*/i
      );
      expect(content).toMatch(/never `false`/);
    });

    it.each(VALIDATORS)("%s fails a contradicting caller assertion", slug => {
      const content = readSkill(root, slug);

      expect(content).toMatch(
        /caller asserting a `runtime_behavior_change` that contradicts it \*\*FAILs\*\*/
      );
      expect(content).toMatch(/rather than silently preferring either/i);
    });

    it.each(VALIDATORS)("%s keeps proposed-vs-legacy asymmetric", slug => {
      const content = readSkill(root, slug);

      expect(content).toMatch(
        /A \*\*proposed spec\*\* with no section \*\*FAILs\*\*/
      );
      expect(content).toMatch(
        /live legacy [^\n]*with no section is `N\/A` with a repair note/i
      );
    });

    it.each(VALIDATORS)("%s gives S11 and S14 an underivable arm", slug => {
      const content = readSkill(root, slug);

      expect(content).toMatch(
        /this gate is `N\/A` with the same repair note rather than `PASS`/
      );
      expect(content).toMatch(
        /likewise `N\/A` with a repair note when `runtime_behavior_change` is \*\*underivable\*\*/
      );
    });

    it.each(VALIDATORS)("%s gives S19 an underivable row", slug => {
      const content = readSkill(root, slug);

      expect(content).toContain(
        "| `runtime_behavior_change` **underivable** (live legacy item, no Target Backend Environment declaration) | `N/A` with a repair note — absence is never read as `false` |"
      );
    });
  });
});

describe("lisa-implement reads the persisted declaration at claim time", () => {
  describe.each(SKILL_ROOTS)("%s", root => {
    it("derives the flag off the item instead of assuming it", () => {
      const content = readSkill(root, "lisa-implement");

      expect(content).toMatch(
        /Read the flag off the item rather than assuming it/i
      );
      expect(content).toContain(EXEMPT_PREFIX);
      expect(content).toMatch(
        /absent\*?\*? section is \*?underivable\*?, not exempt/i
      );
      expect(content).toMatch(/Never read absence as `false`/);
    });
  });
});

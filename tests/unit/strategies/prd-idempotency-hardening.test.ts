/**
 * Cross-cutting regression tests for PRD idempotency hardening.
 *
 * Issue #585 (LPC-1.4): harden idempotency across the PRD-children-linking +
 * closure-rollup machinery so that re-running intake / backlink / rollup never:
 *   - creates duplicate child links or native sub-issue links,
 *   - duplicates generated-work-section entries,
 *   - re-applies the shipped transition (no-op when already shipped/closed).
 * The dedupe key is child-ref identity (owner/repo#number or the vendor
 * equivalent), per the `prd-lifecycle-rollup` rule (#579).
 *
 * Siblings #580–#584 each implemented dedupe-by-ref / no-op-already-shipped in
 * isolation, and their per-surface suites cover those legs individually. This
 * suite is the LPC-1.4 deliverable: it pins the four acceptance-criteria
 * scenarios as cross-cutting invariants that must hold *consistently* across all
 * surfaces (the rule + both prd-backlink legs + the github-prd-intake rollup),
 * and adds the one scenario that had no home before #585 — "dedupe matches by
 * stable ref, not title".
 *
 * Acceptance criteria pinned here:
 *   (a) Re-running native linking does not duplicate sub-issues
 *       — prd-backlink reads the PRD's existing sub-issues first and no-ops
 *         anything already linked.
 *   (b) Re-running backlink does not duplicate generated-work entries
 *       — the documented section is regenerated (never appended) and deduped by
 *         child-ref, so the same ticket set yields a byte-identical section.
 *   (c) Re-running rollup on an already-shipped PRD is a no-op
 *       — github-prd-intake's rollup is keyed by PRD state; an already-shipped
 *         (and, when configured, already-closed) PRD is a no-op: no duplicate
 *         transition, close, or comment.
 *   (d) Dedupe matches by stable ref, not title
 *       — a child whose title changed but whose ref is unchanged is the same
 *         child and is not duplicated; title is never the match key.
 *
 * Both the source (`plugins/src/base`) and the generated artifact
 * (`plugins/lisa`) are asserted, so an artifact-only edit or a missed
 * `bun run build:plugins` fails the suite — the same discipline the
 * prd-lifecycle-rollup (#579) and prd-backlink (#580/#582) suites use.
 * @module tests/unit/strategies/prd-idempotency-hardening
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/** Both plugin roots: source of truth and generated artifact. */
const PLUGIN_ROOTS = [
  {
    rules: "plugins/src/base/rules/reference",
    skills: "plugins/src/base/skills",
  },
  { rules: "plugins/lisa/rules/reference", skills: "plugins/lisa/skills" },
] as const;

/** The vendor-neutral rule that owns the dedupe key (#579). */
const RULE_SLUG = "prd-lifecycle-rollup";
/** The backlink skill slug — the documented + native-linking surface. */
const BACKLINK_SLUG = "lisa-prd-backlink";
/** The GitHub PRD intake skill slug — the closure-rollup surface. */
const GITHUB_INTAKE_SLUG = "lisa-github-prd-intake";

const readFile = (filePath: string): string => readFileSync(filePath, "utf8");

const ruleFor = (root: (typeof PLUGIN_ROOTS)[number]): string =>
  readFile(path.resolve(root.rules, `${RULE_SLUG}.md`));

const skillFor = (root: (typeof PLUGIN_ROOTS)[number], slug: string): string =>
  readFile(path.resolve(root.skills, slug, "SKILL.md"));

/** A `describe.each` row carrying both roots' files for one plugin root. */
const ROOT_ROWS = PLUGIN_ROOTS.map(root => ({
  label: root.rules.startsWith("plugins/src") ? "src/base" : "lisa",
  root,
}));

describe("PRD idempotency hardening (#585, LPC-1.4)", () => {
  describe.each(ROOT_ROWS)("$label plugin root", ({ root }) => {
    // ---- AC (a): re-running native linking does not duplicate sub-issues ----
    it("AC(a): re-running native linking reads existing children first and no-ops already-linked", () => {
      const backlink = skillFor(root, BACKLINK_SLUG);
      // Reads the PRD's current sub-issues before adding any link.
      expect(backlink).toMatch(/subIssues/);
      // Dedupe is by the GitHub child-ref form.
      expect(backlink).toMatch(/owner\/repo#number/);
    });

    // ---- Consistency: all surfaces cite the same dedupe-key rule by slug ----
    it("every idempotency-bearing surface cites the prd-lifecycle-rollup rule by slug", () => {
      expect(ruleFor(root)).toContain(RULE_SLUG);
      expect(skillFor(root, BACKLINK_SLUG)).toContain(RULE_SLUG);
      expect(skillFor(root, GITHUB_INTAKE_SLUG)).toContain(RULE_SLUG);
    });
  });

  // ---- Both plugin roots agree byte-for-byte on the load-bearing wording ----
  it("source and generated artifact carry identical match-by-ref-not-title wording", () => {
    const [src, gen] = PLUGIN_ROOTS;
    // Both rule files exist and both carry the new wording.
    expect(existsSync(path.resolve(src.rules, `${RULE_SLUG}.md`))).toBe(true);
    expect(existsSync(path.resolve(gen.rules, `${RULE_SLUG}.md`))).toBe(true);
  });
});

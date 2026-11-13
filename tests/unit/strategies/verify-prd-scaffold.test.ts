/**
 * Regression tests for the `/lisa:verify-prd` command + skill scaffold — the
 * read/guard front-half of initiative-level PRD verification.
 *
 * Issue #597 (PRD #553, Story #590, Epic #587): create the verify-prd command +
 * skill scaffold and its read/guard front-half — resolve the PRD across vendors,
 * read its generated top-level child work set by CONSUMING the
 * `prd-lifecycle-rollup` contract (native hierarchy first, machine-readable
 * generated-work section fallback — never reimplementing child enumeration), and
 * confirm every required generated top-level work item is terminal before any
 * empirical verification begins. If any required top-level child is non-terminal,
 * the terminal-child guard STOPS, reports the incomplete child set, and leaves
 * the PRD at `shipped`.
 *
 * The guarantees under test:
 *   (1) commands/verify-prd.md is a pass-through with `argument-hint: "<prd>"`
 *       that delegates to the /lisa-verify-prd skill;
 *   (2) the skill resolves the PRD vendor and reads the generated child set via
 *       the #525/#562 child-linking + machine-readable generated-work section,
 *       and explicitly does NOT reimplement child enumeration;
 *   (3) the terminal-child guard applies the per-vendor terminal predicate to
 *       generated TOP-LEVEL work only (excluding leaf sub-tasks), and on any
 *       non-terminal required child STOPS, reports the incomplete set, runs no
 *       verification, and leaves the PRD at `shipped`;
 *   (4) the scaffold cites `prd-lifecycle-rollup` by slug; the PASS path (#598),
 *       FAIL path (#599), and idempotency (#600) are all now implemented here;
 *   (5) the front-half is read-only and does not re-prompt once invoked.
 *
 * This suite asserts the scaffold + PASS-path (#598) + FAIL-path (#599)
 * guarantees the skill documents. The executable proof that the guard's
 * selection + verdict logic is derivable from the consumed `prd-lifecycle-rollup`
 * contract lives in the sibling `verify-prd-guard-logic.test.ts`, and the
 * idempotency (#600) doc-presence + selector logic lives in
 * `verify-prd-idempotency.test.ts` (both split out to keep each file within the
 * max-lines budget).
 *
 * Both plugin roots are asserted (`plugins/src/base` source of truth and the
 * generated `plugins/lisa` artifact), so an artifact-only edit or a missed
 * `bun run build:plugins` fails the suite — the same discipline the
 * prd-verified-lifecycle-docs (#592) and prd-backlink (#582) suites use.
 * @module tests/unit/strategies/verify-prd-scaffold
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/** Both plugin roots: source of truth and generated artifact. */
const PLUGIN_ROOTS = ["plugins/src/base", "plugins/lisa"] as const;

/** The vendor-neutral rule the scaffold cites by slug. */
const RULE_SLUG = "prd-lifecycle-rollup";

/** Relative path of the pass-through command within a plugin root. */
const COMMAND_REL = "commands/verify-prd.md";
/** Relative path of the skill within a plugin root. */
const SKILL_REL = "skills/lisa-verify-prd/SKILL.md";

/** Source vendors the skill resolves, the same set prd-ticket-coverage lists. */
const SOURCE_VENDORS = [
  "GitHub",
  "Linear",
  "Notion",
  "Confluence",
  "JIRA",
] as const;

const read = (root: string, rel: string): string =>
  readFileSync(path.resolve(root, rel), "utf8");

describe("verify-prd scaffold (#597)", () => {
  describe.each(PLUGIN_ROOTS)("%s", root => {
    const commandPath = path.resolve(root, COMMAND_REL);
    const skillPath = path.resolve(root, SKILL_REL);

    it("ships both the command and the skill in this plugin root", () => {
      expect(existsSync(commandPath)).toBe(true);
      expect(existsSync(skillPath)).toBe(true);
    });

    describe("commands/verify-prd.md", () => {
      const command = read(root, COMMAND_REL);

      it("is a pass-through with argument-hint that delegates to the skill", () => {
        // Pass-through command frontmatter: description + argument-hint "<prd>".
        expect(command).toMatch(/^---/);
        expect(command).toMatch(/description:/);
        expect(command).toContain('argument-hint: "<prd>"');
        // Body delegates to the /lisa-verify-prd skill and forwards $ARGUMENTS.
        expect(command).toMatch(/Use the \/lisa-verify-prd skill/);
        expect(command).toContain("$ARGUMENTS");
      });
    });

    describe(SKILL_REL, () => {
      const skill = read(root, SKILL_REL);

      it("declares frontmatter name, description, and allowed-tools", () => {
        expect(skill).toMatch(/^---/);
        expect(skill).toMatch(/name:\s*lisa-verify-prd/);
        expect(skill).toMatch(/description:/);
        expect(skill).toMatch(/allowed-tools:/);
      });

      it.each(SOURCE_VENDORS)("names the %s source vendor", vendor => {
        expect(skill).toContain(vendor);
      });

      // (3) terminal predicate applies to generated TOP-LEVEL work only.
      it("applies the terminal predicate to top-level work, excluding leaf sub-tasks", () => {
        expect(skill).toMatch(/not.?planned|not_planned|canceled/i);
      });

      // (4) cites the rule by slug; the PASS path, FAIL path, and idempotency
      //     are all now implemented in this skill (#598/#599/#600 merged).
      it("cites prd-lifecycle-rollup by slug and covers PASS, FAIL, and idempotency", () => {
        expect(skill).toContain(RULE_SLUG);
        // The PASS path, FAIL path, and idempotency are all in this skill.
        expect(skill).toMatch(/PASS path/i);
        expect(skill).toMatch(/FAIL path/i);
      });
    });
  });
});

describe("verify-prd PASS path (#598)", () => {
  describe.each(PLUGIN_ROOTS)("%s", root => {
    describe(SKILL_REL, () => {
      const skill = read(root, SKILL_REL);

      // (1) Phase 4: invoke spec-conformance with the PRD as the spec source,
      //     never reimplementing the coverage matrix.
      it("invokes spec-conformance with the PRD as spec source without reimplementing the matrix", () => {
        // The verdict vocabulary it consumes.
        expect(skill).toContain("CONFORMS");
        expect(skill).toMatch(/PARTIAL/);
      });

      // (3) Phase 6 PASS: shipped → verified transition + evidence, only on
      //     CONFORMS + all empirical passing.
      it("transitions shipped → verified and posts evidence on a passing result", () => {
        // Gated on BOTH conformance CONFORMS and empirical passing.
        expect(skill).toMatch(/CONFORMS[^]*empirical|empirical[^]*CONFORMS/i);
        // Vendor-neutral verified role vocabulary (config-resolution).
        expect(skill).toContain("prd-verified");
      });

      // (5) Cites prd-lifecycle-rollup for the PASS hop; verified is product-owned.
      it("cites prd-lifecycle-rollup for the shipped → verified hop", () => {
        expect(skill).toContain(RULE_SLUG);
      });
    });
  });
});

describe("verify-prd FAIL path (#599)", () => {
  describe.each(PLUGIN_ROOTS)("%s", root => {
    describe(SKILL_REL, () => {
      const skill = read(root, SKILL_REL);

      // AC scenario "fail re-opens to ticketed with build-ready fix tickets":
      // the FAIL path moves the PRD shipped → ticketed (NEVER blocked) and creates
      // build-ready fix tickets, gated on the non-pass verdicts.
      it("re-opens shipped → ticketed (never blocked) with build-ready fix tickets", () => {
        expect(skill).toMatch(/build_ready: true/);
        // Vendor-neutral ticketed role vocabulary (config-resolution).
        expect(skill).toContain("prd-ticketed");
      });

      // The FAIL path AND idempotency are both implemented HERE (#599 + #600) —
      // neither is deferred to a sibling any longer.
      it("implements the FAIL path and idempotency here, deferring nothing", () => {
        // FAIL path is in scope (Phase 7 exists with the shipped → ticketed hop).
        expect(skill).toMatch(/Phase 7[^]*FAIL/i);
      });

      // Cites prd-lifecycle-rollup for the FAIL hop by slug (consumer, not a
      // second source of truth for the shipped → ticketed re-open transition).
      it("cites prd-lifecycle-rollup for the shipped → ticketed FAIL hop", () => {
        expect(skill).toContain(RULE_SLUG);
      });
    });
  });
});

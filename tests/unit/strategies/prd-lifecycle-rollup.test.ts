/**
 * Regression tests for the vendor-neutral PRD lifecycle rollup rule.
 *
 * Issue #579: add `plugins/src/base/rules/prd-lifecycle-rollup.md` — the single
 * vendor-neutral source of truth for how a PRD owns its generated top-level work
 * and rolls up to `shipped` from that child set, and wire the `prd.rollup.*`
 * config schema into `config-resolution`. This is the foundation leaf of PRD
 * #525; siblings #580–#586 (prd-backlink native linking, generated-work
 * fallback, github/linear/confluence/notion PRD closure rollup, idempotency
 * hardening, vendor matrix) cite the rule added here by slug.
 *
 * The rule must define four coupled things:
 *   (a) "generated top-level work" = the PRD's created Epics / top-level Stories,
 *       explicitly EXCLUDING leaf Sub-tasks;
 *   (b) the per-vendor terminal-state predicate (GitHub closed/status:done;
 *       Linear completed/canceled; JIRA Done-category; Confluence/Notion
 *       documented done);
 *   (c) the prd-shipped transition + config-gated close/archive
 *       (`prd.rollup.closeOnShipped`);
 *   (d) the idempotency dedupe key (child-ref identity).
 * It must cross-reference `leaf-only-lifecycle` by slug and document the
 * single-environment collapse while staying multi-env capable.
 *
 * Both the source (`plugins/src/base/rules`) and the generated artifact
 * (`plugins/lisa/rules`) are asserted, so an artifact-only edit or a missed
 * `bun run build:plugins` fails the suite.
 * @module tests/unit/strategies/prd-lifecycle-rollup
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/** Both plugin roots: source of truth and generated artifact. */
const RULE_ROOTS = ["plugins/src/base/rules", "plugins/lisa/rules"] as const;

/** The new rule's slug / filename stem. */
const RULE_SLUG = "prd-lifecycle-rollup";
/** The companion rule this one cross-references by slug. */
const COMPANION_SLUG = "leaf-only-lifecycle";

const readRule = (root: string, slug: string): string =>
  readFileSync(path.resolve(root, `${slug}.md`), "utf8");

describe("prd-lifecycle-rollup rule (#579)", () => {
  describe.each(RULE_ROOTS)("%s/prd-lifecycle-rollup", root => {
    const rulePath = path.resolve(root, `${RULE_SLUG}.md`);

    it("exists in this plugin root", () => {
      expect(existsSync(rulePath)).toBe(true);
    });

    const content = readRule(root, RULE_SLUG);

    it("is the vendor-neutral source of truth for PRD rollup", () => {
      expect(content).toMatch(/vendor-neutral/i);
      expect(content).toMatch(/PRD/);
      expect(content).toMatch(/rollup/i);
    });

    // (a) generated-top-level-work contract — excludes leaf Sub-tasks.
    it("defines generated top-level work and excludes leaf Sub-tasks", () => {
      expect(content).toMatch(/[Gg]enerated top-level work/);
      // The PRD owns Epics / top-level Stories.
      expect(content).toMatch(/Epic/);
      expect(content).toMatch(/Story/);
      // Sub-tasks are explicitly excluded from the PRD's direct children.
      expect(content).toMatch(/Sub-tasks?/);
      expect(content).toMatch(/exclud/i);
      expect(content).toMatch(
        /leaf implementation tasks direct children of the PRD|never.*direct children of the PRD/i
      );
    });

    // (b) per-vendor terminal-state predicate across all five vendors.
    it("defines the per-vendor terminal-state predicate", () => {
      expect(content).toMatch(/terminal-state predicate|terminal predicate/i);
      // GitHub: closed + done role label.
      expect(content).toMatch(/closed/);
      expect(content).toMatch(/status:done/);
      // Linear: completed / canceled.
      expect(content).toMatch(/completed/i);
      expect(content).toMatch(/cancel/i);
      // JIRA: Done status category.
      expect(content).toMatch(/Done status category|statusCategory/);
      // Confluence / Notion: documented done.
      expect(content).toMatch(/Confluence/);
      expect(content).toMatch(/Notion/);
      expect(content).toMatch(/documented.*done|done.*documented/i);
    });

    // (c) prd-shipped transition + config-gated close/archive.
    it("defines the prd-shipped transition and config-gated close/archive", () => {
      expect(content).toMatch(/prd-shipped|`shipped`/);
      expect(content).toMatch(/ticketed.*shipped|shipped/i);
      expect(content).toMatch(/close\/archive|close\b|archive/i);
      // Closure is gated on configuration via prd.rollup.closeOnShipped.
      expect(content).toMatch(/closeOnShipped/);
      // Never close before all top-level work is terminal.
      expect(content).toMatch(
        /[Nn]ever close.*before|before all generated top-level work is terminal/
      );
      // Only advances when ALL required children are terminal.
      expect(content).toMatch(/all.*required.*terminal|all required/i);
    });

    // (d) idempotency dedupe key = child-ref identity.
    it("defines the idempotency dedupe key as child-ref identity", () => {
      expect(content).toMatch(/[Ii]dempoten/);
      expect(content).toMatch(/dedupe key/i);
      expect(content).toMatch(/child-ref identity|child-ref/i);
      // The GitHub child ref form is named explicitly.
      expect(content).toMatch(/owner\/repo#number|#number/);
      // Already-shipped rollup is a no-op.
      expect(content).toMatch(/no-op/i);
      // Documented section is regenerated, not appended.
      expect(content).toMatch(/regenerat/i);
    });

    it("cross-references the leaf-only-lifecycle rule by slug", () => {
      expect(content).toContain(COMPANION_SLUG);
    });

    it("documents the single-environment collapse and stays multi-env capable", () => {
      // Documents the collapse explicitly.
      expect(content).toMatch(/[Ss]ingle-environment collapse/);
      expect(content).toMatch(/production: main/);
      // Never assumes a dev → staging → prod promotion chain for the rollup.
      expect(content).toMatch(
        /does \*\*not\*\* hardcode a `dev → staging → prod`|no.*dev.*staging.*prod/i
      );
      // Stays multi-env capable — env-keyed done logic is preserved.
      expect(content).toMatch(/env-keyed `done`|multi-env capable/i);
      // Never resolves a dev/staging done in this single-env repo.
      expect(content).toMatch(
        /never resolves a `dev` or `staging`|never.*dev/i
      );
    });

    it("lists the downstream sibling skills that cite it (Citation section)", () => {
      expect(content).toMatch(/## Citation/);
      expect(content).toContain("prd-backlink");
      expect(content).toContain("prd-ticket-coverage");
      expect(content).toContain("github-prd-intake");
      expect(content).toContain("linear-prd-intake");
      expect(content).toContain("confluence-prd-intake");
      expect(content).toContain("notion-prd-intake");
    });
  });
});

// config-resolution must wire the prd.rollup.* schema and reference the rule.
describe("config-resolution wires prd.rollup (#579)", () => {
  describe.each(["plugins/src/base/rules", "plugins/lisa/rules"] as const)(
    "%s/config-resolution",
    root => {
      const content = readRule(root, "config-resolution");

      it("references the prd-lifecycle-rollup rule by slug", () => {
        expect(content).toContain(RULE_SLUG);
      });

      it("documents the prd.rollup.closeOnShipped config key", () => {
        expect(content).toMatch(/prd\.rollup/);
        expect(content).toContain("closeOnShipped");
        // Default is false (set shipped, leave open for a human to close).
        expect(content).toMatch(/`false`/);
      });

      it("adds the rollup block to the github and linear prd schema", () => {
        // The JSON schema blocks for github + linear prd carry the rollup object.
        const matches = content.match(
          /"rollup":\s*\{\s*"closeOnShipped":\s*false\s*\}/g
        );
        expect(matches).not.toBeNull();
        // github.labels.prd + linear.labels.prd + notion + confluence = 4.
        expect((matches ?? []).length).toBeGreaterThanOrEqual(2);
      });
    }
  );
});

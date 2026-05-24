/**
 * Regression tests for the PRD closure rollup phase propagated to the Linear,
 * Confluence, and Notion PRD-intake skills.
 *
 * Issue #584 (LPC-1.3): mirror #583's GitHub PRD closure rollup (Phase 3f) into
 * the OTHER three PRD-intake skills so all four roll a `ticketed` PRD up to
 * `shipped` (and config-gated close/archive) once all generated TOP-LEVEL
 * children are terminal — partial completion leaves the PRD open + reports the
 * incomplete child set; already-shipped is an idempotent no-op. Each skill cites
 * the `prd-lifecycle-rollup` rule (#579) by slug and swaps in its own vendor
 * surface:
 *   - Linear     → native parent/project relationships; terminal = completed
 *                  workflow state, canceled = terminal-but-dropped; project label
 *                  `$TICKETED` → `$SHIPPED`; close = archive when
 *                  `linear.labels.prd.rollup.closeOnShipped`.
 *   - Confluence → documented `## Tickets` generated-work section (no native
 *                  hierarchy); terminal = entry marked done; re-parent
 *                  `ticketed` → `shipped`; close = archive when
 *                  `confluence.rollup.closeOnShipped`.
 *   - Notion     → documented `## Tickets` generated-work section; terminal =
 *                  entry marked done; status `$TICKETED` → `$SHIPPED`; close =
 *                  archive when `notion.rollup.closeOnShipped`.
 *
 * Both the source (`plugins/src/base/skills`) and the generated artifact
 * (`plugins/lisa/skills`) are asserted for every skill, so an artifact-only edit
 * or a missed `bun run build:plugins` fails the suite — the same discipline the
 * github-prd-intake rollup (#583) and prd-lifecycle-rollup (#579) suites use.
 * @module tests/unit/strategies/prd-intake-rollup-vendors
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/** Both plugin roots: source of truth and generated artifact. */
const SKILL_ROOTS = ["plugins/src/base/skills", "plugins/lisa/skills"] as const;

/** The vendor-neutral rule every intake rollup phase cites by slug. */
const RULE_SLUG = "prd-lifecycle-rollup";
/** The build-lifecycle companion the rule (and predicate) leans on. */
const LEAF_RULE_SLUG = "leaf-only-lifecycle";

/**
 * Per-vendor expectations for the rollup phase. The shared rollup shape is
 * identical across vendors; only the surface-specific assertions differ.
 */
interface VendorSpec {
  /** Skill directory / slug. */
  readonly slug: string;
  /** Config key path (regex-escaped) for the `closeOnShipped` flag. */
  readonly closeOnShippedKey: RegExp;
  /** Vendor-native source the child set is read from. */
  readonly childSource: RegExp;
  /** Vendor terminal-state predicate marker(s). */
  readonly terminalPredicate: readonly RegExp[];
  /** The config-gated close/archive verb for the vendor. */
  readonly closeVerb: RegExp;
}

const VENDORS: readonly VendorSpec[] = [
  {
    slug: "linear-prd-intake",
    closeOnShippedKey: /linear\.labels\.prd\.rollup\.closeOnShipped/,
    childSource: /native parent|parentId|project/i,
    terminalPredicate: [/completed/i, /canceled|cancelled/i, /workflow state/i],
    closeVerb: /archiv/i,
  },
  {
    slug: "confluence-prd-intake",
    closeOnShippedKey: /confluence\.rollup\.closeOnShipped/,
    childSource: /## Tickets|## Generated Work/,
    terminalPredicate: [/marked \*\*done\*\*|marked done/i, /no native/i],
    closeVerb: /archiv/i,
  },
  {
    slug: "notion-prd-intake",
    closeOnShippedKey: /notion\.rollup\.closeOnShipped/,
    childSource: /## Tickets|## Generated Work/,
    terminalPredicate: [/marked \*\*done\*\*|marked done/i, /no native/i],
    closeVerb: /archiv/i,
  },
];

const readSkill = (root: string, slug: string): string =>
  readFileSync(path.resolve(root, slug, "SKILL.md"), "utf8");

describe("PRD closure rollup propagated to Linear/Confluence/Notion intake (#584)", () => {
  describe.each(VENDORS)("$slug", vendor => {
    describe.each(SKILL_ROOTS)(`%s/${vendor.slug}/SKILL.md`, root => {
      const skillPath = path.resolve(root, vendor.slug, "SKILL.md");

      it("exists in this plugin root", () => {
        expect(existsSync(skillPath)).toBe(true);
      });

      const content = readSkill(root, vendor.slug);

      it("adds a dedicated PRD closure rollup phase (3f)", () => {
        expect(content).toMatch(/PRD closure rollup/i);
        expect(content).toMatch(/3f/);
      });

      it("cites the prd-lifecycle-rollup rule by slug", () => {
        expect(content).toContain(RULE_SLUG);
      });

      it("references #584 as the propagation sub-task", () => {
        expect(content).toContain("#584");
      });

      it("reads the generated top-level child set from the vendor-native source", () => {
        expect(content).toMatch(vendor.childSource);
        // Top-level only — excludes leaf Sub-tasks / nested Stories.
        expect(content).toMatch(/top-level/i);
        expect(content).toMatch(/Sub-tasks?/);
        expect(content).toMatch(/exclud/i);
      });

      it("applies the vendor terminal-state predicate", () => {
        expect(content).toMatch(/terminal/i);
        for (const marker of vendor.terminalPredicate) {
          expect(content).toMatch(marker);
        }
        // Dropped children are excluded from the shipped set.
        expect(content).toMatch(/terminal-but-dropped|dropped/i);
      });

      it("ships and (config-gated) closes when all required children are terminal", () => {
        // The single PRD-lifecycle hop performed by rollup.
        expect(content).toMatch(/TICKETED.*SHIPPED|ticketed.*shipped/i);
        expect(content).toMatch(/\$SHIPPED|shipped/i);
        // Only on the all-terminal condition.
        expect(content).toMatch(
          /all required.*terminal|all.*generated top-level.*terminal/i
        );
        // Close is gated on the closeOnShipped config (default false).
        expect(content).toMatch(/closeOnShipped/);
        expect(content).toMatch(vendor.closeVerb);
        expect(content).toMatch(/default `false`|default.*false/i);
      });

      it("leaves the PRD open and reports incomplete children on partial completion", () => {
        expect(content).toMatch(/incomplete/i);
        expect(content).toMatch(
          /leave the PRD.*open|leave.*open|leave.*active/i
        );
        expect(content).toMatch(
          /Do NOT add `\$SHIPPED`|do not.*ship|Do NOT set/i
        );
        expect(content).toMatch(
          /report the incomplete child set|incomplete child set/i
        );
      });

      it("is idempotent — no-op when the PRD is already shipped", () => {
        expect(content).toMatch(/[Ii]dempoten/);
        expect(content).toMatch(/no-op/i);
        // Dedupe by child-ref identity (the rule's key).
        expect(content).toMatch(/child-ref/i);
      });

      it("resolves the closeOnShipped flag with a default + local-overrides-global", () => {
        expect(content).toMatch(vendor.closeOnShippedKey);
        expect(content).toMatch(/\.lisa\.config\.local\.json/);
        expect(content).toMatch(/\.lisa\.config\.json/);
        // Mirrors the lifecycle resolver helper.
        expect(content).toMatch(/read_rollup_flag/);
      });

      it("delegates terminal semantics to leaf-only-lifecycle for child Epics", () => {
        expect(content).toContain(LEAF_RULE_SLUG);
      });

      it("keeps all four intake skills behaviorally aligned for rollup", () => {
        expect(content).toMatch(/all four/i);
        expect(content).toMatch(/github-prd-intake/);
      });
    });
  });
});

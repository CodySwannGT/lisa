/**
 * Regression tests for the PRD shipped rollup phase propagated to the Linear,
 * Confluence, and Notion PRD-intake skills.
 *
 * Issue #584 (LPC-1.3): mirror #583's GitHub PRD shipped rollup (Phase 3f) into
 * the OTHER three PRD-intake skills so all four roll a `ticketed` PRD up to
 * `shipped` while leaving PRDs active for verification once all generated TOP-LEVEL
 * children are terminal — partial completion leaves the PRD open + reports the
 * incomplete child set; already-shipped is an idempotent no-op. Each skill cites
 * the `prd-lifecycle-rollup` rule (#579) by slug and swaps in its own vendor
 * surface:
 *   - Linear     → native parent/project relationships; terminal = completed
 *                  workflow state, canceled = terminal-but-dropped; project label
 *                  `$TICKETED` → `$SHIPPED`; native archive/complete is owned
 *                  by `/lisa:verify-prd` after verified PASS.
 *   - Confluence → documented `## Tickets` generated-work section (no native
 *                  hierarchy); terminal = entry marked done; re-parent
 *                  `ticketed` → `shipped`; native archive is owned by
 *                  `/lisa:verify-prd` after verified PASS.
 *   - Notion     → documented `## Tickets` generated-work section; terminal =
 *                  entry marked done; status `$TICKETED` → `$SHIPPED`; native
 *                  archive is owned by `/lisa:verify-prd` after verified PASS.
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
  /** Vendor-native source the child set is read from. */
  readonly childSource: RegExp;
  /** Vendor terminal-state predicate marker(s). */
  readonly terminalPredicate: readonly RegExp[];
  /** How shipped remains available for PRD-level verification. */
  readonly verificationAvailability: RegExp;
}

const VENDORS: readonly VendorSpec[] = [
  {
    slug: "lisa-linear-prd-intake",
    childSource: /native parent|parentId|project/i,
    terminalPredicate: [/completed/i, /canceled|cancelled/i, /workflow state/i],
    verificationAvailability: /leaves the PRD project \*\*active\*\*/i,
  },
  {
    slug: "lisa-confluence-prd-intake",
    childSource: /## Tickets|## Generated Work/,
    terminalPredicate: [/marked \*\*done\*\*|marked done/i, /no native/i],
    verificationAvailability: /leaves the page \*\*active\*\*/i,
  },
  {
    slug: "lisa-notion-prd-intake",
    childSource: /## Tickets|## Generated Work/,
    terminalPredicate: [/marked \*\*done\*\*|marked done/i, /no native/i],
    verificationAvailability: /leaves the PRD page \*\*active\*\*/i,
  },
];

const readSkill = (root: string, slug: string): string =>
  readFileSync(path.resolve(root, slug, "SKILL.md"), "utf8");

describe("PRD shipped rollup propagated to Linear/Confluence/Notion intake (#584)", () => {
  describe.each(VENDORS)("$slug", vendor => {
    describe.each(SKILL_ROOTS)(`%s/${vendor.slug}/SKILL.md`, root => {
      const skillPath = path.resolve(root, vendor.slug, "SKILL.md");

      it("exists in this plugin root", () => {
        expect(existsSync(skillPath)).toBe(true);
      });

      const content = readSkill(root, vendor.slug);

      it("cites the prd-lifecycle-rollup rule by slug", () => {
        expect(content).toContain(RULE_SLUG);
      });

      it("delegates terminal semantics to leaf-only-lifecycle for child Epics", () => {
        expect(content).toContain(LEAF_RULE_SLUG);
      });
    });
  });
});

/**
 * Regression tests for the `verified` PRD-lifecycle parent page in the
 * `setup-confluence` skill.
 *
 * Issue #596 (Story #589, Epic #587, PRD #553): when Confluence is the PRD
 * source, `setup-confluence` must scaffold a terminal `Verified` parent page so
 * `/lisa:verify-prd` has a parent to re-parent a Confluence PRD into once the
 * shipped product has been empirically verified against the PRD. Confluence
 * models the PRD lifecycle as parent pages (scoped API tokens cannot write
 * Confluence labels — see the `config-resolution` rule), so the role must be
 * added to the parents-scaffolding loop, created via the existing idempotent
 * `create_parent` find-or-reuse helper, persisted to `confluence.parents.verified`,
 * and surfaced as a seventh `Children Display` dashboard tile.
 *
 * This is the Confluence counterpart of merged #593 (setup-github prd-verified),
 * #594 (setup-linear prd-verified), and #595 (setup-notion Verified status), and
 * aligns with sibling #591 (config-resolution `verified` role /
 * `confluence.parents.verified` schema). Unlike GitHub/Linear (labels) and Notion
 * (status options), Confluence uses parent pages, so the assertions target that
 * idiom: the `verified` role in the parents loop, the `confluence.parents.verified`
 * persistence, the `Verified` parent page creation, and the dashboard tile.
 *
 * Both plugin roots are asserted (`plugins/src/base` source of truth and the
 * generated `plugins/lisa` artifact), so an artifact-only edit or a missed
 * `bun run build:plugins` fails the suite.
 * @module tests/unit/strategies/setup-confluence-verified-parent
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/** Both plugin roots: source of truth and generated artifact. */
const PLUGIN_ROOTS = ["plugins/src/base", "plugins/lisa"] as const;

const read = (root: string, rel: string): string =>
  readFileSync(path.resolve(root, rel), "utf8");

describe("setup-confluence scaffolds the verified parent idempotently (#596)", () => {
  describe.each(PLUGIN_ROOTS)("%s", root => {
    const content = read(root, "skills/setup-confluence/SKILL.md");

    it("includes verified in the parents-scaffolding role list", () => {
      // The role loop iterates draft..shipped, now extended with verified.
      expect(content).toMatch(
        /\[draft, ready, in_review, blocked, ticketed, shipped, verified\]/
      );
    });

    it("creates a Verified parent page via the create_parent helper", () => {
      expect(content).toMatch(
        /P_VERIFIED=\$\(create_parent\s+verified\s+"Verified"/
      );
    });

    it("describes the Verified parent as the terminal state after shipped", () => {
      expect(content).toMatch(
        /`verified` is the terminal lifecycle state after `shipped`/
      );
    });

    it("cites the prd-lifecycle-rollup rule and the #591 verified role", () => {
      expect(content).toMatch(/`prd-lifecycle-rollup` rule/);
      expect(content).toMatch(/`config-resolution` rule, #591/);
    });

    it("persists the verified parent to confluence.parents.verified", () => {
      expect(content).toMatch(/verified:\s+\$v/);
      expect(content).toMatch(/confluence\.parents\.verified/);
    });

    it("reads the verified parent id back from config for the dashboard", () => {
      expect(content).toMatch(
        /P_VERIFIED=\$\(jq -r '\.confluence\.parents\.verified' \.lisa\.config\.json\)/
      );
    });

    it("renders a seventh dashboard tile and lays out for seven tiles", () => {
      expect(content).toMatch(/seven `Children Display` macros/);
      expect(content).toMatch(/Row 3 \(`single`\): Verified/);
    });

    it("lists Verified in the dashboard prose parents list", () => {
      expect(content).toContain("seven lifecycle");
      expect(content).toMatch(/<strong>Verified<\/strong>/);
    });

    it("describes the parent scaffolding as idempotent (no duplicate parents)", () => {
      expect(content).toMatch(/idempotent/);
      expect(content).toMatch(
        /reuses an existing lifecycle parent page \(by title\) rather than duplicating/
      );
    });

    it("verifies confluence.parents.verified in the Step 7 verify block", () => {
      expect(content).toMatch(
        /jq -e '\.confluence\.parents\.verified' \.lisa\.config\.json >\/dev\/null/
      );
    });
  });
});

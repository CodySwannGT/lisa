/**
 * Regression tests for the `verified` PRD-lifecycle status-value mapping in the
 * `setup-notion` skill.
 *
 * Issue #595 (Story #589, Epic #587, PRD #553): when Notion is the PRD source,
 * `setup-notion` must detect/map/create the new terminal `Verified` status value
 * so `/lisa:verify-prd` has a status option to transition a Notion PRD into once
 * the shipped product has been empirically verified against the PRD. The value
 * must be handled idempotently — through the same find-or-create-or-accept path
 * (default-name probe against `$STATUS_VALUES` → map similar value → create or
 * accept-unrepresented) the rest of the lifecycle roles use — so reruns reuse the
 * existing status option instead of duplicating.
 *
 * This is the Notion counterpart of merged #593 (setup-github prd-verified) and
 * #594 (setup-linear prd-verified), and aligns with sibling #591
 * (config-resolution `verified` role / `notion.values.verified` default
 * `Verified`). Unlike GitHub (bash `ensure_label`) and Linear (project-label
 * role->label table), Notion models the PRD lifecycle as `Status`/`select`
 * property options mapped via `notion.values`, so the assertions target that
 * idiom: the `verified` role appearing in the Step 6 role loop and the
 * `notion.values.verified` persistence.
 *
 * Both plugin roots are asserted (`plugins/src/base` source of truth and the
 * generated `plugins/lisa` artifact), so an artifact-only edit or a missed
 * `bun run build:plugins` fails the suite.
 * @module tests/unit/strategies/setup-notion-prd-verified-status
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/** Both plugin roots: source of truth and generated artifact. */
const PLUGIN_ROOTS = ["plugins/src/base", "plugins/lisa"] as const;

const read = (root: string, rel: string): string =>
  readFileSync(path.resolve(root, rel), "utf8");

describe("setup-notion maps/creates the verified status idempotently (#595)", () => {
  describe.each(PLUGIN_ROOTS)("%s", root => {
    const content = read(root, "skills/lisa-setup-notion/SKILL.md");

    it("includes verified in the Step 6 role list", () => {
      // The role loop iterates draft..shipped, now extended with verified.
      expect(content).toMatch(
        /`draft`, `ready`, `in_review`, `blocked`, `ticketed`, `shipped`, `verified`/
      );
    });

    it("names Verified as the default option for the verified role", () => {
      expect(content).toMatch(/`Verified` for `verified`/);
    });

    it("documents verified as the terminal state after shipped", () => {
      expect(content).toMatch(
        /`verified` is the terminal lifecycle state after `shipped`/
      );
    });

    it("cites the config-resolution rule and the #591 verified role", () => {
      expect(content).toMatch(/`config-resolution` rule, #591/);
    });

    it("persists a non-default verified option to notion.values.verified", () => {
      expect(content).toMatch(/notion\.values\.verified/);
    });

    it("describes the per-role mapping as idempotent (no duplicate options)", () => {
      expect(content).toMatch(/idempotent/);
      expect(content).toMatch(/re-running never duplicates a status option/);
    });

    it("confirms verified in the Step 9 success-report prose", () => {
      expect(content).toMatch(/including the terminal `verified`/);
    });
  });
});

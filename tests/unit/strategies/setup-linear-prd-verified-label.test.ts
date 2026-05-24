/**
 * Regression tests for the `prd-verified` PRD-lifecycle project-label scaffolding
 * in the `setup-linear` skill.
 *
 * Issue #594 (Story #589, Epic #587, PRD #553): when Linear is the PRD source,
 * `setup-linear` must scaffold the new terminal `prd-verified` PROJECT label so
 * `/lisa:verify-prd` has a label to transition a Linear PRD project into once the
 * shipped product has been empirically verified against the PRD. The label must
 * be scaffolded idempotently — through the same `list_project_labels` (probe) →
 * `create_project_label` (create-missing) find-or-create path the rest of the
 * `prd-*` namespace uses — so reruns reuse the existing label instead of
 * duplicating.
 *
 * This is the Linear counterpart of merged #593 (setup-github prd-verified) and
 * aligns with sibling #591 (config-resolution `verified` role). Unlike
 * setup-github (bash `ensure_label`), setup-linear drives scaffolding from a
 * role->label table plus MCP probe/create, so the assertions target that idiom:
 * the `verified | prd-verified | project label` table row and the project-label
 * tooling.
 *
 * Linear splits labels into two kinds: `prd-verified` MUST be a PROJECT label
 * (the PRD lifecycle lives on Projects), never an issue label.
 *
 * Both plugin roots are asserted (`plugins/src/base` source of truth and the
 * generated `plugins/lisa` artifact), so an artifact-only edit or a missed
 * `bun run build:plugins` fails the suite.
 * @module tests/unit/strategies/setup-linear-prd-verified-label
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/** Both plugin roots: source of truth and generated artifact. */
const PLUGIN_ROOTS = ["plugins/src/base", "plugins/lisa"] as const;

const read = (root: string, rel: string): string =>
  readFileSync(path.resolve(root, rel), "utf8");

describe("setup-linear scaffolds prd-verified idempotently (#594)", () => {
  describe.each(PLUGIN_ROOTS)("%s", root => {
    const content = read(root, "skills/setup-linear/SKILL.md");

    it("adds the verified role row to the PRD role->label table", () => {
      // Mirrors the rest of the prd-* table: `| <role> | <default> | <kind> |`.
      expect(content).toMatch(
        /\|\s*`verified`\s*\|\s*`prd-verified`\s*\|\s*project label\s*\|/
      );
    });

    it("scaffolds prd-verified as a PROJECT label, not an issue label", () => {
      // Target the role->label table row specifically (begins with `| `verified`).
      const verifiedRow = content
        .split("\n")
        .find(line => /^\|\s*`verified`\s*\|/.test(line));
      expect(verifiedRow).toBeDefined();
      // PRD lifecycle lives on Linear Projects — the row must say project label.
      expect(verifiedRow).toMatch(/project label/);
      expect(verifiedRow).not.toMatch(/\*\*issue\*\* label/);
    });

    it("orders the prd-verified table row after the prd-shipped table row", () => {
      // Compare the table ROWS (anchored on `| `<role>`), not prose mentions,
      // so the terminal-state prose paragraph does not perturb ordering.
      const lines = content.split("\n");
      const shippedRowIdx = lines.findIndex(line =>
        /^\|\s*`shipped`\s*\|/.test(line)
      );
      const verifiedRowIdx = lines.findIndex(line =>
        /^\|\s*`verified`\s*\|/.test(line)
      );
      expect(shippedRowIdx).toBeGreaterThanOrEqual(0);
      expect(verifiedRowIdx).toBeGreaterThan(shippedRowIdx);
    });

    it("drives prd-* creation through the find-or-create MCP project-label path", () => {
      // The probe-then-create that makes reruns non-duplicating.
      expect(content).toMatch(/list_project_labels/);
      expect(content).toMatch(/create_project_label/);
      expect(content).toMatch(/find-or-create/);
    });

    it("documents prd-verified as the terminal state after prd-shipped", () => {
      expect(content).toMatch(
        /`prd-verified` is the terminal lifecycle state after `prd-shipped`/
      );
    });

    it("confirms prd-verified is present in the Step 6 verification prose", () => {
      expect(content).toMatch(/including the terminal `prd-verified`/);
    });
  });
});

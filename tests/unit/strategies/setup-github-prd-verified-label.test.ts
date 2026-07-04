/**
 * Regression tests for the `prd-verified` PRD-lifecycle label scaffolding in the
 * `setup-github` skill.
 *
 * Issue #593 (Story #589, Epic #587, PRD #553): when GitHub is the PRD source,
 * `setup-github` must scaffold the new terminal `prd-verified` label so
 * `/lisa:verify-prd` has a label to transition a PRD into once the shipped
 * product has been empirically verified against the PRD. The label must be
 * created idempotently — through the same find-or-create `ensure_label` helper
 * the rest of the `prd-*` namespace uses — so reruns reuse the existing label
 * instead of erroring or duplicating.
 *
 * This aligns with sibling #591 (config-resolution `verified` role), whose
 * default GitHub vendor map resolves `read_role prd verified` to `prd-verified`.
 *
 * Both plugin roots are asserted (`plugins/src/base` source of truth and the
 * generated `plugins/lisa` artifact), so an artifact-only edit or a missed
 * `bun run build:plugins` fails the suite.
 * @module tests/unit/strategies/setup-github-prd-verified-label
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/** Both plugin roots: source of truth and generated artifact. */
const PLUGIN_ROOTS = ["plugins/src/base", "plugins/lisa"] as const;

const read = (root: string, rel: string): string =>
  readFileSync(path.resolve(root, rel), "utf8");

describe("setup-github scaffolds prd-verified idempotently (#593)", () => {
  describe.each(PLUGIN_ROOTS)("%s", root => {
    const content = read(root, "skills/lisa-setup-github/SKILL.md");

    it("scaffolds prd-verified via the read_role default ladder", () => {
      // Mirrors the rest of the prd-* block: `read_role prd <role> <default>`.
      expect(content).toMatch(/read_role prd verified\s+prd-verified\)/);
    });

    it("creates prd-verified through the idempotent ensure_label helper", () => {
      // The line must run through ensure_label (find-or-create), not gh label
      // create directly — that is what makes reruns non-duplicating.
      const verifiedLine = content
        .split("\n")
        .find(line => line.includes("read_role prd verified"));
      expect(verifiedLine).toBeDefined();
      expect(verifiedLine).toMatch(/^ensure_label\b/);
    });

    it("gives prd-verified a distinct color and a product-owned description", () => {
      expect(content).toMatch(
        /ensure_label "\$\(read_role prd verified\s+prd-verified\)"\s+0E8A16\s+"[^"]*verified against the PRD[^"]*product owns[^"]*"/
      );
    });

    it("orders prd-verified after prd-shipped (terminal lifecycle state)", () => {
      const shippedIdx = content.indexOf("read_role prd shipped");
      const verifiedIdx = content.indexOf("read_role prd verified");
      expect(shippedIdx).toBeGreaterThanOrEqual(0);
      expect(verifiedIdx).toBeGreaterThan(shippedIdx);
    });

    it("documents ensure_label as find-or-create so reruns do not duplicate", () => {
      // The idempotency guarantee the prd-verified line relies on.
      expect(content).toMatch(/ensure_label` is find-or-create/);
    });
  });
});

/**
 * Regression tests for the `verified` terminal PRD lifecycle state in the
 * lifecycle documentation.
 *
 * Issue #592 (PRD #553): the new terminal `verified` state must be visible
 * everywhere the PRD lifecycle is described, and the docs must distinguish
 * per-ticket `/lisa:verify` (verifies one work item) from initiative-level
 * `/lisa:verify-prd` (empirically verifies the shipped product against the
 * whole PRD).
 *
 * Target lifecycle:
 *   draft → ready → in_review → blocked | ticketed → shipped → verified
 * with failed post-ship verification re-opening the PRD to `ticketed` with
 * build-ready fix tickets (NEVER `blocked`; no separate `verifying` /
 * `verification-failed` states), and `verified` terminal and product-owned
 * like `draft` and `shipped`.
 *
 * Both plugin roots are asserted (`plugins/src/base` source of truth and the
 * generated `plugins/lisa` artifact), so an artifact-only edit or a missed
 * `bun run build:plugins` fails the suite.
 * @module tests/unit/strategies/prd-verified-lifecycle-docs
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/** Both plugin roots: source of truth and generated artifact. */
const PLUGIN_ROOTS = ["plugins/src/base", "plugins/lisa"] as const;

/** The four PRD-intake skills whose lifecycle diagrams must show `verified`. */
const PRD_INTAKE_VENDORS = [
  "github",
  "linear",
  "notion",
  "confluence",
] as const;

const read = (root: string, rel: string): string =>
  readFileSync(path.resolve(root, rel), "utf8");

describe("verified PRD lifecycle state in docs (#592)", () => {
  describe.each(PLUGIN_ROOTS)("%s", root => {
    describe.each(PRD_INTAKE_VENDORS)("%s-prd-intake SKILL", vendor => {
      const content = read(root, `skills/${vendor}-prd-intake/SKILL.md`);

      it("lifecycle diagram ends ... → shipped → verified", () => {
        expect(content).toContain(
          "draft → ready → in_review → blocked | ticketed → shipped → verified"
        );
      });

      it("lists verified among the product-owned terminal states intake does not touch", () => {
        // The diagram annotation marks the trailing states as product-owned.
        expect(content).toMatch(/\(product\)\s+\(product\)/);
        // verified is named as product-owned / never touched by the intake skill.
        expect(content).toMatch(/`verified`[^]*product-owned/i);
        expect(content).toMatch(/verify-prd/);
      });

      it("explains shipped is generated-work-complete and verified is empirically checked", () => {
        expect(content).toMatch(
          /shipped product[^]*empirically checked against the PRD/i
        );
      });

      it("re-opens to ticketed (never blocked) with build-ready fix tickets on failed post-ship verification", () => {
        expect(content).toMatch(/does \*\*not\*\* use `blocked`/i);
        expect(content).toMatch(/shipped → ticketed/);
        expect(content).toMatch(/build-ready fix tickets/i);
        // Still introduces no separate verifying/verification-failed state.
        expect(content).toMatch(
          /verifying.*verification-failed|verification-failed/
        );
      });
    });

    describe.each(PRD_INTAKE_VENDORS)("%s-prd-intake agent", vendor => {
      const content = read(root, `agents/${vendor}-prd-intake.md`);

      it("documents the full lifecycle through verified", () => {
        expect(content).toContain(
          "draft → ready → in_review → blocked | ticketed → shipped → verified"
        );
      });

      it("names verified as set by /lisa:verify-prd, never by the intake agent", () => {
        expect(content).toMatch(/verify-prd/);
        expect(content).toMatch(/`?verified`?[^]*never by this agent/i);
      });

      it("forbids touching the verified label in its rules", () => {
        expect(content).toMatch(/Never touch[^]*verified/i);
      });
    });

    describe("prd-lifecycle-rollup rule", () => {
      const content = read(root, "rules/prd-lifecycle-rollup.md");

      it("extends the canonical lifecycle to shipped → verified", () => {
        expect(content).toMatch(
          /ready → in_review → \(blocked \| ticketed\) → shipped → verified/
        );
      });

      it("documents shipped → verified (pass) and shipped → ticketed (fail) owned by verify-prd", () => {
        expect(content).toMatch(/shipped → verified/);
        expect(content).toMatch(/shipped → ticketed/);
        expect(content).toMatch(/verify-prd/);
      });

      it("has a PRD-level verification vs ticket verification section", () => {
        expect(content).toContain(
          "## PRD-level verification vs ticket verification"
        );
      });

      it("distinguishes /lisa:verify (one work item) from /lisa:verify-prd (whole initiative)", () => {
        // verify = single work item.
        expect(content).toMatch(/`\/lisa:verify`[^]*single work item/i);
        // verify-prd = initiative-level acceptance gate.
        expect(content).toMatch(
          /`\/lisa:verify-prd`[^]*initiative-level acceptance gate/i
        );
      });

      it("states shipped is necessary but not sufficient for verified", () => {
        expect(content).toMatch(/necessary but not sufficient/i);
      });

      it("keeps the lifecycle small: failed verification re-opens to ticketed (never blocked), no extra states", () => {
        expect(content).toMatch(/does \*\*not\*\* move the PRD to `blocked`/i);
        expect(content).toMatch(/shipped → ticketed/);
        expect(content).toMatch(
          /prd-verifying.*prd-verification-failed|verification-failed/
        );
      });

      it("marks verified as terminal and product-owned like draft and shipped", () => {
        expect(content).toMatch(
          /`verified` is terminal and product-owned[^]*draft[^]*shipped/i
        );
      });
    });
  });
});

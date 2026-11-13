/**
 * Regression coverage for the repair-intake operator contract.
 *
 * The skill is the executable contract for cron repair behavior, so these tests
 * guard the high-risk semantics that should not drift back to single-item
 * pickup or miss terminal close-out repairs.
 * @module tests/unit/strategies/repair-intake-contract
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOTS = ["plugins/src/base", "plugins/lisa"] as const;

const read = (root: string, relative: string): string =>
  readFileSync(path.resolve(root, relative), "utf8");

describe("repair-intake contract", () => {
  describe.each(ROOTS)("%s", root => {
    const skill = read(root, "skills/lisa-repair-intake/SKILL.md");
    const command = read(root, "commands/repair-intake.md");

    it("reserves human_needed for access and operator holds, not product or scoping calls (#4687)", () => {
      expect(skill).toMatch(
        /under `humanGate\.mode: "strict"`\s+it is human-needed as before/
      );
    });

    it("defaults dual GitHub repair queues to both lifecycles", () => {
      expect(skill).toMatch(/Default GitHub `intake_mode` is `both`/);
      expect(command).toMatch(/default GitHub intake_mode is both/i);
    });

    it("materializes the resolved graph before the blocker classifier loads it", () => {
      const write = skill.indexOf('> "$ROLLUP_DIR/graph.json"');
      const load = skill.indexOf(
        'jq -n --slurpfile g "$ROLLUP_DIR/graph.json"'
      );
      expect(write).toBeGreaterThan(-1);
      expect(load).toBeGreaterThan(write);
      expect(skill).toMatch(/Serialize the EXACT graph/i);
      expect(skill).toContain('test -s "$ROLLUP_DIR/graph.json"');
    });

    it("repairs GitHub PRDs missing native top-level child links", () => {
      expect(skill).toMatch(/subIssues/);
    });

    it("recovers a merged-PR leaf staleness-exempt, before rollup, with merged PRs discoverable", () => {
      // (c) Discovery includes merged (closed) PRs — search defaults to open.
      expect(skill).toMatch(/gh pr list --search <issue-ref> --state all/);
      expect(skill).toMatch(/closedByPullRequestsReferences/);
      expect(skill).toMatch(/defaults to `--state open`/);
    });

    describe("Class A clears a dependency by containment, not by status name", () => {
      // Scoped to Class A deliberately. The status-role vocabulary appears all
      // over the skill for other purposes; a whole-file match would pass while
      // the dependency gate itself still reasoned by label.
      const classA = skill.slice(
        skill.indexOf("### Class A — dependency blockers"),
        skill.indexOf("### Class B")
      );

      it("delegates to the shared blocker-containment rule", () => {
        expect(classA).toContain("blocker-containment");
      });

      it("resolves the base branch from the environment, not a rendered Branch Plan", () => {
        expect(classA).toContain("deploy.branches");
      });

      it("keeps the no-code carve-out positive, never an absence", () => {
        expect(classA).toMatch(/"no PR found" is `no-pr` and stays blocking/i);
      });
    });

    describe("Class C is fenced against human_needed", () => {
      // Scoped to the Class C section deliberately. `human_needed` appears
      // elsewhere in the skill as a marker to apply, preserve, or clear, and a
      // whole-file match would pass on those mentions while Class C stayed
      // unguarded — which is exactly the defect: the marker was preserved while
      // the thing it guards was overridden.
      const classC = skill.slice(
        skill.indexOf("### Class C — ambiguity / clarifying answers"),
        skill.indexOf("### Class D")
      );

      it("refuses to enter the path at all, rather than preserving and proceeding", () => {
        expect(classC).toMatch(/`human_needed` hard-stops this path/i);
        // The skip must be visible in the run record, not silent.
        expect(classC).toMatch(/skipped: human_needed/);
      });

      it("matches the marker across the hyphen/underscore skew", () => {
        expect(classC).toMatch(/human_needed/);
      });
    });
  });
});

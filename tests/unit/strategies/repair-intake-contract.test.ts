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
    const skill = read(root, "skills/repair-intake/SKILL.md");
    const command = read(root, "commands/repair-intake.md");

    it("repairs every actionable candidate inside max_candidates", () => {
      expect(skill).toMatch(/Repair every materially actionable candidate/i);
      expect(skill).toMatch(/default cap is 100/i);
      expect(command).toMatch(/repair every materially actionable candidate/i);
      expect(`${skill}\n${command}`).not.toMatch(
        /one materially actionable repair|first materially actionable one|One actionable repair/
      );
    });

    it("defaults dual GitHub repair queues to both lifecycles", () => {
      expect(skill).toMatch(/Absent .*`both` when both namespaces exist/is);
      expect(skill).toMatch(/Default GitHub `intake_mode` is `both`/);
      expect(command).toMatch(/default GitHub intake_mode is both/i);
    });

    it("includes terminal native closure and completed rollup repair paths", () => {
      expect(skill).toMatch(/Build terminal-open.*native close/is);
      expect(skill).toMatch(/PRD terminal-open.*close \/ archive/is);
      expect(skill).toMatch(/Build parent rollup reconciliation/is);
      expect(skill).toMatch(/PRD rollup with all generated work terminal/is);
      expect(command).toMatch(/terminal native closure/i);
      expect(command).toMatch(/completed rollups/i);
    });

    it("reconciles intermediate-env parent rollups, not only terminal close-out", () => {
      const section = skill.slice(
        skill.indexOf("### Build parent rollup reconciliation")
      );
      // Generalized beyond fully-terminal: handles intermediate envs too.
      expect(section).toMatch(/intermediate-env/i);
      expect(section).toMatch(/least-advanced/i);
      // Native closure stays gated on the true production terminal.
      expect(section).toMatch(
        /native closure only at the true terminal|only.*production/i
      );
      // The cron sweep documents the SE-318 case (e.g. all children at On Stg).
      expect(skill).toMatch(/On Stg/);
    });

    it("reconciles a container wrongly stuck in `ready`, never a ready leaf", () => {
      // Narrowed guard: ready LEAVES are intake's lane; a ready CONTAINER is reconciled.
      expect(skill).toMatch(/Touch `ready` \*\*leaves\*\*/);
      expect(skill).toMatch(/[Ss]tale-`ready` container/);
      expect(skill).toMatch(/invariant violation/i);
      // It is the one documented ready-touching exception.
      expect(skill).toMatch(/one .*exception|the one exception/i);
    });
  });
});

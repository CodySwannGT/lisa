/**
 * @file package-lisa-script-report.test.ts
 * @description What an apply TELLS the operator about the scripts it changed.
 *
 * The second half of #2952. The reserved-base split (covered in
 * `package-lisa-script-composition.test.ts`) stops the loss for the gate
 * scripts; every other governed script is still force-overwritten, and the
 * property that made the original defect nasty was not that it was wrong but
 * that it was SILENT — one changed string inside a `package.json` diff
 * dominated by key reordering, with a green Lint check on top.
 *
 * So an apply that discards host content now names what it discarded, and an
 * apply that reclaims a value Lisa itself wrote says so WITHOUT the wording of
 * a loss — six false alarms on a first upgrade would bury the one line that is
 * real.
 * @module tests/unit/strategies/package-lisa-script-report
 */
import { describe, expect, it } from "vitest";

import { createPackageLisaApplyHarness } from "../../helpers/package-lisa-apply-harness.js";

/** The lint base as Lisa has shipped it — the value hosts extended. */
const LINT_BASE = "oxlint && eslint . --quiet";

/** What a host writes to run Lisa's base plus its own gates. */
const DELEGATION = "$npm_execpath run lint:lisa";

/** Script names used throughout. */
const LINT = "lint";
const LINT_LISA = "lint:lisa";
const BUILD = "build";
const TSC = "tsc";
const TYPESCRIPT = "typescript";

/**
 * The split-pair template, as the fix ships it.
 * @returns A typescript-stack template governing `lint` as a pair
 */
function lintTemplate(): object {
  return {
    force: { scripts: { [LINT_LISA]: LINT_BASE, [BUILD]: TSC } },
    defaults: { scripts: { [LINT]: DELEGATION } },
    adopt: { scripts: { [LINT]: [LINT_BASE] } },
  };
}

describe("what an apply says about the scripts it changed (#2952)", () => {
  const host = createPackageLisaApplyHarness();

  describe("a preserved extension is not preserved in silence", () => {
    it("does not report the apply as silent when it keeps an extended gate", async () => {
      await host.writeTemplate(TYPESCRIPT, lintTemplate());
      await host.writeHostPackage({
        [LINT]: `${LINT_BASE} && node scripts/budgets.mjs`,
      });

      const result = await host.runApply();

      expect(result.note).toBeDefined();
      expect(result.note).toContain(LINT);
    });
  });

  describe("an adopt migration reads as a handover, not a loss", () => {
    it("names the reserved base and says the composition point is the host's", async () => {
      // The host value was Lisa's own, so nothing of theirs was discarded.
      // Reporting it as a replacement puts six loss-shaped lines in front of
      // every operator on their first upgrade, and a real loss stops standing
      // out — which is the failure this whole change exists to end.
      await host.writeTemplate(TYPESCRIPT, lintTemplate());
      await host.writeHostPackage({ [LINT]: LINT_BASE });

      const result = await host.runApply();

      expect(result.note).toContain(LINT_LISA);
      expect(result.note).toContain("now calls it");
      expect(result.note ?? "").not.toContain(`Replaced scripts.${LINT}:`);
    });

    it("still reports a loss for an adoptable key whose new value calls no base", async () => {
      // The handover wording names `<key>:lisa`. A template that lists a value
      // as adoptable but defaults the key to something that invokes no reserved
      // base has genuinely replaced the value, and must say so rather than
      // claim a handover to a script that does not exist.
      await host.writeTemplate(TYPESCRIPT, {
        force: {},
        defaults: { scripts: { [BUILD]: "rollup -c" } },
        adopt: { scripts: { [BUILD]: [TSC] } },
      });
      await host.writeHostPackage({ [BUILD]: TSC });

      const result = await host.runApply();

      expect(result.note).toContain(`Replaced scripts.${BUILD}:`);
      expect(result.note ?? "").not.toContain("now calls it");
    });
  });

  describe("report-and-preserve safety net for every other governed script", () => {
    it("names a forced script whose host value it overwrote", async () => {
      await host.writeTemplate(TYPESCRIPT, lintTemplate());
      await host.writeHostPackage({
        [LINT]: DELEGATION,
        [BUILD]: "tsc && node scripts/bundle.mjs",
      });

      const result = await host.runApply();

      expect((await host.hostScripts())[BUILD]).toBe(TSC);
      expect(result.note).toContain(BUILD);
      expect(result.note).toContain("node scripts/bundle.mjs");
    });

    it("walks every script key rather than a chosen subset", async () => {
      // The consumer's first semantic diff compared a GUESSED subset of sections
      // and reported "ordering only" — wrong, and it would have shipped the
      // defect. Any governed key, however unexpected its name, must be walked.
      await host.writeTemplate(TYPESCRIPT, {
        force: { scripts: { "zz:obscure:gate": "node gate.mjs" } },
      });
      await host.writeHostPackage({
        "zz:obscure:gate": "node gate.mjs && node extra.mjs",
      });

      const result = await host.runApply();

      expect(result.note).toContain("zz:obscure:gate");
    });

    it("says nothing about a script the host never had", async () => {
      await host.writeTemplate(TYPESCRIPT, lintTemplate());
      await host.writeHostPackage({ [LINT]: DELEGATION });

      const result = await host.runApply();

      expect(result.note ?? "").not.toContain(BUILD);
    });
  });

  describe("retired keys are named, not dropped in silence", () => {
    it("says what a removed script used to run", async () => {
      await host.writeTemplate(TYPESCRIPT, {
        force: {},
        remove: { scripts: ["legacy:gate"] },
      });
      await host.writeHostPackage({ "legacy:gate": "node scripts/legacy.mjs" });

      const result = await host.runApply();

      expect((await host.hostScripts())["legacy:gate"]).toBeUndefined();
      expect(result.note).toContain("legacy:gate");
      expect(result.note).toContain("node scripts/legacy.mjs");
    });

    it("elides a very long value instead of flooding the terminal", async () => {
      const sprawling = `node a.mjs${" && node b.mjs".repeat(20)}`;
      await host.writeTemplate(TYPESCRIPT, {
        force: { scripts: { sprawl: "node a.mjs" } },
      });
      await host.writeHostPackage({ sprawl: sprawling });

      const result = await host.runApply();

      expect(result.note).toContain("…");
      expect(result.note).not.toContain(sprawling);
    });
  });
});

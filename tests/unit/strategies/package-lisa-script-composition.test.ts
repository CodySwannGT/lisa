/**
 * @file package-lisa-script-composition.test.ts
 * @description A host's gate chained into a governed script must survive `lisa apply`.
 *
 * The defect (#2952): `scripts.lint` sat in `force`, so every apply replaced the
 * host's value outright. A consumer lost five chained gates — including a design
 * budget ratchet — in one upgrade, and CI kept reporting Lint green, because CI
 * runs `<pm> run lint` through an external reusable workflow where no
 * repo-local step can be added. Chaining into `lint` is the only composition
 * point the host has, and Lisa owned it.
 *
 * The fix is a reserved base name: Lisa forces `lint:lisa` — which a host cannot
 * delete — and merely DEFAULTS `lint` to invoke it, so the composition point
 * belongs to the host and survives by construction.
 *
 * This half covers what an apply PRESERVES. What it TELLS the operator is the
 * other half of the same fix and lives in `package-lisa-script-report.test.ts`.
 * @module tests/unit/strategies/package-lisa-script-composition
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
const UNHOOKED_PHRASE = "nothing invokes";

/**
 * The template shape the fix introduces, parameterised by the base value so a
 * case can ship a CHANGED base and prove an unmodified host still tracks it.
 * @param base - Value Lisa forces into `lint:lisa`
 * @returns A typescript-stack template
 */
function lintTemplate(base: string = LINT_BASE): object {
  return {
    force: { scripts: { [LINT_LISA]: base, [BUILD]: TSC } },
    defaults: { scripts: { [LINT]: DELEGATION } },
    adopt: { scripts: { [LINT]: [LINT_BASE] } },
  };
}

describe("governed scripts as host composition points (#2952)", () => {
  const host = createPackageLisaApplyHarness();

  describe("a host-extended gate survives an apply", () => {
    it("keeps a host lint that delegates to the reserved base and chains its own gates", async () => {
      const hostLint = `${DELEGATION} && node scripts/budgets.mjs && node scripts/coverage.mjs`;
      await host.writeTemplate(TYPESCRIPT, lintTemplate());
      await host.writeHostPackage({ [LINT]: hostLint });

      await host.runApply();

      const scripts = await host.hostScripts();
      expect(scripts[LINT]).toBe(hostLint);
      expect(scripts[LINT_LISA]).toBe(LINT_BASE);
    });

    it("keeps a host lint that still inlines the old base ahead of its gates", async () => {
      // The exact shape measured in the field: the host extended the value Lisa
      // used to force, before any reserved base existed.
      const hostLint = `${LINT_BASE} && node scripts/budgets.mjs && bun run e2e:guard:test`;
      await host.writeTemplate(TYPESCRIPT, lintTemplate());
      await host.writeHostPackage({ [LINT]: hostLint });

      const result = await host.runApply();

      expect((await host.hostScripts())[LINT]).toBe(hostLint);
      expect(result.note).toContain(LINT_LISA);
    });
  });

  describe("an unmodified gate still tracks the template", () => {
    it("adopts the delegation when the host value is byte-identical to a Lisa base", async () => {
      await host.writeTemplate(TYPESCRIPT, lintTemplate());
      await host.writeHostPackage({ [LINT]: LINT_BASE });

      await host.runApply();

      expect((await host.hostScripts())[LINT]).toBe(DELEGATION);
    });

    it("takes a CHANGED base value for a host that never customised lint", async () => {
      const newBase = "oxlint && eslint . --quiet --cache";
      await host.writeTemplate(TYPESCRIPT, lintTemplate(newBase));
      await host.writeHostPackage({ [LINT]: LINT_BASE });

      await host.runApply();

      const scripts = await host.hostScripts();
      // `run lint` resolves to the new base through the reserved name.
      expect(scripts[LINT]).toBe(DELEGATION);
      expect(scripts[LINT_LISA]).toBe(newBase);
    });

    it("installs both names on a host that has no lint script at all", async () => {
      await host.writeTemplate(TYPESCRIPT, lintTemplate());
      await host.writeHostPackage({ [BUILD]: TSC });

      const result = await host.runApply();

      const scripts = await host.hostScripts();
      expect(scripts[LINT]).toBe(DELEGATION);
      expect(scripts[LINT_LISA]).toBe(LINT_BASE);
      expect(result.note ?? "").not.toContain(UNHOOKED_PHRASE);
    });

    it("says nothing about a host that has already adopted the delegation", async () => {
      await host.writeTemplate(TYPESCRIPT, lintTemplate());
      await host.writeHostPackage({
        [LINT]: DELEGATION,
        [LINT_LISA]: LINT_BASE,
        [BUILD]: TSC,
      });

      // The first apply normalises top-level key ORDER, which is exactly the
      // churn that hid the defect; the second is the steady state a host sees.
      await host.runApply();
      const result = await host.runApply();

      expect((await host.hostScripts())[LINT]).toBe(DELEGATION);
      expect(result.action).toBe("skipped");
      expect(result.note).toBeUndefined();
    });
  });

  describe("the governance-critical base is still enforced", () => {
    it("restores a reserved base the host deleted", async () => {
      await host.writeTemplate(TYPESCRIPT, lintTemplate());
      await host.writeHostPackage({ [LINT]: DELEGATION });

      await host.runApply();

      expect((await host.hostScripts())[LINT_LISA]).toBe(LINT_BASE);
    });

    it("overwrites a reserved base the host weakened", async () => {
      await host.writeTemplate(TYPESCRIPT, lintTemplate());
      await host.writeHostPackage({
        [LINT]: DELEGATION,
        [LINT_LISA]: "echo skipped",
      });

      await host.runApply();

      expect((await host.hostScripts())[LINT_LISA]).toBe(LINT_BASE);
    });

    it("names the gate when the host's composition point no longer runs it", async () => {
      await host.writeTemplate(TYPESCRIPT, lintTemplate());
      await host.writeHostPackage({ [LINT]: "echo nothing-to-see-here" });

      const result = await host.runApply();

      const scripts = await host.hostScripts();
      expect(scripts[LINT]).toBe("echo nothing-to-see-here");
      expect(scripts[LINT_LISA]).toBe(LINT_BASE);
      expect(result.note).toContain(LINT_LISA);
      expect(result.note).toContain(UNHOOKED_PHRASE);
    });
  });

  describe("the whole inheritance chain contributes", () => {
    it("recognises a Lisa value written by a parent template, not just the child", async () => {
      // A host may have taken its value from any layer of the chain it has
      // passed through. Letting the child's list REPLACE the parent's would
      // stop recognising a value Lisa really did author, and the host would be
      // warned about something it never touched.
      await host.writeTemplate("all", {
        adopt: { scripts: { [LINT]: ["eslint . --quiet"] } },
        defaults: { scripts: { [LINT]: DELEGATION } },
      });
      await host.writeTemplate(TYPESCRIPT, lintTemplate());
      await host.writeHostPackage({ [LINT]: "eslint . --quiet" });

      await host.runApply();

      expect((await host.hostScripts())[LINT]).toBe(DELEGATION);
    });
  });

  describe("adopt never fights force", () => {
    it("keeps a value the template both forces and lists as adoptable", async () => {
      // Force already wrote Lisa's current value into the key, so clearing it
      // would delete what force just put there. Force wins; adopt stands down.
      await host.writeTemplate(TYPESCRIPT, {
        force: { scripts: { [BUILD]: TSC } },
        adopt: { scripts: { [BUILD]: [TSC] } },
        defaults: { scripts: { [BUILD]: "rollup -c" } },
      });
      await host.writeHostPackage({ [BUILD]: TSC });

      await host.runApply();

      expect((await host.hostScripts())[BUILD]).toBe(TSC);
    });
  });

  describe("idempotence", () => {
    it("changes nothing on a second apply", async () => {
      await host.writeTemplate(TYPESCRIPT, lintTemplate());
      await host.writeHostPackage({
        [LINT]: `${DELEGATION} && node scripts/budgets.mjs`,
      });

      await host.runApply();
      const first = await host.hostPackage();
      const second = await host.runApply();

      expect(second.action).toBe("skipped");
      expect(await host.hostPackage()).toEqual(first);
    });
  });

  describe("postinstall applies stay out of the scripts section", () => {
    it("leaves every script alone when restricted to security pins", async () => {
      await host.writeTemplate(TYPESCRIPT, lintTemplate());
      await host.writeHostPackage({ [LINT]: LINT_BASE });

      await host.runApply({ skipGitCheck: true, postinstall: true });

      expect((await host.hostScripts())[LINT]).toBe(LINT_BASE);
    });
  });
});

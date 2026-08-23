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
 * Two properties made it nasty and both are pinned here: the loss was SILENT,
 * and the surrounding `package.json` diff is dominated by key reordering, so
 * nobody sees one changed string.
 *
 * The fix has two halves and each is proved separately:
 *
 * 1. A reserved base name. Lisa forces `lint:lisa` — which a host cannot delete
 *    — and merely DEFAULTS `lint` to invoke it, so the composition point belongs
 *    to the host and survives by construction.
 * 2. Report-and-preserve as the safety net. Every other governed script is still
 *    force-overwritten, but an apply that discards host content now names what
 *    it discarded instead of doing it quietly.
 * @module tests/unit/strategies/package-lisa-script-composition
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type {
  FileOperationResult,
  LisaConfig,
} from "../../../src/core/config.js";
import { PackageLisaStrategy } from "../../../src/strategies/package-lisa.js";
import type { StrategyContext } from "../../../src/strategies/strategy.interface.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

/** The lint base as Lisa has shipped it — the value hosts extended. */
const LINT_BASE = "oxlint && eslint . --quiet";

/** What a host writes to run Lisa's base plus its own gates. */
const DELEGATION = "$npm_execpath run lint:lisa";

/** Script names and manifest keys used throughout. */
const LINT = "lint";
const LINT_LISA = "lint:lisa";
const BUILD = "build";
const TSC = "tsc";
const PACKAGE_JSON = "package.json";
const TEMPLATE_FILE = "package.lisa.json";
const TYPESCRIPT = "typescript";
const UNHOOKED_PHRASE = "nothing invokes";

describe("governed scripts as host composition points (#2952)", () => {
  let strategy: PackageLisaStrategy;
  let tempDir: string;
  let lisaDir: string;
  let projectDir: string;

  beforeEach(async () => {
    strategy = new PackageLisaStrategy();
    tempDir = await createTempDir();
    lisaDir = path.join(tempDir, "lisa");
    projectDir = path.join(tempDir, "project");
    await fs.ensureDir(lisaDir);
    await fs.ensureDir(projectDir);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  /**
   * Build a strategy context pointing at the temp Lisa and project dirs.
   * @param overrides - Config fields a case varies
   * @returns Context the strategy can be driven with
   */
  function createContext(overrides: Partial<LisaConfig> = {}): StrategyContext {
    return {
      config: {
        lisaDir,
        destDir: projectDir,
        dryRun: false,
        yesMode: true,
        validateOnly: false,
        skipGitCheck: false,
        harness: "claude",
        ...overrides,
      },
      backupFile: async () => {},
      promptOverwrite: async () => true,
    };
  }

  /**
   * Write one `package.lisa.json` into the temp Lisa tree.
   * @param typeName - Project type directory (e.g. "typescript")
   * @param template - Template body
   */
  async function writeTemplate(
    typeName: string,
    template: object
  ): Promise<void> {
    const dir = path.join(lisaDir, typeName, "package-lisa");
    await fs.ensureDir(dir);
    await fs.writeJson(path.join(dir, TEMPLATE_FILE), template);
  }

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

  /**
   * Write the host manifest, marking the project as a TypeScript stack.
   * @param scripts - Scripts the host ships
   */
  async function writeHostPackage(
    scripts: Record<string, string>
  ): Promise<void> {
    await fs.writeJson(path.join(projectDir, "tsconfig.json"), {});
    await fs.writeJson(path.join(projectDir, PACKAGE_JSON), {
      name: "host-project",
      version: "1.0.0",
      scripts,
    });
  }

  /**
   * Run the strategy the way an apply drives it.
   * @param context - Optional context override
   * @returns The operation result, whose `note` carries operator-visible text
   */
  async function runApply(
    context: StrategyContext = createContext()
  ): Promise<FileOperationResult> {
    const sourcePath = path.join(
      lisaDir,
      TYPESCRIPT,
      "package-lisa",
      TEMPLATE_FILE
    );
    return strategy.apply(
      sourcePath,
      path.join(projectDir, TEMPLATE_FILE),
      TEMPLATE_FILE,
      context
    );
  }

  /**
   * Read the host manifest's scripts back off disk.
   * @returns The scripts section after an apply
   */
  async function hostScripts(): Promise<Record<string, string>> {
    const pkg = (await fs.readJson(path.join(projectDir, PACKAGE_JSON))) as {
      scripts: Record<string, string>;
    };
    return pkg.scripts;
  }

  describe("a host-extended gate survives an apply", () => {
    it("keeps a host lint that delegates to the reserved base and chains its own gates", async () => {
      const hostLint = `${DELEGATION} && node scripts/budgets.mjs && node scripts/coverage.mjs`;
      await writeTemplate(TYPESCRIPT, lintTemplate());
      await writeHostPackage({ [LINT]: hostLint });

      await runApply();

      const scripts = await hostScripts();
      expect(scripts[LINT]).toBe(hostLint);
      expect(scripts[LINT_LISA]).toBe(LINT_BASE);
    });

    it("keeps a host lint that still inlines the old base ahead of its gates", async () => {
      // The exact shape measured in the field: the host extended the value Lisa
      // used to force, before any reserved base existed.
      const hostLint = `${LINT_BASE} && node scripts/budgets.mjs && bun run e2e:guard:test`;
      await writeTemplate(TYPESCRIPT, lintTemplate());
      await writeHostPackage({ [LINT]: hostLint });

      const result = await runApply();

      expect((await hostScripts())[LINT]).toBe(hostLint);
      expect(result.note).toContain(LINT_LISA);
    });

    it("does not report the apply as silent when it keeps an extended gate", async () => {
      await writeTemplate(TYPESCRIPT, lintTemplate());
      await writeHostPackage({
        [LINT]: `${LINT_BASE} && node scripts/budgets.mjs`,
      });

      const result = await runApply();

      expect(result.note).toBeDefined();
      expect(result.note).toContain(LINT);
    });
  });

  describe("an unmodified gate still tracks the template", () => {
    it("adopts the delegation when the host value is byte-identical to a Lisa base", async () => {
      await writeTemplate(TYPESCRIPT, lintTemplate());
      await writeHostPackage({ [LINT]: LINT_BASE });

      await runApply();

      expect((await hostScripts())[LINT]).toBe(DELEGATION);
    });

    it("takes a CHANGED base value for a host that never customised lint", async () => {
      const newBase = "oxlint && eslint . --quiet --cache";
      await writeTemplate(TYPESCRIPT, lintTemplate(newBase));
      await writeHostPackage({ [LINT]: LINT_BASE });

      await runApply();

      const scripts = await hostScripts();
      // `run lint` resolves to the new base through the reserved name.
      expect(scripts[LINT]).toBe(DELEGATION);
      expect(scripts[LINT_LISA]).toBe(newBase);
    });

    it("installs both names on a host that has no lint script at all", async () => {
      await writeTemplate(TYPESCRIPT, lintTemplate());
      await writeHostPackage({ [BUILD]: TSC });

      const result = await runApply();

      const scripts = await hostScripts();
      expect(scripts[LINT]).toBe(DELEGATION);
      expect(scripts[LINT_LISA]).toBe(LINT_BASE);
      expect(result.note ?? "").not.toContain(UNHOOKED_PHRASE);
    });

    it("says nothing about a host that has already adopted the delegation", async () => {
      await writeTemplate(TYPESCRIPT, lintTemplate());
      await writeHostPackage({
        [LINT]: DELEGATION,
        [LINT_LISA]: LINT_BASE,
        [BUILD]: TSC,
      });

      // The first apply normalises top-level key ORDER, which is exactly the
      // churn that hid the defect; the second is the steady state a host sees.
      await runApply();
      const result = await runApply();

      expect((await hostScripts())[LINT]).toBe(DELEGATION);
      expect(result.action).toBe("skipped");
      expect(result.note).toBeUndefined();
    });
  });

  describe("the governance-critical base is still enforced", () => {
    it("restores a reserved base the host deleted", async () => {
      await writeTemplate(TYPESCRIPT, lintTemplate());
      await writeHostPackage({ [LINT]: DELEGATION });

      await runApply();

      expect((await hostScripts())[LINT_LISA]).toBe(LINT_BASE);
    });

    it("overwrites a reserved base the host weakened", async () => {
      await writeTemplate(TYPESCRIPT, lintTemplate());
      await writeHostPackage({
        [LINT]: DELEGATION,
        [LINT_LISA]: "echo skipped",
      });

      await runApply();

      expect((await hostScripts())[LINT_LISA]).toBe(LINT_BASE);
    });

    it("names the gate when the host's composition point no longer runs it", async () => {
      await writeTemplate(TYPESCRIPT, lintTemplate());
      await writeHostPackage({ [LINT]: "echo nothing-to-see-here" });

      const result = await runApply();

      const scripts = await hostScripts();
      expect(scripts[LINT]).toBe("echo nothing-to-see-here");
      expect(scripts[LINT_LISA]).toBe(LINT_BASE);
      expect(result.note).toContain(LINT_LISA);
      expect(result.note).toContain(UNHOOKED_PHRASE);
    });
  });

  describe("report-and-preserve safety net for every other governed script", () => {
    it("names a forced script whose host value it overwrote", async () => {
      await writeTemplate(TYPESCRIPT, lintTemplate());
      await writeHostPackage({
        [LINT]: DELEGATION,
        [BUILD]: "tsc && node scripts/bundle.mjs",
      });

      const result = await runApply();

      expect((await hostScripts())[BUILD]).toBe(TSC);
      expect(result.note).toContain(BUILD);
      expect(result.note).toContain("node scripts/bundle.mjs");
    });

    it("walks every script key rather than a chosen subset", async () => {
      // The consumer's first semantic diff compared a GUESSED subset of sections
      // and reported "ordering only" — wrong, and it would have shipped the
      // defect. Any governed key, however unexpected its name, must be walked.
      await writeTemplate(TYPESCRIPT, {
        force: { scripts: { "zz:obscure:gate": "node gate.mjs" } },
      });
      await writeHostPackage({
        "zz:obscure:gate": "node gate.mjs && node extra.mjs",
      });

      const result = await runApply();

      expect(result.note).toContain("zz:obscure:gate");
    });

    it("says nothing about a script the host never had", async () => {
      await writeTemplate(TYPESCRIPT, lintTemplate());
      await writeHostPackage({ [LINT]: DELEGATION });

      const result = await runApply();

      expect(result.note ?? "").not.toContain(BUILD);
    });
  });

  describe("adopt never fights force", () => {
    it("keeps a value the template both forces and lists as adoptable", async () => {
      // Force already wrote Lisa's current value into the key, so clearing it
      // would delete what force just put there. Force wins; adopt stands down.
      await writeTemplate(TYPESCRIPT, {
        force: { scripts: { [BUILD]: TSC } },
        adopt: { scripts: { [BUILD]: [TSC] } },
        defaults: { scripts: { [BUILD]: "rollup -c" } },
      });
      await writeHostPackage({ [BUILD]: TSC });

      await runApply();

      expect((await hostScripts())[BUILD]).toBe(TSC);
    });
  });

  describe("idempotence", () => {
    it("changes nothing on a second apply", async () => {
      await writeTemplate(TYPESCRIPT, lintTemplate());
      await writeHostPackage({
        [LINT]: `${DELEGATION} && node scripts/budgets.mjs`,
      });

      await runApply();
      const first = await fs.readJson(path.join(projectDir, PACKAGE_JSON));
      const second = await runApply();

      expect(second.action).toBe("skipped");
      expect(await fs.readJson(path.join(projectDir, PACKAGE_JSON))).toEqual(
        first
      );
    });
  });

  describe("postinstall applies stay out of the scripts section", () => {
    it("leaves every script alone when restricted to security pins", async () => {
      await writeTemplate(TYPESCRIPT, lintTemplate());
      await writeHostPackage({ [LINT]: LINT_BASE });

      await runApply(createContext({ skipGitCheck: true }));

      expect((await hostScripts())[LINT]).toBe(LINT_BASE);
    });
  });
});

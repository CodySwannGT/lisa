/**
 * Behavioural tests for CodySwannGT/lisa#3501.
 *
 * Bootstrap wrote `knip.json` into repositories that configure knip as
 * `knip.ts`. knip prefers `.json`, so the generated file silently outranked the
 * config the repository actually maintains, and its real settings stopped being
 * read. Every #3069 guard sits *below* the `!destExists` early return in
 * `copy-overwrite`, so on a `knip.ts` repository not one of them evaluated —
 * the template landed as a NEW file rather than as a replacement.
 *
 * Precedence measured directly against knip 5.82.1, varying only which files
 * exist: `knip.ts` alone yields the repository's real findings; `knip.json`
 * alone yields `Refine entry pattern (no matches)`; **both** is byte-identical
 * to `knip.json` alone.
 * @module tests/unit/strategies/copy-overwrite-config-shadowing
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LisaConfig } from "../../../src/core/config.js";
import { CopyOverwriteStrategy } from "../../../src/strategies/copy-overwrite.js";
import type { StrategyContext } from "../../../src/strategies/strategy.interface.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const KNIP_JSON = "knip.json";
const KNIP_TS = "knip.ts";
/** Lisa's generic stack template: globs naming directories a repo may not have. */
const LISA_TEMPLATE = '{"entry":["bin/**/*.ts"],"project":["bin/**/*.ts"]}';
/** What a repository maintaining its own knip config looks like. */
const HOST_KNIP_TS = 'export default { entry: ["src/index.ts"] };\n';
/**
 * The sentence a governance template carries to declare Lisa replaces it every
 * run. Spelled out rather than imported so this file pins the literal contract
 * the strategy keys on.
 */
const REPLACED_EVERY_RUN = "This file IS replaced on each apply.";

describe("copy-overwrite does not outrank a config it did not write", () => {
  let strategy: CopyOverwriteStrategy;
  let tempDir: string;
  let srcDir: string;
  let destDir: string;

  beforeEach(async () => {
    strategy = new CopyOverwriteStrategy();
    tempDir = await createTempDir();
    srcDir = path.join(tempDir, "src");
    destDir = path.join(tempDir, "dest");
    await fs.ensureDir(srcDir);
    await fs.ensureDir(destDir);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  /**
   * Build a strategy context over the temp source and destination trees.
   * @param overrides - Configuration overrides for the case under test
   * @returns Strategy context with test defaults
   */
  function createContext(overrides: Partial<LisaConfig> = {}): StrategyContext {
    const config: LisaConfig = {
      lisaDir: srcDir,
      destDir,
      dryRun: false,
      yesMode: false,
      validateOnly: false,
      skipGitCheck: false,
      harness: "claude",
      ...overrides,
    };
    return {
      config,
      backupFile: async () => {},
      promptOverwrite: async () => true,
    };
  }

  /**
   * Run the strategy for one managed template against the destination tree.
   * @param relativePath - Repo-relative template path
   * @param sourceContents - Contents of the packaged template
   * @param overrides - Configuration overrides
   * @returns The strategy's result
   */
  async function applyTemplate(
    relativePath: string,
    sourceContents: string,
    overrides: Partial<LisaConfig> = {}
  ): ReturnType<CopyOverwriteStrategy["apply"]> {
    const srcFile = path.join(srcDir, relativePath);
    const destFile = path.join(destDir, relativePath);
    await fs.writeFile(srcFile, sourceContents);
    return strategy.apply(
      srcFile,
      destFile,
      relativePath,
      createContext(overrides)
    );
  }

  // ── Scenario 1: the target already configures knip in TypeScript ──────────
  // This is the injection-proof case. Removing the extension check in
  // `shadowedExistingConfig` turns exactly this test red; the scenarios below
  // it all pass against the unfixed code, which is why they cannot stand in
  // for it.
  it("does not write knip.json when the project configures knip in knip.ts", async () => {
    await fs.writeFile(path.join(destDir, KNIP_TS), HOST_KNIP_TS);

    const result = await applyTemplate(KNIP_JSON, LISA_TEMPLATE);

    expect(result.action).toBe("shadowed");
    expect(await fs.pathExists(path.join(destDir, KNIP_JSON))).toBe(false);
  });

  it("says which file it stood down for, not merely that it skipped", async () => {
    await fs.writeFile(path.join(destDir, KNIP_TS), HOST_KNIP_TS);

    const result = await applyTemplate(KNIP_JSON, LISA_TEMPLATE);

    // The absent file is invisible on its own — a template that never arrives
    // looks identical to one that was never shipped. The note is the only
    // thing that distinguishes them.
    expect(result.note).toContain(KNIP_TS);
    expect(result.note).toContain("knip");
  });

  it("leaves the project's own knip.ts untouched", async () => {
    await fs.writeFile(path.join(destDir, KNIP_TS), HOST_KNIP_TS);

    await applyTemplate(KNIP_JSON, LISA_TEMPLATE);

    expect(await fs.readFile(path.join(destDir, KNIP_TS), "utf8")).toBe(
      HOST_KNIP_TS
    );
  });

  // Every remaining spelling in knip's own `KNIP_CONFIG_LOCATIONS`, all of
  // which sit below `knip.json` in that list and so lose to it. Enumerated
  // rather than sampled: each is a repository that would keep silently losing
  // its settings if the table missed it, and `knip.config.ts` is the one the
  // report's proposed `knip.{ts,js,mjs,cjs}` set would have left uncovered.
  it.each([
    "knip.jsonc",
    ".knip.json",
    ".knip.jsonc",
    "knip.js",
    "knip.config.ts",
    "knip.config.js",
  ])("also stands down for %s", async sibling => {
    await fs.writeFile(path.join(destDir, sibling), HOST_KNIP_TS);

    const result = await applyTemplate(KNIP_JSON, LISA_TEMPLATE);

    expect(result.action).toBe("shadowed");
    expect(await fs.pathExists(path.join(destDir, KNIP_JSON))).toBe(false);
  });

  // The rejection control for the case above. knip does not resolve these, so
  // a project holding one has no working knip config and nothing is being
  // shadowed. Standing down would withhold the seed, leave knip on defaults,
  // and print a note naming a file knip ignores. Pinned as a test because the
  // report proposed exactly this pair, so the omission has to read as a
  // decision that stays made.
  it.each(["knip.mjs", "knip.cjs"])(
    "still writes knip.json beside %s, which knip does not read",
    async unread => {
      await fs.writeFile(path.join(destDir, unread), HOST_KNIP_TS);

      const result = await applyTemplate(KNIP_JSON, LISA_TEMPLATE);

      expect(result.action).toBe("copied");
      expect(await fs.readFile(path.join(destDir, KNIP_JSON), "utf8")).toBe(
        LISA_TEMPLATE
      );
    }
  );

  // ── Scenario 2: the target has no knip configuration ──────────────────────
  it("writes knip.json when the project configures knip nowhere", async () => {
    const result = await applyTemplate(KNIP_JSON, LISA_TEMPLATE);

    expect(result.action).toBe("copied");
    expect(await fs.readFile(path.join(destDir, KNIP_JSON), "utf8")).toBe(
      LISA_TEMPLATE
    );
  });

  // ── Scenario 3: the target already has a curated knip.json ────────────────
  it("preserves a curated knip.json rather than replacing it, as #3069 established", async () => {
    const curated = '{"entry":["src/main.ts"]}';
    await fs.writeFile(path.join(destDir, KNIP_JSON), curated);

    const result = await applyTemplate(KNIP_JSON, LISA_TEMPLATE, {
      yesMode: true,
    });

    expect(result.action).toBe("stale");
    expect(await fs.readFile(path.join(destDir, KNIP_JSON), "utf8")).toBe(
      curated
    );
  });

  // ── Scenario 4: the reported symptom, asserted separately ─────────────────
  it("leaves a knip.ts project with exactly one knip config after apply", async () => {
    await fs.writeFile(path.join(destDir, KNIP_TS), HOST_KNIP_TS);

    await applyTemplate(KNIP_JSON, LISA_TEMPLATE);

    // The mechanism is precedence; the symptom a consumer recognises is a
    // second, untracked config file appearing at the repo root and taking over.
    const knipConfigs = (await fs.readdir(destDir)).filter(entry =>
      entry.includes("knip")
    );
    expect(knipConfigs).toEqual([KNIP_TS]);
  });

  // ── The guard on the guard ────────────────────────────────────────────────
  it("still writes a governance template whose sibling exists", async () => {
    // Seed-only is the whole safety argument. If this guard applied to
    // templates Lisa replaces every run, any host could silently disable
    // Lisa's enforcement by dropping in a same-family file — #2374's
    // undeliverable-fix incident re-entering through the door opened here.
    // Keyed on the template's own declaration, so this fixture carries it.
    await fs.writeFile(path.join(destDir, KNIP_TS), HOST_KNIP_TS);

    const result = await applyTemplate(
      KNIP_JSON,
      `// ${REPLACED_EVERY_RUN}\n${LISA_TEMPLATE}`
    );

    expect(result.action).toBe("copied");
    expect(await fs.pathExists(path.join(destDir, KNIP_JSON))).toBe(true);
  });

  it("does not stand down for an unrelated template that merely shares a directory", async () => {
    await fs.writeFile(path.join(destDir, KNIP_TS), HOST_KNIP_TS);

    const result = await applyTemplate("tsconfig.json", "{}");

    expect(result.action).toBe("copied");
  });

  it("writes nothing on a dry run, and still reports the shadowing", async () => {
    await fs.writeFile(path.join(destDir, KNIP_TS), HOST_KNIP_TS);

    const result = await applyTemplate(KNIP_JSON, LISA_TEMPLATE, {
      dryRun: true,
    });

    expect(result.action).toBe("shadowed");
    expect(await fs.pathExists(path.join(destDir, KNIP_JSON))).toBe(false);
  });
});

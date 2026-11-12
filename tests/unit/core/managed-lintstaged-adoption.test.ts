/** Released staged-file gates upgrade without replacing host customizations. */
import * as fs from "fs-extra";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LisaConfig } from "../../../src/core/config.js";
import {
  LISA_OWNED_HASH_HISTORY_DERIVED,
  LISA_OWNED_HASH_LEDGER,
} from "../../../src/core/lisa-owned-hash-ledger.js";
import { isLisaOwnedTemplate } from "../../../src/core/lisa-owned-templates.js";
import { CopyOverwriteStrategy } from "../../../src/strategies/copy-overwrite.js";
import type { StrategyContext } from "../../../src/strategies/strategy.interface.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const TARGET = ".lintstagedrc.json";
const SOURCE = path.join(ROOT, "typescript/copy-overwrite", TARGET);
// Exact public 4.99.6 default, before module extensions reached this task group.
const OLDER = `{
  "*.{js,mjs,ts,tsx,jsx}": [
    "oxlint --fix --no-error-on-unmatched-pattern",
    "eslint --quiet --cache --fix --no-error-on-unmatched-pattern --no-warn-ignored",
    "ast-grep scan",
    "prettier --write"
  ],
  "*.{sh,bash,zsh,ksh}": ["ast-grep scan"],
  "*.{json,html,md,mdx,css,scss,yaml,yml,graphql}": ["prettier --write"]
}
`;
const OLDER_HASH =
  "058f6bb7ce5b734ba3e62774b1f769c94053c574f2b4db3e59515c325e49c0ef";
const ROUTES = ["yes", "postinstall", "unattended"] as const;

describe("managed lint-staged configuration adoption", () => {
  let tempDir: string;
  let backups: string[];
  const strategy = new CopyOverwriteStrategy();

  beforeEach(async () => {
    tempDir = await createTempDir();
    backups = [];
  });
  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  /**
   * Ordinary update routes use the real shipped ledger and no refresh opt-in.
   * @param route - How the host invokes Lisa
   * @returns Configuration and callbacks for the ordinary strategy
   */
  function context(route: (typeof ROUTES)[number]): StrategyContext {
    const config: LisaConfig = {
      lisaDir: ROOT,
      destDir: tempDir,
      dryRun: false,
      yesMode: route !== "unattended",
      validateOnly: false,
      skipGitCheck: route === "postinstall",
      harness: "claude",
    };
    return {
      config,
      unattended: route !== "yes",
      backupFile: async file => {
        backups.push(await fs.readFile(file, "utf8"));
      },
      promptOverwrite: async () => {
        expect(route).toBe("yes");
        return true;
      },
    };
  }

  it("enrols the exact released default in both provenance records", () => {
    expect(createHash("sha256").update(OLDER).digest("hex")).toBe(OLDER_HASH);
    const currentHash = createHash("sha256")
      .update(fs.readFileSync(SOURCE))
      .digest("hex");
    for (const record of [
      LISA_OWNED_HASH_LEDGER,
      LISA_OWNED_HASH_HISTORY_DERIVED,
    ]) {
      expect(record[TARGET]).toContain(OLDER_HASH);
      expect(record[TARGET]).toContain(currentHash);
    }
  });

  it.each(ROUTES)(
    "upgrades a known default and reapplies safely via %s",
    async route => {
      const destination = path.join(tempDir, TARGET);
      await fs.writeFile(destination, OLDER);
      const update = context(route);
      const result = await strategy.apply(SOURCE, destination, TARGET, update);
      expect(result.action).toBe("overwritten");
      expect(await fs.readFile(destination, "utf8")).toBe(
        await fs.readFile(SOURCE, "utf8")
      );
      expect(backups).toEqual([OLDER]);
      const repeat = await strategy.apply(SOURCE, destination, TARGET, update);
      expect(repeat.action).toBe("skipped");
      expect(backups).toEqual([OLDER]);
    }
  );

  it.each(ROUTES)(
    "preserves additional host checks byte-for-byte via %s",
    async route => {
      const destination = path.join(tempDir, TARGET);
      const custom = OLDER.replace(
        '"ast-grep scan",',
        '"ast-grep scan",\n    "host-security-check --strict",'
      );
      expect(custom).not.toBe(OLDER);
      await fs.writeFile(destination, custom);
      const result = await strategy.apply(
        SOURCE,
        destination,
        TARGET,
        context(route)
      );
      expect(result.action).toBe("host-ahead");
      expect(await fs.readFile(destination, "utf8")).toBe(custom);
      expect(backups).toEqual([]);
    }
  );

  it("owns only the exact root staged-file configuration", () => {
    expect(isLisaOwnedTemplate(TARGET)).toBe(true);
    for (const hostPath of [
      "packages/module/.lintstagedrc.json",
      "packages\\module\\.lintstagedrc.json",
      ".lintstagedrc.json.bak",
      ".lintstagedrc",
      "lint-staged.config.ts",
    ]) {
      expect(isLisaOwnedTemplate(hostPath), hostPath).toBe(false);
    }
  });

  it("preserves host-specific globs without an explicit refresh request", async () => {
    const destination = path.join(tempDir, TARGET);
    const custom = OLDER.replace("*.{js,mjs,ts,tsx,jsx}", "src/**/*.{ts,tsx}");
    await fs.writeFile(destination, custom);
    const result = await strategy.apply(
      SOURCE,
      destination,
      TARGET,
      context("unattended")
    );
    expect(result.action).toBe("host-ahead");
    expect(await fs.readFile(destination, "utf8")).toBe(custom);
    expect(backups).toEqual([]);
  });

  it("does not refresh a nested host configuration even when its bytes are known", async () => {
    const relativePath = `packages/module/${TARGET}`;
    const destination = path.join(tempDir, relativePath);
    await fs.outputFile(destination, OLDER);
    const result = await strategy.apply(
      SOURCE,
      destination,
      relativePath,
      context("unattended")
    );
    expect(result.action).toBe("stale");
    expect(await fs.readFile(destination, "utf8")).toBe(OLDER);
    expect(backups).toEqual([]);
  });
});

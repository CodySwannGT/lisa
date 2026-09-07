/**
 * @file expo-host-run-scripts-survive-apply.test.ts
 * @description Expo run commands that encode host environment and device facts
 * must survive a full Lisa apply.
 *
 * A measured caller apply replaced nine such values. The dangerous example was
 * `playwright:build`: the host sourced a non-production environment and wrote a
 * build-integrity stamp, while the forced template value was a bare web export.
 * The same apply removed host application identifiers from every Maestro route
 * and the host collection target from Lighthouse.
 *
 * These are composition points, not governance controls. Lisa provides their
 * defaults and adopts values Lisa itself previously wrote; it does not replace
 * a value the host owns. Four controls observed in the same apply remain forced
 * so this protection cannot accidentally weaken actual governance.
 * @module tests/integration/expo-host-run-scripts-survive-apply
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { LisaConfig } from "../../src/core/config.js";
import { PackageLisaStrategy } from "../../src/strategies/package-lisa.js";
import type { StrategyContext } from "../../src/strategies/strategy.interface.js";
import { cleanupTempDir, createTempDir } from "../helpers/test-utils.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const TEMPLATE = path.join("expo", "package-lisa", "package.lisa.json");

const HOST_FACING = [
  "lighthouse:check",
  "maestro:studio",
  "maestro:test",
  "maestro:test:android",
  "maestro:test:ios",
  "maestro:test:smoke",
  "playwright:build",
  "playwright:test",
  "playwright:test:ui",
] as const;

const FORCED_CONTROLS = [
  "check:vacuous-required-checks",
  "test:integration:lisa",
  "test:mutation",
] as const;

const CUSTOM_BUILD =
  "sh -c 'set -a; . ./.env.nonproduction; set +a; expo export --platform web --clear && node scripts/write-build-stamp.mjs'";

describe("Expo host-facing run commands survive a full apply", () => {
  let tempDir: string;
  let projectDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    projectDir = path.join(tempDir, "project");
    await fs.ensureDir(projectDir);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  /**
   * Apply the real shipped Expo template to one host script map.
   * @param scripts - Host scripts present before the apply
   * @returns Scripts written by the full apply
   */
  async function applyExpo(
    scripts: Record<string, string>
  ): Promise<Record<string, string>> {
    const destination = path.join(projectDir, "package.json");
    await fs.writeJson(destination, {
      name: "host-project",
      version: "1.0.0",
      dependencies: { expo: "~57.0.0" },
      scripts,
    });
    const config: LisaConfig = {
      lisaDir: REPO_ROOT,
      destDir: projectDir,
      dryRun: false,
      yesMode: true,
      validateOnly: false,
      skipGitCheck: false,
      harness: "claude",
    };
    const context: StrategyContext = {
      config,
      backupFile: async () => {},
      promptOverwrite: async () => true,
    };

    await new PackageLisaStrategy().apply(
      path.join(REPO_ROOT, TEMPLATE),
      destination,
      "package.lisa.json",
      context
    );

    const applied = (await fs.readJson(destination)) as {
      scripts: Record<string, string>;
    };
    return applied.scripts;
  }

  it("keeps all nine host-owned values, including the environment-safe build", async () => {
    const host = Object.fromEntries(
      HOST_FACING.map(key => [key, `host-owned ${key}`])
    );
    host["playwright:build"] = CUSTOM_BUILD;

    const applied = await applyExpo(host);

    expect(
      Object.fromEntries(HOST_FACING.map(key => [key, applied[key]]))
    ).toEqual(host);
    expect(applied["playwright:build"]).toContain(".env.nonproduction");
    expect(applied["playwright:build"]).toContain("write-build-stamp.mjs");
  });

  it("still supplies every host-facing command when the host has none", async () => {
    const applied = await applyExpo({});

    expect(HOST_FACING.filter(key => applied[key] === undefined)).toEqual([]);
  });

  it("classifies old Lisa values for adoption rather than force", () => {
    const template = fs.readJsonSync(path.join(REPO_ROOT, TEMPLATE)) as {
      force: { scripts: Record<string, string> };
      defaults: { scripts: Record<string, string> };
      adopt: { scripts: Record<string, readonly string[]> };
    };

    const misclassified = HOST_FACING.filter(
      key =>
        template.force.scripts[key] !== undefined ||
        template.defaults.scripts[key] === undefined ||
        !(template.adopt.scripts[key] ?? []).includes(
          template.defaults.scripts[key] ?? ""
        )
    );
    expect(misclassified).toEqual([]);
  });

  it("keeps the three remaining governance controls forced", async () => {
    const host = Object.fromEntries(
      FORCED_CONTROLS.map(key => [key, `host-disabled ${key}`])
    );

    const applied = await applyExpo(host);

    expect(FORCED_CONTROLS.filter(key => applied[key] === host[key])).toEqual(
      []
    );
  });
});

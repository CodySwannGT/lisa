/**
 * @file host-test-scripts-survive-apply.test.ts
 * @description The SHIPPED templates must let a host's own test-script
 * composition survive an apply.
 *
 * The unit coverage drives the template files as data, which proves how they
 * are CLASSIFIED and nothing about what an apply does to a real host manifest.
 * This drives the real `package.lisa.json` out of the repository root against a
 * host fixture, so it fails the moment a test script goes back into `force`.
 *
 * The fixture reproduces the measured field shape from a consumer upgrade,
 * where an apply rewrote all six test scripts and destroyed two things at once:
 *
 *   - `LISA_TEST_SCRATCH_PREFIXES`, the operator's registry of fixture prefixes
 *     its suites legitimately create. Losing it made Lisa's own scratch-leak
 *     guard fail 19 healthy suites.
 *   - a coverage reporter chained after the run, which does not fail when it is
 *     removed — it simply stops reporting.
 *
 * Both live in the script value because `test:cov` is the name the gate invokes,
 * so it is the only composition point the host has.
 * @module tests/integration/host-test-scripts-survive-apply
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { LisaConfig } from "../../src/core/config.js";
import { PackageLisaStrategy } from "../../src/strategies/package-lisa.js";
import type { StrategyContext } from "../../src/strategies/strategy.interface.js";
import { cleanupTempDir, createTempDir } from "../helpers/test-utils.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");

/**
 * The stack template the fixture resolves to.
 * @remarks
 * The harm was measured on a nestjs consumer, but `apply` derives the stack
 * from the project on disk, and this fixture carries only a `tsconfig.json`.
 * Naming nestjs here would silently resolve the typescript chain anyway and
 * assert against values from a template this run never applied. The governance
 * defect is identical in both, and the unit spec covers every stack.
 */
const TEMPLATE = path.join("typescript", "package-lisa", "package.lisa.json");

const PACKAGE_JSON = "package.json";
const PACKAGE_LISA_JSON = "package.lisa.json";
const HOST_NAME = "host-project";

/** The operator registry an apply erased, verbatim from the measured case. */
const HOST_PREFIXES = `LISA_TEST_SCRATCH_PREFIXES='["alembic-","etl-","partner-"]'`;

/** The reporter chained after the run, which fails silently when removed. */
const HOST_REPORTER = "node scripts/coverage-margin.mjs --base origin/dev";

describe("a host's test-script composition survives the shipped apply", () => {
  let tempDir: string;
  let projectDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    projectDir = path.join(tempDir, "project");
    await fs.ensureDir(projectDir);
    await fs.writeJson(path.join(projectDir, "tsconfig.json"), {});
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  /**
   * Drive the real strategy with the repository's own templates.
   * @param scripts - The host manifest's scripts section
   * @returns The scripts section the apply wrote
   */
  async function applyShippedTemplates(
    scripts: Record<string, string>
  ): Promise<Record<string, string>> {
    await fs.writeJson(path.join(projectDir, PACKAGE_JSON), {
      name: HOST_NAME,
      version: "1.0.0",
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
      path.join(projectDir, PACKAGE_LISA_JSON),
      PACKAGE_LISA_JSON,
      context
    );
    const pkg = (await fs.readJson(path.join(projectDir, PACKAGE_JSON))) as {
      scripts: Record<string, string>;
    };
    return pkg.scripts;
  }

  /**
   * The reserved base the shipped template forces for one key.
   * @remarks
   * A missing base throws rather than yielding `undefined`: every assertion
   * below compares against this value, and `undefined === undefined` would let
   * a template that had dropped the pair entirely read as one that passes.
   * @param key - Host-facing script key
   * @returns Value of `force.scripts["<key>:lisa"]`
   * @throws {Error} When the template ships no reserved base for the key
   */
  function shippedBase(key: string): string {
    const template = fs.readJsonSync(path.join(REPO_ROOT, TEMPLATE)) as {
      force: { scripts: Record<string, string> };
    };
    const base = template.force.scripts[`${key}:lisa`];
    if (typeof base !== "string") {
      throw new Error(`${TEMPLATE} ships no forced ${key}:lisa`);
    }
    return base;
  }

  it("keeps a test:cov that delegates to the reserved base and chains a reporter", async () => {
    const hostCov = `${HOST_PREFIXES} $npm_execpath run test:cov:lisa; rc=$?; ${HOST_REPORTER}; exit $rc`;

    const scripts = await applyShippedTemplates({ "test:cov": hostCov });

    expect(scripts["test:cov"]).toBe(hostCov);
    expect(scripts["test:cov:lisa"]).toBe(shippedBase("test:cov"));
  });

  it("keeps a test:cov that still inlines the base it was extended from", async () => {
    // The measured shape: the host never learned about the reserved base, so it
    // spelled Lisa's command out and wrapped it. This is the case that was
    // silently overwritten, and it is the one a real consumer arrives in.
    const hostCov = `${HOST_PREFIXES} ${shippedBase("test:cov")}; rc=$?; ${HOST_REPORTER}; exit $rc`;

    const scripts = await applyShippedTemplates({ "test:cov": hostCov });

    expect(scripts["test:cov"]).toBe(hostCov);
  });

  it("keeps an operator scratch registry on every host-facing test script", async () => {
    const keys = ["test", "test:unit", "test:cov", "test:cov:unit"] as const;
    const host = Object.fromEntries(
      keys.map(key => [key, `${HOST_PREFIXES} ${shippedBase(key)}`])
    );

    const scripts = await applyShippedTemplates(host);

    const erased = keys.filter(
      key => !(scripts[key] ?? "").includes("LISA_TEST_SCRATCH_PREFIXES")
    );
    expect(erased).toEqual([]);
  });

  it("migrates a host that never customised test:cov onto the reserved base", async () => {
    const scripts = await applyShippedTemplates({
      "test:cov": shippedBase("test:cov"),
    });

    expect(scripts["test:cov"]).toBe("$npm_execpath run test:cov:lisa");
    expect(scripts["test:cov:lisa"]).toBe(shippedBase("test:cov"));
  });
});

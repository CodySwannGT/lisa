/**
 * @file host-lint-gate-survives-apply.test.ts
 * @description The SHIPPED templates must let a host's own gate survive an apply.
 *
 * The unit coverage for #2952 drives synthetic templates, which proves the
 * mechanism and nothing about what Lisa actually ships. This drives the real
 * `package.lisa.json` files out of the repository root, so it fails the moment
 * a gate script goes back into `force` — which is the regression itself.
 *
 * The host fixture reproduces the measured field shape: a `lint` script that
 * runs Lisa's checks and then a chain of project gates, in a project where CI
 * invokes `<pm> run lint` through an external reusable workflow and no
 * repo-local step can be added. `lint` is the only composition point there is.
 * @module tests/integration/host-lint-gate-survives-apply
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { LisaConfig } from "../../src/core/config.js";
import { PackageLisaStrategy } from "../../src/strategies/package-lisa.js";
import type { StrategyContext } from "../../src/strategies/strategy.interface.js";
import { cleanupTempDir, createTempDir } from "../helpers/test-utils.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");

/** Where the TypeScript stack's template lives. */
const TEMPLATE = path.join("typescript", "package-lisa", "package.lisa.json");

/** Project gates a host chains after Lisa's, none of which Lisa knows about. */
const HOST_GATES =
  "node scripts/design-budgets.mjs && node scripts/coverage-floor.mjs";

const PACKAGE_JSON = "package.json";

/** The sidecar path the strategy is triggered with. */
const PACKAGE_LISA_JSON = "package.lisa.json";

/** Name of the throwaway host manifest each case writes. */
const HOST_NAME = "host-project";

describe("a host gate chained into lint survives the shipped apply", () => {
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
   * @returns The scripts section the apply wrote
   */
  async function applyShippedTemplates(): Promise<Record<string, string>> {
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
   * The lint base the shipped TypeScript template forces.
   * @returns Value of `force.scripts["lint:lisa"]`
   */
  function shippedLintBase(): string {
    const template = fs.readJsonSync(path.join(REPO_ROOT, TEMPLATE)) as {
      force: { scripts: Record<string, string> };
    };
    return template.force.scripts["lint:lisa"];
  }

  it("keeps a lint that delegates to the reserved base and adds project gates", async () => {
    const hostLint = `$npm_execpath run lint:lisa && ${HOST_GATES}`;
    await fs.writeJson(path.join(projectDir, PACKAGE_JSON), {
      name: HOST_NAME,
      version: "1.0.0",
      scripts: { lint: hostLint },
    });

    const scripts = await applyShippedTemplates();

    expect(scripts.lint).toBe(hostLint);
    expect(scripts["lint:lisa"]).toBe(shippedLintBase());
  });

  it("keeps a lint that still inlines the base it was extended from", async () => {
    const hostLint = `${shippedLintBase()} && ${HOST_GATES}`;
    await fs.writeJson(path.join(projectDir, PACKAGE_JSON), {
      name: HOST_NAME,
      version: "1.0.0",
      scripts: { lint: hostLint },
    });

    const scripts = await applyShippedTemplates();

    expect(scripts.lint).toBe(hostLint);
  });

  it("migrates a host that never customised lint onto the reserved base", async () => {
    await fs.writeJson(path.join(projectDir, PACKAGE_JSON), {
      name: HOST_NAME,
      version: "1.0.0",
      scripts: { lint: shippedLintBase() },
    });

    const scripts = await applyShippedTemplates();

    expect(scripts.lint).toBe("$npm_execpath run lint:lisa");
    expect(scripts["lint:lisa"]).toBe(shippedLintBase());
  });
});

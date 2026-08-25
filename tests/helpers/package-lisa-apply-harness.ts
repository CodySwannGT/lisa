/**
 * @file package-lisa-apply-harness.ts
 * @description Drives `PackageLisaStrategy` against a throwaway Lisa tree and a
 * throwaway host project, so a spec can state a template and a host manifest
 * and assert on what an apply left behind.
 *
 * Extracted so the #2952 coverage can be split by concern — what an apply
 * PRESERVES, and what it TELLS the operator — without either half carrying a
 * copy of the setup. A copied harness drifts, and two harnesses that disagree
 * about the fixture make the two halves untrustworthy together.
 * @module tests/helpers/package-lisa-apply-harness
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach } from "vitest";

import type { FileOperationResult, LisaConfig } from "../../src/core/config.js";
import { PackageLisaStrategy } from "../../src/strategies/package-lisa.js";
import type { StrategyContext } from "../../src/strategies/strategy.interface.js";
import { cleanupTempDir, createTempDir } from "./test-utils.js";

/** File name of both the template and the sidecar an apply is triggered with. */
const TEMPLATE_FILE = "package.lisa.json";

/** The host manifest an apply rewrites. */
const PACKAGE_JSON = "package.json";

/** Project type whose template the harness applies. */
const TYPESCRIPT = "typescript";

/** Directory a stack's template lives in, under its type directory. */
const PACKAGE_LISA_DIR = "package-lisa";

/**
 * Path to one stack's `package.lisa.json` under a Lisa tree.
 * @param root - A Lisa checkout root, real or temporary
 * @param typeName - Stack template directory name
 * @returns Absolute path to that stack's template
 */
function templatePath(root: string, typeName: string): string {
  return path.join(root, typeName, PACKAGE_LISA_DIR, TEMPLATE_FILE);
}

/** Temp locations created for one test case. */
interface HarnessPaths {
  /** Root of the throwaway tree, removed after the case. */
  readonly tempDir: string;
  /** Stands in for a Lisa checkout the templates are read from. */
  readonly lisaDir: string;
  /** Stands in for the host project the apply rewrites. */
  readonly projectDir: string;
}

/** Operations a spec drives the strategy with. */
export interface PackageLisaApplyHarness {
  /** Write one `package.lisa.json` into the temp Lisa tree. */
  writeTemplate(typeName: string, template: object): Promise<void>;
  /**
   * Copy the templates this repository SHIPS into the temp Lisa tree.
   * @remarks
   * A spec that states its own template proves the merge rules; only this
   * proves what a consumer actually receives, which is where a governance
   * classification defect lives.
   */
  installShippedTemplates(typeNames: readonly string[]): Promise<void>;
  /**
   * Write a stack marker file into the host project so type detection sees it.
   * @remarks
   * `cdk.json` is what makes a project detect as the cdk stack, and the cdk
   * template only reaches a host that has one.
   */
  writeHostMarker(fileName: string, contents?: object): Promise<void>;
  /** Write the host manifest, marking the project as a TypeScript stack. */
  writeHostPackage(scripts: Record<string, string>): Promise<void>;
  /** Write a whole host manifest, marking the project as a TypeScript stack. */
  writeHostManifest(manifest: Record<string, unknown>): Promise<void>;
  /** Run the strategy the way an apply drives it. */
  runApply(
    overrides?: Partial<LisaConfig>,
    strategy?: PackageLisaStrategy
  ): Promise<FileOperationResult>;
  /** Read the host manifest's scripts back off disk. */
  hostScripts(): Promise<Record<string, string>>;
  /** Read the whole host manifest back off disk. */
  hostPackage(): Promise<Record<string, unknown>>;
}

/**
 * Build a harness whose temp directories are created and removed per case.
 * @remarks
 * Registers its own `beforeEach`/`afterEach`, so a spec calls this once at
 * `describe` scope and every case gets an untouched Lisa tree and host project.
 * @returns Operations bound to the per-case temp tree
 */
export function createPackageLisaApplyHarness(): PackageLisaApplyHarness {
  // A single replaceable slot rather than a mutated record: the paths are only
  // known once `beforeEach` has run, and an empty-string placeholder would let
  // a misordered call write into the repository root instead of failing.
  const slot: { current: HarnessPaths | undefined } = { current: undefined };

  /**
   * The current case's temp paths.
   * @returns Paths created for this case
   * @throws {Error} When called outside a case the harness set up
   */
  function paths(): HarnessPaths {
    if (slot.current === undefined) {
      throw new Error(
        "package-lisa apply harness used outside a test case; call createPackageLisaApplyHarness() at describe scope"
      );
    }
    return slot.current;
  }

  beforeEach(async () => {
    const tempDir = await createTempDir();
    const lisaDir = path.join(tempDir, "lisa");
    const projectDir = path.join(tempDir, "project");
    await fs.ensureDir(lisaDir);
    await fs.ensureDir(projectDir);
    slot.current = { tempDir, lisaDir, projectDir };
  });

  afterEach(async () => {
    await cleanupTempDir(paths().tempDir);
    slot.current = undefined;
  });

  return harnessOperations(paths);
}

/**
 * The operations a harness exposes, bound to a paths accessor.
 * @remarks
 * Lifted out of the factory so the factory states only lifecycle — a single
 * function carrying both was over this repository's function-length budget.
 * @param paths - Accessor for the current case's temp paths
 * @returns Operations bound to those paths
 */
function harnessOperations(paths: () => HarnessPaths): PackageLisaApplyHarness {
  return {
    async writeTemplate(typeName, template) {
      const file = templatePath(paths().lisaDir, typeName);
      await fs.ensureDir(path.dirname(file));
      await fs.writeJson(file, template);
    },

    async installShippedTemplates(typeNames) {
      for (const typeName of typeNames) {
        const file = templatePath(paths().lisaDir, typeName);
        await fs.ensureDir(path.dirname(file));
        await fs.copy(templatePath(process.cwd(), typeName), file);
      }
    },

    async writeHostMarker(fileName, contents = {}) {
      await fs.writeJson(path.join(paths().projectDir, fileName), contents);
    },

    async writeHostPackage(scripts) {
      await this.writeHostManifest({ scripts });
    },

    async writeHostManifest(manifest) {
      await fs.writeJson(path.join(paths().projectDir, "tsconfig.json"), {});
      await fs.writeJson(path.join(paths().projectDir, PACKAGE_JSON), {
        name: "host-project",
        version: "1.0.0",
        ...manifest,
      });
    },

    async runApply(overrides = {}, strategy = new PackageLisaStrategy()) {
      const context: StrategyContext = {
        config: {
          lisaDir: paths().lisaDir,
          destDir: paths().projectDir,
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
      return strategy.apply(
        templatePath(paths().lisaDir, TYPESCRIPT),
        path.join(paths().projectDir, TEMPLATE_FILE),
        TEMPLATE_FILE,
        context
      );
    },

    async hostScripts() {
      const pkg = (await this.hostPackage()) as {
        scripts: Record<string, string>;
      };
      return pkg.scripts;
    },

    async hostPackage() {
      return (await fs.readJson(
        path.join(paths().projectDir, PACKAGE_JSON)
      )) as Record<string, unknown>;
    },
  };
}

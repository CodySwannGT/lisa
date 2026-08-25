/**
 * The remedy Lisa prints for a refused `$name` rewrite must actually work.
 *
 * CodySwannGT/lisa#3191 is the failure this pins shut: a refusal advised a
 * narrowing that could not be performed, so an operator who followed the
 * instruction was refused a second time and concluded the guard was broken
 * rather than their range wrong. A security control that reads as broken is one
 * that gets routed around, which costs every true positive it was written for.
 *
 * So the assertion here is not "the message mentions a range". It is: take the
 * range Lisa suggests, write it into the host manifest, run the SAME apply
 * again, and watch it succeed. Nothing short of that proves the advice is
 * followable.
 * @module tests/unit/strategies/package-lisa-override-floor-remedy
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { LisaConfig } from "../../../src/core/config.js";
import { suggestSatisfyingDirectRange } from "../../../src/core/override-floors.js";
import { PackageLisaStrategy } from "../../../src/strategies/package-lisa.js";
import type { StrategyContext } from "../../../src/strategies/strategy.interface.js";
import {
  cleanupTempDir,
  createTempDir,
  createTypeScriptProject,
} from "../../helpers/test-utils.js";

const FLOOR = "^8.0.16";
const TOO_LOW = "^8.0.5";
const PACKAGE_JSON = "package.json";
const TS_DEPS = { typescript: "^5.0.0" } as const;

describe("refused $name rewrite: the printed remedy", () => {
  let strategy: PackageLisaStrategy;
  let tempDir: string;
  let lisaDir: string;
  let projectDir: string;
  let sourcePath: string;
  let destPath: string;

  beforeEach(async () => {
    strategy = new PackageLisaStrategy(() => "9.9.9");
    tempDir = await createTempDir();
    lisaDir = path.join(tempDir, "lisa");
    projectDir = path.join(tempDir, "project");
    await fs.ensureDir(lisaDir);
    await createTypeScriptProject(projectDir);

    const templateDir = path.join(lisaDir, "typescript", "package-lisa");
    await fs.ensureDir(templateDir);
    sourcePath = path.join(templateDir, "package.lisa.json");
    await fs.writeJson(sourcePath, { force: { overrides: { vite: FLOOR } } });

    destPath = path.join(projectDir, PACKAGE_JSON);
    await fs.writeJson(destPath, {
      name: "host",
      dependencies: TS_DEPS,
      devDependencies: { vite: TOO_LOW },
    });
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  /**
   * Build a strategy context pointed at the fixture directories.
   * @returns Context for a non-interactive apply
   */
  function createContext(): StrategyContext {
    const config: LisaConfig = {
      lisaDir,
      destDir: projectDir,
      dryRun: false,
      yesMode: true,
      validateOnly: false,
      skipGitCheck: false,
      harness: "claude",
    };
    return {
      config,
      backupFile: async () => {},
      promptOverwrite: async () => true,
    };
  }

  it("refuses the apply and names the verified raise in the refusal itself", async () => {
    await expect(
      strategy.apply(sourcePath, destPath, PACKAGE_JSON, createContext())
    ).rejects.toThrow(
      'Raise the direct dependency vite from "^8.0.5" to "^8.0.16", which Lisa has verified satisfies the floor "^8.0.16".'
    );
  });

  it("applies cleanly once the host writes the suggested range", async () => {
    await expect(
      strategy.apply(sourcePath, destPath, PACKAGE_JSON, createContext())
    ).rejects.toThrow("would widen if rewritten");

    const suggested = suggestSatisfyingDirectRange(FLOOR);
    expect(suggested).toBe(FLOOR);
    await fs.writeJson(destPath, {
      name: "host",
      dependencies: TS_DEPS,
      devDependencies: { vite: suggested },
    });

    const result = await strategy.apply(
      sourcePath,
      destPath,
      PACKAGE_JSON,
      createContext()
    );

    expect(result.action).not.toBe("skipped");
    const written = await fs.readJson(destPath);
    expect(written.overrides.vite).toBe("$vite");
    expect(written.devDependencies.vite).toBe(FLOOR);
  });

  it("applies cleanly for a bounded floor whose obvious caret suggestion would be refused", async () => {
    const boundedFloor = ">=8.0.16 <8.1.0";
    await fs.writeJson(sourcePath, {
      force: { overrides: { vite: boundedFloor } },
    });
    const suggested = suggestSatisfyingDirectRange(boundedFloor);
    // The caret at the floor minimum is NOT a subset of a bounded floor, so a
    // suggestion that skipped verification would send the operator straight
    // back into the refusal.
    expect(suggested).not.toBe("^8.0.16");
    expect(suggested).toBe(boundedFloor);

    await fs.writeJson(destPath, {
      name: "host",
      dependencies: TS_DEPS,
      devDependencies: { vite: suggested },
    });

    await strategy.apply(sourcePath, destPath, PACKAGE_JSON, createContext());

    const written = await fs.readJson(destPath);
    expect(written.overrides.vite).toBe("$vite");
  });
});

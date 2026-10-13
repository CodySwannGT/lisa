/**
 * An install must not move the `quality.yml` pin past the runner-owned gates
 * while the declarations that create their legs are missing (#4449).
 *
 * Lisa 4.80.0 (#3052) deleted five hand-written `quality.yml` jobs because a
 * `declared_gates` leg proves the same property. A leg exists only for a gate
 * the project DECLARES. On a package-manager install (postinstall-safe apply)
 * `EnsureSeededGatesMigration` refuses to write declarations, by rule (#3574):
 * an install must not change what the repository requires. The pin migration
 * used to advance anyway, which delivered the deletion without the
 * declaration, so the five checks vanished. That is a change to what the
 * repository requires, made by an install, in the loosening direction.
 *
 * The fix keeps both halves together. During an install, a project that calls
 * `quality.yml` and lacks any of those declarations keeps its workflow refs
 * where they were, and is told so. A full apply seeds the declarations and
 * moves the pin in the same run, so nothing ever arrives without the other.
 * @module tests/unit/migrations/ensure-pinned-reusable-workflow-refs-seeding-hold
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ReleasePinDependencies } from "../../../src/core/lisa-release-pin.js";
import { SilentLogger } from "../../../src/logging/silent-logger.js";
import { EnsurePinnedReusableWorkflowRefsMigration } from "../../../src/migrations/ensure-pinned-reusable-workflow-refs.js";
import type { MigrationContext } from "../../../src/migrations/migration.interface.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const CI = path.join(".github", "workflows", "ci.yml");
const SHA = "0123456789abcdef0123456789abcdef01234567";
const OLD_SHA = "fedcba9876543210fedcba9876543210fedcba98";

/** The reusable whose pin is under test. */
const QUALITY = "quality.yml";
const TYPE_CORRECTNESS = "type-correctness";

/** The five gates whose jobs #3052 deleted. */
const RUNNER_OWNED = [
  "code-style-slow",
  TYPE_CORRECTNESS,
  "format-conformance",
  "build-integrity",
  "dead-code",
] as const;

/**
 * A caller workflow pointing at one Lisa reusable at a given ref.
 * @param file - Reusable workflow file name
 * @param ref - The ref the caller points at
 * @returns Workflow YAML
 */
const caller = (file: string, ref: string): string =>
  `name: CI\non:\n  pull_request:\njobs:\n  job:\n    uses: CodySwannGT/lisa/.github/workflows/${file}@${ref} # v4.70.0\n`;

/**
 * A gates block declaring every runner-owned gate at pull-request.
 * @param level - The level each is declared at
 * @returns The gates block
 */
const declaredAll = (level: string): Record<string, unknown> =>
  Object.fromEntries(
    RUNNER_OWNED.map(gate => [gate, { "pull-request": level }])
  );

describe("EnsurePinnedReusableWorkflowRefsMigration during an install", () => {
  let tempDir: string;
  let projectDir: string;
  let lisaDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    projectDir = path.join(tempDir, "project");
    lisaDir = path.join(tempDir, "lisa");
    await fs.ensureDir(path.join(projectDir, ".github", "workflows"));
    await fs.ensureDir(lisaDir);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  const deps = (): ReleasePinDependencies => ({
    readVersion: () => "4.80.1",
    readStampedCommit: () => SHA,
    readStampedTag: () => "v4.80.1",
    resolveTagCommit: async () => null,
  });

  const context = (postinstallSafe: boolean): MigrationContext => ({
    projectDir,
    lisaDir,
    detectedTypes: ["typescript"],
    dryRun: false,
    logger: new SilentLogger(),
    postinstallSafe,
  });

  /**
   * Write the project's `.lisa.config.json`.
   * @param gates - The gates block, or undefined for a config without one
   * @returns Resolves once written
   */
  const writeConfig = async (gates?: Record<string, unknown>): Promise<void> =>
    fs.writeJson(
      path.join(projectDir, ".lisa.config.json"),
      gates === undefined ? {} : { gates }
    );

  const readCi = (): Promise<string> =>
    fs.readFile(path.join(projectDir, CI), "utf8");

  it("holds the quality.yml pin when the runner-owned gates are undeclared", async () => {
    await fs.writeFile(path.join(projectDir, CI), caller(QUALITY, OLD_SHA));
    await writeConfig();
    const before = await readCi();
    const migration = new EnsurePinnedReusableWorkflowRefsMigration(deps());

    const result = await migration.apply(context(true));

    expect(result.action).toBe("skipped");
    expect(result.message).toContain(TYPE_CORRECTNESS);
    expect(result.message).toContain("npx @codyswann/lisa@latest .");
    expect(await readCi()).toBe(before);
  });

  it("holds while even one runner-owned gate is undeclared", async () => {
    await fs.writeFile(path.join(projectDir, CI), caller(QUALITY, OLD_SHA));
    const gates = declaredAll("required");
    delete gates["dead-code"];
    await writeConfig(gates);
    const migration = new EnsurePinnedReusableWorkflowRefsMigration(deps());

    const result = await migration.apply(context(true));

    expect(result.action).toBe("skipped");
    expect(result.message).toContain("dead-code");
    expect(result.message).not.toContain(TYPE_CORRECTNESS);
  });

  it("advances the pin when every runner-owned gate is declared, off included", async () => {
    await fs.writeFile(path.join(projectDir, CI), caller(QUALITY, OLD_SHA));
    await writeConfig({
      ...declaredAll("required"),
      "build-integrity": { "pull-request": "off" },
    });
    const migration = new EnsurePinnedReusableWorkflowRefsMigration(deps());

    const result = await migration.apply(context(true));

    expect(result.action).toBe("applied");
    expect(await readCi()).toContain(`quality.yml@${SHA}`);
  });

  it("advances the pin on a full apply, where seeding runs in the same apply", async () => {
    await fs.writeFile(path.join(projectDir, CI), caller(QUALITY, OLD_SHA));
    await writeConfig();
    const migration = new EnsurePinnedReusableWorkflowRefsMigration(deps());

    const result = await migration.apply(context(false));

    expect(result.action).toBe("applied");
    expect(await readCi()).toContain(`quality.yml@${SHA}`);
  });

  it("does not hold a project that calls no quality.yml", async () => {
    await fs.writeFile(
      path.join(projectDir, CI),
      caller("create-issue-on-failure.yml", OLD_SHA)
    );
    await writeConfig();
    const migration = new EnsurePinnedReusableWorkflowRefsMigration(deps());

    const result = await migration.apply(context(true));

    expect(result.action).toBe("applied");
  });

  it("says nothing when the pin is already where it would go", async () => {
    await fs.writeFile(
      path.join(projectDir, CI),
      caller(QUALITY, SHA).replace("# v4.70.0", "# v4.80.1")
    );
    await writeConfig();
    const migration = new EnsurePinnedReusableWorkflowRefsMigration(deps());

    expect(await migration.applies(context(true))).toBe(false);
  });
});

/**
 * Tests for the oxlint vendoring migration (issue #2465).
 */
import os from "node:os";
import path from "node:path";

import fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ProjectType } from "../../../src/core/config.js";
import { SilentLogger } from "../../../src/logging/silent-logger.js";
import { EnsureOxlintBaseConfigsMigration } from "../../../src/migrations/ensure-oxlint-base-configs.js";
import type { MigrationContext } from "../../../src/migrations/migration.interface.js";

const OXLINTRC = ".oxlintrc.json";
const VENDOR_DIR = path.join(".lisa", "lisa-oxlint");
const LEGACY = "./node_modules/@codyswann/lisa/oxlint/typescript.json";
const VENDORED = "./.lisa/lisa-oxlint/typescript.json";
/** Basenames of the fixture configs, reused across assertions. */
const BASE_JSON = "base.json";
const TYPESCRIPT_JSON = "typescript.json";
/** Exact content the fixture's typescript config must hold once vendored. */
const TYPESCRIPT_CONFIG = {
  extends: [`./${BASE_JSON}`],
  plugins: ["typescript"],
} as const;

describe("EnsureOxlintBaseConfigsMigration", () => {
  const migration = new EnsureOxlintBaseConfigsMigration();
  let tempDir: string;
  let projectDir: string;
  let lisaDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "lisa-oxlint-"));
    lisaDir = path.join(tempDir, "lisa");
    projectDir = path.join(tempDir, "project");
    await fs.ensureDir(projectDir);
    // A miniature copy of Lisa's own `oxlint/` directory, chain included.
    await fs.ensureDir(path.join(lisaDir, "oxlint"));
    await fs.writeJson(path.join(lisaDir, "oxlint", BASE_JSON), {
      rules: { "no-debugger": "error" },
    });
    await fs.writeJson(
      path.join(lisaDir, "oxlint", TYPESCRIPT_JSON),
      TYPESCRIPT_CONFIG
    );
    await fs.writeJson(path.join(lisaDir, "oxlint", "expo.json"), {
      extends: [`./${TYPESCRIPT_JSON}`],
      plugins: ["react"],
    });
  });

  afterEach(async () => {
    await fs.remove(tempDir);
  });

  const ctx = (dryRun = false): MigrationContext => ({
    projectDir,
    lisaDir,
    detectedTypes: ["typescript"] as ProjectType[],
    dryRun,
    logger: new SilentLogger(),
  });

  const writeOxlintrc = (config: unknown): Promise<void> =>
    fs.writeJson(path.join(projectDir, OXLINTRC), config, { spaces: 2 });

  const readOxlintrc = (): Promise<{ readonly extends?: readonly string[] }> =>
    fs.readJson(path.join(projectDir, OXLINTRC));

  const vendored = (name: string): string =>
    path.join(projectDir, VENDOR_DIR, name);

  it("is a noop when the project has no .oxlintrc.json", async () => {
    expect(await migration.applies(ctx())).toBe(false);
    expect((await migration.apply(ctx())).action).toBe("noop");
  });

  it("is a noop for Lisa's own repo, which extends its in-repo oxlint/", async () => {
    await writeOxlintrc({ extends: ["./oxlint/typescript.json"] });
    expect(await migration.applies(ctx())).toBe(false);
  });

  it("vendors the referenced config and its whole extends chain", async () => {
    await writeOxlintrc({ extends: [VENDORED] });
    expect(await migration.applies(ctx())).toBe(true);
    await migration.apply(ctx());

    expect(await fs.readJson(vendored(TYPESCRIPT_JSON))).toEqual(
      TYPESCRIPT_CONFIG
    );
    // The transitive parent must come along or the chain dangles.
    expect(await fs.readJson(vendored(BASE_JSON))).toEqual({
      rules: { "no-debugger": "error" },
    });
  });

  it("vendors the full chain for a child stack", async () => {
    await writeOxlintrc({ extends: ["./.lisa/lisa-oxlint/expo.json"] });
    await migration.apply(ctx());

    for (const name of ["expo.json", TYPESCRIPT_JSON, BASE_JSON]) {
      expect(await fs.pathExists(vendored(name))).toBe(true);
    }
  });

  it("prunes the legacy node_modules extends entry left behind by array-union merge", async () => {
    // The `merge` strategy unions arrays and never removes entries, so an
    // upgraded host carries BOTH paths. oxlint hard-fails on the unresolvable
    // one, so pruning is what actually fixes existing projects.
    await writeOxlintrc({ extends: [LEGACY, VENDORED] });
    expect(await migration.applies(ctx())).toBe(true);
    await migration.apply(ctx());

    expect((await readOxlintrc()).extends).toEqual([VENDORED]);
  });

  it("replaces a legacy-only extends with the vendored equivalent", async () => {
    await writeOxlintrc({ extends: [LEGACY] });
    expect(await migration.applies(ctx())).toBe(true);
    await migration.apply(ctx());

    expect((await readOxlintrc()).extends).toEqual([VENDORED]);
    expect(await fs.pathExists(vendored(TYPESCRIPT_JSON))).toBe(true);
  });

  it("preserves host-authored extends entries and other keys", async () => {
    await writeOxlintrc({
      extends: [LEGACY, "./config/house-rules.json"],
      rules: { "no-console": "off" },
    });
    await migration.apply(ctx());

    const result = await readOxlintrc();
    expect(result.extends).toEqual([VENDORED, "./config/house-rules.json"]);
    expect(result).toMatchObject({ rules: { "no-console": "off" } });
  });

  it("is idempotent", async () => {
    await writeOxlintrc({ extends: [VENDORED] });
    await migration.apply(ctx());
    const first = await readOxlintrc();

    expect(await migration.applies(ctx())).toBe(false);
    await migration.apply(ctx());
    expect(await readOxlintrc()).toEqual(first);
  });

  it("refreshes a stale vendored config so hosts cannot pin old rules", async () => {
    await writeOxlintrc({ extends: [VENDORED] });
    await fs.ensureDir(path.join(projectDir, VENDOR_DIR));
    await fs.writeJson(vendored(TYPESCRIPT_JSON), { plugins: ["stale"] });

    expect(await migration.applies(ctx())).toBe(true);
    await migration.apply(ctx());
    expect(await fs.readJson(vendored(TYPESCRIPT_JSON))).toEqual(
      TYPESCRIPT_CONFIG
    );
  });

  it("writes nothing in dry-run mode", async () => {
    await writeOxlintrc({ extends: [LEGACY, VENDORED] });
    const result = await migration.apply(ctx(true));

    expect(result.action).toBe("applied");
    expect(await fs.pathExists(vendored(TYPESCRIPT_JSON))).toBe(false);
    expect((await readOxlintrc()).extends).toEqual([LEGACY, VENDORED]);
  });

  it("leaves the host alone when Lisa ships no such config", async () => {
    await writeOxlintrc({ extends: ["./.lisa/lisa-oxlint/rails.json"] });
    const result = await migration.apply(ctx());

    expect(result.action).toBe("noop");
    expect(await fs.pathExists(vendored("rails.json"))).toBe(false);
  });
});

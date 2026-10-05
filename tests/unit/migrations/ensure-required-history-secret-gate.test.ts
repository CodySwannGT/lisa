/**
 * @file ensure-required-history-secret-gate.test.ts
 * @description Required Rails policy is explicit, idempotent and preserves unrelated declarations.
 * @module tests/migrations
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EnsureRequiredHistorySecretGateMigration } from "../../../src/migrations/ensure-required-history-secret-gate.js";
import type { MigrationContext } from "../../../src/migrations/migration.interface.js";
import { SilentLogger } from "../../../src/logging/silent-logger.js";
const CONFIG = ".lisa.config.json";
describe("Rails required history migration", () => {
  it("seeds only the authored property and reapplies without drift", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "history-policy-"));
    const migration = new EnsureRequiredHistorySecretGateMigration();
    const ctx = {
      projectDir,
      lisaDir: projectDir,
      detectedTypes: ["rails"],
      dryRun: false,
      logger: new SilentLogger(),
    } as MigrationContext;
    try {
      await mkdir(join(projectDir, ".github/workflows"), { recursive: true });
      await writeFile(
        join(projectDir, ".github/workflows/ci.yml"),
        "jobs:\n  quality:\n    name: Quality Checks\n    uses: CodySwannGT/lisa/.github/workflows/quality-rails.yml@main\n"
      );
      const original = {
        gates: {
          runner: "just",
          "credential-leakage": { "pull-request": "optional" },
        },
      };
      await writeFile(join(projectDir, CONFIG), JSON.stringify(original));
      expect(await migration.applies(ctx)).toBe(true);
      expect(
        (await migration.apply({ ...ctx, postinstallSafe: true })).action
      ).toBe("skipped");
      expect(
        JSON.parse(await readFile(join(projectDir, CONFIG), "utf8"))
      ).toEqual(original);
      expect((await migration.apply(ctx)).action).toBe("applied");
      const config = JSON.parse(
        await readFile(join(projectDir, CONFIG), "utf8")
      );
      expect(config.gates.runner).toBe("just");
      expect(config.gates["credential-leakage"]).toEqual(
        original.gates["credential-leakage"]
      );
      expect(config.gates["introduced-history-credential-leakage"].push).toBe(
        "required"
      );
      expect((await migration.apply(ctx)).action).toBe("noop");
      expect(
        await migration.applies({ ...ctx, detectedTypes: ["typescript"] })
      ).toBe(false);
      config.gates["introduced-history-credential-leakage"].push = "off";
      await writeFile(join(projectDir, CONFIG), JSON.stringify(config));
      await expect(migration.apply(ctx)).rejects.toThrow(/conflicts/u);
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });
});

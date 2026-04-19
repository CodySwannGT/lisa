import * as os from "node:os";
import * as path from "node:path";
import { SilentLogger } from "../../../src/logging/silent-logger.js";
import { MigrationRegistry } from "../../../src/migrations/index.js";
import type {
  Migration,
  MigrationContext,
  MigrationResult,
} from "../../../src/migrations/migration.interface.js";

const FAKE_PROJECT = path.join(os.tmpdir(), "lisa-registry-test-project");
const FAKE_LISA = path.join(os.tmpdir(), "lisa-registry-test-lisa");

/**
 * Build a migration context for testing
 * @param dryRun - Whether to run in dry-run mode
 * @returns A migration context with fake paths
 */
function makeContext(dryRun = false): MigrationContext {
  return {
    projectDir: FAKE_PROJECT,
    lisaDir: FAKE_LISA,
    detectedTypes: ["typescript"],
    dryRun,
    logger: new SilentLogger(),
  };
}

/**
 * Build a fake migration that records invocations
 * @param name - Migration name
 * @param shouldApply - Whether `applies` should return true
 * @param captured - Mutable list to capture invocations
 * @returns A fake Migration that records its calls into `captured`
 */
function makeFakeMigration(
  name: string,
  shouldApply: boolean,
  captured: string[]
): Migration {
  return {
    name,
    description: `fake ${name}`,
    async applies(): Promise<boolean> {
      captured.push(`${name}:applies`);
      return shouldApply;
    },
    async apply(ctx: MigrationContext): Promise<MigrationResult> {
      captured.push(`${name}:apply:dryRun=${String(ctx.dryRun)}`);
      return {
        name,
        action: "applied",
        changedFiles: [`${name}.txt`],
        message: `applied ${name}`,
      };
    },
  };
}

describe("MigrationRegistry", () => {
  it("defaults to the built-in migrations", () => {
    const registry = new MigrationRegistry();
    const names = registry.getAll().map(m => m.name);

    expect(names).toContain("ensure-tsconfig-local-includes");
    expect(names).toContain("ensure-audit-ignore-local-exclusions");
    expect(names).toContain("ensure-lisa-postinstall");
  });

  it("runs only applicable migrations", async () => {
    const captured: string[] = [];
    const registry = new MigrationRegistry([
      makeFakeMigration("alpha", true, captured),
      makeFakeMigration("beta", false, captured),
    ]);

    const results = await registry.runAll(makeContext());

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ name: "alpha", action: "applied" });
    expect(results[1]).toMatchObject({ name: "beta", action: "skipped" });
    expect(captured).toEqual([
      "alpha:applies",
      "alpha:apply:dryRun=false",
      "beta:applies",
    ]);
  });

  it("propagates dryRun through the context", async () => {
    const captured: string[] = [];
    const registry = new MigrationRegistry([
      makeFakeMigration("alpha", true, captured),
    ]);

    await registry.runAll(makeContext(true));

    expect(captured).toEqual(["alpha:applies", "alpha:apply:dryRun=true"]);
  });

  it("invokes beforeStrategies on every migration that implements it", async () => {
    const captured: string[] = [];
    const alpha: Migration = {
      name: "alpha",
      description: "alpha",
      async beforeStrategies(): Promise<void> {
        captured.push("alpha:before");
      },
      async applies(): Promise<boolean> {
        return false;
      },
      async apply(): Promise<MigrationResult> {
        return { name: "alpha", action: "noop" };
      },
    };
    const beta: Migration = {
      name: "beta",
      description: "beta",
      async applies(): Promise<boolean> {
        return false;
      },
      async apply(): Promise<MigrationResult> {
        return { name: "beta", action: "noop" };
      },
    };
    const gamma: Migration = {
      name: "gamma",
      description: "gamma",
      async beforeStrategies(): Promise<void> {
        captured.push("gamma:before");
      },
      async applies(): Promise<boolean> {
        return false;
      },
      async apply(): Promise<MigrationResult> {
        return { name: "gamma", action: "noop" };
      },
    };
    const registry = new MigrationRegistry([alpha, beta, gamma]);

    await registry.runBeforeStrategies(makeContext());

    expect(captured).toEqual(["alpha:before", "gamma:before"]);
  });

  it("returns aggregated results preserving migration order", async () => {
    const captured: string[] = [];
    const registry = new MigrationRegistry([
      makeFakeMigration("alpha", true, captured),
      makeFakeMigration("beta", true, captured),
      makeFakeMigration("gamma", false, captured),
    ]);

    const results = await registry.runAll(makeContext());

    expect(results.map(r => r.name)).toEqual(["alpha", "beta", "gamma"]);
    expect(results.map(r => r.action)).toEqual([
      "applied",
      "applied",
      "skipped",
    ]);
  });
});

import * as path from "node:path";
import { LISA_PACKAGE_NAME } from "../core/self-apply.js";
import { readJsonOrNull, writeJson } from "../utils/json-utils.js";
import type {
  Migration,
  MigrationContext,
  MigrationResult,
} from "./migration.interface.js";

const PACKAGE_JSON = "package.json";

/** Suffix of the forced wrapper script each plain alias delegates to. */
const WRAPPER_SUFFIX = ":lisa";

/**
 * Every value Lisa itself ever shipped for a plain test alias, by key.
 *
 * Generated from the git history of each stack's
 * `package-lisa/package.lisa.json` (force and defaults), minus the current
 * `$npm_execpath run <key>:lisa` form. The plain aliases are template
 * `defaults`, so an apply preserves whatever a host already has, and a host
 * that adopted Lisa early kept a raw `vitest run` / `jest` value that skips
 * `lisa-test-run --profile <stack>`. That wrapper is what registers stack
 * scratch such as `cdk.out`, so those hosts fail the scratch-leak check on
 * suites whose every test passes (CodySwannGT/lisa#4786).
 *
 * Exact-match only: a value not in this table is the project's own choice and
 * is never touched. Entries are permanent — a host that has not re-applied
 * still carries its old value, so removing one would strand it.
 */
export const LEGACY_TEST_SCRIPT_VALUES: Readonly<
  Record<string, readonly string[]>
> = Object.freeze({
  test: Object.freeze([
    "NODE_ENV=test jest",
    "NODE_ENV=test jest --passWithNoTests",
    "NODE_ENV=test lisa-test-run --profile expo --adapter direct -- jest",
    "lisa-test-run --profile cdk --adapter vitest -- vitest run",
    "lisa-test-run --profile harper-fabric --adapter vitest -- vitest run",
    "lisa-test-run --profile nestjs --adapter vitest -- vitest run",
    "lisa-test-run --profile phaser --adapter vitest -- vitest run",
    "lisa-test-run --profile typescript --adapter vitest -- vitest run",
    "vitest run",
  ]),
  "test:cov": Object.freeze([
    "NODE_ENV=test jest --coverage",
    "NODE_ENV=test lisa-test-run --profile expo --adapter direct -- jest --coverage",
    "lisa-test-run --profile cdk --adapter vitest -- vitest run --coverage",
    "lisa-test-run --profile harper-fabric --adapter vitest -- vitest run --coverage",
    "lisa-test-run --profile nestjs --adapter vitest -- vitest run --coverage",
    "lisa-test-run --profile phaser --adapter vitest -- vitest run --coverage",
    "lisa-test-run --profile typescript --adapter vitest -- vitest run --coverage",
    "vitest run --coverage",
  ]),
  "test:cov:unit": Object.freeze([
    'LISA_COVERAGE_SCOPE=unit NODE_ENV=test jest --coverage --testPathIgnorePatterns="\\.integration[.\\\\-](test|spec)\\.(ts|tsx)$"',
    'LISA_COVERAGE_SCOPE=unit NODE_ENV=test lisa-test-run --profile expo --adapter direct -- jest --coverage --testPathIgnorePatterns="\\.integration[.\\\\-](test|spec)\\.(ts|tsx)$"',
    "LISA_COVERAGE_SCOPE=unit lisa-test-run --profile cdk --adapter vitest -- vitest run --coverage --exclude='**/integration/**'",
    "LISA_COVERAGE_SCOPE=unit lisa-test-run --profile harper-fabric --adapter vitest -- vitest run --coverage --exclude='**/integration/**'",
    "LISA_COVERAGE_SCOPE=unit lisa-test-run --profile nestjs --adapter vitest -- vitest run --coverage --exclude='**/integration/**' --exclude='**/*.integration.*'",
    "LISA_COVERAGE_SCOPE=unit lisa-test-run --profile phaser --adapter vitest -- vitest run --coverage --exclude='**/integration/**'",
    "LISA_COVERAGE_SCOPE=unit lisa-test-run --profile phaser --adapter vitest -- vitest run --coverage --exclude='**/integration/**' --exclude='**/*.integration.*'",
    "LISA_COVERAGE_SCOPE=unit lisa-test-run --profile typescript --adapter vitest -- vitest run --coverage --exclude='**/integration/**'",
    "LISA_COVERAGE_SCOPE=unit vitest run --coverage --exclude='**/integration/**'",
    "LISA_COVERAGE_SCOPE=unit vitest run --coverage --exclude='**/integration/**' --exclude='**/*.integration.*'",
    'NODE_ENV=test jest --coverage --testPathIgnorePatterns="\\.integration[.\\\\-](test|spec)\\.(ts|tsx)$"',
    "vitest run --coverage --exclude='**/integration/**'",
    "vitest run --coverage --exclude='**/integration/**' --exclude='**/*.integration.*'",
  ]),
  "test:integration": Object.freeze([
    'NODE_ENV=test jest --testPathPatterns="\\.integration[.\\\\-](test|spec)\\.(ts|tsx)$"',
    'NODE_ENV=test jest --testPathPatterns="\\.integration[.\\\\-](test|spec)\\.(ts|tsx)$" --passWithNoTests',
    'NODE_ENV=test jest --testPathPatterns="\\.integration\\.test\\.(ts|tsx)$" --passWithNoTests',
    "vitest run '.integration.'",
    "vitest run '.integration.' --passWithNoTests",
    "vitest run test/integration",
    "vitest run tests/integration",
    "vitest run tests/integration --passWithNoTests",
  ]),
  "test:node": Object.freeze([
    "LISA_TEST_SCRATCH_PREFIXES='[\"node-\"]' lisa-test-run --profile cdk --adapter direct -- node scripts/lisa-test-node.mjs",
    "LISA_TEST_SCRATCH_PREFIXES='[\"node-\"]' lisa-test-run --profile expo --adapter direct -- node scripts/lisa-test-node.mjs",
    "LISA_TEST_SCRATCH_PREFIXES='[\"node-\"]' lisa-test-run --profile harper-fabric --adapter direct -- node scripts/lisa-test-node.mjs",
    "LISA_TEST_SCRATCH_PREFIXES='[\"node-\"]' lisa-test-run --profile nestjs --adapter direct -- node scripts/lisa-test-node.mjs",
    "LISA_TEST_SCRATCH_PREFIXES='[\"node-\"]' lisa-test-run --profile phaser --adapter direct -- node scripts/lisa-test-node.mjs",
    "LISA_TEST_SCRATCH_PREFIXES='[\"node-\"]' lisa-test-run --profile typescript --adapter direct -- node scripts/lisa-test-node.mjs",
    "node scripts/lisa-test-node.mjs",
  ]),
  "test:unit": Object.freeze([
    'NODE_ENV=test jest --testPathIgnorePatterns="\\.integration[.\\\\-](test|spec)\\.(ts|tsx)$"',
    'NODE_ENV=test jest --testPathIgnorePatterns="\\.integration[.\\\\-](test|spec)\\.(ts|tsx)$" --passWithNoTests',
    'NODE_ENV=test jest --testPathIgnorePatterns="\\.integration\\.test\\.(ts|tsx)$" --passWithNoTests',
    'NODE_ENV=test lisa-test-run --profile expo --adapter direct -- jest --testPathIgnorePatterns="\\.integration[.\\\\-](test|spec)\\.(ts|tsx)$"',
    "lisa-test-run --profile cdk --adapter vitest -- vitest run --exclude='**/integration/**'",
    "lisa-test-run --profile harper-fabric --adapter vitest -- vitest run --exclude='**/integration/**'",
    "lisa-test-run --profile nestjs --adapter vitest -- vitest run --exclude='**/integration/**'",
    "lisa-test-run --profile nestjs --adapter vitest -- vitest run --exclude='**/integration/**' --exclude='**/*.integration.*'",
    "lisa-test-run --profile phaser --adapter vitest -- vitest run --exclude='**/integration/**'",
    "lisa-test-run --profile phaser --adapter vitest -- vitest run --exclude='**/integration/**' --exclude='**/*.integration.*'",
    "lisa-test-run --profile typescript --adapter vitest -- vitest run --exclude='**/integration/**'",
    "vitest run --exclude='**/integration/**'",
  ]),
  "test:watch": Object.freeze([
    "NODE_ENV=test jest --watch",
    "NODE_ENV=test lisa-test-run --profile expo --adapter direct -- jest --watch",
    "lisa-test-run --profile cdk --adapter vitest -- vitest",
    "lisa-test-run --profile harper-fabric --adapter vitest -- vitest",
    "lisa-test-run --profile nestjs --adapter vitest -- vitest",
    "lisa-test-run --profile phaser --adapter vitest -- vitest",
    "lisa-test-run --profile typescript --adapter vitest -- vitest",
    "vitest",
  ]),
});

/** Minimal package.json shape this migration reads and writes. */
interface PackageJson {
  readonly name?: string;
  readonly scripts?: Readonly<Record<string, string>>;
  readonly [key: string]: unknown;
}

/**
 * The aliases to rewrite: a Lisa-shipped legacy value with its wrapper present.
 * @param scripts - The host's scripts
 * @returns Alias names whose value should delegate to `<alias>:lisa`
 */
export function legacyAliases(
  scripts: Readonly<Record<string, string>>
): readonly string[] {
  return Object.keys(LEGACY_TEST_SCRIPT_VALUES).filter(alias => {
    const value = scripts[alias];
    return (
      value !== undefined &&
      scripts[`${alias}${WRAPPER_SUFFIX}`] !== undefined &&
      (LEGACY_TEST_SCRIPT_VALUES[alias] ?? []).includes(value)
    );
  });
}

/**
 * The delegating value for one alias.
 * @param alias - Plain script name, e.g. `test:cov:unit`
 * @returns `$npm_execpath run <alias>:lisa`
 */
function delegation(alias: string): string {
  return `$npm_execpath run ${alias}${WRAPPER_SUFFIX}`;
}

/**
 * Migration: point Lisa-shipped legacy test aliases at their `:lisa` wrappers.
 */
export class DelegateLegacyTestScriptsMigration implements Migration {
  readonly name = "delegate-legacy-test-scripts";
  readonly description =
    "Rewrite test aliases still holding a value Lisa used to ship so they delegate to their lisa-test-run wrapper";

  /**
   * Whether any alias still holds a Lisa-shipped legacy value.
   * @param ctx - Migration context
   * @returns True when at least one alias would be rewritten
   */
  async applies(ctx: MigrationContext): Promise<boolean> {
    const pkg = await readJsonOrNull<PackageJson>(
      path.join(ctx.projectDir, PACKAGE_JSON)
    );
    if (!pkg?.scripts || pkg.name === LISA_PACKAGE_NAME) return false;
    return legacyAliases(pkg.scripts).length > 0;
  }

  /**
   * Rewrite each legacy alias to delegate to its wrapper.
   * @param ctx - Migration context
   * @returns Result naming the rewritten aliases
   */
  async apply(ctx: MigrationContext): Promise<MigrationResult> {
    const pkgPath = path.join(ctx.projectDir, PACKAGE_JSON);
    const pkg = await readJsonOrNull<PackageJson>(pkgPath);
    const scripts = pkg?.scripts;
    if (!pkg || !scripts || pkg.name === LISA_PACKAGE_NAME) {
      return { name: this.name, action: "noop" };
    }
    const aliases = legacyAliases(scripts);
    if (aliases.length === 0) return { name: this.name, action: "noop" };

    const message = `Delegated legacy test scripts to their lisa-test-run wrappers: ${aliases.join(", ")}`;
    if (ctx.dryRun) {
      ctx.logger.dry(`Would update package.json ${aliases.join(", ")}`);
      return {
        name: this.name,
        action: "applied",
        changedFiles: [PACKAGE_JSON],
        message,
      };
    }
    const rewritten = Object.fromEntries(
      aliases.map(alias => [alias, delegation(alias)])
    );
    await writeJson(pkgPath, { ...pkg, scripts: { ...scripts, ...rewritten } });
    ctx.logger.success(message);
    return {
      name: this.name,
      action: "applied",
      changedFiles: [PACKAGE_JSON],
      message,
    };
  }
}

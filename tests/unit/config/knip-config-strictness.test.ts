/**
 * Every knip config Lisa runs or ships tells the dead-code gate nothing to
 * look away from (CodySwannGT/lisa#4932).
 *
 * The gate is only as honest as the list of things it was told not to check.
 * Lisa's own `knip.json` and every stack's `copy-overwrite/knip.json` once
 * carried `ignoreDependencies`, `ignoreBinaries`, `"devDependencies": "off"`
 * and an `ignore` list that removed every test file from analysis. Together
 * they hid dependencies unused since the Jest configs were removed, orphaned
 * test helpers, and binaries nothing declared — and every host inherited the
 * same blind spots through the stack templates.
 *
 * A dependency, binary or file the gate cannot see is fixed where it lives:
 * removed when unused, or made visible through a plugin, an entry or a
 * declaration. It is never listed here. The configs are DISCOVERED, so a new
 * stack's `knip.json` is held to this the moment it exists. The `knip.ts` an
 * Expo host is told to write (the `knip-platform-files` skill's worked
 * example, built on `@codyswann/lisa/knip`) is evaluated and held to the same
 * bar, so the documented fix can never carry an exemption either.
 * @module tests/unit/config/knip-config-strictness
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { minimatch } from "minimatch";
import { describe, expect, it } from "vitest";

import {
  againstSource,
  workedExample,
} from "../../helpers/expo-knip-fixture.js";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/** Options that exempt dependencies, binaries or findings by name. */
const EXEMPTION_KEYS = [
  "ignoreDependencies",
  "ignoreBinaries",
  "ignoreUnresolved",
  "ignoreMembers",
  "ignoreIssues",
] as const;

/**
 * Options that relax a check for every name at once. `ignoreExportsUsedInFile`
 * stops reporting an export whose only user is its own module, which is
 * exactly the dead surface the gate exists to find.
 */
const RELAXATION_KEYS = ["ignoreExportsUsedInFile"] as const;

/**
 * Ordinary modules in every layout a stack uses: code another module imports.
 * An `entry` glob matching any of them makes every such file an entry point,
 * so the gate can never call one unused and never reports its unused exports.
 * Entries are a project's real starting points — its manifest's `main`,
 * `bin` and `exports` (knip reads those itself), framework conventions such as
 * routes, handlers and migrations, and runnable scripts.
 */
const ORDINARY_MODULE_PROBES = [
  "src/services/user-service.ts",
  "src/utils/format.ts",
  "src/users/users.service.ts",
  "lib/app-stack.ts",
  "lib/util/format.ts",
  "components/Button.tsx",
  "src/components/Button.tsx",
  "src/features/profile/hooks/useProfile.ts",
  "hooks/useThing.ts",
  "utils/date.ts",
] as const;

/**
 * Files a stack's framework loads by a path string, so nothing imports them and
 * only an entry keeps them from being reported unused. A CDK `NodejsFunction`
 * names its handler file directly (`entry: "lambda/process-order.ts"`), under
 * any name, and a copy-overwrite config leaves the host no way to add one.
 */
const FRAMEWORK_ENTRY_PROBES: Readonly<Record<string, readonly string[]>> = {
  "cdk/copy-overwrite/knip.json": [
    "lambda/process-order.ts",
    "lambdas/orders/process-order.ts",
    "functions/api/get-user.ts",
  ],
};

/**
 * Test-file paths in every layout a stack uses. An `ignore` glob matching any
 * of them takes tests out of the analysis the issue requires them to be in.
 */
const TEST_FILE_PROBES = [
  "src/index.test.ts",
  "src/index.spec.ts",
  "src/components/button.test.tsx",
  "src/__tests__/index.ts",
  "src/__mocks__/fs.ts",
  "tests/unit/index.test.ts",
  "tests/e2e/smoke.ts",
  "test/index.ts",
  "e2e/login.spec.ts",
] as const;

/** One parsed knip config and the scopes inside it that take options. */
interface KnipConfig {
  readonly file: string;
  readonly scopes: readonly Readonly<Record<string, unknown>>[];
}

/**
 * Root config plus every workspace override inside it.
 * @param file - Repo-relative path of the knip config
 * @returns The parsed config and each options scope it declares
 */
function readConfig(file: string): KnipConfig {
  const parsed = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, file), "utf8")
  ) as Record<string, unknown>;
  const workspaces = (parsed.workspaces ?? {}) as Record<
    string,
    Record<string, unknown>
  >;
  return { file, scopes: [parsed, ...Object.values(workspaces)] };
}

/**
 * The skill's worked-example `knip.ts`, evaluated as knip would load it.
 * @returns The config object it exports, as a parsed config
 */
async function evaluatedWorkedExample(): Promise<KnipConfig> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-knip-ts-"));
  const file = path.join(dir, "knip.ts");
  fs.writeFileSync(file, againstSource(workedExample()));
  return import(pathToFileURL(file).href)
    .then((loaded: { default: Record<string, unknown> }) => ({
      file: "knip-platform-files/SKILL.md knip.ts",
      scopes: [
        loaded.default,
        ...Object.values(
          (loaded.default.workspaces ?? {}) as Record<
            string,
            Record<string, unknown>
          >
        ),
      ],
    }))
    .finally(() => fs.rmSync(dir, { recursive: true, force: true }));
}

/**
 * Lisa's own config and every stack config a host receives.
 * @returns Repo-relative paths, Lisa's own first
 */
function discoverConfigs(): readonly string[] {
  const shipped = fs
    .readdirSync(REPO_ROOT, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !entry.name.startsWith("."))
    .map(entry => path.join(entry.name, "copy-overwrite", "knip.json"))
    .filter(file => fs.existsSync(path.join(REPO_ROOT, file)))
    .sort((a, b) => (a < b ? -1 : Number(a > b)));
  return ["knip.json", ...shipped];
}

const CONFIGS = discoverConfigs().map(readConfig);

/**
 * Every exemption a config carries, as `file: key` lines.
 * @param config - Parsed config
 * @returns One line per exempting key found, in any scope
 */
function exemptions(config: KnipConfig): readonly string[] {
  return config.scopes.flatMap(scope =>
    EXEMPTION_KEYS.filter(key => key in scope).map(
      key => `${config.file}: ${key}`
    )
  );
}

/**
 * Every option a config sets that relaxes a check for all names.
 * @param config - Parsed config
 * @returns One `file: key` line per relaxation found, in any scope
 */
function relaxations(config: KnipConfig): readonly string[] {
  return config.scopes.flatMap(scope =>
    RELAXATION_KEYS.filter(key => key in scope).map(
      key => `${config.file}: ${key}`
    )
  );
}

/**
 * Every `entry` glob that turns an ordinary module into an entry point.
 * @param config - Parsed config
 * @returns One `file: glob` line per offending pattern
 */
function blanketEntries(config: KnipConfig): readonly string[] {
  return config.scopes.flatMap(scope => {
    const entry = scope.entry;
    const patterns = Array.isArray(entry)
      ? (entry as string[])
      : typeof entry === "string"
        ? [entry]
        : [];
    return patterns
      .filter(pattern =>
        ORDINARY_MODULE_PROBES.some(probe =>
          minimatch(probe, pattern, { dot: true })
        )
      )
      .map(pattern => `${config.file}: entry ${pattern}`);
  });
}

/**
 * Every rule a config switches off.
 * @param config - Parsed config
 * @returns One `file: rules.name` line per disabled rule
 */
function disabledRules(config: KnipConfig): readonly string[] {
  return config.scopes.flatMap(scope =>
    Object.entries((scope.rules ?? {}) as Record<string, unknown>)
      .filter(([, level]) => level === "off")
      .map(([rule]) => `${config.file}: rules.${rule}`)
  );
}

/**
 * Every `ignore` glob that would take a test file out of the analysis.
 * @param config - Parsed config
 * @returns One `file: glob` line per offending pattern
 */
function testIgnores(config: KnipConfig): readonly string[] {
  return config.scopes.flatMap(scope => {
    const ignore = scope.ignore;
    const patterns = Array.isArray(ignore)
      ? (ignore as string[])
      : typeof ignore === "string"
        ? [ignore]
        : [];
    return patterns
      .filter(pattern =>
        TEST_FILE_PROBES.some(probe => minimatch(probe, pattern, { dot: true }))
      )
      .map(pattern => `${config.file}: ${pattern}`);
  });
}

describe("knip configs Lisa runs and ships are strict", () => {
  it("discovers Lisa's own config and every stack's shipped config", () => {
    // Zero is never a pass: an empty discovery makes every case below vacuous.
    expect(CONFIGS.map(config => config.file)).toContain("knip.json");
    expect(CONFIGS.length).toBeGreaterThan(1);
  });

  it("exempts no dependency, binary or finding by name", () => {
    expect(CONFIGS.flatMap(exemptions)).toEqual([]);
  });

  it("switches no rule off", () => {
    expect(CONFIGS.flatMap(disabledRules)).toEqual([]);
  });

  it("relaxes no check for every name at once", () => {
    expect(CONFIGS.flatMap(relaxations)).toEqual([]);
  });

  it("makes only real starting points entries, never every module", () => {
    expect(CONFIGS.flatMap(blanketEntries)).toEqual([]);
  });

  it.each(Object.entries(FRAMEWORK_ENTRY_PROBES))(
    "%s makes every file its framework loads by path an entry",
    (file, probes) => {
      const patterns = readConfig(file).scopes.flatMap(scope =>
        Array.isArray(scope.entry) ? (scope.entry as string[]) : []
      );
      const missed = probes.filter(
        probe =>
          !patterns.some(pattern => minimatch(probe, pattern, { dot: true }))
      );
      expect(missed).toEqual([]);
    }
  );

  it("keeps every test file in the analysis", () => {
    expect(CONFIGS.flatMap(testIgnores)).toEqual([]);
  });

  it("holds a host knip.ts built from Lisa's Expo resolution to the same bar", async () => {
    const example = await evaluatedWorkedExample();
    // It really is the helper's output: without these the check is vacuous.
    expect(Object.keys(example.scopes[0] ?? {})).toEqual(
      expect.arrayContaining(["compilers", "paths"])
    );
    expect(exemptions(example)).toEqual([]);
    expect(relaxations(example)).toEqual([]);
    expect(blanketEntries(example)).toEqual([]);
    expect(disabledRules(example)).toEqual([]);
    expect(testIgnores(example)).toEqual([]);
  });

  it("still catches each kind of exemption when one is present", () => {
    // The negative control: a checker that had stopped reading a key would
    // make every assertion above pass for the wrong reason.
    const loose: KnipConfig = {
      file: "control.json",
      scopes: [
        {
          ignoreBinaries: ["printf"],
          ignoreExportsUsedInFile: true,
          entry: ["src/**/*.ts", "src/main.ts"],
          rules: { devDependencies: "off" },
          ignore: ["**/*.test.ts", "**/dist/**"],
        },
        { ignoreDependencies: ["zod"] },
      ],
    };
    expect(exemptions(loose)).toEqual([
      "control.json: ignoreBinaries",
      "control.json: ignoreDependencies",
    ]);
    expect(disabledRules(loose)).toEqual([
      "control.json: rules.devDependencies",
    ]);
    expect(testIgnores(loose)).toEqual(["control.json: **/*.test.ts"]);
    expect(relaxations(loose)).toEqual([
      "control.json: ignoreExportsUsedInFile",
    ]);
    expect(blanketEntries(loose)).toEqual(["control.json: entry src/**/*.ts"]);
  });
});

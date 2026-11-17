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
 * stack's `knip.json` is held to this the moment it exists.
 * @module tests/unit/config/knip-config-strictness
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { minimatch } from "minimatch";
import { describe, expect, it } from "vitest";

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

  it("keeps every test file in the analysis", () => {
    expect(CONFIGS.flatMap(testIgnores)).toEqual([]);
  });

  it("still catches each kind of exemption when one is present", () => {
    // The negative control: a checker that had stopped reading a key would
    // make every assertion above pass for the wrong reason.
    const loose: KnipConfig = {
      file: "control.json",
      scopes: [
        {
          ignoreBinaries: ["printf"],
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
  });
});

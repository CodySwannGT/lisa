/**
 * Proof that every `.mjs` file Lisa INSTALLS into a consumer is inside the
 * ESLint config Lisa installs alongside it.
 *
 * Background (CodySwannGT/lisa#2658). Lisa ships `.mjs` guard scripts into a
 * consumer's `scripts/` tree, and the `eslint.ignore.config.json` it ships in
 * the same update carried `scripts/**`. Every one of those files therefore
 * resolved to NO rules at all: `npx eslint scripts/...` answered "All of the
 * files matching the glob pattern are ignored" and exited 0. An external
 * scanner reading the same files found a CRITICAL `javascript:S2871` (a bare
 * `.sort()`), twice in one day, in files local lint had been silent about for
 * their entire life. A file nobody lints is indistinguishable from a clean one.
 *
 * The discriminator these tests use is `eslint --print-config <path>`, via its
 * API equivalent `calculateConfigForFile`. It is the ONLY reliable one:
 *
 *   - an ignored path returns `undefined` — no rules, nothing to say;
 *   - a covered path returns a resolved config with hundreds of rules.
 *
 * Silence proves nothing here. `--no-warn-ignored` suppresses the only notice
 * an ignored file produces, `eslint --quiet` hides every warn-level rule, and
 * oxlint exits 0 on warnings. "No output" is compatible with total coverage and
 * with total absence, which is exactly how this survived.
 *
 * The shipped set is DISCOVERED, never listed: a new `<stack>/copy-overwrite`
 * tree carrying `.mjs` files inherits these assertions with nobody remembering
 * to add it. Discovery reads the git INDEX rather than the disk — see
 * `tests/helpers/shipped-mjs-roster` and CodySwannGT/lisa#2824 for why a
 * required push gate may not be scoped to files no commit contains.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

import {
  defaultIgnores,
  scriptsFilePatterns,
} from "../../../src/configs/eslint/base.js";
import { getCdkConfig } from "../../../src/configs/eslint/cdk.js";
import { getExpoConfig } from "../../../src/configs/eslint/expo.js";
import { getHarperFabricConfig } from "../../../src/configs/eslint/harper-fabric.js";
import { getNestjsConfig } from "../../../src/configs/eslint/nestjs.js";
import { getPhaserConfig } from "../../../src/configs/eslint/phaser.js";
import { getTypescriptConfig } from "../../../src/configs/eslint/typescript.js";
import { shippedMjsRoster } from "../../helpers/shipped-mjs-roster.js";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/**
 * A resolved config this size means the path is genuinely inside the config
 * rather than matched by some stray empty block. The real number is ~1290; the
 * floor is deliberately far below it so ordinary rule churn never trips this.
 */
const COVERED_RULE_FLOOR = 500;

/** A path an installed script occupies in the consumer, used as a probe. */
const INSTALLED_PROBE = "scripts/lisa-gates.mjs";

/** The two ignore patterns that hid every shipped `.mjs` file. */
const SCRIPTS_IGNORE = "scripts/**";
const NESTED_SCRIPTS_IGNORE = "projects/**/scripts/**";

/**
 * Where a shipped file lands in the consumer.
 *
 * `all/copy-overwrite/scripts/lisa-gates.mjs` is installed at
 * `scripts/lisa-gates.mjs`, and it is THAT path the consumer's config judges.
 * @param shippedPath - Repo-relative path inside a `copy-overwrite` tree
 * @returns The consumer-relative path the file is installed at
 */
function consumerPath(shippedPath: string): string {
  return shippedPath.replace(/^[^/]+\/copy-overwrite\//u, "");
}

/**
 * The `ignores` array from a shipped `eslint.ignore.config.json` template.
 * @param relativePath - Path relative to the Lisa repo root
 * @returns The template's ignore patterns
 */
function readIgnores(relativePath: string): readonly string[] {
  const parsed = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf-8")
  ) as { ignores?: readonly string[] };
  return parsed.ignores ?? [];
}

/**
 * An ESLint instance built from a stack factory, exactly as the config Lisa
 * copies into a consumer builds it.
 * @param overrideConfig - The flat config array under test
 * @returns An ESLint instance rooted at the repo
 */
function eslintFor(overrideConfig: unknown): ESLint {
  return new ESLint({
    cwd: REPO_ROOT,
    overrideConfigFile: true,
    overrideConfig: overrideConfig as ESLint.Options["overrideConfig"],
  });
}

/**
 * The rules a config resolves for one path — `eslint --print-config`, as an API
 * call. An ignored path resolves to nothing, which is the whole point.
 * @param eslint - The instance under test
 * @param relativePath - Consumer-relative path to resolve
 * @returns The resolved rule map, empty when the path is ignored
 */
async function resolvedRules(
  eslint: ESLint,
  relativePath: string
): Promise<Record<string, unknown>> {
  const config = (await eslint.calculateConfigForFile(
    path.join(REPO_ROOT, relativePath)
  )) as { rules?: Record<string, unknown> } | null;
  return config?.rules ?? {};
}

// Tracked only. A file no commit contains is shipped by nothing, and this
// suite runs inside a required push gate.
const SHIPPED_MJS = shippedMjsRoster(REPO_ROOT).tracked;
const TEMPLATE_IGNORES = readIgnores(
  "typescript/copy-overwrite/eslint.ignore.config.json"
);

/**
 * A TypeScript stack config built with the shipped ignore template.
 * @returns The flat config array a consumer's eslint.config.ts produces
 */
function shippedTypescriptConfig(): ReturnType<typeof getTypescriptConfig> {
  return getTypescriptConfig({
    tsconfigRootDir: REPO_ROOT,
    ignorePatterns: [...TEMPLATE_IGNORES],
  });
}

describe("shipped .mjs lint coverage", () => {
  it("discovers at least one shipped .mjs file", () => {
    // An empty discovery set would make every assertion below vacuously true —
    // the exact "ran nothing, reported success" failure #2603 closed on the
    // test side. Zero is never a pass here.
    expect(SHIPPED_MJS.length).toBeGreaterThan(0);
  });

  it("resolves a large rule set for every shipped .mjs under the shipped ignore template", async () => {
    const eslint = eslintFor(shippedTypescriptConfig());

    const counts = await Promise.all(
      SHIPPED_MJS.map(async shipped => ({
        installed: consumerPath(shipped),
        ruleCount: Object.keys(
          await resolvedRules(eslint, consumerPath(shipped))
        ).length,
      }))
    );
    const uncovered = counts
      .filter(entry => entry.ruleCount < COVERED_RULE_FLOOR)
      .map(entry => `${entry.installed} (rules: ${entry.ruleCount})`);

    expect(uncovered).toEqual([]);
  });

  it("does not ignore any shipped .mjs under the compiled defaultIgnores", async () => {
    // A consumer with no eslint.ignore.config.json falls back to defaultIgnores.
    // Both paths carried `scripts/**`, so both had to be fixed.
    const eslint = eslintFor(
      getTypescriptConfig({ tsconfigRootDir: REPO_ROOT })
    );

    const verdicts = await Promise.all(
      SHIPPED_MJS.map(async shipped => ({
        installed: consumerPath(shipped),
        ignored: await eslint.isPathIgnored(
          path.join(REPO_ROOT, consumerPath(shipped))
        ),
      }))
    );

    expect(
      verdicts.filter(entry => entry.ignored).map(entry => entry.installed)
    ).toEqual([]);
  });

  it("still returns no config for a genuinely ignored path", async () => {
    // The negative control. Without it, a `calculateConfigForFile` that had
    // stopped discriminating would make every assertion above pass for the
    // wrong reason.
    const eslint = eslintFor(shippedTypescriptConfig());
    const ignoredPath = path.join(REPO_ROOT, "node_modules/pkg/index.mjs");

    expect(await eslint.isPathIgnored(ignoredPath)).toBe(true);
    expect(await eslint.calculateConfigForFile(ignoredPath)).toBeUndefined();
  });
});

describe("shipped .mjs lint coverage across every stack", () => {
  /**
   * Every stack factory, and whether Lisa's own dev tree can INSTANTIATE it.
   *
   * The Expo config pulls React-specific plugins at Expo's pinned versions,
   * which this repo does not install — `calculateConfigForFile` throws
   * "Could not find set-state-in-effect in plugin react-hooks" for EVERY path
   * under it, `src/index.ts` included. That is a dependency mismatch, not a
   * coverage verdict, so asserting through ESLint there would report the wrong
   * failure. Coverage is therefore asserted STRUCTURALLY for every stack — the
   * shipped ignore list must not exclude the installed scripts tree, and the
   * scripts profile must be present and last — and the full
   * `--print-config` resolution proof runs on the TypeScript stack, which is
   * the one the shipped ignore template pairs with and which every other stack
   * composes from.
   */
  const STACKS = [
    ["typescript", getTypescriptConfig],
    ["expo", getExpoConfig],
    ["nestjs", getNestjsConfig],
    ["cdk", getCdkConfig],
    ["phaser", getPhaserConfig],
    ["harper-fabric", getHarperFabricConfig],
  ] as const;

  /**
   * Config-array entries, narrowed to the fields these assertions read.
   * @param factory - A stack config factory
   * @returns The flat config array built with the shipped ignore template
   */
  function buildStack(factory: (typeof STACKS)[number][1]): {
    files?: unknown;
    ignores?: readonly string[];
    rules?: Record<string, unknown>;
  }[] {
    return factory({
      tsconfigRootDir: REPO_ROOT,
      ignorePatterns: [...TEMPLATE_IGNORES],
    }) as {
      files?: unknown;
      ignores?: readonly string[];
      rules?: Record<string, unknown>;
    }[];
  }

  it.each(STACKS.map(([name, factory]) => [name, factory]))(
    "the %s stack does not globally ignore the installed scripts tree",
    (_name, factory) => {
      const globalIgnores = buildStack(factory)
        .filter(entry => entry.ignores && !entry.files)
        .flatMap(entry => [...(entry.ignores ?? [])]);

      expect(globalIgnores).not.toContain(SCRIPTS_IGNORE);
      expect(globalIgnores).not.toContain(NESTED_SCRIPTS_IGNORE);
    }
  );

  it.each(STACKS.map(([name, factory]) => [name, factory]))(
    "the %s stack carries the scripts profile, and carries it last",
    (_name, factory) => {
      const built = buildStack(factory);
      const profileIndexes = built
        .map((entry, index) => ({ entry, index }))
        .filter(
          ({ entry }) =>
            JSON.stringify(entry.files) === JSON.stringify(scriptsFilePatterns)
        )
        .map(({ index }) => index);

      // Present at all — a stack that forgets to wire it ships the old silence.
      expect(profileIndexes).not.toEqual([]);
      // And LAST, because a later application-oriented override would re-enable
      // exactly the rules the profile turns off. That is not hypothetical: this
      // repo's own project-local config did it, silently, to one rule.
      expect(profileIndexes.at(-1)).toBe(built.length - 1);
    }
  );

  it("the Expo scripts profile permits dynamic environment keys", () => {
    const profile = buildStack(getExpoConfig).at(-1);

    expect(profile?.files).toEqual(scriptsFilePatterns);
    expect(profile?.rules?.["expo/no-dynamic-env-var"]).toBe("off");
  });

  it("the typescript stack resolves rules at an installed scripts/ path", async () => {
    const eslint = eslintFor(shippedTypescriptConfig());

    expect(
      Object.keys(await resolvedRules(eslint, INSTALLED_PROBE)).length
    ).toBeGreaterThan(COVERED_RULE_FLOOR);
  });
});

describe("the scripts profile relaxes documentation, not correctness", () => {
  /**
   * Whether a resolved rule entry is switched off.
   * @param entry - The resolved rule entry
   * @returns True when the rule is off
   */
  function isOff(entry: unknown): boolean {
    const severity = Array.isArray(entry) ? entry[0] : entry;
    return severity === 0 || severity === "off";
  }

  /**
   * The rules that apply to an installed `scripts/` `.mjs` file.
   * @returns The resolved rule map
   */
  async function scriptsRules(): Promise<Record<string, unknown>> {
    return await resolvedRules(
      eslintFor(shippedTypescriptConfig()),
      INSTALLED_PROBE
    );
  }

  it("keeps sonarjs/no-alphabetical-sort ON for shipped scripts", async () => {
    // This is javascript:S2871 — the CRITICAL the exclusion was hiding, found
    // twice in one day by an external scanner. If a future flood of findings is
    // ever "fixed" by relaxing this rule for scripts, the blind spot is back.
    const rules = await scriptsRules();

    expect(rules["sonarjs/no-alphabetical-sort"]).toBeDefined();
    expect(isOff(rules["sonarjs/no-alphabetical-sort"])).toBe(false);
  });

  it.each([
    ["no-undef"],
    ["sonarjs/no-duplicate-string"],
    ["sonarjs/no-unused-collection"],
    ["@typescript-eslint/no-unused-vars"],
  ])("keeps %s ON for shipped scripts", async ruleId => {
    expect(isOff((await scriptsRules())[ruleId])).toBe(false);
  });

  it("raises sonarjs/no-ignored-exceptions to error for shipped scripts", async () => {
    // The one rule this profile makes STRICTER than the application default,
    // which carries it at `warn`. A swallowed exception is an error that went
    // somewhere and said nothing — a broken command reading as a measured zero.
    // `bun run lint` is `eslint . --quiet`, which hides warnings, so `warn`
    // here would be the same disappearing act the rule is meant to catch.
    const severity = (await scriptsRules())["sonarjs/no-ignored-exceptions"];

    expect(Array.isArray(severity) ? severity[0] : severity).toBe(2);
  });

  it("relaxes the JSDoc regime and functional purity for shipped scripts", async () => {
    // Scripts are CLIs, not published API. This is the deliberate half of the
    // profile — asserted so the two halves cannot be confused for each other.
    const rules = await scriptsRules();

    expect(isOff(rules["jsdoc/require-jsdoc"])).toBe(true);
    expect(isOff(rules["functional/no-let"])).toBe(true);
  });
});

describe("the scripts ignore cannot come back", () => {
  it.each([[SCRIPTS_IGNORE], [NESTED_SCRIPTS_IGNORE]])(
    "compiled defaultIgnores does not contain %s",
    pattern => {
      expect(defaultIgnores).not.toContain(pattern);
    }
  );

  it.each([
    ["eslint.ignore.config.json"],
    ["typescript/copy-overwrite/eslint.ignore.config.json"],
  ])("%s does not ignore the shipped scripts tree", relativePath => {
    const ignores = readIgnores(relativePath);

    expect(ignores).not.toContain(SCRIPTS_IGNORE);
    expect(ignores).not.toContain(NESTED_SCRIPTS_IGNORE);
  });

  it("targets the installed scripts tree with the scripts profile", () => {
    expect(scriptsFilePatterns).toContain(SCRIPTS_IGNORE);
  });
});

/**
 * @file package-lisa-integration-script-layout.test.ts
 * @description `test:integration` must not force a directory that only some
 * repositories have.
 *
 * The defect (#3070): `cdk/package-lisa/package.lisa.json` carried
 * `test:integration` in `force` — where Lisa's value completely replaces the
 * host's — pinned to the literal path `vitest run tests/integration`. A
 * consumer that keeps integration tests beside their subjects
 * (`src/orders/orders.integration.test.ts`) has no such directory, so the
 * forced value did not narrow the run, it eliminated it: `No test files found,
 * exiting with code 1`, which failed the push gate. The same key was `defaults`
 * one template up in `typescript`, so the correct governance level appeared to
 * depend on which stack template you read.
 *
 * Neither half is enforceable by a spelling. What is governance-critical is
 * that integration tests RUN, not that they live in `tests/integration`, so the
 * fix follows the reserved-base pattern #2952 established for this exact class
 * of gate script: Lisa forces `test:integration:lisa` with a layout-agnostic
 * value, and merely DEFAULTS `test:integration` to invoke it. `adopt` reclaims
 * the values Lisa itself wrote, so a consumer already clobbered by the force
 * recovers on its next apply instead of needing a migration.
 *
 * These cases drive the templates this repository SHIPS, not a synthetic one —
 * a governance-classification defect lives in the shipped file, and a spec that
 * states its own template cannot see it.
 *
 * A later attempt made an empty suite green with `--passWithNoTests`. That lets
 * a generated command prove a required integration gate after collecting zero
 * tests — the exact vacuous-green contract Lisa's registry rejects. Projects
 * with no integration suite declare the gate off/optional; the required
 * generated command itself must remain non-vacuous.
 * @module tests/unit/strategies/package-lisa-integration-script-layout
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import type { ProjectType } from "../../../src/core/config.js";
import { PackageLisaStrategy } from "../../../src/strategies/package-lisa.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const MANIFEST_PROFILES = {
  "package.json": "lisa",
  "typescript/package-lisa/package.lisa.json": "typescript",
  "npm-package/package-lisa/package.lisa.json": "npm-package",
  "nestjs/package-lisa/package.lisa.json": "nestjs",
  "cdk/package-lisa/package.lisa.json": "cdk",
  "harper-fabric/package-lisa/package.lisa.json": "harper-fabric",
  "phaser/package-lisa/package.lisa.json": "phaser",
  "expo/package-lisa/package.lisa.json": "expo",
} as const satisfies Readonly<Record<string, string>>;
const MANIFESTS = Object.keys(
  MANIFEST_PROFILES
) as readonly (keyof typeof MANIFEST_PROFILES)[];
const STACKS = Object.values(MANIFEST_PROFILES).filter(
  profile => profile !== "lisa"
) as readonly ProjectType[];

/** Both manifest script surfaces, with the root surface winning collisions. */
interface ManifestScripts {
  readonly scripts?: Readonly<Record<string, string>>;
  readonly force?: { readonly scripts?: Readonly<Record<string, string>> };
}

/**
 * Compose both governed script maps without letting either hide the other.
 * @param parsed - Parsed manifest
 * @returns Governed scripts, with root scripts overriding force collisions
 */
const scriptsFrom = (
  parsed: ManifestScripts
): Readonly<Record<string, string>> => ({
  ...parsed.force?.scripts,
  ...parsed.scripts,
});

/**
 * Read one shipped manifest's governed scripts.
 * @param file - Repository-relative manifest path
 * @returns Merged governed scripts
 */
const scriptsIn = (file: string): Readonly<Record<string, string>> =>
  scriptsFrom(fs.readJsonSync(path.join(REPO_ROOT, file)) as ManifestScripts);

/**
 * Whether one managed script invokes a supervised test surface.
 * @param key - Script key
 * @returns Whether the route is managed
 */
const isManagedTestScript = (key: string): boolean =>
  /^(?:test(?::|$)|playwright:test(?::|$)|maestro:test(?::|$)|check:shell-guard-refusals$)/u.test(
    key
  );

/**
 * Expand package aliases while refusing cycles and multiple launchers.
 * @param scripts - Complete script map
 * @param key - Script key to resolve
 * @param active - Active alias chain
 * @returns Terminal command
 */
function terminalCommand(
  scripts: Readonly<Record<string, string>>,
  key: string,
  active: ReadonlySet<string> = new Set()
): string {
  if (active.has(key)) throw new Error(`Package script alias cycle at ${key}`);
  const command = scripts[key];
  if (command === undefined)
    throw new Error(`Missing package script alias ${key}`);
  const aliases = [
    ...command.matchAll(/\$npm_execpath run ([a-z0-9:-]+)(?: -- ([^;&]+))?/gu),
  ];
  if (aliases.length === 0) return command;
  if (aliases.length > 1)
    throw new Error(`Package script ${key} invokes more than one child alias`);
  const alias = aliases[0];
  const childKey = alias?.[1];
  if (alias === undefined || childKey === undefined) return command;
  const child = terminalCommand(scripts, childKey, new Set([...active, key]));
  const extra = alias[2]?.trim();
  const suffix = extra === undefined ? "" : ` ${extra}`;
  return command.replace(alias[0], `${child}${suffix}`);
}

/**
 * Resolve one stack exactly through package-lisa inheritance.
 * @param stack - Project stack
 * @returns Effective scripts
 */
async function resolvedScripts(
  stack: ProjectType
): Promise<Readonly<Record<string, string>>> {
  const planned = await new PackageLisaStrategy().planPackageJson(
    { name: "route-probe", version: "0.0.0" },
    [stack],
    REPO_ROOT
  );
  return (planned.scripts ?? {}) as Readonly<Record<string, string>>;
}

/**
 * Return a diagnostic unless one terminal route has one exact wrapper.
 * @param stack - Expected route profile
 * @param key - Script key
 * @param command - Terminal command
 * @returns Violation diagnostic, when any
 */
function routeFailure(
  stack: string,
  key: string,
  command: string
): string | undefined {
  const matches = command.match(/\blisa-test-run(?:\.js)?\b/gu) ?? [];
  const adapter = /\bvitest\b/u.test(command) ? "vitest" : "direct";
  const exact = new RegExp(
    `\\blisa-test-run(?:\\.js)? --profile ${stack} --adapter ${adapter} --\\s`,
    "u"
  );
  return matches.length === 1 && exact.test(command)
    ? undefined
    : `${stack}:${key}=${command}`;
}

/** The host-facing script name, which belongs to the host. */
const INTEGRATION = "test:integration";

/** The reserved base Lisa forces, which a host cannot delete or weaken. */
const INTEGRATION_LISA = "test:integration:lisa";

/** Every shipped template that governs the integration suite. */
const TEMPLATES = ["typescript", "cdk", "nestjs", "expo"] as const;

/** The templates whose stack runs the suite under vitest. */
const VITEST_TEMPLATES = ["typescript", "cdk", "nestjs"] as const;

/**
 * Real test-file paths from the three layouts consumers actually use.
 * @remarks
 * Vitest treats a bare positional argument as a substring filter over the test
 * file path — measured on vitest 4.1.9, the version these templates force:
 * `tests/integration` matched 1 of these 3 files, `.integration.` matched 1,
 * and the pair `.integration. integration/` matched all 3 while still leaving
 * `src/integration-helpers/helper.test.ts` out.
 */
const INTEGRATION_TEST_PATHS = [
  "src/orders/orders.integration.test.ts",
  "tests/integration/db.test.ts",
  "test/integration/api.test.ts",
] as const;

/** A unit test whose directory merely contains the word, which must not match. */
const NON_INTEGRATION_TEST_PATH = "src/integration-helpers/helper.test.ts";

/**
 * Read a shipped template off disk.
 * @param typeName - Stack template directory name
 * @returns The parsed template
 */
async function shippedTemplate(
  typeName: string
): Promise<Record<string, { scripts?: Record<string, string> }>> {
  return (await fs.readJson(
    path.join(process.cwd(), typeName, "package-lisa", "package.lisa.json")
  )) as Record<string, { scripts?: Record<string, string> }>;
}

/**
 * Name the template sections that carry a given script key.
 * @param template - A parsed `package.lisa.json`
 * @param scriptName - The script key to locate
 * @returns Section names, in a stable order
 */
function sectionsCarrying(
  template: Record<string, { scripts?: Record<string, string> }>,
  scriptName: string
): readonly string[] {
  return ["force", "defaults", "merge"].filter(
    section => template[section]?.scripts?.[scriptName] !== undefined
  );
}

/**
 * The positional filters a template's reserved base passes to vitest.
 * @remarks
 * Everything after `vitest run` that is not an option, with the surrounding
 * shell quotes removed. A missing base throws rather than yielding an empty
 * list: an empty list satisfies every assertion below, so a template that had
 * dropped the gate entirely would read as one that passes it.
 * @param typeName - Stack template directory name
 * @returns The filters, in command order
 * @throws {Error} When the template ships no reserved base
 */
async function forcedFilters(typeName: string): Promise<readonly string[]> {
  const template = await shippedTemplate(typeName);
  const command = template.force?.scripts?.[INTEGRATION_LISA];
  const words = command?.split(" ") ?? [];
  const vitest = words.findIndex(
    (word, index) => word === "vitest" && words[index + 1] === "run"
  );
  if (
    typeof command !== "string" ||
    vitest < 0 ||
    words[vitest + 1] !== "run"
  ) {
    throw new Error(
      `${typeName} ships no forced ${INTEGRATION_LISA}; got ${String(command)}`
    );
  }
  return words
    .slice(vitest + 2)
    .filter(token => !token.startsWith("-"))
    .map(token => token.replace(/^'|'$/gu, ""));
}

describe("managed package test supervision wiring", () => {
  it("merges force and root scripts, with root scripts winning collisions", () => {
    expect(
      scriptsFrom({
        force: {
          scripts: {
            "test:force-only": "bare-force-vitest",
            "test:collision": "force-command",
          },
        },
        scripts: {
          "test:root-only": "bare-root-vitest",
          "test:collision": "root-command",
        },
      })
    ).toEqual({
      "test:force-only": "bare-force-vitest",
      "test:root-only": "bare-root-vitest",
      "test:collision": "root-command",
    });
  });

  it.each(MANIFESTS)("routes every raw managed test command in %s", file => {
    const scripts = scriptsIn(file);
    const bypasses = Object.entries(scripts)
      .filter(([key]) => isManagedTestScript(key))
      .map(([key]) => [key, terminalCommand(scripts, key)] as const)
      .filter(
        ([key, command]) =>
          routeFailure(MANIFEST_PROFILES[file], key, command) !== undefined
      );

    expect(bypasses).toEqual([]);
  });

  it.each(STACKS)(
    "resolves every %s route to exactly one honest supervised command",
    async stack => {
      const scripts = await resolvedScripts(stack);
      const failures = Object.entries(scripts)
        .filter(([key]) => isManagedTestScript(key))
        .map(([key]) => [key, terminalCommand(scripts, key)] as const)
        .map(([key, command]) => routeFailure(stack, key, command))
        .filter((failure): failure is string => failure !== undefined);

      expect(failures).toEqual([]);
    }
  );
});

describe("test:integration governance and layout (#3070)", () => {
  const NORMALIZED_ROUTE_PROFILE = "--profile <route>";

  describe("every template classifies the key the same way", () => {
    it.each(TEMPLATES)(
      "%s: hands the host-facing name back as a default and forces only the reserved base",
      async typeName => {
        const template = await shippedTemplate(typeName);

        expect(sectionsCarrying(template, INTEGRATION)).toEqual(["defaults"]);
        expect(sectionsCarrying(template, INTEGRATION_LISA)).toEqual(["force"]);
      }
    );

    it("keeps the typescript and cdk templates in agreement, which is where the split was found", async () => {
      const [typescript, cdk] = await Promise.all(
        ["typescript", "cdk"].map(shippedTemplate)
      );

      expect(sectionsCarrying(cdk, INTEGRATION)).toEqual(
        sectionsCarrying(typescript, INTEGRATION)
      );
      expect(
        cdk.force?.scripts?.[INTEGRATION_LISA]?.replace(
          /--profile\s+\S+/u,
          NORMALIZED_ROUTE_PROFILE
        )
      ).toBe(
        typescript.force?.scripts?.[INTEGRATION_LISA]?.replace(
          /--profile\s+\S+/u,
          NORMALIZED_ROUTE_PROFILE
        )
      );
    });

    it("gives every vitest stack the same base value, so the copies cannot drift apart", async () => {
      const templates = await Promise.all(
        VITEST_TEMPLATES.map(shippedTemplate)
      );
      const values = templates.map(template =>
        template.force?.scripts?.[INTEGRATION_LISA]?.replace(
          /--profile\s+\S+/u,
          NORMALIZED_ROUTE_PROFILE
        )
      );

      // Truthiness first: three `undefined`s are also a set of size one, and
      // would report agreement from templates that ship no gate at all.
      expect(values.every(value => typeof value === "string")).toBe(true);
      expect(new Set(values).size).toBe(1);
    });

    it.each(VITEST_TEMPLATES)(
      "%s: cannot prove the required gate after collecting zero tests",
      async typeName => {
        const template = await shippedTemplate(typeName);
        const command = template.force?.scripts?.[INTEGRATION_LISA];

        expect(command).not.toContain("--passWithNoTests");
      }
    );

    it.each(VITEST_TEMPLATES)(
      "%s: adopts the old supervised empty-suite spelling without redelivering it",
      async typeName => {
        const template = (await fs.readJson(
          path.join(
            process.cwd(),
            typeName,
            "package-lisa",
            "package.lisa.json"
          )
        )) as {
          force?: { scripts?: Record<string, string> };
          adopt?: { scripts?: Record<string, readonly string[]> };
        };
        const forced = template.force?.scripts?.[INTEGRATION_LISA];
        const adopted = template.adopt?.scripts?.[INTEGRATION] ?? [];

        expect(forced).toMatch(
          new RegExp(
            `^lisa-test-run --profile ${typeName} --adapter vitest -- vitest run`,
            "u"
          )
        );
        expect(forced).not.toContain("--passWithNoTests");
        expect(adopted).toContain(`${forced} --passWithNoTests`);
        const profileLegacy = forced?.replace(" --adapter vitest", "");
        const unprofiledLegacy = profileLegacy?.replace(
          `--profile ${typeName} `,
          ""
        );
        expect(adopted).toContain(profileLegacy);
        expect(adopted).toContain(`${profileLegacy} --passWithNoTests`);
        expect(adopted).toContain(unprofiledLegacy);
        expect(adopted).toContain(`${unprofiledLegacy} --passWithNoTests`);
      }
    );
  });

  describe("the forced value finds integration tests wherever a repository keeps them", () => {
    it.each(VITEST_TEMPLATES)(
      "%s: matches beside-subject, tests/integration and test/integration layouts alike",
      async typeName => {
        const filters = await forcedFilters(typeName);

        for (const testPath of INTEGRATION_TEST_PATHS) {
          expect(
            filters.some(filter => testPath.includes(filter)),
            `${typeName} must run ${testPath}`
          ).toBe(true);
        }
      }
    );

    it.each(VITEST_TEMPLATES)(
      "%s: still leaves a unit test out of the integration lane",
      async typeName => {
        const filters = await forcedFilters(typeName);

        expect(filters.length).toBeGreaterThan(0);
        expect(
          filters.some(filter => NON_INTEGRATION_TEST_PATH.includes(filter))
        ).toBe(false);
      }
    );
  });
});

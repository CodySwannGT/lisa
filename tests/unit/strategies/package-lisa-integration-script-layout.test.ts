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
 * @module tests/unit/strategies/package-lisa-integration-script-layout
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import { createPackageLisaApplyHarness } from "../../helpers/package-lisa-apply-harness.js";

/** The host-facing script name, which belongs to the host. */
const INTEGRATION = "test:integration";

/** The reserved base Lisa forces, which a host cannot delete or weaken. */
const INTEGRATION_LISA = "test:integration:lisa";

/** Every shipped template that governs the integration suite. */
const TEMPLATES = ["typescript", "cdk", "nestjs", "expo"] as const;

/** The templates whose stack runs the suite under vitest. */
const VITEST_TEMPLATES = ["typescript", "cdk", "nestjs"] as const;

/** The literal-path value that broke a differently laid out repository. */
const LITERAL_PATH_VALUE = "vitest run tests/integration";

/** Marker file that makes a project detect as the cdk stack. */
const CDK_JSON = "cdk.json";

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
  if (typeof command !== "string" || !command.startsWith("vitest run ")) {
    throw new Error(
      `${typeName} ships no forced ${INTEGRATION_LISA}; got ${String(command)}`
    );
  }
  return command
    .split(" ")
    .slice(2)
    .filter(token => !token.startsWith("-"))
    .map(token => token.replace(/^'|'$/gu, ""));
}

describe("test:integration governance and layout (#3070)", () => {
  const host = createPackageLisaApplyHarness();

  /**
   * Stand up a cdk-stack host against the shipped templates.
   * @param scripts - The host's own scripts before the apply
   */
  async function cdkHost(scripts: Record<string, string>): Promise<void> {
    await host.installShippedTemplates(["typescript", "cdk"]);
    await host.writeHostPackage(scripts);
    await host.writeHostMarker(CDK_JSON, { app: "node bin/infrastructure.js" });
  }

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
      expect(cdk.force?.scripts?.[INTEGRATION_LISA]).toBe(
        typescript.force?.scripts?.[INTEGRATION_LISA]
      );
    });

    it("gives every vitest stack the same base value, so the copies cannot drift apart", async () => {
      const templates = await Promise.all(
        VITEST_TEMPLATES.map(shippedTemplate)
      );
      const values = templates.map(
        template => template.force?.scripts?.[INTEGRATION_LISA]
      );

      // Truthiness first: three `undefined`s are also a set of size one, and
      // would report agreement from templates that ship no gate at all.
      expect(values.every(value => typeof value === "string")).toBe(true);
      expect(new Set(values).size).toBe(1);
    });
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

  describe("what a cdk apply leaves behind", () => {
    it("keeps a cdk host's own test:integration instead of replacing it", async () => {
      const hostValue = "vitest run '.integration.' --passWithNoTests";
      await cdkHost({ [INTEGRATION]: hostValue });

      await host.runApply();

      expect((await host.hostScripts())[INTEGRATION]).toBe(hostValue);
    });

    it("installs a usable test:integration on a cdk host that has none", async () => {
      await cdkHost({ build: "tsc --noEmit" });

      await host.runApply();

      const scripts = await host.hostScripts();
      expect(scripts[INTEGRATION]).toContain(INTEGRATION_LISA);
      expect(scripts[INTEGRATION]).not.toBe(LITERAL_PATH_VALUE);
      expect(scripts[INTEGRATION_LISA]).toBeDefined();
    });

    it("reclaims the literal path a previous apply forced, so a clobbered host recovers", async () => {
      await cdkHost({ [INTEGRATION]: LITERAL_PATH_VALUE });

      await host.runApply();

      const scripts = await host.hostScripts();
      expect(scripts[INTEGRATION]).toContain(INTEGRATION_LISA);
      expect(scripts[INTEGRATION]).not.toBe(LITERAL_PATH_VALUE);
    });
  });
});

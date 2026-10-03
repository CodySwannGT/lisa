/**
 * Real shipped HTTP floors must exclude the high advisories reported by CI.
 *
 * Immutable GitHub advisory data captured 2026-10-03. Each GHSA's primary
 * source is https://github.com/advisories/<ghsa>. Only Axios's supported 1.x
 * and Undici's supported 6.x branches are relevant here. The collector and
 * comparator are the production prover's exports; no network mock or weaker
 * substitute decides whether a shipped floor is vulnerable.
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { intersects } from "semver";
import { afterEach, describe, expect, it } from "vitest";

import {
  collectFloors,
  lowestPermitted,
  withinRange,
} from "../../../scripts/check-security-floors.mjs";
import type { LisaConfig } from "../../../src/core/config.js";
import { PackageLisaStrategy } from "../../../src/strategies/package-lisa.js";
import type { StrategyContext } from "../../../src/strategies/strategy.interface.js";
import {
  cleanupTempDir,
  createCDKProject,
  createTempDir,
  createTypeScriptProject,
} from "../../helpers/test-utils.js";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const TEMPLATE = "typescript/package-lisa/package.lisa.json";
const PACKAGE_JSON = "package.json";
const SECTIONS = ["overrides", "resolutions"] as const;
const PATCHED = { axios: ">=1.20.0", undici: "^6.28.1" } as const;
const STALE = { axios: ">=1.18.0", undici: "^6.28.0" } as const;
const EXPLICIT_DEFAULTS = {
  typescript: "^6.0.3",
  vitest: "^4.1.10",
  "@vitest/coverage-v8": "^4.1.10",
} as const;

/** High advisories' exact npm ranges and first patched supported releases. */
const ADVISORIES = [
  {
    name: "axios",
    ghsa: "GHSA-m8m8-qj5v-23w3",
    range: ">= 1.15.2, < 1.20.0",
    patched: "1.20.0",
  },
  {
    name: "axios",
    ghsa: "GHSA-r4gj-5m52-g5wh",
    range: ">= 1.17.0, < 1.20.0",
    patched: "1.20.0",
  },
  {
    name: "axios",
    ghsa: "GHSA-c29m-xwm3-cm6r",
    range: ">= 1.16.1, < 1.20.0",
    patched: "1.20.0",
  },
  {
    name: "axios",
    ghsa: "GHSA-mghh-pgcx-3jjj",
    range: ">= 1.15.0, < 1.20.0",
    patched: "1.20.0",
  },
  {
    name: "axios",
    ghsa: "GHSA-x97p-jq2g-jp4f",
    range: ">= 1.15.1, < 1.20.0",
    patched: "1.20.0",
  },
  {
    name: "axios",
    ghsa: "GHSA-3pq3-5fj3-cg6v",
    range: ">= 1.13.0, < 1.20.0",
    patched: "1.20.0",
  },
  {
    name: "axios",
    ghsa: "GHSA-542g-h47m-68v8",
    range: ">= 1.13.0, < 1.20.0",
    patched: "1.20.0",
  },
  {
    name: "undici",
    ghsa: "GHSA-rfgv-xxqx-mfg5",
    range: ">= 6.7.0, < 6.28.1",
    patched: "6.28.1",
  },
] as const;

/** Collect the actual policies, rather than constructing passing manifests. */
const COLLECTED = collectFloors();
const ADVISORY_SITES = ADVISORIES.flatMap(advisory =>
  SECTIONS.map(section => ({ ...advisory, section }))
);

describe("forced HTTP security floors", () => {
  it.each(Object.keys(PATCHED))(
    "collects both real %s force sites without gaps",
    name => {
      expect(COLLECTED.unscanned).toEqual([]);
      expect(COLLECTED.unparseable).toEqual([]);
      const sites = COLLECTED.found.get(name) ?? [];
      expect(
        sites
          .map(site => `${site.file}:${site.path}`)
          .sort((left, right) => left.localeCompare(right))
      ).toEqual(
        SECTIONS.map(section => `${TEMPLATE}:force.${section}`).sort(
          (left, right) => left.localeCompare(right)
        )
      );
    }
  );

  it.each(ADVISORY_SITES)(
    "$ghsa: shipped force.$section $name excludes $range",
    ({ name, ghsa, range, section }) => {
      const site = COLLECTED.found
        .get(name)
        ?.find(
          entry => entry.file === TEMPLATE && entry.path === `force.${section}`
        );
      expect(
        site,
        `${TEMPLATE}:force.${section}.${name} missing`
      ).toBeDefined();
      expect(
        withinRange(site!.lowest, range),
        `${ghsa}: ${site!.file} ${site!.path}.${name} permits ${site!.spec}`
      ).toBe(false);
    }
  );

  it.each(ADVISORIES)(
    "$ghsa: rejects the vulnerable control and clears the patched endpoint",
    ({ name, range, patched }) => {
      const staleLowest = lowestPermitted(STALE[name]);
      const patchedLowest = lowestPermitted(patched);
      if (staleLowest === null || patchedLowest === null)
        throw new Error(`Unparseable ${name} advisory control endpoints`);
      expect(withinRange(staleLowest, range)).toBe(true);
      expect(withinRange(patchedLowest, range)).toBe(false);
    }
  );

  it.each(
    SECTIONS.flatMap(section =>
      Object.entries(PATCHED).map(([name, expected]) => ({
        section,
        name,
        expected,
      }))
    )
  )(
    "root $section.$name also excludes every release below its patch",
    ({ section, name, expected }) => {
      const root = fs.readJsonSync(path.join(REPO_ROOT, PACKAGE_JSON));
      expect(root[section][name]).toBe(expected);
      expect(
        intersects(
          root[section][name],
          `<${name === "axios" ? "1.20.0" : "6.28.1"}`
        )
      ).toBe(false);
    }
  );
});

describe("shipped HTTP force policy adoption", () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    if (tempDir !== undefined) await cleanupTempDir(tempDir);
    tempDir = undefined;
  });

  it.each([
    ["typescript", false],
    ["typescript", true],
    ["cdk", false],
    ["cdk", true],
  ] as const)(
    "%s full/restricted(postinstall=%s) apply repairs stale host floors",
    async (stack, postinstall) => {
      tempDir = await createTempDir();
      const host = path.join(tempDir, "host");
      if (stack === "cdk") await createCDKProject(host);
      else await createTypeScriptProject(host);
      const dest = path.join(host, PACKAGE_JSON);
      const seeded = await fs.readJson(dest);
      const explicitScripts = {
        test: "node host-test.js",
        "host-only": "node host.js",
      };
      await fs.writeJson(dest, {
        ...seeded,
        name: "http-security-fixture",
        devDependencies: EXPLICIT_DEFAULTS,
        scripts: explicitScripts,
        engines: { node: "22.22.0" },
        overrides: { ...STALE, "host-only-dependency": "^1.0.0" },
        resolutions: { ...STALE, "host-only-dependency": "^1.0.0" },
      });
      const config: LisaConfig = {
        lisaDir: REPO_ROOT,
        destDir: host,
        dryRun: false,
        yesMode: true,
        validateOnly: false,
        skipGitCheck: false,
        postinstall,
        harness: "claude",
      };
      const context: StrategyContext = {
        config,
        backupFile: async () => {},
        promptOverwrite: async () => true,
      };
      const strategy = new PackageLisaStrategy(() => "9.9.9");
      const source = path.join(
        REPO_ROOT,
        stack,
        "package-lisa",
        "package.lisa.json"
      );
      const result = await strategy.apply(source, dest, PACKAGE_JSON, context);
      expect(result.action).not.toBe("skipped");
      const written = await fs.readJson(dest);
      for (const section of SECTIONS) {
        expect(written[section]).toMatchObject(PATCHED);
        expect(written[section]["host-only-dependency"]).toBe("^1.0.0");
      }
      expect(written.scripts).toMatchObject(explicitScripts);
      // CDK owns Vitest in force on full apply; TypeScript's defaults and the
      // restricted path retain the explicit host values under existing policy.
      expect(written.devDependencies.typescript).toBe(
        EXPLICIT_DEFAULTS.typescript
      );
      if (postinstall || stack === "typescript") {
        expect(written.devDependencies).toMatchObject(EXPLICIT_DEFAULTS);
        expect(written.engines.node).toBe("22.22.0");
      }
      if (postinstall) expect(written.scripts).toEqual(explicitScripts);
      const first = await fs.readFile(dest, "utf8");
      await strategy.apply(source, dest, PACKAGE_JSON, context);
      expect(await fs.readFile(dest, "utf8")).toBe(first);
    }
  );
});

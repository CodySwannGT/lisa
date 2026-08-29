/**
 * @file governed-script-composition-points.test.ts
 * @description The shipped templates must keep every static-analysis gate split
 * into a Lisa-owned base and a host-owned composition point (#2952).
 *
 * These are the scripts whose entire contract is "run checks and fail". CI
 * invokes them through an external reusable workflow, so a host that needs one
 * more gate has nowhere to put it except the script itself — and while Lisa
 * FORCED those names, every apply deleted the addition and left CI green.
 *
 * Three obligations are executable here rather than written down, because a
 * written one drifts the first time somebody edits a base value:
 *
 * 1. The bare gate name is never forced again. That is the regression itself.
 * 2. Every reserved base has a default that actually invokes it — a base
 *    nothing calls is the same green-but-inert failure in a new costume.
 * 3. Every reserved base's CURRENT value is in its `adopt` list, so a host
 *    sitting on it is recognised as uncustomised and migrated rather than
 *    warned at. Change a base without extending the list and this fails.
 * @module tests/unit/config/governed-script-composition-points
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import type { PackageLisaTemplate } from "../../../src/strategies/package-lisa-types.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

/** Suffix naming the Lisa-owned half of a split script. */
const BASE_SUFFIX = ":lisa";

/** TypeScript template inherited by every TypeScript-derived stack. */
const TYPESCRIPT_TEMPLATE = "typescript/package-lisa/package.lisa.json";

/** Every tracked `package.lisa.json`, keyed by its repo-relative path. */
const TEMPLATE_PATHS = [
  "package.lisa.json",
  TYPESCRIPT_TEMPLATE,
  "expo/package-lisa/package.lisa.json",
  "nestjs/package-lisa/package.lisa.json",
  "cdk/package-lisa/package.lisa.json",
  "npm-package/package-lisa/package.lisa.json",
  "phaser/package-lisa/package.lisa.json",
  "harper-fabric/package-lisa/package.lisa.json",
] as const;

/**
 * The static-analysis gates. Any template that governs one of these must
 * govern it as a split pair, never as a bare forced script.
 */
const GATE_SCRIPTS = [
  "lint",
  "lint:slow",
  "typecheck",
  "format:check",
  "knip",
  "knip:check",
  "sg:scan",
] as const;

/**
 * Build the exact supervised integration command for a Vitest-backed stack.
 * @param profile - Lisa scratch profile for the stack
 * @returns Exact ordered wrapper, adapter, separator, and Vitest arguments
 */
const vitestIntegrationCommand = (profile: string): string =>
  `lisa-test-run --profile ${profile} --adapter vitest -- vitest run '.integration.' 'integration/'`;

/** Exact integration base commands and whether their default comes from TypeScript. */
const INTEGRATION_COMMANDS = [
  [TYPESCRIPT_TEMPLATE, vitestIntegrationCommand("typescript"), false],
  [
    "expo/package-lisa/package.lisa.json",
    'NODE_ENV=test lisa-test-run --profile expo --adapter direct -- jest --testPathPatterns="\\.integration[.\\\\-](test|spec)\\.(ts|tsx)$"',
    false,
  ],
  [
    "nestjs/package-lisa/package.lisa.json",
    vitestIntegrationCommand("nestjs"),
    false,
  ],
  [
    "cdk/package-lisa/package.lisa.json",
    vitestIntegrationCommand("cdk"),
    false,
  ],
  [
    "npm-package/package-lisa/package.lisa.json",
    vitestIntegrationCommand("npm-package"),
    true,
  ],
  [
    "phaser/package-lisa/package.lisa.json",
    vitestIntegrationCommand("phaser"),
    true,
  ],
  [
    "harper-fabric/package-lisa/package.lisa.json",
    vitestIntegrationCommand("harper-fabric"),
    true,
  ],
] as const;

/** Exact composition command inherited or owned by each integration stack. */
const INTEGRATION_DELEGATION = "$npm_execpath run test:integration:lisa";

/**
 * Read one template off disk.
 * @param relativePath - Repo-relative path to the template
 * @returns Parsed template
 */
function readTemplate(relativePath: string): PackageLisaTemplate {
  return fs.readJsonSync(
    path.join(REPO_ROOT, relativePath)
  ) as PackageLisaTemplate;
}

/**
 * Scripts a template section declares.
 * @param section - One of the template's top-level sections
 * @returns The section's `scripts` map, or an empty map
 */
function scriptsOf(section: Record<string, unknown> | undefined): {
  readonly [name: string]: unknown;
} {
  const scripts = section?.scripts;
  return typeof scripts === "object" && scripts !== null
    ? (scripts as Record<string, unknown>)
    : {};
}

describe("governed script composition points", () => {
  describe.each(TEMPLATE_PATHS)("%s", relativePath => {
    const template = readTemplate(relativePath);
    const forced = scriptsOf(template.force);
    const defaulted = scriptsOf(template.defaults);
    const adopted = scriptsOf(template.adopt);

    it("never forces a bare static-analysis gate name", () => {
      const bareGates = GATE_SCRIPTS.filter(name => name in forced);

      expect(bareGates).toEqual([]);
    });

    it("splits every static-analysis gate it governs into a reserved base", () => {
      const governed = GATE_SCRIPTS.filter(
        name => `${name}${BASE_SUFFIX}` in forced || name in defaulted
      );
      const split = governed.filter(
        name => `${name}${BASE_SUFFIX}` in forced && name in defaulted
      );

      expect(split).toEqual(governed);
    });

    it("gives every reserved base a default that invokes it", () => {
      const bases = GATE_SCRIPTS.map(name => `${name}${BASE_SUFFIX}`).filter(
        name => name in forced
      );
      const uninvoked = bases.filter(base => {
        const composed = base.slice(0, -BASE_SUFFIX.length);
        const delegation = defaulted[composed];
        return typeof delegation !== "string" || !delegation.includes(base);
      });

      expect(uninvoked).toEqual([]);
    });

    it("lists every reserved base's current value in its adopt list", () => {
      const bases = GATE_SCRIPTS.map(name => `${name}${BASE_SUFFIX}`).filter(
        name => name in forced
      );
      const unlisted = bases.filter(base => {
        const composed = base.slice(0, -BASE_SUFFIX.length);
        const legacy = adopted[composed];
        return !Array.isArray(legacy) || !legacy.includes(forced[base]);
      });

      expect(unlisted).toEqual([]);
    });

    it("backs every adopt entry with a default to adopt into", () => {
      const orphaned = Object.keys(adopted).filter(
        name => typeof defaulted[name] !== "string"
      );

      expect(orphaned).toEqual([]);
    });
  });

  it("splits the lint gate in every template that ships one", () => {
    const shipping = TEMPLATE_PATHS.filter(relativePath => {
      const template = readTemplate(relativePath);
      return (
        `lint${BASE_SUFFIX}` in scriptsOf(template.force) ||
        "lint" in scriptsOf(template.defaults)
      );
    });

    // Root, typescript, expo, nestjs, cdk, phaser, harper-fabric all govern
    // lint; npm-package does not.
    expect(shipping).toHaveLength(TEMPLATE_PATHS.length - 1);
  });

  it.each(INTEGRATION_COMMANDS)(
    "keeps %s integration execution supervised through its composed default",
    (relativePath, command, inheritsDefault) => {
      const template = readTemplate(relativePath);
      const forced = scriptsOf(template.force);
      const ownDefaults = scriptsOf(template.defaults);
      const typescriptDefaults = scriptsOf(
        readTemplate(TYPESCRIPT_TEMPLATE).defaults
      );

      expect(forced["test:integration:lisa"]).toBe(command);
      expect(ownDefaults["test:integration"]).toBe(
        inheritsDefault ? undefined : INTEGRATION_DELEGATION
      );
      expect(
        ownDefaults["test:integration"] ??
          typescriptDefaults["test:integration"]
      ).toBe(INTEGRATION_DELEGATION);
    }
  );
});

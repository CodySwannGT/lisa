/** Structural guard that managed test entrypoints cannot bypass lisa-test-run. */
import * as fs from "node:fs";
import * as path from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import {
  resolveScratchRouteProfile,
  type ScratchRouteProfileName,
} from "../../../src/configs/vitest/scratch-route-profile.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const MANIFESTS = [
  "package.json",
  "typescript/package-lisa/package.lisa.json",
  "nestjs/package-lisa/package.lisa.json",
  "cdk/package-lisa/package.lisa.json",
  "harper-fabric/package-lisa/package.lisa.json",
  "phaser/package-lisa/package.lisa.json",
] as const;
const CHILD_LAUNCHERS = new Set([
  "boundedSpawnSync",
  "execFile",
  "execFileSync",
  "spawn",
  "spawnSync",
]);
const ROUTES: readonly ScratchRouteProfileName[] = [
  "lisa",
  "typescript",
  "nestjs",
  "cdk",
  "harper-fabric",
  "phaser",
];

/**
 * Read one JSON manifest's force/root scripts.
 * @param file - Repository-relative manifest path
 * @returns Governed scripts
 */
function scriptsIn(file: string): Readonly<Record<string, string>> {
  const parsed = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, file), "utf8")
  ) as ManifestScripts;
  return scriptsFrom(parsed);
}

/** Both manifest script surfaces, with the root surface winning collisions. */
interface ManifestScripts {
  readonly scripts?: Readonly<Record<string, string>>;
  readonly force?: {
    readonly scripts?: Readonly<Record<string, string>>;
  };
}

/**
 * Compose both governed script maps without letting either hide the other.
 * @param parsed - Parsed manifest
 * @returns Governed scripts, with root scripts overriding force collisions
 */
function scriptsFrom(
  parsed: ManifestScripts
): Readonly<Record<string, string>> {
  return {
    ...parsed.force?.scripts,
    ...parsed.scripts,
  };
}

/**
 * Find every direct Vitest child invocation that does not route through the
 * supervised source entrypoint.
 * @param source - TypeScript source to inspect
 * @returns Bare direct Vitest spawn call texts
 */
function directVitestSpawnBypasses(source: string): readonly string[] {
  const sourceFile = ts.createSourceFile(
    "spawn-control.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const bypasses: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(sourceFile).split(".").at(-1);
      const text = node.getText(sourceFile);
      const childStart = callee !== undefined && CHILD_LAUNCHERS.has(callee);
      if (
        childStart &&
        /["'`]vitest(?:\.mjs)?["'`]|node_modules[^]{0,80}vitest/iu.test(text) &&
        !/lisa-test-run(?:\.ts)?|TEST_RUNNER(?:_ARGS)?/u.test(text)
      ) {
        bypasses.push(text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return bypasses;
}

/**
 * Enumerate every TypeScript test source so a new child launch cannot escape
 * the supervision guard merely by living outside a hard-coded file list.
 * @param directory - Absolute directory to walk
 * @returns Absolute TypeScript source paths
 */
function testSources(directory: string): readonly string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return testSources(target);
    return entry.isFile() && entry.name.endsWith(".ts") ? [target] : [];
  });
}

/**
 * Whether one managed script invokes a supervised test surface.
 * @param key - Script key
 * @param command - Script command
 * @returns Whether supervision is required
 */
function isManagedTestScript(key: string, command: string): boolean {
  return (
    (/^(?:test(?::|$)|check:shell-guard-refusals$)/u.test(key) &&
      /\b(?:vitest|lisa-mutation|check-shell-guard-refusal-coverage)\b/u.test(
        command
      )) ||
    key === "test:watch"
  );
}

describe("managed test supervision wiring", () => {
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

  it("detects every bare Vitest child, including a second call", () => {
    const source = `
      spawnSync("node", ["lisa-test-run.ts", "--import", "tsx", "--profile", "lisa", "--", "vitest"]);
      spawnSync("vitest", ["run"]);
      execFileSync("node_modules/.bin/vitest", ["run"]);
    `;

    expect(directVitestSpawnBypasses(source)).toHaveLength(2);
  });

  it.each(MANIFESTS)("routes every managed test command in %s", file => {
    const bypasses = Object.entries(scriptsIn(file))
      .filter(([key, command]) => isManagedTestScript(key, command))
      .filter(
        ([, command]) =>
          !/\blisa-test-run (?:--profile\s+[a-z][a-z0-9-]*\s+)?--\s/u.test(
            command
          )
      );

    expect(bypasses).toEqual([]);
  });

  it("routes every internal Vitest child launch through source supervision", () => {
    const bypasses = testSources(path.join(REPO_ROOT, "tests")).flatMap(file =>
      directVitestSpawnBypasses(fs.readFileSync(file, "utf8")).map(call => ({
        call,
        file: path.relative(REPO_ROOT, file),
      }))
    );

    expect(bypasses).toEqual([]);
  });
});

describe("lisa-test-run scratch route profiles", () => {
  it.each(ROUTES)("freezes the explicit %s registry", route => {
    const profile = resolveScratchRouteProfile(route, {});

    expect(profile.name).toBe(route);
    expect(profile.suiteLabel).toBe(route);
    expect(Object.isFrozen(profile)).toBe(true);
    expect(Object.isFrozen(profile.registeredPrefixes)).toBe(true);
  });

  it("binds the CDK route to its real default assembly prefix", () => {
    expect(resolveScratchRouteProfile("cdk", {})).toEqual({
      name: "cdk",
      suiteLabel: "cdk",
      registeredPrefixes: ["cdk", "cdk.out"],
    });
  });

  it("binds the Lisa route to its committed fixture registry", () => {
    expect(resolveScratchRouteProfile("lisa", {}).registeredPrefixes).toEqual([
      "changelog-",
      "derived-",
      "e2e-",
      "failure-signatures-",
      "invoked-",
      "lisa-",
      "maestro-",
      "node-",
      "review-",
      "skipreq-",
      "state-",
      "vacuity-",
      "wiki-",
    ]);
  });

  it("canonicalizes operator additions and refuses suite conflicts", () => {
    expect(
      resolveScratchRouteProfile("typescript", {
        LISA_TEST_SCRATCH_PREFIXES: '["fixture-","fixture-"]',
      }).registeredPrefixes
    ).toEqual(["fixture-"]);
    expect(() =>
      resolveScratchRouteProfile("cdk", {
        LISA_TEST_SCRATCH_SUITE: "typescript",
      })
    ).toThrow(/conflicts/iu);
  });

  it("freezes CDK operator additions into the wrapper registry", () => {
    const profile = resolveScratchRouteProfile("cdk", {
      LISA_TEST_SCRATCH_PREFIXES: '["operator-cdk-"]',
    });

    expect(profile.registeredPrefixes).toEqual([
      "cdk",
      "cdk.out",
      "operator-cdk-",
    ]);
    expect(() =>
      (
        resolveScratchRouteProfile("cdk", {
          LISA_TEST_SCRATCH_PREFIXES: '["operator-cdk-"]',
        }).registeredPrefixes as string[]
      ).push("dynamic-replacement")
    ).toThrow();
  });

  it.each(["", "unknown", "../cdk"])("refuses profile %j", profile => {
    expect(() => resolveScratchRouteProfile(profile, {})).toThrow(/profile/iu);
  });
});

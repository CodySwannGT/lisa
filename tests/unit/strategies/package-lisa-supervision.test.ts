import * as fs from "fs-extra";
import * as path from "node:path";
import { PackageLisaStrategy } from "../../../src/strategies/package-lisa.js";
import type { ProjectType } from "../../../src/core/config.js";
import { commandTools } from "../../helpers/template-toolchain.js";
import { describe, expect, it } from "vitest";

describe("Phaser package template controls", () => {
  const template = fs.readJsonSync(
    path.resolve("phaser/package-lisa/package.lisa.json")
  ) as { readonly force?: { readonly scripts?: Record<string, string> } };

  it("ships the exact supervised Vitest scripts on the reserved bases", () => {
    // The values are unchanged; only the keys moved. These are governed PAIRS
    // now — Lisa forces `<key>:lisa` and merely defaults `<key>` to invoke it,
    // so a host can chain onto the host-facing name without an apply erasing
    // it. Asserting the host-facing key here would re-assert the defect.
    expect(template.force?.scripts).toMatchObject({
      "test:lisa":
        "node scripts/lib/worktree-dependencies.mjs && lisa-test-run --profile phaser --adapter vitest -- vitest run",
      "test:cov:lisa":
        "node scripts/lib/worktree-dependencies.mjs && lisa-test-run --profile phaser --adapter vitest -- vitest run --coverage",
    });
  });

  it("redispatches the complete wrapped command when discovering its tool", () => {
    expect(
      commandTools(
        "lisa-test-run --profile phaser --adapter vitest -- bun run --silent vitest"
      )
    ).toEqual(["vitest"]);
  });
});

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

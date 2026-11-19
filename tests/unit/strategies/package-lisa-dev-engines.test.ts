/**
 * A forced `devEngines.packageManager` floor reaches only the hosts whose
 * package manager it names (CodySwannGT/lisa#4848).
 *
 * The CDK template forces an npm floor (#4793). `actions/setup-node` reads that
 * key and turns on npm caching, which fails on a bun host because it has no
 * npm lockfile. Because the key is forced, a host could not drop it for good.
 * @module tests/unit/strategies/package-lisa-dev-engines
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  detectHostPackageManager,
  fitDevEnginesToHost,
  parseInvokingPackageManager,
  retireDevEnginesFloor,
} from "../../../src/strategies/package-lisa-dev-engines.js";
import { PackageLisaStrategy } from "../../../src/strategies/package-lisa.js";
import type { ResolvedPackageLisaTemplate } from "../../../src/strategies/package-lisa-types.js";

const NPM_FLOOR = { name: "npm", version: ">=11.6.0", onFail: "warn" };

const NPM_LOCKFILE = "package-lock.json";
const BUN_LOCKFILE = "bun.lock";

const dirs: string[] = [];

/**
 * Make a project directory holding the named files.
 * @param files - File names to create
 * @param manifest - Optional package.json content
 * @returns The directory
 */
function project(
  files: readonly string[],
  manifest?: Record<string, unknown>
): string {
  const dir = mkdtempSync(path.join(tmpdir(), "lisa-dev-engines-"));
  dirs.push(dir);
  for (const file of files) writeFileSync(path.join(dir, file), "");
  if (manifest !== undefined)
    writeFileSync(path.join(dir, "package.json"), JSON.stringify(manifest));
  return dir;
}

/**
 * A template forcing the npm floor beside an unrelated forced key.
 * @returns Template
 */
function template(): ResolvedPackageLisaTemplate {
  return {
    force: { private: true, devEngines: { packageManager: NPM_FLOOR } },
    defaults: {},
    merge: {},
    remove: {},
    adopt: {},
  };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true });
});

describe("detectHostPackageManager", () => {
  it.each([
    [BUN_LOCKFILE, "bun"],
    ["bun.lockb", "bun"],
    ["yarn.lock", "yarn"],
    ["pnpm-lock.yaml", "pnpm"],
    [NPM_LOCKFILE, "npm"],
    ["npm-shrinkwrap.json", "npm"],
  ])("reads %s as %s", (file, manager) => {
    expect(detectHostPackageManager(project([file]), {})).toBe(manager);
  });

  it("prefers the packageManager field over a lockfile", () => {
    expect(
      detectHostPackageManager(project([NPM_LOCKFILE]), {
        packageManager: "bun@1.4.4",
      })
    ).toBe("bun");
  });

  it("treats an npm lockfile as npm even beside another manager's", () => {
    expect(
      detectHostPackageManager(project([BUN_LOCKFILE, NPM_LOCKFILE]), {})
    ).toBe("npm");
  });

  it("is unknown with no lockfile and no field", () => {
    expect(detectHostPackageManager(project([]), {})).toBeUndefined();
  });

  it("is unknown with no project directory", () => {
    expect(detectHostPackageManager(undefined, {})).toBeUndefined();
  });

  it("falls back to the invoking manager with no field and no lockfile", () => {
    expect(detectHostPackageManager(project([]), {}, "bun")).toBe("bun");
    expect(detectHostPackageManager(undefined, {}, "bun")).toBe("bun");
  });

  it("lets a lockfile outrank the invoking manager", () => {
    expect(detectHostPackageManager(project([NPM_LOCKFILE]), {}, "bun")).toBe(
      "npm"
    );
  });

  it("lets the packageManager field outrank the invoking manager", () => {
    expect(
      detectHostPackageManager(
        project([]),
        { packageManager: "npm@11.6.0" },
        "bun"
      )
    ).toBe("npm");
  });
});

describe("parseInvokingPackageManager", () => {
  it.each([
    ["bun/1.4.4 npm/? node/v24.21.0 darwin arm64", "bun", "1.4.4"],
    ["npm/11.6.2 node/v24.21.0 linux x64 workspaces/false", "npm", "11.6.2"],
    ["pnpm/10.12.1 npm/? node/v24.21.0 linux x64", "pnpm", "10.12.1"],
    ["yarn/4.9.2 npm/? node/v24.21.0 linux x64", "yarn", "4.9.2"],
    ["yarn/1.22.22 npm/? node/v24.21.0 darwin arm64", "yarn", "1.22.22"],
    [
      "bun/1.5.0-canary.12+abc123 npm/? node/v24.21.0",
      "bun",
      "1.5.0-canary.12+abc123",
    ],
    ["  bun/1.4.4 npm/? node/v24.21.0  ", "bun", "1.4.4"],
  ])("reads %s as %s %s", (userAgent, name, version) => {
    expect(parseInvokingPackageManager(userAgent)).toEqual({ name, version });
  });

  it.each([
    [undefined],
    [""],
    ["node/v24.21.0 darwin arm64"],
    ["deno/2.4.0"],
    ["bun"],
    ["bun/"],
    ["bun/? npm/1.0.0"],
    ["bunny/1.4.4"],
    ["npm 11.6.2"],
    ["Bun/1.4.4"],
  ])("names no manager for %j", userAgent => {
    expect(parseInvokingPackageManager(userAgent)).toBeUndefined();
  });
});

describe("fitDevEnginesToHost", () => {
  it("keeps the npm floor for an npm host", () => {
    const fitted = fitDevEnginesToHost(template(), "npm", {});
    expect(fitted.template.force.devEngines).toEqual({
      packageManager: NPM_FLOOR,
    });
  });

  it("keeps the npm floor when the host manager is unknown", () => {
    const fitted = fitDevEnginesToHost(template(), undefined, {});
    expect(fitted.template.force.devEngines).toEqual({
      packageManager: NPM_FLOOR,
    });
  });

  it("does not force the npm floor onto a bun host", () => {
    const fitted = fitDevEnginesToHost(template(), "bun", {});
    expect(fitted.template.force.devEngines).toBeUndefined();
    expect(fitted.template.force.private).toBe(true);
  });

  it("retires the npm floor Lisa wrote on an earlier apply", () => {
    const fitted = fitDevEnginesToHost(template(), "bun", {
      devEngines: { packageManager: NPM_FLOOR },
    });
    expect(fitted.retire).toBe(true);
  });

  it("retires Lisa's floor whatever order its keys are in", () => {
    const fitted = fitDevEnginesToHost(template(), "bun", {
      devEngines: {
        packageManager: { onFail: "warn", version: ">=11.6.0", name: "npm" },
      },
    });
    expect(fitted.retire).toBe(true);
  });

  it("leaves a devEngines value the host wrote itself", () => {
    const fitted = fitDevEnginesToHost(template(), "bun", {
      devEngines: { packageManager: { name: "bun", version: ">=1.4.0" } },
    });
    expect(fitted.retire).toBe(false);
  });

  it("does not mutate the template it was given", () => {
    const original = template();
    fitDevEnginesToHost(original, "bun", {});
    expect(original.force.devEngines).toEqual({ packageManager: NPM_FLOOR });
  });
});

describe("retireDevEnginesFloor", () => {
  it("keeps other devEngines keys", () => {
    expect(
      retireDevEnginesFloor({
        devEngines: { packageManager: NPM_FLOOR, runtime: { name: "node" } },
      })
    ).toEqual({ devEngines: { runtime: { name: "node" } } });
  });

  it("leaves a manifest without devEngines alone", () => {
    expect(retireDevEnginesFloor({ name: "x" })).toEqual({ name: "x" });
  });
});

describe("CDK template applied to hosts (#4848)", () => {
  const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

  /**
   * Plan a CDK host's package.json the way apply does.
   * @param dir - Host directory
   * @param manifest - Host package.json
   * @param invoking - Manager that launched the apply, if any
   * @returns Planned package.json
   */
  function plan(
    dir: string,
    manifest: Record<string, unknown>,
    invoking?: string
  ): Promise<Record<string, unknown>> {
    return new PackageLisaStrategy().planPackageJson(
      manifest,
      ["typescript", "cdk"],
      REPO_ROOT,
      false,
      dir,
      invoking
    );
  }

  it("gives an npm host the npm floor", async () => {
    const planned = await plan(project([NPM_LOCKFILE]), { name: "h" });
    expect(planned.devEngines).toEqual({ packageManager: NPM_FLOOR });
  });

  it("does not give a bun host the npm floor", async () => {
    const planned = await plan(project([BUN_LOCKFILE]), { name: "h" });
    expect(planned.devEngines).toBeUndefined();
  });

  it("removes the npm floor an earlier apply wrote onto a bun host", async () => {
    const planned = await plan(project([BUN_LOCKFILE]), {
      name: "h",
      devEngines: { packageManager: NPM_FLOOR },
    });
    expect(planned.devEngines).toBeUndefined();
  });

  it("gives a host with no signal at all the npm floor", async () => {
    const planned = await plan(project([]), { name: "h" });
    expect(planned.devEngines).toEqual({ packageManager: NPM_FLOOR });
  });

  it("does not give a fresh host adopted through bun the npm floor", async () => {
    const planned = await plan(project([]), { name: "h" }, "bun");
    expect(planned.devEngines).toBeUndefined();
  });

  it("keeps one floor decision across two adoptions of a bun host (#4941)", async () => {
    // First adoption: `bunx lisa apply .` on a host with no lockfile yet.
    const dir = project([]);
    const first = await plan(dir, { name: "h" }, "bun");
    // `bun install` then writes bun.lock, and the next apply may be launched
    // by anything, including a bare `lisa apply .` with no user agent.
    writeFileSync(path.join(dir, BUN_LOCKFILE), "");
    expect(await plan(dir, { ...first })).toEqual(first);
    expect(await plan(dir, { ...first }, "bun")).toEqual(first);
    expect(first.devEngines).toBeUndefined();
  });

  it("keeps one floor decision across two adoptions of an npm host", async () => {
    const dir = project([]);
    const first = await plan(dir, { name: "h" }, "npm");
    writeFileSync(path.join(dir, NPM_LOCKFILE), "");
    expect(await plan(dir, { ...first })).toEqual(first);
    expect(first.devEngines).toEqual({ packageManager: NPM_FLOOR });
  });

  it("is stable when a bun host is applied twice", async () => {
    const dir = project([BUN_LOCKFILE]);
    const once = await plan(dir, { name: "h" });
    expect(await plan(dir, { ...once })).toEqual(once);
  });
});

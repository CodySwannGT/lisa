/**
 * Expo's shipped `jest.config.ts` names `esbuild-register` as its Jest config
 * loader, Lisa ships that package to every host, and a CommonJS host needs it
 * (CodySwannGT/lisa#4932).
 *
 * The loader is invisible to knip: Jest names it in a docblock, and nothing
 * imports it. That made it look removable. It is not. Jest 30 first tries
 * Node's own TypeScript support and only reaches the docblock loader after a
 * `SyntaxError`, which is exactly what an Expo app gets: its package.json has
 * no `"type": "module"`, so Node reads the config's `import` statements as
 * CommonJS and refuses them. Removing the pragma broke every Expo host's unit
 * suite in the packed-host journey. This suite proves both halves — Node alone
 * cannot load the shipped config in a CommonJS host, and `esbuild-register`,
 * registered the way Jest registers it, can — and pins the dependency that
 * puts the loader in the host's tree.
 * @module tests/unit/config/expo-jest-config-loader
 */
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const TEMPLATE = path.join(
  REPO_ROOT,
  "expo",
  "copy-overwrite",
  "jest.config.ts"
);

/** A CommonJS host's config that imports a sibling module, as the real one does. */
const HOST_CONFIG = [
  'import { base } from "./jest.base";',
  'const config = { ...base, testEnvironment: "node" };',
  "export default config;",
  "",
].join("\n");

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0))
    fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * A minimal CommonJS host holding a TypeScript Jest config.
 * @returns Path of the host's jest.config.ts
 */
function commonJsHost(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "expo-jest-loader-"));
  const config = path.join(dir, "jest.config.ts");
  tempDirs.push(dir);
  fs.writeFileSync(path.join(dir, "package.json"), '{"name":"host"}\n');
  fs.writeFileSync(
    path.join(dir, "jest.base.ts"),
    'export const base = { preset: "jest-expo" };\n'
  );
  fs.writeFileSync(config, HOST_CONFIG);
  return config;
}

describe("Expo's Jest config loader", () => {
  it("is named in the shipped config and shipped by Lisa", () => {
    const docblock = fs.readFileSync(TEMPLATE, "utf8").split("*/")[0] ?? "";
    expect(docblock).toMatch(/@jest-config-loader esbuild-register\b/u);
    const manifest = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")
    ) as { dependencies?: Record<string, string> };
    expect(manifest.dependencies).toHaveProperty("esbuild-register");
  });

  it("is needed: Node alone cannot load the config in a CommonJS host", () => {
    const config = commonJsHost();
    const run = boundedSpawnSync({
      label: "load a TypeScript Jest config with Node alone",
      command: process.execPath,
      args: ["-e", `require(${JSON.stringify(config)})`],
    });
    expect(run.status).not.toBe(0);
  });

  it("is sufficient: registered as Jest registers it, the config loads", () => {
    const config = commonJsHost();
    const requireFromHost = createRequire(config);
    const { register } = createRequire(__filename)(
      "esbuild-register/dist/node"
    ) as typeof import("esbuild-register/dist/node");
    const { unregister } = register({
      target: `node${process.version.slice(1)}`,
    });
    try {
      const loaded = requireFromHost(config) as {
        default: { preset: string; testEnvironment: string };
      };
      expect(loaded.default).toEqual({
        preset: "jest-expo",
        testEnvironment: "node",
      });
    } finally {
      unregister();
    }
  });
});

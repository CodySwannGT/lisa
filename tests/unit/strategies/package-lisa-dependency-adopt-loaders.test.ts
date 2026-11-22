/**
 * The reclaim guard keeps a package a tool or a config loads without any host
 * file importing it, and drops one whose only use another kept package already
 * serves (CodySwannGT/lisa#4932).
 * @module tests/unit/strategies/package-lisa-dependency-adopt-loaders
 */
import { describe, expect, it } from "vitest";

import { findMentionedPackages } from "../../../src/strategies/package-mentions.js";
import { createPackageLisaApplyHarness } from "../../helpers/package-lisa-apply-harness.js";
import {
  gitInit,
  writeHostFile,
} from "../../helpers/package-mention-fixture.js";

const MANIFEST = "package.json";

describe("dependency reclaim and packages loaded without an import", () => {
  const host = createPackageLisaApplyHarness();

  it("keeps a package a tool loads by its short name", async () => {
    gitInit(host.hostDir());
    // codegen.ts names plugins as `typescript-operations`, not the package.
    writeHostFile(
      host.hostDir(),
      "codegen.ts",
      'export default { generates: { "a.ts": { plugins: ["typescript-operations"] } } };\n'
    );
    expect([
      ...(await findMentionedPackages(host.hostDir(), [
        "@graphql-codegen/typescript-operations",
        "@graphql-codegen/near-operation-file-preset",
      ])),
    ]).toEqual(["@graphql-codegen/typescript-operations"]);
  });

  it("keeps a package the app config loads through a setting", async () => {
    // Expo loads expo-system-ui for `userInterfaceStyle`; the host never
    // names the package, and knip's Expo plugin counts it as used.
    gitInit(host.hostDir());
    writeHostFile(
      host.hostDir(),
      "app.json",
      '{"expo":{"userInterfaceStyle":"automatic"}}'
    );
    expect([
      ...(await findMentionedPackages(host.hostDir(), [
        "expo-system-ui",
        "expo-navigation-bar",
      ])),
    ]).toEqual(["expo-system-ui"]);
  });

  it("keeps a native module that only the app config names, as a config plugin", async () => {
    // Expo resolves config plugins from app.json at prebuild; host code never
    // imports them, and the tracked config is where the name lives.
    gitInit(host.hostDir());
    writeHostFile(
      host.hostDir(),
      "app.json",
      '{"expo":{"plugins":[["expo-build-properties",{"ios":{}}]]}}'
    );
    expect([
      ...(await findMentionedPackages(host.hostDir(), [
        "expo-build-properties",
        "expo-battery",
      ])),
    ]).toEqual(["expo-build-properties"]);
  });

  it("keeps a package a manifest script runs, but not one it merely lists", async () => {
    gitInit(host.hostDir());
    writeHostFile(
      host.hostDir(),
      MANIFEST,
      JSON.stringify({
        scripts: { "test:debug": "node -r ts-node/register run.ts" },
        devDependencies: { "ts-node": "^10.9.2", "old-lib": "1" },
        overrides: { "old-lib": "1" },
      })
    );
    expect([
      ...(await findMentionedPackages(host.hostDir(), ["ts-node", "old-lib"])),
    ]).toEqual(["ts-node"]);
    // A command another kept package already puts on PATH keeps nothing:
    // `@playwright/test` ships the `playwright` binary.
    writeHostFile(
      host.hostDir(),
      MANIFEST,
      JSON.stringify({ scripts: { "test:e2e": "playwright test" } })
    );
    writeHostFile(
      host.hostDir(),
      "node_modules/@playwright/test/package.json",
      JSON.stringify({ bin: { playwright: "cli.js" } })
    );
    // Installed, `playwright` ships the same binary itself.
    writeHostFile(
      host.hostDir(),
      "node_modules/playwright/package.json",
      JSON.stringify({ bin: { playwright: "cli.js" } })
    );
    expect([
      ...(await findMentionedPackages(
        host.hostDir(),
        ["playwright"],
        ["@playwright/test", "playwright"]
      )),
    ]).toEqual([]);
    expect([
      ...(await findMentionedPackages(host.hostDir(), ["playwright"], [])),
    ]).toEqual(["playwright"]);
  });

  it("keeps a package whose binary a manifest script runs", async () => {
    gitInit(host.hostDir());
    writeHostFile(
      host.hostDir(),
      MANIFEST,
      JSON.stringify({ scripts: { build: "nest build" } })
    );
    writeHostFile(
      host.hostDir(),
      "node_modules/@nestjs/cli/package.json",
      JSON.stringify({ bin: { nest: "bin/nest.js" } })
    );
    expect([
      ...(await findMentionedPackages(host.hostDir(), ["@nestjs/cli"])),
    ]).toEqual(["@nestjs/cli"]);
  });

  it("keeps the commitlint preset while the host keeps commitlint itself", async () => {
    gitInit(host.hostDir());
    const preset = "@commitlint/config-conventional";
    const deps = ["@commitlint/cli", preset];
    expect([
      ...(await findMentionedPackages(host.hostDir(), [preset], deps)),
    ]).toEqual([preset]);
    expect([
      ...(await findMentionedPackages(host.hostDir(), deps, deps)),
    ]).toEqual([]);
  });
});

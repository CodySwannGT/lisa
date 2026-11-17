/**
 * @file package-lisa-dependency-adopt.test.ts
 * @description A dependency Lisa stops supplying leaves a host only when the
 * host never uses it (CodySwannGT/lisa#4932).
 *
 * `adopt` reclaims a key still holding a value Lisa wrote. For a dependency that
 * is not proof enough: a host can import a package Lisa once forced without
 * ever touching the version Lisa wrote. So a dependency key is reclaimed only
 * when no host file outside the manifest and lockfiles mentions the package,
 * and every doubt — no repository, git unable to answer — keeps it.
 * @module tests/unit/strategies/package-lisa-dependency-adopt
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import { findMentionedPackages } from "../../../src/strategies/package-mentions.js";
import { boundedExecFileSync } from "../../helpers/io-latency-budget.js";
import { createPackageLisaApplyHarness } from "../../helpers/package-lisa-apply-harness.js";
import { resolveGit } from "../../support/git-executable.js";

const TYPESCRIPT = "typescript";
const RETIRED = "retired-kit";
const RETIRED_VALUE = "^1.2.0";
const DEV_DEPENDENCIES = "devDependencies";
const UNRELATED_SOURCE = "export const x = 1;\n";
const OLD_PLUGIN = "old-plugin";
const MANIFEST = "package.json";

/** A template that no longer supplies the package and recognises its old value. */
const TEMPLATE = {
  force: { scripts: { build: "tsc" } },
  adopt: { devDependencies: { [RETIRED]: [RETIRED_VALUE] } },
};

/**
 * Make a directory an installed git repository: the mention check searches it
 * with git and reads peers from its `node_modules`.
 * @param dir - Host directory
 */
function gitInit(dir: string): void {
  boundedExecFileSync({
    label: "git init host fixture",
    command: resolveGit(),
    args: ["init", "-q"],
    cwd: dir,
  });
  fs.mkdirSync(path.join(dir, "node_modules"), { recursive: true });
}

/**
 * Install a package's manifest into the host's `node_modules`.
 * @param dir - Host directory
 * @param name - Package name
 * @param peerDependencies - Peers the installed package declares
 */
function installPackage(
  dir: string,
  name: string,
  peerDependencies: Readonly<Record<string, string>> = {}
): void {
  writeHostFile(
    dir,
    path.join("node_modules", name, MANIFEST),
    JSON.stringify({ name, version: "1.0.0", peerDependencies })
  );
}

/**
 * Write a host file, creating its directory.
 * @param dir - Host directory
 * @param relative - Path inside the host
 * @param contents - File contents
 */
function writeHostFile(dir: string, relative: string, contents: string): void {
  fs.mkdirSync(path.dirname(path.join(dir, relative)), { recursive: true });
  fs.writeFileSync(path.join(dir, relative), contents);
}

describe("dependency adopt is guarded by use (#4932)", () => {
  const host = createPackageLisaApplyHarness();

  /**
   * The host's devDependencies after one apply of the retiring template.
   * @param value - Version the host holds for the retired package
   * @param files - Host files to write before the apply
   * @param git - Whether the host is a git repository
   * @returns devDependencies as the apply left them
   */
  async function applyWith(
    value: string,
    files: Readonly<Record<string, string>>,
    git = true
  ): Promise<Record<string, string>> {
    await host.writeTemplate(TYPESCRIPT, TEMPLATE);
    await host.writeHostManifest({
      [DEV_DEPENDENCIES]: { [RETIRED]: value, typescript: "^6.0.3" },
    });
    if (git) gitInit(host.hostDir());
    for (const [relative, contents] of Object.entries(files))
      writeHostFile(host.hostDir(), relative, contents);
    await host.runApply();
    return ((await host.hostPackage())[DEV_DEPENDENCIES] ?? {}) as Record<
      string,
      string
    >;
  }

  it("removes the value Lisa wrote when nothing in the host names the package", async () => {
    const deps = await applyWith(RETIRED_VALUE, {
      "src/index.ts": UNRELATED_SOURCE,
      // Lockfiles name every dependency, so they prove nothing.
      "bun.lock": `{"packages":{"${RETIRED}":["${RETIRED}@1.2.0"]}}\n`,
    });
    expect(deps).not.toHaveProperty(RETIRED);
    expect(deps.typescript).toBe("^6.0.3");
  });

  it("keeps the value Lisa wrote when host code imports the package", async () => {
    const deps = await applyWith(RETIRED_VALUE, {
      "src/index.ts": `import kit from "${RETIRED}";\nexport default kit;\n`,
    });
    expect(deps[RETIRED]).toBe(RETIRED_VALUE);
  });

  it("keeps a mention in a file git does not track yet", async () => {
    const deps = await applyWith(RETIRED_VALUE, {
      "scripts/new.mjs": `await import("${RETIRED}");\n`,
    });
    expect(deps[RETIRED]).toBe(RETIRED_VALUE);
  });

  it("keeps a version the host chose, mentioned or not", async () => {
    const deps = await applyWith("^9.9.9", {
      "src/index.ts": UNRELATED_SOURCE,
    });
    expect(deps[RETIRED]).toBe("^9.9.9");
  });

  it("keeps every dependency when the host has nothing installed to read peers from", async () => {
    await host.writeTemplate(TYPESCRIPT, TEMPLATE);
    await host.writeHostManifest({
      [DEV_DEPENDENCIES]: { [RETIRED]: RETIRED_VALUE },
    });
    boundedExecFileSync({
      label: "git init host fixture",
      command: resolveGit(),
      args: ["init", "-q"],
      cwd: host.hostDir(),
    });
    await host.runApply();
    expect(
      ((await host.hostPackage())[DEV_DEPENDENCIES] as Record<string, string>)[
        RETIRED
      ]
    ).toBe(RETIRED_VALUE);
  });

  it("keeps every dependency when the host is not a repository it can search", async () => {
    const deps = await applyWith(
      RETIRED_VALUE,
      { "src/index.ts": UNRELATED_SOURCE },
      false
    );
    expect(deps[RETIRED]).toBe(RETIRED_VALUE);
  });
});

describe("findMentionedPackages", () => {
  const host = createPackageLisaApplyHarness();

  it("counts every candidate as mentioned when there is no host tree", async () => {
    expect([...(await findMentionedPackages(undefined, ["a", "b"]))]).toEqual([
      "a",
      "b",
    ]);
  });

  it("keeps a @types package whose typed package the host uses", async () => {
    gitInit(host.hostDir());
    writeHostFile(host.hostDir(), "src/a.ts", 'import x from "base-64";\n');
    writeHostFile(host.hostDir(), "src/b.ts", 'import y from "@scope/pkg";\n');
    expect([
      ...(await findMentionedPackages(host.hostDir(), [
        "@types/base-64",
        "@types/scope__pkg",
        "@types/unused-lib",
      ])),
    ]).toEqual(["@types/base-64", "@types/scope__pkg"]);
  });

  it("keeps a peer that a kept package needs, and lets it go with that package", async () => {
    gitInit(host.hostDir());
    installPackage(host.hostDir(), "icons", { svg: "*" });
    installPackage(host.hostDir(), "svg");
    writeHostFile(host.hostDir(), "src/use.ts", 'import "icons";\n');
    const deps = ["icons", "svg", "typescript"];
    // The host imports `icons`, which needs `svg` as a peer: both stay.
    expect([
      ...(await findMentionedPackages(host.hostDir(), ["icons", "svg"], deps)),
    ]).toEqual(["icons", "svg"]);
    // Nothing imports `icons` any more: it goes, and its peer goes with it.
    fs.rmSync(path.join(host.hostDir(), "src", "use.ts"));
    expect([
      ...(await findMentionedPackages(host.hostDir(), ["icons", "svg"], deps)),
    ]).toEqual([]);
  });

  it("does not count a file Lisa replaces every run, nor Lisa's governance manifest", async () => {
    gitInit(host.hostDir());
    writeHostFile(
      host.hostDir(),
      "eslint.legacy.ts",
      '/**\n * This file is managed by Lisa and IS replaced on each `lisa` run.\n */\nimport "old-plugin";\n'
    );
    writeHostFile(
      host.hostDir(),
      "package.lisa.json",
      '{"force":{"devDependencies":{"old-plugin":"1"}}}'
    );
    expect([
      ...(await findMentionedPackages(host.hostDir(), [OLD_PLUGIN])),
    ]).toEqual([]);
    // The same import in a file the host owns is the host's own use.
    writeHostFile(host.hostDir(), "src/own.ts", 'import "old-plugin";\n');
    expect([
      ...(await findMentionedPackages(host.hostDir(), [OLD_PLUGIN])),
    ]).toEqual([OLD_PLUGIN]);
  });

  it("does not count prose, ignore lists, or knip and audit exceptions", async () => {
    gitInit(host.hostDir());
    const files = {
      "CHANGELOG.md": "- dropped old-lib\n",
      "docs/notes.md": "old-lib was here\n",
      "knip.json": '{"ignoreDependencies":["old-lib"]}',
      "audit.ignore.local.json": '{"exclusions":[{"package":"old-lib"}]}',
      ".gitignore": "old-lib-cache/\n",
    };
    for (const [file, text] of Object.entries(files))
      writeHostFile(host.hostDir(), file, text);
    expect([
      ...(await findMentionedPackages(host.hostDir(), ["old-lib"])),
    ]).toEqual([]);
  });

  it("counts only a standalone name in the host's own text", async () => {
    gitInit(host.hostDir());
    const files = {
      // Inside longer words and identifiers, or a Claude plugin id.
      "src/a.ts":
        'export const start = "tarball";\nimport "eslint-plugin-tar";\n',
      ".claude/settings.json":
        '{"enabledPlugins":{"tar@claude-plugins-official":true}}',
      "eslint.ignore.config.json": '{"ignores":["tar-report/**"]}',
      "tests/e2e/a.spec.ts": 'import { test } from "@tar/test";\n',
      ".lintstagedrc.json": '{"*.{js,tar,tsx}":["eslint"]}',
      // Lisa's own paths and machine state, and Lisa's block inside a shared hook.
      "scripts/lisa-gate.mjs": 'await import("tar");\n',
      ".lisa/plan-host-1.json": '{"steps":["remove tar"]}',
      ".husky/pre-commit":
        "#!/bin/sh\n# BEGIN: AI GUARDRAILS\nnpx tar\n# END: AI GUARDRAILS\n",
    };
    for (const [file, text] of Object.entries(files))
      writeHostFile(host.hostDir(), file, text);
    expect([...(await findMentionedPackages(host.hostDir(), ["tar"]))]).toEqual(
      []
    );
    // The host's own line in the same hook is the host's use.
    writeHostFile(
      host.hostDir(),
      ".husky/pre-commit",
      "#!/bin/sh\n# BEGIN: AI GUARDRAILS\n# END: AI GUARDRAILS\nnpx tar@7 -x\n"
    );
    expect([...(await findMentionedPackages(host.hostDir(), ["tar"]))]).toEqual(
      ["tar"]
    );
  });

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

  it("separates a mentioned package from an unmentioned one", async () => {
    gitInit(host.hostDir());
    writeHostFile(
      host.hostDir(),
      MANIFEST,
      '{"dependencies":{"a":"1","b":"1"}}'
    );
    writeHostFile(host.hostDir(), "src/use.ts", 'import "a";\n');
    expect([
      ...(await findMentionedPackages(host.hostDir(), ["a", "b"])),
    ]).toEqual(["a"]);
  });
});

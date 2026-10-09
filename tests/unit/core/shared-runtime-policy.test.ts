/** Shared runtime patches must propagate without changing host ownership. */
import * as fs from "fs-extra";
import * as path from "node:path";
import { intersects, minVersion } from "semver";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { LisaConfig } from "../../../src/core/config.js";
import { PackageLisaStrategy } from "../../../src/strategies/package-lisa.js";
import { boundedExecFileSync } from "../../helpers/io-latency-budget.js";
import { GIT_BIN } from "../../support/git-executable.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const NODE_PATCH = "24.21.0";
const VITEST_FLOOR = "4.1.11";
const VITE_FLOOR = "8.3.2";
const PACKAGE_JSON = "package.json";
const TEMPLATE_NAME = "package.lisa.json";
const STACKS = [
  "typescript",
  "cdk",
  "nestjs",
  "npm-package",
  "phaser",
  "harper-fabric",
];
const HARNESSES = [
  "claude",
  "codex",
  "cursor",
  "opencode",
  "agy",
  "copilot",
] as const;

/** Package fields governed by the runtime policy under test. */
type Manifest = {
  engines?: Record<string, string>;
  devDependencies?: Record<string, string>;
  dependencies?: Record<string, string>;
  overrides?: Record<string, string>;
};

/**
 * Load an owned template without substituting test data for its policy.
 * @param stack - Shipped stack template directory
 * @returns Original ownership groups
 */
function readTemplate(stack: string): Record<string, Manifest> {
  return fs.readJsonSync(
    path.join(ROOT, stack, "package-lisa", TEMPLATE_NAME)
  ) as Record<string, Manifest>;
}

/**
 * Assert both the floor and the supported major of a declared range.
 * @param range - Declared package range
 * @param floor - Lowest allowed patch
 * @param major - Supported package major
 */
function expectFloor(
  range: string | undefined,
  floor: string,
  major: number
): void {
  expect(range).toBeDefined();
  expect(minVersion(range as string)?.major).toBe(major);
  expect(intersects(range as string, `<${floor}`)).toBe(false);
}

describe("shared runtime patch policy", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });
  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  /**
   * Apply the shipped template twice and retain byte-level idempotence proof.
   * @param stack - Detected stack and template directory
   * @param host - Caller-owned manifest settings
   * @param harness - Agent surface receiving the shared policy
   * @returns Manifest written by the real strategy
   */
  async function applyTemplate(
    stack: string,
    host: Manifest,
    harness: LisaConfig["harness"] = "claude"
  ): Promise<Manifest> {
    await fs.writeJson(path.join(tempDir, "tsconfig.json"), {});
    if (stack === "cdk") await fs.writeJson(path.join(tempDir, "cdk.json"), {});
    await fs.writeJson(path.join(tempDir, PACKAGE_JSON), {
      name: "runtime-fixture",
      version: "1.0.0",
      ...host,
    });
    const config: LisaConfig = {
      lisaDir: ROOT,
      destDir: tempDir,
      dryRun: false,
      yesMode: true,
      validateOnly: false,
      skipGitCheck: false,
      harness,
    };
    const strategy = new PackageLisaStrategy();
    const source = path.join(ROOT, stack, "package-lisa", TEMPLATE_NAME);
    const destination = path.join(tempDir, TEMPLATE_NAME);
    const context = {
      config,
      backupFile: async () => {},
      promptOverwrite: async () => true,
    };
    await strategy.apply(source, destination, TEMPLATE_NAME, context);
    const first = await fs.readFile(path.join(tempDir, PACKAGE_JSON), "utf8");
    await strategy.apply(source, destination, TEMPLATE_NAME, context);
    expect(await fs.readFile(path.join(tempDir, PACKAGE_JSON), "utf8")).toBe(
      first
    );
    return JSON.parse(first) as Manifest;
  }

  it.each(STACKS)("%s supplies coordinated patched test-tool floors", stack => {
    const template = readTemplate(stack);
    const tools = {
      ...template.defaults?.devDependencies,
      ...template.force?.devDependencies,
    };
    expectFloor(tools.vitest, VITEST_FLOOR, 4);
    expectFloor(tools["@vitest/coverage-v8"], VITEST_FLOOR, 4);
    expect(tools.vitest).toBe(tools["@vitest/coverage-v8"]);
    if (tools.vite !== undefined) expectFloor(tools.vite, VITE_FLOOR, 8);
    const node =
      template.defaults?.engines?.node ?? template.force?.engines?.node;
    if (node !== undefined) expect(minVersion(node)?.version).toBe(NODE_PATCH);
  });

  it.each(HARNESSES)(
    "clean TypeScript hosts get patched defaults under %s",
    async harness => {
      const result = await applyTemplate("typescript", {}, harness);
      expect(result.engines?.node).toBe(NODE_PATCH);
      expectFloor(result.devDependencies?.vitest, VITEST_FLOOR, 4);
      expectFloor(
        result.devDependencies?.["@vitest/coverage-v8"],
        VITEST_FLOOR,
        4
      );
      expectFloor(result.overrides?.vite, VITE_FLOOR, 8);
      expectFloor(result.devDependencies?.typescript, "6.0.0", 6);
      expectFloor(result.devDependencies?.eslint, "9.0.0", 9);
      expectFloor(result.devDependencies?.husky, "8.0.0", 8);
    }
  );

  it("preserves explicitly configured host-owned defaults", async () => {
    const host = {
      engines: { node: "22.22.0" },
      devDependencies: {
        vitest: "4.1.10",
        "@vitest/coverage-v8": "4.1.10",
        typescript: "6.0.3",
      },
    };
    const result = await applyTemplate("typescript", host);
    expect(result.engines?.node).toBe(host.engines.node);
    expect(result.devDependencies?.vitest).toBe(host.devDependencies.vitest);
    expect(result.devDependencies?.["@vitest/coverage-v8"]).toBe(
      host.devDependencies["@vitest/coverage-v8"]
    );
  });

  it("upgrades CDK-owned forced tools while preserving its host-owned Node default", async () => {
    const result = await applyTemplate("cdk", {
      engines: { node: "22.22.0" },
      devDependencies: {
        vitest: "4.1.0",
        "@vitest/coverage-v8": "4.1.0",
        vite: "8.0.16",
      },
    });
    expect(result.engines?.node).toBe("22.22.0");
    expectFloor(result.devDependencies?.vitest, VITEST_FLOOR, 4);
    expectFloor(
      result.devDependencies?.["@vitest/coverage-v8"],
      VITEST_FLOOR,
      4
    );
    expectFloor(result.devDependencies?.vite, VITE_FLOOR, 8);
  });

  it("keeps root/source Node and Vite policy aligned with the shared runtime file", async () => {
    expect((await fs.readFile(path.join(ROOT, ".nvmrc"), "utf8")).trim()).toBe(
      NODE_PATCH
    );
    expect(
      (
        await fs.readFile(
          path.join(ROOT, "typescript/copy-overwrite/.nvmrc"),
          "utf8"
        )
      ).trim()
    ).toBe(NODE_PATCH);
    const root = (await fs.readJson(path.join(ROOT, PACKAGE_JSON))) as Manifest;
    const source = (await fs.readJson(
      path.join(ROOT, TEMPLATE_NAME)
    )) as Record<string, Manifest>;
    expect(root.engines?.node).toBe(NODE_PATCH);
    expectFloor(root.dependencies?.knip, "5.0.0", 5);
    expect(source.defaults?.engines?.node).toBe(NODE_PATCH);
    expectFloor(root.devDependencies?.vite, VITE_FLOOR, 8);
    expect(root.devDependencies?.vite).toBe(
      source.force?.devDependencies?.vite
    );
    expect(source.force?.overrides?.["deepmerge-ts"]).toBe("^8.0.1");
  });

  it("seeds all three TypeScript workflow channels while keeping variable precedence", async () => {
    const workflows = path.join(
      ROOT,
      "typescript/create-only/.github/workflows"
    );
    expect(await fs.readFile(path.join(workflows, "ci.yml"), "utf8")).toContain(
      `node_version: '${NODE_PATCH}'`
    );
    expect(
      await fs.readFile(path.join(workflows, "review-evidence.yml"), "utf8")
    ).toContain(`node-version: '${NODE_PATCH}'`);
    expect(
      await fs.readFile(
        path.join(workflows, "third-party-review-evidence.yml"),
        "utf8"
      )
    ).toContain(`node-version: \${{ vars.NODE_VERSION || '${NODE_PATCH}' }}`);
  });

  it("the Node updater reaches current tracked surfaces and leaves historical data alone", async () => {
    const updater = "scripts/update-node-version.ts";
    const previous = "22.21.1";
    const caller = "cdk/create-only/.github/workflows/ci.yml";
    const reusable = ".github/workflows/quality.yml";
    const fixtures: Record<string, string> = {
      ".nvmrc": `${NODE_PATCH}\n`,
      "typescript/copy-overwrite/.nvmrc": `${previous}\n`,
      "package.json": JSON.stringify({ engines: { node: previous } }),
      "phaser/package-lisa/package.lisa.json": JSON.stringify({
        defaults: { engines: { node: `>= ${previous}` } },
      }),
      "expo/create-only/eas.json": JSON.stringify({
        build: { node: previous },
      }),
      [caller]: `node-version: ${previous}\nnode-version: \${{ vars.NODE_VERSION || '${previous}' }}\n`,
      [reusable]: `node_version:\n  description: Node runtime\n  required: false\n  default: '${previous}'\nother_version:\n  default: '1.2.3'\nnode-version: '22.23.3' # lisa-preserve-node-version: independently qualified updater (#4367)\n`,
      ".github/workflows/npm-updater.yml": "node-version: '22.23.3'\n",
      ".github/workflows/npm-updater-runtime-qualification.yml":
        "node-version: '22.23.3'\n",
      "tests/fixtures/historical/package.json": JSON.stringify({
        engines: { node: previous },
      }),
    };
    for (const [file, contents] of Object.entries(fixtures)) {
      await fs.outputFile(path.join(tempDir, file), contents);
    }
    await fs.ensureDir(path.join(tempDir, "scripts"));
    await fs.copyFile(path.join(ROOT, updater), path.join(tempDir, updater));
    const git = (args: string[]) =>
      boundedExecFileSync({
        label: "track Node updater fixture",
        command: GIT_BIN,
        args,
        cwd: tempDir,
      });
    git(["init", "--initial-branch=main"]);
    git(["add", "."]);
    const run = () =>
      boundedExecFileSync({
        label: "run shared Node updater",
        command: process.execPath,
        args: [path.join(tempDir, updater)],
        cwd: tempDir,
      });
    run();
    for (const file of Object.keys(fixtures).filter(
      file =>
        !file.startsWith("tests/") &&
        !file.startsWith(".github/workflows/npm-updater")
    )) {
      expect(await fs.readFile(path.join(tempDir, file), "utf8")).toContain(
        NODE_PATCH
      );
      expect(await fs.readFile(path.join(tempDir, file), "utf8")).not.toContain(
        previous
      );
    }
    expect(await fs.readFile(path.join(tempDir, reusable), "utf8")).toContain(
      "default: '1.2.3'"
    );
    expect(await fs.readFile(path.join(tempDir, reusable), "utf8")).toContain(
      "node-version: '22.23.3' # lisa-preserve-node-version:"
    );
    expect(
      await fs.readFile(
        path.join(tempDir, "tests/fixtures/historical/package.json"),
        "utf8"
      )
    ).toContain(previous);
    expect(run()).toContain("Files updated: 0");
    for (const file of Object.keys(fixtures).filter(file =>
      file.startsWith(".github/workflows/npm-updater")
    )) {
      expect(await fs.readFile(path.join(tempDir, file), "utf8")).toBe(
        fixtures[file]
      );
    }
  });
});

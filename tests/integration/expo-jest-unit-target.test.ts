/** Exercise the managed Expo scripts with real Bun argument forwarding and Jest collection. */
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../helpers/io-latency-budget.js";
import { createSymlink } from "../support/borrowed-node-modules.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const TEMPLATE = path.join(ROOT, "expo/package-lisa/package.lisa.json");
const JEST_CONFIG = pathToFileURL(
  path.join(ROOT, "dist/configs/jest/expo.js")
).href;
const DIRECTORIES: string[] = [];
const SELECTED = "selected.test.ts";
const INTEGRATION = "remote.integration.test.ts";
const WATCHMAN_DISABLED = false;
const UNIT = "test:unit";
const COVERAGE = "test:cov:unit";

afterEach(() => {
  for (const directory of DIRECTORIES.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

/**
 * Set up the managed scripts with the real packaged Jest discovery settings.
 * @returns The scratch directory.
 */
function fixture(): string {
  const template = JSON.parse(readFileSync(TEMPLATE, "utf8")) as {
    readonly force: { readonly scripts: Record<string, string> };
    readonly defaults: { readonly scripts: Record<string, string> };
  };
  const directory = mkdtempSync(path.join(tmpdir(), "lisa-expo-jest-unit-"));
  DIRECTORIES.push(directory);
  writeFileSync(
    path.join(directory, "package.json"),
    JSON.stringify({
      name: "expo-discovery-fixture",
      private: true,
      type: "module",
      scripts: { ...template.defaults.scripts, ...template.force.scripts },
    })
  );
  mkdirSync(path.join(directory, "scripts"));
  createSymlink(
    path.join(ROOT, "all/copy-overwrite/scripts/lib"),
    path.join(directory, "scripts/lib"),
    "junction"
  );
  writeFileSync(
    path.join(directory, "jest.config.mjs"),
    [
      `import { getExpoJestConfig } from ${JSON.stringify(JEST_CONFIG)};`,
      "const { testMatch, testPathIgnorePatterns } = getExpoJestConfig();",
      `export default { testMatch, testPathIgnorePatterns, watchman: ${WATCHMAN_DISABLED}, maxWorkers: 1, cacheDirectory: "<rootDir>/.jest-cache" };`,
    ].join("\n")
  );
  for (const file of [SELECTED, "another.test.ts", INTEGRATION])
    writeFileSync(path.join(directory, file), "test('fixture', () => {});\n");
  return directory;
}

/**
 * Run the named host script and extract the suites reported by Jest.
 * @param directory - Scratch directory.
 * @param script - Package script to run.
 * @param filters - Positional Jest filters to pass through Bun.
 * @returns Suites Jest selected.
 */
function listTests(
  directory: string,
  script: string,
  ...filters: string[]
): string[] {
  const child = boundedSpawnSync({
    label: `Expo ${script} Jest discovery`,
    command: "bun",
    args: ["run", script, "--", ...filters, "--listTests"],
    cwd: directory,
    env: {
      ...process.env,
      PATH: `${path.join(ROOT, "node_modules/.bin")}${path.delimiter}${process.env.PATH ?? ""}`,
    },
  });
  expect(child.status, child.stderr).toBe(0);
  return child.stdout
    .split(/\r?\n/u)
    .filter(line => path.isAbsolute(line) && line.endsWith(".test.ts"))
    .map(file => path.basename(file));
}

describe("Expo managed Jest unit scripts", () => {
  it.each([UNIT, COVERAGE])(
    "selects only a supplied unit path using %s",
    script => {
      const directory = fixture();
      const selected = listTests(directory, script, SELECTED);

      expect(
        selected,
        `${script} ran ${selected.length} suites for a single path argument. ` +
          "A trailing --testPathIgnorePatterns list can consume the positional path. " +
          "Place the ignore pattern in the Jest config."
      ).toEqual([SELECTED]);
    }
  );

  it("keeps integration tests out of unit runs and includes them in integration runs", () => {
    const directory = fixture();

    expect(new Set(listTests(directory, UNIT))).toEqual(
      new Set([SELECTED, "another.test.ts"])
    );
    expect(listTests(directory, "test:integration")).toEqual([INTEGRATION]);
  });
});

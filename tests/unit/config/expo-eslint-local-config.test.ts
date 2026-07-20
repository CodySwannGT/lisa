/**
 * Host-boundary regression coverage for the managed Expo ESLint wrapper.
 *
 * The real copy-overwrite template is compiled from an isolated package-shaped
 * fixture. Its project-owned local config deliberately carries custom-plugin
 * metadata whose inferred `meta.type` is the broader `string` type. Runtime
 * ESLint accepts that host extension, so Lisa must not force it through the
 * factory return type while preserving the managed factory's own typing.
 * @module tests/unit/config/expo-eslint-local-config
 */
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const MANAGED_CONFIG_FILENAME = "eslint.config.ts";
const LOCAL_CONFIG_FILENAME = "eslint.config.local.ts";
const EXPO_ESLINT_TEMPLATE = path.join(
  REPO_ROOT,
  "expo",
  "copy-overwrite",
  MANAGED_CONFIG_FILENAME
);
const TSC = path.join(REPO_ROOT, "node_modules", "typescript", "bin", "tsc");

const MINIMAL_CUSTOM_PLUGIN = `
const customPlugin = {
  rules: {
    local: {
      meta: { type: "problem" as string },
      create: () => ({}),
    },
  },
};

export default [{ plugins: { custom: customPlugin } }];
`;

const REALISTIC_CUSTOM_PLUGIN = `
const customPlugin = {
  meta: { name: "custom-project-plugin", version: "1.0.0" },
  rules: {
    "prefer-project-api": {
      meta: {
        type: "suggestion" as string,
        docs: { description: "Prefer the project API" },
        schema: [],
      },
      create: () => ({}),
    },
  },
};

export default [
  { ignores: ["generated/**"] },
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { project: customPlugin },
    rules: { "project/prefer-project-api": "warn" },
  },
];
`;

/**
 * Compile the real managed template against one host-owned local config.
 * @param name - Stable fixture name surfaced by the test runner
 * @param localConfig - Project-owned TypeScript config source
 * @returns TypeScript's list of files compiled for non-vacuous proof
 */
function compileHostFixture(name: string, localConfig: string): string {
  const fixture = mkdtempSync(path.join(tmpdir(), `lisa-expo-${name}-`));
  try {
    copyFileSync(
      EXPO_ESLINT_TEMPLATE,
      path.join(fixture, MANAGED_CONFIG_FILENAME)
    );
    writeFileSync(path.join(fixture, LOCAL_CONFIG_FILENAME), localConfig);
    writeFileSync(
      path.join(fixture, "eslint.ignore.config.json"),
      JSON.stringify({ ignores: [] })
    );
    writeFileSync(
      path.join(fixture, "eslint.thresholds.json"),
      JSON.stringify({})
    );
    writeFileSync(
      path.join(fixture, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          allowImportingTsExtensions: true,
          declaration: true,
          module: "preserve",
          moduleResolution: "bundler",
          noEmit: true,
          resolveJsonModule: true,
          skipLibCheck: true,
          strict: true,
          target: "ES2022",
          typeRoots: [path.join(REPO_ROOT, "node_modules", "@types")],
          types: ["node"],
        },
        include: [MANAGED_CONFIG_FILENAME, LOCAL_CONFIG_FILENAME],
      })
    );

    const packageScope = path.join(fixture, "node_modules", "@codyswann");
    mkdirSync(packageScope, { recursive: true });
    symlinkSync(REPO_ROOT, path.join(packageScope, "lisa"), "dir");

    const result = spawnSync(
      process.execPath,
      [TSC, "--project", path.join(fixture, "tsconfig.json"), "--listFiles"],
      { encoding: "utf8" }
    );
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status, output).toBe(0);
    expect(output).toContain(path.join(fixture, MANAGED_CONFIG_FILENAME));
    expect(output).toContain(path.join(fixture, LOCAL_CONFIG_FILENAME));
    return output;
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

describe("Expo local ESLint config host boundary", () => {
  it("typechecks a single custom-plugin entry with widened metadata", () => {
    const compiledFiles = compileHostFixture(
      "single-custom-plugin",
      MINIMAL_CUSTOM_PLUGIN
    );

    expect(compiledFiles).toContain(LOCAL_CONFIG_FILENAME);
  });

  it("typechecks realistic multi-entry custom-plugin configuration", () => {
    const compiledFiles = compileHostFixture(
      "multi-custom-plugin",
      REALISTIC_CUSTOM_PLUGIN
    );

    expect(compiledFiles).toContain(LOCAL_CONFIG_FILENAME);
  });
});

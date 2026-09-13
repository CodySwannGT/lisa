import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import ts from "typescript";
import { afterEach, beforeEach, expect, it } from "vitest";

let root = "";
const HOST_MANIFEST = "package.json";
const require = createRequire(import.meta.url);
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "lisa-override-load-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/**
 * Write a fixture file, creating only directories owned by this test.
 * @param file - Relative fixture path
 * @param value - Text or JSON content
 */
async function put(file: string, value: unknown): Promise<void> {
  const target = path.join(root, file);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(
    target,
    typeof value === "string" ? value : JSON.stringify(value)
  );
}

/**
 * Exercise the real CLI entrypoint against an actual Node import failure.
 * @param compatible - Whether the dependency provides the required export
 */
async function prepare(compatible = false): Promise<void> {
  await put(HOST_MANIFEST, {
    type: "module",
    overrides: {
      "brace-expansion": ">=2.1.4 <3",
      "@isaacs/brace-expansion": "^5.0.1",
    },
  });
  await put("node_modules/minimatch/package.json", {
    name: "minimatch",
    version: "10.2.5",
    type: "module",
    main: "index.js",
    dependencies: { "brace-expansion": "^5.0.5" },
  });
  await put(
    "node_modules/minimatch/index.js",
    "import { expand } from 'brace-expansion'; export const result = expand('x');"
  );
  await put(
    "node_modules/minimatch/node_modules/brace-expansion/package.json",
    {
      name: "brace-expansion",
      version: compatible ? "5.0.9" : "2.1.4",
      type: compatible ? "module" : "commonjs",
      main: "index.js",
    }
  );
  await put(
    "node_modules/minimatch/node_modules/brace-expansion/index.js",
    compatible
      ? "export const expand = value => [value];"
      : "module.exports = value => [value];"
  );
  await put(
    "dist/cli/index.js",
    "import 'minimatch'; export function createProgram() { return { exitOverride() {}, async parseAsync() { console.log('CLI ran'); } }; }"
  );
  await symlink(
    path.dirname(require.resolve("commander")),
    path.join(root, "node_modules/commander")
  );
  for (const file of ["index", "cli-load-diagnostic"]) {
    const source = path.resolve(`src/${file}.ts`);
    if (!existsSync(source)) continue;
    const compiled = ts.transpileModule(await readFile(source, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    });
    await put(`dist/${file}.js`, compiled.outputText);
  }
}

/**
 * Run Node with the fixture's actual nested dependency resolution.
 * @returns Captured process result
 */
function invoke() {
  return spawnSync(
    process.execPath,
    [path.join(root, "dist/index.js"), "doctor"],
    { cwd: root, encoding: "utf8", timeout: 10_000 }
  );
}

it("explains a failed CLI import using the parent's actual nested dependency and host override", async () => {
  await prepare();
  const result = invoke();
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("Named export 'expand' not found");
  expect(result.stderr).toContain(
    "minimatch@10.2.5 declares brace-expansion ^5.0.5"
  );
  expect(result.stderr).toContain("Node resolves brace-expansion@2.1.4");
  expect(result.stderr).toContain("overrides.brace-expansion: >=2.1.4 <3");
  expect(result.stderr).toContain(
    "@isaacs/brace-expansion is a different package"
  );
  expect(result.stdout).not.toContain("CLI ran");
});

it("runs a compatible dependency without a new diagnostic", async () => {
  await prepare(true);
  const result = invoke();
  expect(result.status).toBe(0);
  expect(result.stdout).toContain("CLI ran");
  expect(result.stderr).toBe("");
});

it("does not misreport a command failure as an unexecuted startup", async () => {
  await prepare(true);
  await put(
    "dist/cli/index.js",
    "export function createProgram() { return { exitOverride() {}, async parseAsync() { throw new Error(\"'brace-expansion' failed during the command\"); } }; }"
  );
  const result = invoke();
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("failed during the command");
  expect(result.stderr).not.toContain("the requested command did not run");
});

it("does not attribute the unscoped dependency to a similarly named override", async () => {
  await prepare();
  await put(HOST_MANIFEST, {
    type: "module",
    overrides: { "@isaacs/brace-expansion": "^5.0.1" },
  });
  const result = invoke();
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(
    "No direct brace-expansion override was identified"
  );
  expect(result.stderr).not.toContain("overrides.brace-expansion:");
});

it("withholds non-version override values that could contain credentials", async () => {
  await prepare();
  await put(HOST_MANIFEST, {
    type: "module",
    overrides: {
      "brace-expansion": "https://fixture-token@example.invalid/archive.tgz",
    },
  });
  const result = invoke();
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("unverified non-version value (withheld)");
  expect(result.stderr).not.toContain("fixture-token");
});

it("keeps unreadable host configuration unverified and preserves the original import failure", async () => {
  await prepare();
  await put(HOST_MANIFEST, "{broken");
  // The package type for the executable belongs to dist, so this malformed
  // host manifest tests diagnostics rather than Node's own type discovery.
  await put("dist/package.json", { type: "module" });
  const result = invoke();
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(
    "Could not read the current directory's package.json"
  );
  expect(result.stderr).not.toContain("No incompatible overrides");
});

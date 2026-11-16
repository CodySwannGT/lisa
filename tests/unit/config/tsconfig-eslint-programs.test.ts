/**
 * The `tsconfig.eslint.json` programs ESLint's type-aware rules read their
 * types from (CodySwannGT/lisa#4927).
 *
 * `src/configs/eslint/base.ts` points `parserOptions.project` at
 * `tsconfig.eslint.json`. Wherever that program cannot resolve a name — test
 * globals, Node, an imported `.mjs` module — the type-aware rules see `any`
 * or an error type, so `no-unsafe-*` and `no-floating-promises` miss real
 * problems there or report false ones. Lisa's own copy reported 5,294 errors
 * while lint passed. `bun run typecheck:eslint` now holds Lisa's copy at zero;
 * this suite holds the copies Lisa SHIPS, which no Lisa gate compiles:
 *
 *   - each stack's template declares its own test runner's globals, Node, and
 *     JS interop, and the packages behind those `types` are ones Lisa installs
 *     for that stack; and
 *   - a host-shaped fixture using test globals, `process` and a local `.mjs`
 *     import compiles with zero errors under each shipped template — and does
 *     NOT without those settings, so the assertion is about them.
 *
 * It also compiles a NestJS host's spec files under the shipped
 * `tsconfig.spec.json`. Lisa's own root program's scope is pinned by the sibling
 * `tsconfig-eslint-root-scope.test.ts`.
 *
 * The stack set is DISCOVERED from `<stack>/copy-overwrite/tsconfig.eslint.json`.
 * @module tests/unit/config/tsconfig-eslint-programs
 */
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import process from "node:process";

import { afterEach, describe, expect, it } from "vitest";

import { PROJECT_TYPE_HIERARCHY } from "../../../src/core/config.js";
import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../../helpers/io-latency-budget.js";

useIoLatencyBudget();

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const ESLINT_PROGRAM = "tsconfig.eslint.json";
const COPY_OVERWRITE = "copy-overwrite";
const TEMPLATE = path.join(COPY_OVERWRITE, ESLINT_PROGRAM);
/** NestJS ships this beside its ESLint program to type-check spec files. */
const SPEC_PROGRAM = "tsconfig.spec.json";
const TSGO = path.join(
  REPO_ROOT,
  "node_modules",
  "@typescript",
  "native-preview",
  "bin",
  "tsgo"
);

/** The runner-global `types` entry each test runner needs. */
const RUNNER_GLOBALS = { jest: "jest", vitest: "vitest/globals" } as const;

/** The package that provides each `types` entry a template may declare. */
const TYPES_PACKAGE: Readonly<Record<string, string>> = {
  jest: "@types/jest",
  node: "@types/node",
  "vitest/globals": "vitest",
};

/** The `compilerOptions` this suite reads. */
type CompilerOptions = {
  readonly allowJs?: boolean;
  readonly checkJs?: boolean;
  readonly types?: readonly string[];
};

/** A tsconfig, reduced to what this suite reads. */
type Tsconfig = {
  readonly compilerOptions?: CompilerOptions;
  readonly exclude?: readonly string[];
};

const STACKS = fs
  .readdirSync(REPO_ROOT, { withFileTypes: true })
  .filter(
    entry =>
      entry.isDirectory() &&
      fs.existsSync(path.join(REPO_ROOT, entry.name, TEMPLATE))
  )
  .map(entry => entry.name)
  .sort((a, b) => a.localeCompare(b));

const fixtures: string[] = [];

afterEach(() => {
  for (const fixture of fixtures.splice(0))
    fs.rmSync(fixture, { force: true, recursive: true });
});

/**
 * Read a JSON file relative to the repository root.
 * @param relative - Path under the repository root.
 * @returns The parsed value.
 */
function readJson<T>(relative: string): T {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, relative), "utf8"));
}

/**
 * The test runner a stack ships a config for.
 * @param stack - Stack directory.
 * @returns The runner the stack's managed config files select.
 */
function runnerOf(stack: string): keyof typeof RUNNER_GLOBALS {
  const has = (file: string): boolean =>
    fs.existsSync(path.join(REPO_ROOT, stack, COPY_OVERWRITE, file));
  const jest = has("jest.config.ts");
  const vitest = has("vitest.config.ts");
  if (jest === vitest) {
    throw new Error(
      `${stack} ships ${jest ? "both" : "neither"} jest.config.ts and vitest.config.ts`
    );
  }
  return jest ? "jest" : "vitest";
}

/**
 * A stack and its parents, nearest first.
 * @param stack - Stack directory.
 * @returns The stack followed by each parent in PROJECT_TYPE_HIERARCHY.
 */
function lineage(stack: string): readonly string[] {
  const parent = PROJECT_TYPE_HIERARCHY[stack];
  return parent === undefined ? [stack] : [stack, ...lineage(parent)];
}

/**
 * Packages one stack's `package.lisa.json` installs.
 * @param stack - Stack directory.
 * @returns Names from force, defaults and merge (dev)dependencies.
 */
function packagesOf(stack: string): readonly string[] {
  const file = path.join(stack, "package-lisa", "package.lisa.json");
  if (!fs.existsSync(path.join(REPO_ROOT, file))) return [];
  const governance =
    readJson<Record<string, Record<string, Record<string, string>>>>(file);
  return ["force", "defaults", "merge"].flatMap(section =>
    ["dependencies", "devDependencies"].flatMap(field =>
      Object.keys(governance[section]?.[field] ?? {})
    )
  );
}

/**
 * Every package a stack's `package.lisa.json` chain installs, parents included.
 * @param stack - Stack directory.
 * @returns Package names.
 */
function installedPackages(stack: string): ReadonlySet<string> {
  return new Set(lineage(stack).flatMap(packagesOf));
}

/**
 * A disposable host root whose `node_modules` is Lisa's own, so `types`
 * entries resolve exactly as they would in a host that installed them.
 * @param prefix - Temp directory prefix.
 * @returns The realpath'd root.
 */
function hostRoot(prefix: string): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), prefix)));
  fixtures.push(root);
  fs.symlinkSync(
    path.join(REPO_ROOT, "node_modules"),
    path.join(root, "node_modules")
  );
  return root;
}

/**
 * Write a host-shaped fixture around a given `tsconfig.eslint.json`.
 *
 * The host's own `tsconfig.json` is minimal on purpose: the program's test
 * globals, Node types and JS interop must come from the shipped template, not
 * from anything a host happens to have.
 * @param eslintProgram - The `tsconfig.eslint.json` body to install.
 * @returns The fixture root.
 */
function writeHost(eslintProgram: string): string {
  const root = hostRoot("lisa-4927-");
  fs.mkdirSync(path.join(root, "src"));
  fs.mkdirSync(path.join(root, "tests"));
  fs.writeFileSync(
    path.join(root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        lib: ["ES2022"],
        skipLibCheck: true,
        strict: true,
        target: "ES2022",
      },
    })
  );
  fs.writeFileSync(path.join(root, ESLINT_PROGRAM), eslintProgram);
  fs.writeFileSync(
    path.join(root, "src", "helper.mjs"),
    "export function increment(n) {\n  return n + 1;\n}\n"
  );
  fs.writeFileSync(
    path.join(root, "tests", "helper.test.ts"),
    [
      'import { increment } from "../src/helper.mjs";',
      "",
      'describe("increment", () => {',
      '  it("adds one", () => {',
      "    expect(increment(1)).toBe(2);",
      '    expect(process.env["HOME"]).toBeDefined();',
      "  });",
      "});",
      "",
    ].join("\n")
  );
  return root;
}

/**
 * Compile a host-shaped fixture under a given `tsconfig.eslint.json`.
 * @param eslintProgram - The `tsconfig.eslint.json` body to compile.
 * @returns tsgo's exit status and output.
 */
function compileHost(eslintProgram: string): {
  readonly status: number | null;
  readonly output: string;
} {
  const result = boundedSpawnSync({
    args: [TSGO, "--noEmit", "--pretty", "false", "-p", ESLINT_PROGRAM],
    command: process.execPath,
    cwd: writeHost(eslintProgram),
    label: `tsgo -p ${ESLINT_PROGRAM}`,
  });
  return {
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
    status: result.status,
  };
}

describe("shipped tsconfig.eslint.json templates", () => {
  it("discovers every stack template", () => {
    expect(STACKS).toEqual([
      "cdk",
      "expo",
      "harper-fabric",
      "nestjs",
      "phaser",
      "typescript",
    ]);
  });

  it.each(STACKS)(
    "%s declares its test runner's globals, Node and JS interop",
    stack => {
      const options =
        readJson<Tsconfig>(path.join(stack, TEMPLATE)).compilerOptions ?? {};

      expect(options.types).toEqual([RUNNER_GLOBALS[runnerOf(stack)], "node"]);
      expect(options.allowJs).toBe(true);
      expect(options.checkJs).toBe(false);
    }
  );

  it.each(STACKS)(
    "%s only names types packages Lisa installs for the stack",
    stack => {
      const installed = installedPackages(stack);
      const types =
        readJson<Tsconfig>(path.join(stack, TEMPLATE)).compilerOptions?.types ??
        [];

      const missing = types
        .map(entry => TYPES_PACKAGE[entry] ?? `<unknown types entry ${entry}>`)
        .filter(pkg => !installed.has(pkg));
      expect(missing).toEqual([]);
    }
  );

  it.each(STACKS)(
    "%s compiles a host using test globals, process and a .mjs import",
    stack => {
      const { output, status } = compileHost(
        fs.readFileSync(path.join(REPO_ROOT, stack, TEMPLATE), "utf8")
      );

      expect(output).toBe("");
      expect(status).toBe(0);
    }
  );

  it("fails the same host without those settings", () => {
    // Control: strip the settings this suite pins from one template. If the
    // host still compiled, the assertion above would prove nothing about them.
    const shipped = readJson<Tsconfig & Record<string, unknown>>(
      path.join("typescript", TEMPLATE)
    );
    const { allowJs, checkJs, types, ...stripped } =
      shipped.compilerOptions ?? {};
    expect([allowJs, checkJs, types]).toEqual([
      true,
      false,
      ["vitest/globals", "node"],
    ]);

    const { output, status } = compileHost(
      JSON.stringify({
        ...shipped,
        compilerOptions: { ...stripped, types: [] },
      })
    );

    expect(status).not.toBe(0);
    expect(output).toContain("TS7016");
    expect(output).toMatch(/TS2582|TS2304|TS2593/);
  });
});

describe("shipped NestJS tsconfig.spec.json", () => {
  it("compiles a host's spec files under Vitest globals with zero errors", () => {
    // NestJS runs Vitest (nestjs/copy-overwrite/vitest.config.ts) and Lisa
    // deletes the old jest.config.ts, so spec files must see Vitest's globals.
    // The host's tsconfig.json is the shipped NestJS preset, copied beside it
    // because a fixture cannot resolve `@codyswann/lisa/tsconfig/nestjs`.
    const root = hostRoot("lisa-4927-nestjs-");
    fs.copyFileSync(
      path.join(REPO_ROOT, "tsconfig", "base.json"),
      path.join(root, "base.json")
    );
    fs.copyFileSync(
      path.join(REPO_ROOT, "tsconfig", "nestjs.json"),
      path.join(root, "nestjs.json")
    );
    fs.writeFileSync(
      path.join(root, "tsconfig.json"),
      JSON.stringify({ extends: "./nestjs.json" })
    );
    fs.copyFileSync(
      path.join(REPO_ROOT, "nestjs", COPY_OVERWRITE, SPEC_PROGRAM),
      path.join(root, SPEC_PROGRAM)
    );
    fs.mkdirSync(path.join(root, "src"));
    fs.writeFileSync(
      path.join(root, "src", "app.spec.ts"),
      [
        'describe("app", () => {',
        '  it("runs", () => {',
        "    const spy = vi.fn();",
        "    spy(process.pid);",
        "    expect(spy).toHaveBeenCalledOnce();",
        "  });",
        "});",
        "",
      ].join("\n")
    );

    const result = boundedSpawnSync({
      args: [TSGO, "--noEmit", "--pretty", "false", "-p", SPEC_PROGRAM],
      command: process.execPath,
      cwd: root,
      label: `tsgo -p ${SPEC_PROGRAM}`,
    });

    expect(`${result.stdout ?? ""}${result.stderr ?? ""}`).toBe("");
    expect(result.status).toBe(0);
  });
});

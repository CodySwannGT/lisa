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
 *   - each stack's template gives a host its test runner's globals and JS
 *     interop WITHOUT a `types` list. One here would override the `types` a
 *     host sets in its own tsconfig.json / tsconfig.local.json and drop every
 *     ambient-only package it names (`@types/google.maps`, say). Under
 *     TypeScript 6 `types` defaults to `[]`, so a host names what it needs (or
 *     `"*"`) there, and the template must inherit it. The runner's global
 *     declarations are added through `files` instead; and
 *   - a host-shaped fixture using test globals, `process`, a global declared
 *     by an ambient-only `@types/*` package, and a local `.mjs` import
 *     compiles with zero errors under each shipped template, whether the host
 *     names its types or opts into all of them — and does NOT without those
 *     settings, so the assertion is about them.
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
import { createSymlink } from "../../support/borrowed-node-modules.mjs";

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

/** The declaration file that puts Vitest's globals in a program. */
const VITEST_GLOBALS = "node_modules/vitest/globals.d.ts";

/**
 * Per test runner: the declaration file a template adds through `files`, the
 * package that ships it, and the packages a fixture host installs.
 */
const RUNNERS = {
  jest: {
    globals: "node_modules/@types/jest/index.d.ts",
    globalsFrom: "@types/jest",
    installs: ["@types/jest", "@types/node"],
  },
  vitest: {
    globals: VITEST_GLOBALS,
    globalsFrom: "vitest",
    installs: ["vitest", "@types/node"],
  },
} as const;

/**
 * The `types` a host's own tsconfig may set: naming each package it needs, or
 * TypeScript 6's opt-in to every installed `@types/*` (`types` defaults to
 * `[]` there, so a host that sets nothing loads none).
 */
const HOST_TYPES: readonly (readonly string[])[] = [
  ["node", "lisa-ambient-probe"],
  ["*"],
];

/** An ambient-only `@types/*` package a host might rely on, and its global. */
const AMBIENT_PACKAGE = "@types/lisa-ambient-probe";
const AMBIENT_GLOBAL = "lisaAmbientProbe";

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
  readonly files?: readonly string[];
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
function runnerOf(stack: string): keyof typeof RUNNERS {
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
 * A disposable host root with its own `node_modules`: the runner's packages
 * linked from Lisa's install, plus an ambient-only `@types/*` package that
 * declares one global. Curated rather than Lisa's whole `node_modules`, because
 * with no `types` list every `@types/*` there auto-loads, exactly as in a host.
 * @param prefix - Temp directory prefix.
 * @param runner - The test runner whose packages the host installs.
 * @returns The realpath'd root.
 */
function hostRoot(prefix: string, runner: keyof typeof RUNNERS): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), prefix)));
  const ambient = path.join(root, "node_modules", AMBIENT_PACKAGE);
  fixtures.push(root);
  fs.mkdirSync(ambient, { recursive: true });
  for (const pkg of RUNNERS[runner].installs) {
    createSymlink(
      path.join(REPO_ROOT, "node_modules", pkg),
      path.join(root, "node_modules", pkg)
    );
  }
  fs.writeFileSync(
    path.join(ambient, "package.json"),
    JSON.stringify({ name: AMBIENT_PACKAGE, types: "index.d.ts" })
  );
  fs.writeFileSync(
    path.join(ambient, "index.d.ts"),
    `declare const ${AMBIENT_GLOBAL}: string;\n`
  );
  return root;
}

/**
 * Write a host-shaped fixture around a given `tsconfig.eslint.json`.
 *
 * The host's own `tsconfig.json` is minimal on purpose: it sets only the
 * `types` the host chose, so the program's test globals and JS interop must
 * come from the shipped template.
 * @param eslintProgram - The `tsconfig.eslint.json` body to install.
 * @param runner - The host's test runner.
 * @param hostTypes - The `types` the host's own tsconfig sets.
 * @returns The fixture root.
 */
function writeHost(
  eslintProgram: string,
  runner: keyof typeof RUNNERS,
  hostTypes: readonly string[]
): string {
  const root = hostRoot("lisa-4927-", runner);
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
        types: hostTypes,
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
      `    expect(${AMBIENT_GLOBAL}.length).toBeGreaterThan(0);`,
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
 * @param runner - The host's test runner.
 * @param hostTypes - The `types` the host's own tsconfig sets.
 * @returns tsgo's exit status and output.
 */
function compileHost(
  eslintProgram: string,
  runner: keyof typeof RUNNERS,
  hostTypes: readonly string[]
): {
  readonly status: number | null;
  readonly output: string;
} {
  const result = boundedSpawnSync({
    args: [TSGO, "--noEmit", "--pretty", "false", "-p", ESLINT_PROGRAM],
    command: process.execPath,
    cwd: writeHost(eslintProgram, runner, hostTypes),
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
    "%s gives its test runner's globals and JS interop without a types list",
    stack => {
      const program = readJson<Tsconfig>(path.join(stack, TEMPLATE));
      const options = program.compilerOptions ?? {};

      expect(options.types).toBeUndefined();
      expect(options.allowJs).toBe(true);
      expect(options.checkJs).toBe(false);
      expect(program.files).toEqual([RUNNERS[runnerOf(stack)].globals]);
    }
  );

  it.each(STACKS)(
    "%s gets its runner's globals from a package Lisa installs",
    stack => {
      expect(installedPackages(stack)).toContain(
        RUNNERS[runnerOf(stack)].globalsFrom
      );
    }
  );

  it.each(
    STACKS.flatMap(stack =>
      HOST_TYPES.map(hostTypes => [stack, hostTypes] as const)
    )
  )(
    "%s compiles a host (types %j) using test globals, process, an ambient @types global and a .mjs import",
    (stack, hostTypes) => {
      const { output, status } = compileHost(
        fs.readFileSync(path.join(REPO_ROOT, stack, TEMPLATE), "utf8"),
        runnerOf(stack),
        hostTypes
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
    const { allowJs, checkJs, ...stripped } = shipped.compilerOptions ?? {};
    expect([allowJs, checkJs, shipped.files]).toEqual([
      true,
      false,
      [VITEST_GLOBALS],
    ]);

    const { output, status } = compileHost(
      JSON.stringify({ ...shipped, compilerOptions: stripped, files: [] }),
      "vitest",
      ["*"]
    );

    expect(status).not.toBe(0);
    expect(output).toContain("TS7016");
    expect(output).toMatch(/TS2582|TS2304|TS2593/);
  });
});

describe("shipped NestJS tsconfig.spec.json", () => {
  it("passes no types list and compiles a host's spec files with zero errors", () => {
    expect(
      readJson<Tsconfig>(path.join("nestjs", COPY_OVERWRITE, SPEC_PROGRAM))
        .compilerOptions?.types
    ).toBeUndefined();

    // NestJS runs Vitest (nestjs/copy-overwrite/vitest.config.ts) and Lisa
    // deletes the old jest.config.ts, so spec files must see Vitest's globals.
    // The host's tsconfig.json is the shipped NestJS preset, copied beside it
    // because a fixture cannot resolve `@codyswann/lisa/tsconfig/nestjs`.
    const root = hostRoot("lisa-4927-nestjs-", "vitest");
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
      JSON.stringify({
        compilerOptions: { types: ["node", "lisa-ambient-probe"] },
        extends: "./nestjs.json",
      })
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
        `    expect(${AMBIENT_GLOBAL}).toBeTypeOf("string");`,
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

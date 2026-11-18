/**
 * Every TypeScript file Lisa ships into a host's root passes the ESLint
 * profile Lisa ships for that host, linted where it lands (CodySwannGT/lisa#4927).
 *
 * Lisa's own lint ignores the stack template trees (`eslint.ignore.config.local.json`):
 * their files import siblings that exist only in a host — `./eslint.config.local`,
 * `./vitest.thresholds.json` — so they have no resolvable types in Lisa's tree.
 * That moved their lint coverage here rather than dropping it. For each stack this
 * suite assembles the files a fresh apply leaves in a host — the TypeScript stack's
 * `copy-overwrite` and `create-only` trees, then the stack's own on top, minus
 * every path the stack's lineage deletes — type-checks them, then lints all
 * of them with the stack's shipped profile. The type-check is what catches a
 * shipped file importing a sibling no host has, which a lint passes.
 *
 * `eslint-shipped-config-templates.test.ts` holds the narrower, older contract
 * for `eslint.config.ts` alone and its negative control.
 *
 * Not covered, and why: `all/**` ships only `.d.mts` declarations, which no
 * shipped profile lints; `src/opencode/plugin-templates/**` is copied into
 * `.opencode/plugin/` and runs under OpenCode's Bun runtime, which the shipped
 * profiles do not target; `plugins/**` is generated from `plugins/src`.
 *
 * The stack set and the file set are DISCOVERED, so a new shipped `.ts` file is
 * linted with nobody remembering to add it.
 * @module tests/unit/config/eslint-shipped-host-files
 */
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import process from "node:process";

import { ESLint, type Linter } from "eslint";
import { afterEach, describe, expect, it } from "vitest";

import { getCdkConfig } from "../../../src/configs/eslint/cdk.js";
import { getExpoConfig } from "../../../src/configs/eslint/expo.js";
import { getHarperFabricConfig } from "../../../src/configs/eslint/harper-fabric.js";
import { getNestjsConfig } from "../../../src/configs/eslint/nestjs.js";
import { getPhaserConfig } from "../../../src/configs/eslint/phaser.js";
import { getTypescriptConfig } from "../../../src/configs/eslint/typescript.js";
import { PROJECT_TYPE_HIERARCHY } from "../../../src/core/config.js";
import { borrowNodeModules } from "../../helpers/borrowed-node-modules.js";
import {
  boundedSpawnSync,
  ioLatencyBudgetMs,
} from "../../helpers/io-latency-budget.js";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/** Linting a whole host's shipped files type-aware is a subprocess-scale cost. */
const LINT_TIMEOUT_MS = ioLatencyBudgetMs(300_000);

/** The TypeScript native compiler, which type-checks each fixture host. */
const TSGO = path.join(
  REPO_ROOT,
  "node_modules",
  "@typescript",
  "native-preview",
  "bin",
  "tsgo"
);

/** The program ESLint's type-aware rules read types from, in each host. */
const ESLINT_PROGRAM = "tsconfig.eslint.json";

/** ESLint's numeric `error` severity. */
const ERROR_SEVERITY = 2;

/** Template lanes that put files in a host, in the order an apply layers them. */
const LANES = ["create-only", "copy-overwrite"] as const;

/** JSON siblings the shipped TypeScript files import, with an empty fallback. */
const JSON_SIBLINGS: Readonly<Record<string, string>> = {
  "eslint.ignore.config.json": JSON.stringify({ ignores: [] }),
  "eslint.thresholds.json": "{}",
  "jest.thresholds.json": "{}",
  "vitest.thresholds.json": "{}",
};

/**
 * Packages an Expo host installs that Lisa's own `node_modules` does not hold.
 * Declared, not mocked: only their type surface matters to a lint, and these
 * are the shapes the shipped `jest.setup.ts` uses.
 */
const EXPO_HOST_DECLARATIONS = [
  'declare module "@testing-library/react-native/pure" {',
  "  export function cleanup(): Promise<void>;",
  "}",
  'declare module "@testing-library/react-native/build/matchers/extend-expect" {}',
  "declare namespace React {",
  "  type ReactNode = unknown;",
  "}",
  "",
].join("\n");

/** Options every shipped factory accepts. */
type FactoryOptions = {
  readonly tsconfigRootDir: string;
  readonly ignorePatterns: string[];
};

/** A shipped ESLint factory, as this suite calls it. */
type Factory = (options: FactoryOptions) => Linter.Config[];

const FACTORIES: Readonly<Record<string, Factory>> = {
  cdk: getCdkConfig,
  expo: getExpoConfig,
  "harper-fabric": getHarperFabricConfig,
  nestjs: getNestjsConfig,
  phaser: getPhaserConfig,
  typescript: getTypescriptConfig,
};

const STACKS = Object.keys(FACTORIES).sort((a, b) => a.localeCompare(b));

const fixtures: string[] = [];

afterEach(() => {
  for (const fixture of fixtures.splice(0))
    fs.rmSync(fixture, { force: true, recursive: true });
});

/**
 * A stack and its parents, root-most first — the order an apply layers them.
 * @param stack - Stack directory.
 * @returns Lineage from the root stack down to `stack`.
 */
function lineage(stack: string): readonly string[] {
  const parent = PROJECT_TYPE_HIERARCHY[stack];
  return parent === undefined ? [stack] : [...lineage(parent), stack];
}

/**
 * Paths a stack's lineage deletes from a host.
 * @param stack - Stack directory.
 * @returns Every `deletions.json` path in the lineage.
 */
function deletedPaths(stack: string): ReadonlySet<string> {
  return new Set(
    lineage(stack).flatMap(type => {
      const file = path.join(REPO_ROOT, type, "deletions.json");
      return fs.existsSync(file)
        ? (JSON.parse(fs.readFileSync(file, "utf8")) as { paths: string[] })
            .paths
        : [];
    })
  );
}

/**
 * The root-level files a fresh apply of `stack` leaves, mapped to their source.
 * @param stack - Stack directory.
 * @param keep - Which file names to collect.
 * @returns Destination name → absolute template source.
 */
function shippedRootFiles(
  stack: string,
  keep: (name: string) => boolean
): ReadonlyMap<string, string> {
  const deleted = deletedPaths(stack);
  const layered = lineage(stack).flatMap(type =>
    LANES.flatMap(lane => {
      const dir = path.join(REPO_ROOT, type, lane);
      return fs.existsSync(dir)
        ? fs
            .readdirSync(dir, { withFileTypes: true })
            .filter(entry => entry.isFile() && keep(entry.name))
            .map(entry => [entry.name, path.join(dir, entry.name)] as const)
        : [];
    })
  );
  // Later layers win, exactly as a later template overwrites an earlier one.
  return new Map(layered.filter(([name]) => !deleted.has(name)));
}

/**
 * Write a host holding every shipped TypeScript file for `stack`.
 * @param stack - Stack directory.
 * @returns The fixture root and the TypeScript files in it.
 */
function createHost(stack: string): {
  readonly root: string;
  readonly files: readonly string[];
} {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(tmpdir(), `lisa-hostfiles-${stack}-`))
  );
  const shipped = shippedRootFiles(stack, name => /\.tsx?$/u.test(name));
  const siblings = shippedRootFiles(stack, name => name in JSON_SIBLINGS);
  fixtures.push(root);
  borrowNodeModules(path.join(REPO_ROOT, "node_modules"), root);
  for (const [name, source] of shipped)
    fs.copyFileSync(source, path.join(root, name));
  for (const [name, fallback] of Object.entries(JSON_SIBLINGS)) {
    const source = siblings.get(name);
    if (source === undefined) fs.writeFileSync(path.join(root, name), fallback);
    else fs.copyFileSync(source, path.join(root, name));
  }
  fs.writeFileSync(path.join(root, "host.d.ts"), EXPO_HOST_DECLARATIONS);
  fs.writeFileSync(
    path.join(root, ESLINT_PROGRAM),
    JSON.stringify({
      compilerOptions: {
        allowImportingTsExtensions: true,
        module: "preserve",
        moduleResolution: "bundler",
        noEmit: true,
        resolveJsonModule: true,
        skipLibCheck: true,
        strict: true,
        target: "ES2022",
        types: ["node", ...(stack === "expo" ? ["jest"] : [])],
        paths: Object.fromEntries(
          ["eslint", "jest", "vitest"].map(kind => [
            `@codyswann/lisa/${kind}/*`,
            [path.join(REPO_ROOT, "src", "configs", kind, "*.ts")],
          ])
        ),
      },
      include: [...shipped.keys(), "host.d.ts"],
    })
  );
  return { files: [...shipped.keys()], root };
}

/**
 * Numeric severity of one entry in a calculated `rules` map.
 * @param entry - One value from a calculated config's `rules` map.
 * @returns 0, 1, or 2.
 */
function severityOf(entry: unknown): number {
  const severity = Array.isArray(entry) ? entry[0] : entry;
  if (severity === 2 || severity === "error") return ERROR_SEVERITY;
  return severity === 1 || severity === "warn" ? 1 : 0;
}

/**
 * Error-level findings the shipped profile reports across a host's files.
 *
 * Rules below `error` for EVERY file are switched off first — a cost change,
 * never a coverage change, for the reason the sibling suite records
 * (CodySwannGT/lisa#4263).
 * @param stack - Stack whose profile to build.
 * @param root - Fixture root.
 * @param files - Files to lint, relative to the root.
 * @returns One `file line:col rule — message` line per error.
 */
async function errorsInHost(
  stack: string,
  root: string,
  files: readonly string[]
): Promise<readonly string[]> {
  const factory = FACTORIES[stack];
  if (factory === undefined) throw new Error(`No factory for ${stack}.`);
  const shipped = factory({ ignorePatterns: [], tsconfigRootDir: root });
  const probe = new ESLint({
    cwd: root,
    overrideConfig: shipped,
    overrideConfigFile: true,
  });
  const resolved = await Promise.all(
    files.map(file => probe.calculateConfigForFile(path.join(root, file)))
  );
  const atError = new Set(
    resolved.flatMap(config =>
      Object.entries((config as { rules?: object }).rules ?? {})
        .filter(([, entry]) => severityOf(entry) === ERROR_SEVERITY)
        .map(([rule]) => rule)
    )
  );
  // VACUITY GUARD: a profile with nothing at error would pass every host.
  if (atError.size === 0)
    throw new Error(`The ${stack} profile resolved no error-level rule.`);
  const allRules = resolved.flatMap(config =>
    Object.keys((config as { rules?: object }).rules ?? {})
  );
  const quiet = allRules.filter(rule => !atError.has(rule));
  const results = await new ESLint({
    cwd: root,
    overrideConfig: [
      ...shipped,
      { rules: Object.fromEntries(quiet.map(rule => [rule, "off"])) },
    ],
    overrideConfigFile: true,
  }).lintFiles(files.map(file => path.join(root, file)));
  return results.flatMap(result =>
    result.messages
      .filter(message => message.severity === ERROR_SEVERITY)
      .map(
        message =>
          `${path.relative(root, result.filePath)} ${message.line}:${message.column} ${message.ruleId} — ${message.message}`
      )
  );
}

describe("every TypeScript file Lisa ships into a host passes that host's profile", () => {
  it("covers every stack that ships a tsconfig.eslint.json", () => {
    const shipping = fs
      .readdirSync(REPO_ROOT)
      .filter(name =>
        fs.existsSync(
          path.join(REPO_ROOT, name, "copy-overwrite", ESLINT_PROGRAM)
        )
      )
      .sort((a, b) => a.localeCompare(b));
    expect(STACKS).toEqual(shipping);
  });

  it.each(STACKS)(
    "%s",
    async stack => {
      const { files, root } = createHost(stack);
      expect(files).toContain("eslint.config.ts");

      // Types first: a lint over unresolvable imports proves little, and an
      // import of a file no host has (a shim reaching for a deleted sibling)
      // passes lint and fails only here.
      const compiled = boundedSpawnSync({
        args: [TSGO, "--noEmit", "--pretty", "false", "-p", ESLINT_PROGRAM],
        command: process.execPath,
        cwd: root,
        label: `tsgo ${stack} host`,
      });
      expect(`${compiled.stdout ?? ""}${compiled.stderr ?? ""}`).toBe("");
      expect(await errorsInHost(stack, root, files)).toEqual([]);
    },
    LINT_TIMEOUT_MS
  );

  it(
    "still reports an error in a shipped file other than eslint.config.ts",
    async () => {
      // Negative control: if the profile stopped linting these files, every
      // case above would pass for the wrong reason. (A file the fixture's
      // tsconfig.eslint.json failed to include would surface above as a
      // fatal "not found in any of the provided project(s)" error.)
      const { files, root } = createHost("phaser");
      fs.appendFileSync(
        path.join(root, "vitest.config.ts"),
        "\nexport const loose: any = 1;\n"
      );

      expect((await errorsInHost("phaser", root, files)).join("\n")).toMatch(
        /^vitest\.config\.ts \S+ @typescript-eslint\/no-explicit-any/mu
      );
    },
    LINT_TIMEOUT_MS
  );
});

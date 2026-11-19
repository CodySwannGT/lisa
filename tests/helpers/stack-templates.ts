/**
 * Stack templates, their lineage, and the packages the files they ship into a
 * host name (CodySwannGT/lisa#4932).
 *
 * A file Lisa ships into a host runs from the HOST's dependency tree. Under an
 * isolated layout (pnpm) a package resolves only when the host declares it, so
 * a package Lisa itself depends on is not reachable from a host file. What a
 * shipped file may name is therefore what the stack's templates supply.
 * @module tests/helpers/stack-templates
 */
import * as fs from "node:fs";
import { builtinModules } from "node:module";
import * as path from "node:path";

import { PROJECT_TYPE_HIERARCHY } from "../../src/core/config.js";

export const REPO_ROOT = path.resolve(__dirname, "..", "..");

/** The sections of a stack template the suites read. */
export interface Template {
  readonly force?: Readonly<
    Record<string, Readonly<Record<string, string>> | undefined>
  >;
  readonly defaults?: Readonly<
    Record<string, Readonly<Record<string, string>> | undefined>
  >;
  readonly adopt?: Readonly<
    Record<string, Readonly<Record<string, string>> | undefined>
  >;
  readonly minimums?: Readonly<Record<string, string>>;
}

/** Template lanes whose files land in a host. */
const LANES = ["create-only", "copy-overwrite"] as const;

/** Source files a host runs or compiles. */
const SOURCE_FILE = /\.[cm]?[jt]sx?$/u;

/** Module specifiers in `import … from`, bare `import`, `import()` and `require()`. */
const SPECIFIER =
  /(?:\bfrom\s+|\bimport\s+|\bimport\(\s*|\brequire\(\s*)["']([^"'\s]+)["']/gu;

/** The Jest docblock that names the package Jest loads a TypeScript config with. */
const JEST_CONFIG_LOADER = /@jest-config-loader\s+(\S+)/gu;

/** Directory whose scripts run under the k6 binary, not Node. */
const K6_DIRECTORY = `${path.sep}k6${path.sep}`;

/**
 * Every stack template in the repository.
 * @returns Stack name and parsed template
 */
function templates(): readonly (readonly [string, Template])[] {
  return fs
    .readdirSync(REPO_ROOT, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry): readonly [string, string] => [
      entry.name,
      path.join(REPO_ROOT, entry.name, "package-lisa", "package.lisa.json"),
    ])
    .filter(([, file]) => fs.existsSync(file))
    .map(([stack, file]): readonly [string, Template] => [
      stack,
      JSON.parse(fs.readFileSync(file, "utf8")) as Template,
    ]);
}

export const TEMPLATES = new Map(templates());

/**
 * A stack and its parents, nearest first.
 * @param stack - Stack directory
 * @returns The lineage
 */
export function lineage(stack: string): readonly string[] {
  const parent = PROJECT_TYPE_HIERARCHY[stack];
  return parent === undefined ? [stack] : [stack, ...lineage(parent)];
}

/**
 * The package a module specifier loads.
 * @param specifier - Import or require specifier
 * @returns Package name, or undefined for a relative, absolute, `node:`, URL
 *   or `@/` alias path
 */
function packageOf(specifier: string): string | undefined {
  if (/^(?:\.|\/|node:|@\/|[a-z]+:\/\/|https?:)/u.test(specifier))
    return undefined;
  const parts = specifier.split("/");
  const name = specifier.startsWith("@")
    ? parts.slice(0, 2).join("/")
    : parts[0];
  return name;
}

/**
 * Source text with block and line comments removed, so a word in prose such as
 * `from "malformed"` is not read as an import.
 * @param text - File contents
 * @returns The text without comments
 */
function withoutComments(text: string): string {
  return text
    .split("\n")
    .filter(line => !/^\s*(?:\/\/|\*|\/\*)/u.test(line))
    .join("\n");
}

/**
 * Every package a source text imports or requires.
 * @param text - File contents
 * @returns Package names
 */
export function importedPackages(text: string): readonly string[] {
  return [...withoutComments(text).matchAll(SPECIFIER)].flatMap(match => {
    const name = packageOf(match[1] ?? "");
    return name === undefined ? [] : [name];
  });
}

/**
 * Every package a shipped file needs from the host: its imports, and the
 * loader its Jest docblock names. A Node builtin named bare (`fs`) is Node's,
 * and a k6 script's `k6/*` modules belong to the k6 runtime.
 * @param file - Absolute path of the shipped file
 * @returns Package names
 */
export function namedPackages(file: string): readonly string[] {
  const text = fs.readFileSync(file, "utf8");
  const loaders = [...text.matchAll(JEST_CONFIG_LOADER)].flatMap(match =>
    match[1] === undefined ? [] : [match[1]]
  );
  return [...importedPackages(text), ...loaders].filter(
    name =>
      !builtinModules.includes(name) &&
      !(file.includes(K6_DIRECTORY) && name === "k6")
  );
}

/**
 * Every source file a stack's lineage ships into a host.
 * @param stack - Stack directory
 * @returns Absolute paths
 */
export function shippedSources(stack: string): readonly string[] {
  return lineage(stack).flatMap(layer =>
    LANES.flatMap(lane => {
      const root = path.join(REPO_ROOT, layer, lane);
      return fs.existsSync(root)
        ? fs
            .readdirSync(root, { recursive: true, encoding: "utf8" })
            .filter(file => SOURCE_FILE.test(file) && !file.endsWith(".d.ts"))
            .map(file => path.join(root, file))
        : [];
    })
  );
}

/**
 * Only Expo's lint:slow loads the React plugins (CodySwannGT/lisa#4507).
 *
 * `@codyswann/lisa/eslint/slow` is what every stack's lint:slow imports. When
 * it also defined the Expo factory, importing it loaded
 * eslint-plugin-react-hooks and eslint-plugin-react-compiler for typescript,
 * nestjs and cdk projects too. In a consumer installed with bun's isolated
 * linker (bun 1.3.11), react-hooks 7.1.1 is given zod-validation-error 3.5.4,
 * which both plugins' ranges accept, but react-hooks imports
 * `zod-validation-error/v4`, which 3.x does not export. Every stack's
 * lint:slow then crashed with ERR_PACKAGE_PATH_NOT_EXPORTED before linting a
 * file. The Expo factory now lives in its own published module, and the Expo
 * template forces zod-validation-error 4 for the one stack that loads it.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const REACT_PLUGINS = /eslint-plugin-react-(?:compiler|hooks)/;

/**
 * Read a repository file.
 * @param file - Path relative to the repository root
 * @returns Its contents
 */
function read(file: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, file), "utf8");
}

/**
 * Every module specifier a TypeScript source imports, statically or dynamically.
 * @param source - File contents
 * @returns The specifiers
 */
function importSpecifiers(source: string): string[] {
  return [
    ...source.matchAll(
      /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)["']([^"']+)["']/g
    ),
  ].map(([, specifier = ""]) => specifier);
}

/**
 * The relative modules a source file imports, resolved to repository paths.
 * @param file - Repository-relative .ts path
 * @returns Repository-relative .ts paths
 */
function localImports(file: string): string[] {
  return importSpecifiers(read(file))
    .filter(specifier => specifier.startsWith("."))
    .map(specifier =>
      path
        .join(path.dirname(file), specifier)
        .replace(/\.js$/, ".ts")
        .split(path.sep)
        .join("/")
    );
}

/**
 * Every package a module and its local imports load, transitively.
 * @param entry - Repository-relative .ts path
 * @returns Bare package specifiers
 */
function packagesLoadedBy(entry: string): string[] {
  const seen = new Set<string>();
  const visit = (file: string): string[] => {
    if (seen.has(file)) return [];
    const bare = importSpecifiers(read(file)).filter(s => !s.startsWith("."));
    seen.add(file);
    return [...bare, ...localImports(file).flatMap(visit)];
  };
  return visit(entry);
}

describe("the shared slow config loads no React plugin", () => {
  it("src/configs/eslint/slow.ts and everything it imports stay React-free", () => {
    const loaded = packagesLoadedBy("src/configs/eslint/slow.ts");
    expect(loaded.length).toBeGreaterThan(0);
    expect(loaded.filter(specifier => REACT_PLUGINS.test(specifier))).toEqual(
      []
    );
  });

  it("the Expo factory, and only it, loads both React plugins", () => {
    const loaded = packagesLoadedBy("src/configs/eslint/slow-expo.ts");
    expect(loaded).toEqual(
      expect.arrayContaining([
        "eslint-plugin-react-compiler",
        "eslint-plugin-react-hooks",
      ])
    );
  });
});

describe("the Expo factory is published on its own", () => {
  it("is exported as @codyswann/lisa/eslint/slow-expo", () => {
    const exportsMap = (
      JSON.parse(read("package.json")) as { exports: Record<string, string> }
    ).exports;
    expect(exportsMap["./eslint/slow-expo"]).toBe(
      "./dist/configs/eslint/slow-expo.js"
    );
  });

  it("is what the managed Expo eslint.slow.config.ts imports", () => {
    const template = read("expo/copy-overwrite/eslint.slow.config.ts");
    expect(template).toContain(
      'import { getExpoSlowConfig } from "@codyswann/lisa/eslint/slow-expo";'
    );
    expect(template).not.toContain('"@codyswann/lisa/eslint/slow"');
  });

  it.each(["overrides", "resolutions"] as const)(
    "has the Expo template force zod-validation-error 4 in %s",
    section => {
      const template = JSON.parse(
        read("expo/package-lisa/package.lisa.json")
      ) as { force: Record<string, Record<string, string>> };
      expect(template.force[section]?.["zod-validation-error"]).toBe("^4.0.0");
    }
  );
});

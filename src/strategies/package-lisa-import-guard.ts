/**
 * Keep a retired dependency the project's own code still imports
 * (CodySwannGT/lisa#4507).
 *
 * A `remove` entry deletes a key Lisa once wrote. For most entries that is
 * the whole story, but a few name packages a project may also use for its own
 * purposes, and deleting one of those breaks the project's own config. Each
 * package listed here is removed only when no project-owned file imports or
 * requires it. When one does, the dependency stays and the operator is told
 * why it matters and what to do.
 *
 * Lisa-managed copies do not count: they carry the managed-file header and are
 * replaced by the same apply, so the import in an outdated copy is Lisa's own.
 * @module strategies/package-lisa-import-guard
 */
import * as fs from "node:fs";
import * as path from "node:path";

/** Packages guarded this way, and the note an operator gets when one stays. */
export const IMPORT_GUARDED_REMOVALS: Readonly<Record<string, string>> = {
  "eslint-plugin-react-compiler":
    "kept eslint-plugin-react-compiler because a project file imports it. Its newest release requires zod 3, which GHSA-mrhx-c7xc-m3w5 (high) affects. Lisa's Expo config no longer needs it: a built-in shim keeps react-compiler/react-compiler resolving. Remove the project's own import, then the dependency, to clear the advisory",
};

/** File extensions an import or require can live in. */
const SOURCE_EXTENSIONS = new Set([
  ".cjs",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
]);

/** Directories that hold installed, generated or native code, never the project's own. */
const SKIPPED_DIRECTORIES = new Set([
  ".cache",
  ".expo",
  ".git",
  ".next",
  ".turbo",
  "android",
  "build",
  "coverage",
  "dist",
  "ios",
  "node_modules",
]);

/** The header every Lisa-managed copy starts with. */
const MANAGED_MARKER = "This file is managed by Lisa";

/** How far into a file the managed header may appear. */
const HEADER_WINDOW = 600;

/**
 * Whether source text imports or requires the package, or a subpath of it.
 * @param text - File contents
 * @param name - Package name
 * @returns True when the package is imported
 */
export function importsPackage(text: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `(?:\\bfrom\\s*|\\bimport\\s*\\(\\s*|\\brequire\\s*\\(\\s*|\\bimport\\s+)(["'])${escaped}(?:/[^"']*)?\\1`
  ).test(text);
}

/**
 * Every project-owned source file under a directory, without following links.
 * @param root - Project directory
 * @returns Absolute paths
 */
function projectSourceFiles(root: string): readonly string[] {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(root, entry.name);
    if (entry.isDirectory())
      return SKIPPED_DIRECTORIES.has(entry.name)
        ? []
        : projectSourceFiles(full);
    return entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))
      ? [full]
      : [];
  });
}

/**
 * The first project-owned file that imports a package.
 * @param projectDir - Project directory
 * @param name - Package name
 * @returns Its path relative to the project, or undefined when none does
 */
export function firstProjectImport(
  projectDir: string,
  name: string
): string | undefined {
  const importer = projectSourceFiles(projectDir).find(file => {
    const text = fs.readFileSync(file, "utf8");
    return (
      !text.slice(0, HEADER_WINDOW).includes(MANAGED_MARKER) &&
      importsPackage(text, name)
    );
  });
  return importer === undefined
    ? undefined
    : path.relative(projectDir, importer);
}

/**
 * Drop guarded packages from the remove lists when the project imports them.
 * @param projectDir - Project directory
 * @param removeSections - Template remove lists, by package.json section
 * @param projectJson - The project's package.json before the apply
 * @returns The remove lists to apply, and a note for each package kept
 */
export function retainImportedRemovals(
  projectDir: string,
  removeSections: Readonly<Record<string, string[]>>,
  projectJson: Readonly<Record<string, unknown>>
): { remove: Record<string, string[]>; notes: string[] } {
  const kept = Object.entries(removeSections).flatMap(([section, keys]) => {
    const present = (projectJson[section] ?? {}) as Record<string, unknown>;
    return keys.flatMap(key => {
      const note = IMPORT_GUARDED_REMOVALS[key];
      if (note === undefined || !(key in present)) return [];
      const importer = firstProjectImport(projectDir, key);
      return importer === undefined ? [] : [{ section, key, note, importer }];
    });
  });
  const remove = Object.fromEntries(
    Object.entries(removeSections).map(([section, keys]) => [
      section,
      keys.filter(
        key =>
          !kept.some(entry => entry.section === section && entry.key === key)
      ),
    ])
  );
  const notes = kept.map(
    ({ section, note, importer }) =>
      `${section}: ${note} (imported by ${importer})`
  );
  return { remove, notes };
}

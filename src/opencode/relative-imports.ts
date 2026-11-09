/**
 * Static relative-import discovery for JavaScript modules Lisa emits.
 *
 * Skill scripts are copied verbatim into a host's `.opencode/` tree, so a
 * relative specifier that resolves inside a Lisa plugin can point at nothing
 * once the file moves (CodySwannGT/lisa#4642: `../../../scripts/<m>.mjs` lands
 * on `.opencode/skills/scripts/`). Both the shared-script emitter and the
 * self-containment guard need the same answer to "which relative files does
 * this module load?", so the parse lives here once.
 *
 * The parse is a deliberate regex over `from "…"`, `import "…"`,
 * `import("…")`, and `require("…")` with a string-literal relative specifier
 * (`./` or `../`), after comments that open a line are removed.
 * Bare specifiers (`node:fs`, packages) are not files Lisa ships and are
 * ignored. Template-literal or computed dynamic imports cannot be resolved
 * statically and are out of reach by construction.
 * @module opencode/relative-imports
 */
import * as fse from "fs-extra";
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { listFilesRecursive } from "../core/lisa-skill-sources.js";

/** File extensions treated as executable JavaScript modules. */
const SCRIPT_MODULE_EXTENSIONS: readonly string[] = [".mjs", ".js", ".cjs"];

/**
 * Matches a relative string-literal specifier after `from`, `import`, or
 * `import(`. Group 2 is the specifier. A dynamic import is matched only in its
 * formatted shape, `import("…")` with no space before the quote, which keeps
 * the pattern free of adjacent optional whitespace runs (linear-time).
 */
const RELATIVE_SPECIFIER_PATTERN =
  /\b(?:from|import\(?|require\()\s*(["'])(\.\.?\/[^"'\n]*)\1/g;

/**
 * Block comments that open a line (after indentation). Anchoring at line start
 * is the conservative choice: a `/*` inside a string such as the glob
 * `"src/**\/*.ts"` never opens a line, so it cannot swallow real imports.
 */
const LINE_OPENING_BLOCK_COMMENT = /^[ \t]*\/\*[\s\S]*?\*\//gm;

/** Line comments that open a line; `"https://…"` inside code is untouched. */
const LINE_OPENING_LINE_COMMENT = /^[ \t]*\/\/.*$/gm;

/**
 * Remove comments that open a line, so commented-out or documented imports
 * are not followed. Trailing comments after code are left in place; the
 * import pattern only matches a quoted specifier after a keyword anyway.
 * @param source - JavaScript module source.
 * @returns Source with line-opening comments blanked.
 */
export function stripLineOpeningComments(source: string): string {
  return source
    .replace(LINE_OPENING_BLOCK_COMMENT, "")
    .replace(LINE_OPENING_LINE_COMMENT, "");
}

/** One relative import whose target does not exist inside the checked tree. */
export interface UnresolvedImport {
  /** Importing file, relative to the checked root. */
  readonly importer: string;
  /** The specifier exactly as written in the importer. */
  readonly specifier: string;
  /** Resolved target, relative to the checked root (may start with `..`). */
  readonly target: string;
}

/**
 * Predicate: is `file` a JavaScript module whose imports should be followed?
 * @param file - Any file path.
 * @returns True for `.mjs`, `.js`, and `.cjs` files.
 */
export function isScriptModule(file: string): boolean {
  return SCRIPT_MODULE_EXTENSIONS.includes(path.extname(file));
}

/**
 * Extract every static relative specifier from module source text.
 * @param source - JavaScript module source.
 * @returns Unique relative specifiers in first-seen order.
 */
export function extractRelativeSpecifiers(source: string): readonly string[] {
  const specifiers = Array.from(
    stripLineOpeningComments(source).matchAll(RELATIVE_SPECIFIER_PATTERN),
    match => match[2]
  ).filter((specifier): specifier is string => Boolean(specifier));
  return Object.freeze(Array.from(new Set(specifiers)));
}

/**
 * Read a module and resolve each relative specifier against its directory.
 * @param absFile - Absolute path to the module.
 * @returns Pairs of specifier and absolute resolved target.
 */
export async function resolveRelativeImports(
  absFile: string
): Promise<readonly { specifier: string; target: string }[]> {
  const source = await readFile(absFile, "utf8");
  return extractRelativeSpecifiers(source).map(specifier => ({
    specifier,
    target: path.resolve(path.dirname(absFile), specifier),
  }));
}

/**
 * Predicate: is `candidate` the directory `root` or somewhere beneath it?
 * @param root - Absolute directory.
 * @param candidate - Absolute path to test.
 * @returns True when `candidate` does not escape `root`.
 */
export function isWithin(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Find every relative import, in every script module under `rootDir`, whose
 * target is missing or lies outside `rootDir`.
 * @param rootDir - Absolute root of the emitted tree to check.
 * @returns Unresolved imports, empty when the tree is self-contained.
 */
export async function findUnresolvedImports(
  rootDir: string
): Promise<readonly UnresolvedImport[]> {
  const files = (await listFilesRecursive(rootDir)).filter(isScriptModule);
  const perFile = await Promise.all(
    files.map(async importer => {
      const imports = await resolveRelativeImports(
        path.join(rootDir, importer)
      );
      const checked = await Promise.all(
        imports.map(async ({ specifier, target }) => {
          const resolves =
            isWithin(rootDir, target) && (await fse.pathExists(target));
          return resolves
            ? undefined
            : { importer, specifier, target: path.relative(rootDir, target) };
        })
      );
      return checked.filter(
        (entry): entry is UnresolvedImport => entry !== undefined
      );
    })
  );
  return Object.freeze(perFile.flat());
}

/**
 * Render one unresolved import as a single diagnostic line naming both ends.
 * @param unresolved - The unresolved import.
 * @returns `<importer> imports "<specifier>" but <target> is not in the tree`.
 */
export function formatUnresolvedImport(unresolved: UnresolvedImport): string {
  return `${unresolved.importer} imports "${unresolved.specifier}" but ${unresolved.target} is not in the tree`;
}

/**
 * Pure parsing and classification helpers for the shipped-surface removal gate
 * (`scripts/check-shipped-surface-removals.mjs`, CodySwannGT/lisa#3849).
 *
 * Everything here is a total function over strings and plain objects: no git,
 * no filesystem, no clock. The gate keeps its I/O in one file so these can be
 * mutation-tested by hand without a repository fixture, which matters because
 * `stryker.conf.json`'s `mutate` is a ten-file allowlist that a new `scripts/`
 * module does not join - an automated run over this file reports
 * `nothing-to-mutate` and says nothing at all.
 *
 * @module scripts/lib/shipped-surface
 */
import path from "node:path";

/**
 * Extensions a consumer can put behind a `package.json` script entry.
 *
 * The list is deliberately broader than "things Lisa runs itself": the
 * question this gate asks is not what upstream invokes, it is what a HOST
 * could have wired. See `isConsumerBindable`.
 */
export const EXECUTABLE_EXTENSIONS = Object.freeze([
  ".cjs",
  ".js",
  ".mjs",
  ".py",
  ".sh",
  ".ts",
]);

/** Destination directory whose contents a host routinely names in scripts. */
export const BINDABLE_ROOT = "scripts/";

/**
 * Whether a destination path is one a consumer may have bound into their own
 * `package.json` - and therefore one that must NOT be propagated as a deletion
 * by default (#3849, revised scenario 3).
 *
 * The rule is the ticket's, stated as a question about the host rather than
 * about upstream: not "does upstream still need it" but "could a consumer have
 * wired this into their own scripts?" For an executable under `scripts/` the
 * answer is usually yes, and the reported instance is exactly that shape - an
 * importer with three npm script entries, a workflow, and a test in the host.
 *
 * @param {string} destination - path in the consumer's tree.
 * @returns {boolean} true when a host may have bound it.
 */
export function isConsumerBindable(destination) {
  if (!destination.startsWith(BINDABLE_ROOT)) return false;
  return EXECUTABLE_EXTENSIONS.includes(path.posix.extname(destination));
}

/** Declaration forms that name exactly one exported binding. */
const DECLARED_EXPORT_PATTERNS = Object.freeze([
  /^\s*export\s+(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/gm,
  /^\s*export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm,
  /^\s*export\s+class\s+([A-Za-z_$][\w$]*)/gm,
]);

/** `export { a, b as c }`, with or without a `from` clause. */
const EXPORT_CLAUSE = /^\s*export\s*\{([^}]*)\}/gm;

/** `export * from "./x.mjs"` - a re-export whose names live in the target. */
const EXPORT_STAR = /^\s*export\s*\*\s*from\s*["']([^"']+)["']/gm;

/** `import { a, b as c } from "./x.mjs"` - named imports only. */
const IMPORT_CLAUSE = /^\s*import\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/gm;

/**
 * The exported name a `{ ... }` clause member introduces: the alias when one
 * is written, the original otherwise. `default` members are dropped - a
 * default export is not a named one and the gate never asks about it.
 *
 * @param {string} member - one comma-separated clause member.
 * @returns {string | null} the exported name, or null when there is none.
 */
export function clauseExportedName(member) {
  const trimmed = member.trim().replace(/^type\s+/, "");
  if (trimmed === "") return null;
  const parts = trimmed.split(/\s+as\s+/);
  const name = (parts.length > 1 ? parts[1] : parts[0]).trim();
  return name === "" || name === "default" ? null : name;
}

/**
 * The imported local binding a `{ ... }` clause member requests from the
 * target module: always the name BEFORE any `as`, because that is the symbol
 * the target must actually export.
 *
 * @param {string} member - one comma-separated clause member.
 * @returns {string | null} the requested export name, or null when there is none.
 */
export function clauseImportedName(member) {
  const trimmed = member.trim().replace(/^type\s+/, "");
  if (trimmed === "") return null;
  const name = trimmed.split(/\s+as\s+/)[0].trim();
  return name === "" || name === "default" ? null : name;
}

/**
 * Every named export a module source declares directly, plus the relative
 * specifiers it re-exports wholesale.
 *
 * `export *` is returned rather than resolved: resolution needs the delivery
 * view, which lives in the gate. Doing it here would make this module read the
 * filesystem.
 *
 * @param {string} source - module source text.
 * @returns {{ names: Set<string>, starFrom: string[] }} declared names and
 *   the relative specifiers whose names are inherited.
 */
export function parseNamedExports(source) {
  const names = new Set();
  for (const pattern of DECLARED_EXPORT_PATTERNS) {
    for (const match of source.matchAll(pattern)) names.add(match[1]);
  }
  for (const match of source.matchAll(EXPORT_CLAUSE)) {
    for (const member of match[1].split(",")) {
      const name = clauseExportedName(member);
      if (name !== null) names.add(name);
    }
  }
  const starFrom = [...source.matchAll(EXPORT_STAR)]
    .map(match => match[1])
    .filter(specifier => specifier.startsWith("."));
  return { names, starFrom };
}

/**
 * Every named import a module source requests from a RELATIVE specifier.
 *
 * Bare specifiers are skipped: they resolve through `node_modules` in the
 * consumer's tree, which this repository cannot see and does not govern.
 *
 * @param {string} source - module source text.
 * @returns {Array<{ specifier: string, names: string[] }>} one entry per
 *   relative named-import statement, in source order.
 */
export function parseRelativeNamedImports(source) {
  const requests = [];
  for (const match of source.matchAll(IMPORT_CLAUSE)) {
    const specifier = match[2];
    if (!specifier.startsWith(".")) continue;
    const names = match[1]
      .split(",")
      .map(member => clauseImportedName(member))
      .filter(name => name !== null);
    if (names.length > 0) requests.push({ names, specifier });
  }
  return requests;
}

/**
 * The destination a relative specifier resolves to, given the destination
 * path of the importing module.
 *
 * @param {string} importerDestination - the importer's path in the consumer tree.
 * @param {string} specifier - a relative specifier from that importer.
 * @returns {string} the resolved destination path.
 */
export function resolveRelative(importerDestination, specifier) {
  return path.posix.normalize(
    path.posix.join(path.posix.dirname(importerDestination), specifier)
  );
}

/**
 * The ledger key for one governed surface.
 *
 * A whole-file removal is keyed by path alone; an export removal is keyed
 * `path symbol`. A shipped path never contains a space, so the two key spaces
 * cannot collide.
 *
 * @param {string} shippedPath - repo-relative path inside a delivery lane.
 * @param {string} [symbol] - the exported name, when a symbol rather than a file.
 * @returns {string} the key.
 */
export function removalKey(shippedPath, symbol) {
  return symbol === undefined ? shippedPath : `${shippedPath} ${symbol}`;
}

/**
 * Index a removal ledger by the surface each entry governs.
 *
 * @param {ReadonlyArray<{ path: string, export?: string, note?: string }>} removals
 *   ledger entries.
 * @returns {Map<string, { path: string, export?: string, note?: string }>} the index.
 */
export function indexRemovals(removals) {
  return new Map(
    removals.map(entry => [removalKey(entry.path, entry.export), entry])
  );
}

/**
 * Whether a ledger entry actually records something an operator can act on.
 *
 * An entry with a blank note is treated as absent. A note that says nothing is
 * the same silence the gate exists to break, and accepting it would let the
 * ledger be satisfied by a placeholder.
 *
 * @param {{ note?: unknown } | undefined} entry - the indexed ledger entry.
 * @returns {boolean} true when the entry carries a usable note.
 */
export function hasUsableNote(entry) {
  return (
    entry !== undefined &&
    typeof entry.note === "string" &&
    entry.note.trim() !== ""
  );
}

import {
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { auditRecord } from "./audit-exclusions.js";

/**
 * The real path of a directory, following symlinks, or undefined when the
 * path is missing, a broken link, or not a directory.
 * @param path - A path that may be or pass through a symlink
 * @returns Its real path when it is a directory
 */
function realDirectory(path: string): string | undefined {
  try {
    return statSync(path).isDirectory() ? realpathSync(path) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Child node_modules directories of one node_modules directory, including
 * the isolated stores Bun and pnpm keep under `.bun` and `.pnpm`. Symlinked
 * entries are followed, so a linked workspace package's own node_modules is
 * searched too; every result is a real path.
 * @param modules - A node_modules directory (a real path)
 * @returns The real node_modules directories nested one level below it
 */
function nestedModules(modules: string): readonly string[] {
  return readdirSync(modules).flatMap(name => {
    const base = realDirectory(join(modules, name));
    if (base === undefined) return [];
    const children =
      name.startsWith("@") || [".bun", ".pnpm"].includes(name)
        ? readdirSync(base).map(child => join(base, child))
        : [base];
    return children.flatMap(child => {
      const nested = realDirectory(join(child, "node_modules"));
      return nested === undefined ? [] : [nested];
    });
  });
}

/**
 * Every distinct installed directory of a package, at any depth. Symlinks are
 * followed (a linked workspace package can hold its own copy) and each copy
 * is reported once, by real path, so a link back up the tree cannot loop and
 * a store entry reached through several links is checked once.
 * @param root - Project root whose node_modules is searched
 * @param name - Package name
 * @returns Each installed directory with the version its manifest declares
 */
export function installedCopies(
  root: string,
  name: string
): readonly { readonly dir: string; readonly version: string }[] {
  const start = realDirectory(join(root, "node_modules"));
  const walk = (
    queue: readonly string[],
    seen: ReadonlySet<string>
  ): readonly string[] => {
    const fresh = [...new Set(queue)].filter(dir => !seen.has(dir));
    if (!fresh.length) return [...seen];
    const next = new Set([...seen, ...fresh]);
    return walk(fresh.flatMap(nestedModules), next);
  };
  const modules = start === undefined ? [] : walk([start], new Set());
  const packages = modules.flatMap(dir => {
    const pkg = realDirectory(join(dir, ...name.split("/")));
    return pkg !== undefined && existsSync(join(pkg, "package.json"))
      ? [pkg]
      : [];
  });
  return [...new Set(packages)].flatMap(pkg => {
    const parsed: unknown = JSON.parse(
      readFileSync(join(pkg, "package.json"), "utf8")
    );
    return auditRecord(parsed) &&
      parsed.name === name &&
      typeof parsed.version === "string"
      ? [{ dir: pkg, version: parsed.version }]
      : [];
  });
}

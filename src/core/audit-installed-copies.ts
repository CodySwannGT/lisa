import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { auditRecord } from "./audit-exclusions.js";

/**
 * Child node_modules directories of one node_modules directory, including
 * the isolated stores Bun and pnpm keep under `.bun` and `.pnpm`.
 * @param modules - A node_modules directory
 * @returns The node_modules directories nested one level below it
 */
function nestedModules(modules: string): readonly string[] {
  return readdirSync(modules, { withFileTypes: true }).flatMap(entry => {
    if (!entry.isDirectory()) return [];
    const base = join(modules, entry.name);
    const children =
      entry.name.startsWith("@") || [".bun", ".pnpm"].includes(entry.name)
        ? readdirSync(base, { withFileTypes: true })
            .filter(child => child.isDirectory())
            .map(child => join(base, child.name))
        : [base];
    return children
      .map(child => join(child, "node_modules"))
      .filter(child => existsSync(child) && lstatSync(child).isDirectory());
  });
}

/**
 * Every real (non-symlinked) installed directory of a package, at any depth.
 * @param root - Project root whose node_modules is searched
 * @param name - Package name
 * @returns Each installed directory with the version its manifest declares
 */
export function installedCopies(
  root: string,
  name: string
): readonly { readonly dir: string; readonly version: string }[] {
  const start = join(root, "node_modules");
  const walk = (
    queue: readonly string[],
    seen: ReadonlySet<string>
  ): readonly string[] => {
    const fresh = queue.filter(dir => !seen.has(dir));
    if (!fresh.length) return [...seen];
    const next = new Set([...seen, ...fresh]);
    return walk(fresh.flatMap(nestedModules), next);
  };
  const modules = existsSync(start) ? walk([start], new Set()) : [];
  return modules.flatMap(dir => {
    const pkg = join(dir, ...name.split("/"));
    const manifest = join(pkg, "package.json");
    if (!existsSync(manifest) || lstatSync(pkg).isSymbolicLink()) return [];
    const parsed: unknown = JSON.parse(readFileSync(manifest, "utf8"));
    return auditRecord(parsed) &&
      parsed.name === name &&
      typeof parsed.version === "string"
      ? [{ dir: pkg, version: parsed.version }]
      : [];
  });
}

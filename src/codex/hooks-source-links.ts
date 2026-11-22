/**
 * Ownership proof for legacy Codex hook links: decides whether a symlink in a
 * host's `.codex/` points at a shipped Lisa source (in this checkout, its
 * compiled twin, or an installed `@codyswann/lisa` package) rather than at a
 * host path that merely shares a suffix.
 * @module codex/hooks-source-links
 */
import * as fse from "fs-extra";
import { lstat, readFile, readlink } from "node:fs/promises";
import * as path from "node:path";

/**
 * Admit links to known Lisa sources, not host paths with similar suffixes.
 * Canonical installed-package paths also recover genuinely dangling links.
 * @param destination Host script path.
 * @param source Exact shipped source.
 * @param lisaDir Verified Lisa package root.
 * @param destDir Host root.
 * @returns Whether the catalog owns this legacy representation.
 */
export async function isManagedSourceLink(
  destination: string,
  source: string,
  lisaDir: string,
  destDir: string
): Promise<boolean> {
  const stat = await lstat(destination).catch(() => undefined);
  if (!stat?.isSymbolicLink()) return false;
  const target = path.resolve(
    path.dirname(destination),
    await readlink(destination)
  );
  const relative = path.relative(lisaDir, source);
  if (target === path.resolve(source)) return true;
  if (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
    return false;
  const variants = sourceLocationVariants(relative);
  if (variants.some(file => target === path.resolve(lisaDir, file)))
    return true;
  const installedRoot = path.join(destDir, "node_modules/@codyswann/lisa");
  return isLisaPackageTarget(target, variants, installedRoot);
}

/**
 * Source and compiled trees contain the same legacy bundled scripts.
 * @param relative Source path within the verified Lisa package.
 * @returns Exact supported source locations within that package.
 */
function sourceLocationVariants(relative: string): readonly string[] {
  const tree = ["src", "dist"].find(directory =>
    relative.startsWith(path.join(directory, "codex", "scripts") + path.sep)
  );
  return tree === undefined
    ? [relative]
    : [
        relative,
        path.join(
          tree === "src" ? "dist" : "src",
          "codex",
          "scripts",
          path.basename(relative)
        ),
      ];
}

/**
 * Verify old package/store roots rather than relying on their directory layout.
 * @param target Resolved legacy link target.
 * @param variants Exact supported paths within a Lisa package.
 * @param installedRoot Canonical host package path, including dangling installs.
 * @returns Whether positive package identity owns this expected source path.
 */
async function isLisaPackageTarget(
  target: string,
  variants: readonly string[],
  installedRoot: string
): Promise<boolean> {
  const roots = variants
    .filter(file => target.endsWith(path.sep + file))
    .map(file => target.slice(0, -(file.length + 1)));
  const verified = await Promise.all(
    roots.map(async root => {
      if (root === path.resolve(installedRoot) && !(await fse.pathExists(root)))
        return true;
      const metadata: unknown = await readFile(
        path.join(root, "package.json"),
        "utf8"
      )
        .then(raw => JSON.parse(raw) as unknown)
        .catch(() => undefined);
      return (
        typeof metadata === "object" &&
        metadata !== null &&
        "name" in metadata &&
        metadata.name === "@codyswann/lisa"
      );
    })
  );
  return verified.some(Boolean);
}

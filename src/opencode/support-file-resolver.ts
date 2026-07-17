import * as path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Resolve an OpenCode support file in source checkouts and built packages.
 * @param moduleUrl URL of the calling installer module.
 * @param filename Canonical support-file basename.
 * @returns Absolute path to the source or bundled copy.
 */
export function resolveSupportFile(
  moduleUrl: string,
  filename: string
): string {
  const moduleDir = path.dirname(fileURLToPath(moduleUrl));
  const bundled = path.join(moduleDir, "plugin-templates", filename);
  if (path.basename(path.dirname(moduleDir)) === "dist") return bundled;
  return path.resolve(
    moduleDir,
    "..",
    "..",
    "plugins",
    "src",
    "base",
    "hooks",
    filename
  );
}

import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { RAILS_HOOK_ENGINE_FILES } from "../../scripts/lib/rails-hooks.mjs";

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
  if ((RAILS_HOOK_ENGINE_FILES as readonly string[]).includes(filename))
    return path.resolve(moduleDir, "../../scripts/lib", filename);
  // Generated hooks carry the same ownership banner as the dispatcher copy;
  // raw authoring sources do not, so their literal-byte memo keys would differ.
  return path.resolve(
    moduleDir,
    "..",
    "..",
    "plugins",
    "lisa",
    "hooks",
    filename
  );
}

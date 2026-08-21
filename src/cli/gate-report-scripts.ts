/**
 * Read the project's package scripts for the report.
 *
 * Its own module because the three-state answer is load-bearing and easy to
 * flatten: a `package.json` that could not be READ is not a project with no
 * scripts, and a cell that reported "no such script" for an unreadable file
 * would be a verdict where the report owes an unknown.
 * @module cli/gate-report-scripts
 */
import { readFile } from "node:fs/promises";
import * as path from "node:path";

/**
 * Read `package.json` scripts, distinguishing absent from unreadable.
 * @param projectRoot - Project root
 * @returns The scripts block, or null when it could not be read
 */
export async function readScripts(
  projectRoot: string
): Promise<Record<string, string> | null> {
  const source = await readFile(
    path.join(projectRoot, "package.json"),
    "utf8"
  ).catch(() => undefined);
  if (source === undefined) return null;
  try {
    const parsed: unknown = JSON.parse(source);
    if (parsed === null || typeof parsed !== "object") return null;
    const scripts: unknown = Reflect.get(parsed, "scripts");
    if (scripts === null || typeof scripts !== "object") return {};
    return scripts as Record<string, string>;
  } catch {
    return null;
  }
}

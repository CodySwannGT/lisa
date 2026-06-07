/**
 * `lisa cross-pollinate [path]` — run the deterministic cross-pollination engine
 * over a host project, making its locally-authored agent definitions available
 * in the formats of the other agents the project's harness includes.
 *
 * This is the CLI surface for the engine bundled at
 * `plugins/lisa/scripts/cross-pollinate.mjs`; the `/lisa:cross-pollinate` skill
 * layers in the judgment-heavy translations the engine reports as `pending`.
 * Default is dry-run; pass `--write` to apply and update the provenance lockfile.
 * @module cli/cross-pollinate-cmd
 */
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ConsoleLogger } from "../logging/index.js";
import { toAbsolutePath } from "../utils/path-utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Options for {@link runCrossPollinate}. */
export interface CrossPollinateOptions {
  /** When true, write emits and update the lockfile; otherwise report only. */
  readonly write?: boolean;
}

/** Minimal shape of the bundled engine module. */
interface Engine {
  readonly plan: (root: string) => unknown;
  readonly apply: (p: unknown, opts: { dryRun: boolean }) => unknown;
  readonly renderReport: (p: unknown, result: unknown) => string;
}

/**
 * Resolve and dynamically import the bundled cross-pollinate engine.
 * @returns The engine module.
 */
async function loadEngine(): Promise<Engine> {
  const enginePath = path.resolve(
    __dirname,
    "..",
    "..",
    "plugins",
    "lisa",
    "scripts",
    "cross-pollinate.mjs"
  );
  return (await import(pathToFileURL(enginePath).href)) as unknown as Engine;
}

/**
 * Run cross-pollination against a destination project.
 * @param destination - Project path (defaults to the current directory)
 * @param options - CLI options
 */
export async function runCrossPollinate(
  destination: string | undefined,
  options: CrossPollinateOptions
): Promise<void> {
  const destDir = toAbsolutePath(destination ?? ".");
  const logger = new ConsoleLogger();
  const dryRun = options.write !== true;

  try {
    const engine = await loadEngine();
    const plan = engine.plan(destDir);
    const result = engine.apply(plan, { dryRun });
    logger.info(engine.renderReport(plan, result));
    if (dryRun) {
      logger.info("\n(dry-run — pass --write to apply; default is dry-run)");
    }
  } catch (error) {
    logger.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

/**
 * Read-only cross-pollination nudge for `lisa apply`.
 *
 * The cross-pollinate engine (`plugins/lisa/scripts/cross-pollinate.mjs`) keeps
 * a host project's locally-authored agent definitions in sync across every
 * agent the project's harness includes. `apply` runs here in PLAN mode only —
 * it never writes — and prints a one-line suggestion to run
 * `/lisa:cross-pollinate` (or `lisa cross-pollinate --write`) when it detects
 * work to do. Writing agent files from `apply` would be a silent, outward-facing
 * mutation (apply also runs during `postinstall`), so the actual emit stays
 * behind explicit user intent.
 *
 * Every failure here is non-fatal: a missing engine, an unreadable project, or a
 * malformed plan must never break an otherwise-successful apply.
 * @module cli/cross-pollinate-nudge
 */
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import type { ILogger } from "../logging/index.js";

/** Shape of the plan object returned by the bundled engine's `plan()`. */
interface CrossPollinationPlan {
  readonly targetAgents: readonly string[];
  readonly emits: ReadonlyArray<{ readonly reason: string }>;
  readonly pending: readonly unknown[];
  readonly conflicts: readonly unknown[];
  readonly orphans: readonly unknown[];
}

/**
 * Run the cross-pollinate engine in read-only plan mode and log a nudge when it
 * finds actionable work. Never throws.
 * @param destDir - Absolute path to the applied project root
 * @param lisaDir - Absolute path to the Lisa package/repo root (holds plugins/)
 * @param logger - Logger for the suggestion line
 */
export async function nudgeCrossPollinate(
  destDir: string,
  lisaDir: string,
  logger: ILogger
): Promise<void> {
  try {
    const enginePath = path.join(
      lisaDir,
      "plugins",
      "lisa",
      "scripts",
      "cross-pollinate.mjs"
    );
    const engine = (await import(pathToFileURL(enginePath).href)) as {
      plan?: (root: string) => CrossPollinationPlan;
    };
    if (typeof engine.plan !== "function") {
      return;
    }
    const plan = engine.plan(destDir);
    const pendingEmits = plan.emits.filter(
      e => e.reason !== "up-to-date"
    ).length;
    const actionable =
      pendingEmits +
      plan.pending.length +
      plan.conflicts.length +
      plan.orphans.length;
    if (actionable === 0) {
      return;
    }
    const bits = [
      pendingEmits ? `${pendingEmits} to sync` : "",
      plan.pending.length ? `${plan.pending.length} need translation` : "",
      plan.conflicts.length ? `${plan.conflicts.length} conflicts` : "",
      plan.orphans.length ? `${plan.orphans.length} orphaned` : "",
    ].filter(Boolean);
    logger.info(
      `Cross-pollination: ${bits.join(", ")} across [${plan.targetAgents.join(", ")}]. ` +
        `Run /lisa:cross-pollinate (or: lisa cross-pollinate . --write) to update.`
    );
  } catch {
    // Non-fatal: never let a nudge break apply.
  }
}

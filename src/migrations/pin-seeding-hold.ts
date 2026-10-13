/**
 * Whether a package-manager install may move the `quality.yml` pin (#4449).
 *
 * Lisa 4.80.0 deleted five hand-written `quality.yml` jobs because a declared
 * gate leg proves the same property (#3052), and a leg exists only for a gate
 * the project declares. During an install `EnsureSeededGatesMigration` refuses
 * to write declarations, because an install must not change what the
 * repository requires (#3574). Moving the pin anyway would change it the other
 * way: five checks gone, with nothing reporting it. So the pin migration asks
 * this module first, and holds every ref while the answer is a reason.
 * @module migrations/pin-seeding-hold
 */
import { readFile } from "node:fs/promises";
import * as path from "node:path";

import { importGateRegistry } from "../cli/gate-registry-source.js";
import { findReusableWorkflowRefs } from "../core/reusable-workflow-pin.js";
import type { MigrationContext } from "./migration.interface.js";

/** The reusable workflow whose deleted jobs a declared gate leg now replaces. */
const QUALITY_WORKFLOW = "quality.yml";

/** The slice of the shipped registry this module calls. */
interface GateRegistryModule {
  readonly undeclaredRunnerOwnedGates?: (
    gates: Record<string, unknown>
  ) => readonly string[];
}

/**
 * The project's gates block, or an empty one when there is none to read.
 * @param projectDir - Destination project directory
 * @returns The gates block
 */
async function readGatesBlock(
  projectDir: string
): Promise<Record<string, unknown>> {
  const config = await readFile(
    path.join(projectDir, ".lisa.config.json"),
    "utf8"
  )
    .then(text => JSON.parse(text) as { readonly gates?: unknown })
    .catch(() => ({}) as { readonly gates?: unknown });
  return typeof config.gates === "object" && config.gates !== null
    ? (config.gates as Record<string, unknown>)
    : {};
}

/**
 * Why an install must leave the refs alone, or null when it may move them.
 *
 * Only an install holds (a full apply seeds in the same run), only when a
 * rewrite is pending, only for a project that calls `quality.yml`, and only
 * while a runner-owned gate is undeclared. `off` counts as declared.
 * @param ctx - Migration context
 * @param changes - The rewrites the pin migration would make
 * @returns The operator-readable reason, or null
 */
export async function seedingHoldReason(
  ctx: MigrationContext,
  changes: readonly { readonly source: string }[]
): Promise<string | null> {
  if (ctx.postinstallSafe !== true || changes.length === 0) return null;
  const callsQuality = changes.some(change =>
    findReusableWorkflowRefs(change.source).some(
      reference => reference.workflow === QUALITY_WORKFLOW
    )
  );
  if (!callsQuality) return null;
  const registry = await importGateRegistry<GateRegistryModule>();
  if (typeof registry?.undeclaredRunnerOwnedGates !== "function") return null;
  const missing = registry.undeclaredRunnerOwnedGates(
    await readGatesBlock(ctx.projectDir)
  );
  if (missing.length === 0) return null;
  return [
    "Left every Lisa reusable-workflow ref where it was: this install would move quality.yml past the",
    "release that replaced five of its jobs with declared gate legs, and this project does not yet declare",
    `${missing.join(", ")} at pull-request, so those checks would stop running with nothing reporting it.`,
    "An install may not write those declarations, so it does not move the pin either. Apply Lisa",
    "deliberately and both land together, in a diff someone reviews:",
    "",
    "    npx @codyswann/lisa@latest .",
  ].join("\n");
}

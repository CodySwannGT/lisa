import * as path from "node:path";
import * as fse from "fs-extra";
import { importGateRegistry } from "../cli/gate-registry-source.js";
import { readJsonOrNull, writeJson } from "../utils/json-utils.js";
import type {
  Migration,
  MigrationContext,
  MigrationResult,
} from "./migration.interface.js";

const LISA_CONFIG = ".lisa.config.json";
const PACKAGE_JSON = "package.json";

/** The slice of the shipped gate registry this migration calls. */
interface GateRegistryModule {
  readonly seedGates: (options: {
    gates?: Record<string, unknown>;
    scripts?: Record<string, string>;
    runner?: string;
  }) => {
    gates: Record<string, unknown>;
    seeded: readonly { gate: string; moment: string; run: string | null }[];
    skipped: readonly { gate: string; moment: string; reason: string }[];
  };
}

/** Minimal shape of `.lisa.config.json` for this migration. */
interface LisaConfig {
  readonly gates?: Record<string, unknown>;
  readonly [key: string]: unknown;
}

/** Minimal shape of `package.json` for this migration. */
interface ProjectManifest {
  readonly scripts?: Record<string, string>;
}

/** What the seed would do, resolved once and reused by `applies`/`apply`. */
interface SeedPlan {
  readonly configPath: string;
  readonly config: LisaConfig;
  readonly gates: Record<string, unknown>;
  readonly seeded: readonly { gate: string; moment: string }[];
}

/**
 * The task runner a seeded block should record, from the project's lockfile.
 *
 * LOCKFILE ONLY, and deliberately so. This matches the pre-push hook's
 * PRIORITY (bun, then yarn, then npm) but not its `command -v` availability
 * check, because the two answer different questions. The hook decides what to
 * run on THIS machine, now, and re-decides on every machine. `gates.runner` is
 * written into `.lisa.config.json` and committed: one value, resolved once,
 * then read by every contributor and every CI runner.
 *
 * Probing the seeding machine's PATH and freezing the result would let a
 * laptop that happens not to have bun installed record `npm run` for a bun
 * project, permanently and for everyone. The lockfile is the portable fact
 * about which runner the project uses; an absent binary is a local
 * environment gap to fix locally, not a property of the repository.
 * @param projectDir - Destination project directory
 * @returns A runner string for `gates.runner`
 */
async function detectRunner(projectDir: string): Promise<string> {
  const has = async (file: string): Promise<boolean> =>
    fse.pathExists(path.join(projectDir, file));
  if ((await has("bun.lockb")) || (await has("bun.lock"))) return "bun run";
  if (await has("yarn.lock")) return "yarn";
  return "npm run";
}

/**
 * Migration: declare, in `.lisa.config.json`, the gates this project is already
 * proving with a command written into a Lisa-shipped hook or workflow.
 *
 * WHY A MIGRATION AND NOT A TEMPLATE. Nothing seeds a `gates` block into a
 * consumer: exactly one `.lisa.config.json` is tracked anywhere in Lisa, and it
 * is Lisa's own. So the hardcoded path in the pre-push hook and in every gated
 * CI job is not a fallback for the unusual project — it is the DEFAULT for
 * essentially every installed one. A create-only artifact would never reach a
 * repository that already exists, and a version bump alone would deliver
 * nothing, which is why this is a migration that runs on `lisa apply`.
 *
 * WHY IT SEEDS LESS THAN THE REGISTRY. A seeded declaration has to reproduce
 * what the built-in did, or the migration reddens a fleet on a version bump.
 * `seedGates` therefore declares a gate only when the task that reproduces the
 * built-in is a script the project actually has, and only at a moment the
 * registry says the gate may be declared at. Everything it declines stays
 * ungoverned — and stays reported by `lisa-gates.mjs unconfigured`, which the
 * pre-push hook and every gated CI job now print. Visible beats declared-away.
 *
 * Idempotent: an existing declaration always wins, so a second run seeds
 * nothing. Never removes or rewrites a declaration the project made.
 */
export class EnsureSeededGatesMigration implements Migration {
  readonly name = "ensure-seeded-gates";
  readonly description =
    "Declare the gates the project already proves with a command written into a Lisa-shipped hook or workflow";

  /**
   * Resolve what seeding would change, or null when there is nothing to do.
   * @param ctx - Migration context
   * @returns The plan, or null
   */
  private async plan(ctx: MigrationContext): Promise<SeedPlan | null> {
    const configPath = path.join(ctx.projectDir, LISA_CONFIG);
    const config = await readJsonOrNull<LisaConfig>(configPath);
    // No config file means the project has not been onboarded at all. Creating
    // one here would declare gates for a repository that has not asked Lisa to
    // govern anything, so this stays a migration for projects that already
    // carry the file.
    if (config === null) return null;
    const manifest = await readJsonOrNull<ProjectManifest>(
      path.join(ctx.projectDir, PACKAGE_JSON)
    );
    if (manifest === null) return null;
    const registry = await importGateRegistry<GateRegistryModule>();
    if (registry === null) return null;

    const { runner: declaredRunner, ...gates } = config.gates ?? {};
    const result = registry.seedGates({
      gates: gates as Record<string, unknown>,
      scripts: manifest.scripts ?? {},
      runner:
        typeof declaredRunner === "string"
          ? declaredRunner
          : await detectRunner(ctx.projectDir),
    });
    if (result.seeded.length === 0) return null;
    return {
      configPath,
      config,
      gates: result.gates,
      seeded: result.seeded.map(entry => ({
        gate: entry.gate,
        moment: entry.moment,
      })),
    };
  }

  /**
   * Applies when at least one ungoverned property has a task that reproduces it.
   * @param ctx - Migration context
   * @returns True when there is work to do
   */
  async applies(ctx: MigrationContext): Promise<boolean> {
    return (await this.plan(ctx)) !== null;
  }

  /**
   * Write the seeded declarations into `.lisa.config.json`.
   * @param ctx - Migration context
   * @returns Result describing the action taken
   */
  async apply(ctx: MigrationContext): Promise<MigrationResult> {
    const plan = await this.plan(ctx);
    if (plan === null) return { name: this.name, action: "noop" };
    const declared = plan.seeded
      .map(entry => `${entry.gate}@${entry.moment}`)
      .join(", ");
    const message = `Declared ${plan.seeded.length} gate(s) in ${LISA_CONFIG} that were running a command written into a Lisa-shipped hook or workflow: ${declared}`;
    if (ctx.dryRun) {
      ctx.logger.dry(`Would seed ${plan.seeded.length} gate declaration(s)`);
      return {
        name: this.name,
        action: "applied",
        changedFiles: [LISA_CONFIG],
        message,
      };
    }
    await writeJson(plan.configPath, { ...plan.config, gates: plan.gates });
    ctx.logger.success(message);
    return {
      name: this.name,
      action: "applied",
      changedFiles: [LISA_CONFIG],
      message,
    };
  }
}

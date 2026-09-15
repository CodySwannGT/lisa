import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { isJsonObject, type JsonObject } from "../sync/json-path.js";
import { loadYaml } from "../utils/yaml.js";
import { writeJson } from "../utils/json-utils.js";
import { locateJob, locateKey } from "./deploy-outcome-guard-yaml.js";
import type {
  Migration,
  MigrationContext,
  MigrationResult,
} from "./migration.interface.js";

const CONFIG = ".lisa.config.json";
const WORKFLOWS = ".github/workflows";
const GATE = "coverage-adequacy";
const MOMENT = "pull-request";
const LEGACY = "verify_enforced";
const QUALITY = /^CodySwannGT\/lisa\/\.github\/workflows\/quality\.yml@/u;

/** One narrowly edited caller; unrelated bytes are preserved. */
interface CallerEdit {
  readonly relative: string;
  readonly source: string;
}

/** Planned declaration and caller changes for a single project. */
interface Plan {
  readonly edits: readonly CallerEdit[];
  readonly config: JsonObject;
  readonly seed: boolean;
}

/**
 * Read a file without confusing an unreadable file with a missing one.
 * @param file - File to read.
 * @returns Its contents, or null only when absent.
 */
async function readOptional(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/**
 * Require an object before preserving its existing entries.
 * @param value - Configuration value.
 * @param name - Safe configuration path for the error message.
 * @returns The existing object.
 */
function object(value: unknown, name: string): JsonObject {
  if (!isJsonObject(value))
    throw new Error(
      `Cannot preserve verification opt-in: ${name} must be an object.`
    );
  return value;
}

/**
 * Remove one literal input while preserving the rest of the YAML byte-for-byte.
 * @param source - Original workflow.
 * @param id - Parsed job identifier.
 * @param emptyWith - Whether removing this input empties the with map.
 * @returns Edited workflow, or throws before writing an ambiguous shape.
 */
function removeInput(source: string, id: string, emptyWith: boolean): string {
  const lines = source.split("\n");
  const block = /^[A-Za-z_][A-Za-z0-9_-]*$/u.test(id)
    ? locateJob(lines, id)
    : null;
  const span = block ? locateKey(lines, block, "with") : null;
  const matches = span
    ? lines.flatMap((line, index) =>
        index > span.start &&
        index < span.end &&
        /^\s+verify_enforced:\s*true\s*(?:#.*)?\r?$/iu.test(line)
          ? [index]
          : []
      )
    : [];
  if (!span || matches.length !== 1)
    throw new Error(
      "Cannot safely migrate the verification input in this YAML layout; the caller was left unchanged."
    );
  return lines
    .filter(
      (_, index) => index !== matches[0] && !(emptyWith && index === span.start)
    )
    .join("\n");
}

/**
 * Recognize only actual opt-ins to Lisa's standard PR workflow.
 * @param source - Workflow text.
 * @returns The edited text, or null when no supported input is present.
 */
function migrateCaller(source: string): string | null {
  if (!source.includes(LEGACY)) return null;
  const document = object(loadYaml(source), "workflow");
  if (!isJsonObject(document.jobs)) return null;
  const edited = Object.entries(document.jobs).reduce(
    (state, [id, value]) => migrateJob(state, id, value),
    { source, jobs: document.jobs }
  );
  if (edited.source === source) return null;
  if (
    !isDeepStrictEqual(loadYaml(edited.source), {
      ...document,
      jobs: edited.jobs,
    })
  )
    throw new Error(
      "Verification input migration would change unrelated workflow data; the caller was left unchanged."
    );
  return edited.source;
}

/**
 * Preserve one opted-in job while retaining the other workflow data.
 * @param state - Current workflow text and job mapping.
 * @param state.source - Current workflow text.
 * @param state.jobs - Current job mapping.
 * @param id - Job identifier.
 * @param value - Parsed job.
 * @returns Updated workflow state.
 */
function migrateJob(
  state: { source: string; jobs: JsonObject },
  id: string,
  value: unknown
): { source: string; jobs: JsonObject } {
  if (
    !isJsonObject(value) ||
    typeof value.uses !== "string" ||
    !QUALITY.test(value.uses) ||
    !isJsonObject(value.with) ||
    value.with[LEGACY] !== true
  )
    return state;
  const input = value.with;
  // The measured legacy callers use the project root and PR moment. Do not
  // guess which settings file a dynamic or differently scoped caller reads.
  if (
    (input.working_directory !== undefined &&
      input.working_directory !== "." &&
      input.working_directory !== "") ||
    (input.moment !== undefined && input.moment !== MOMENT)
  ) {
    throw new Error(
      "Cannot migrate this verification opt-in automatically: preserve or add the equivalent coverage-adequacy declaration in the caller's working directory and moment, then remove verify_enforced before updating Lisa."
    );
  }
  const { verify_enforced: _legacy, ...remaining } = input;
  const { with: _inputs, ...job } = value;
  const emptyWith = Object.keys(remaining).length === 0;
  return {
    jobs: {
      ...state.jobs,
      [id]: emptyWith ? job : { ...job, with: remaining },
    },
    source: removeInput(state.source, id, emptyWith),
  };
}

/**
 * Read only workflow files, collecting literal opt-ins and validating each edit.
 * @param projectDir - Project being updated.
 * @returns Safe caller edits.
 */
async function callerEdits(projectDir: string): Promise<readonly CallerEdit[]> {
  const files = await readdir(path.join(projectDir, WORKFLOWS), {
    withFileTypes: true,
  }).catch((error: NodeJS.ErrnoException) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  });
  const edits = await Promise.all(
    files
      .filter(file => file.isFile() && /\.ya?ml$/u.test(file.name))
      .map(async file => {
        const relative = path.join(WORKFLOWS, file.name);
        const source = await readFile(path.join(projectDir, relative), "utf8");
        const migrated = migrateCaller(source);
        return migrated === null ? null : { relative, source: migrated };
      })
  );
  return edits.filter((edit): edit is CallerEdit => edit !== null);
}

/**
 * Carry an existing workflow opt-in into the declaration that replaced it.
 * No declaration is seeded for an inactive caller, and explicit choices win.
 *
 * Ordinary package installs leave project files unchanged. Explicit applies
 * using the legacy postinstall-safe mode still advance workflow pins while
 * retaining old template content, so this migration also runs in that mode.
 * It preserves an existing choice before the retired input becomes invalid.
 */
export class PreserveVerificationOptInsMigration implements Migration {
  readonly name = "preserve-verification-opt-ins";
  readonly description =
    "Preserve existing verification-check opt-ins when updating Lisa workflows";
  private capturedProject: string | null = null;
  private capturedOptIn = false;

  /**
   * Capture and validate before a managed workflow can lose the old input.
   * @param ctx - Update context.
   */
  async beforeStrategies(ctx: MigrationContext): Promise<void> {
    const edits = await callerEdits(ctx.projectDir);
    this.capturedProject = ctx.projectDir;
    this.capturedOptIn = edits.length > 0;
    if (this.capturedOptIn) await this.plan(ctx, edits);
  }

  /**
   * Resolve a declaration without overwriting an explicit current choice.
   * @param ctx - Update context.
   * @param edits - Current caller edits.
   * @returns An actionable plan, or null when nothing needs changing.
   */
  private async plan(
    ctx: MigrationContext,
    edits: readonly CallerEdit[]
  ): Promise<Plan | null> {
    if (
      edits.length === 0 &&
      !(this.capturedProject === ctx.projectDir && this.capturedOptIn)
    )
      return null;
    const text = await readOptional(path.join(ctx.projectDir, CONFIG));
    const config = text === null ? {} : object(JSON.parse(text), CONFIG);
    const gates = Object.hasOwn(config, "gates")
      ? object(config.gates, "gates")
      : {};
    const coverage = Object.hasOwn(gates, GATE)
      ? object(gates[GATE], `gates.${GATE}`)
      : {};
    const seed = !Object.hasOwn(coverage, MOMENT);
    if (!seed && edits.length === 0) return null;
    return {
      edits,
      seed,
      config: seed
        ? {
            ...config,
            gates: {
              ...gates,
              [GATE]: {
                ...coverage,
                [MOMENT]: { level: "required", run: "check:verification" },
              },
            },
          }
        : config,
    };
  }

  /**
   * Determine whether a former opt-in or a remaining old input needs migration.
   * @param ctx - Update context.
   * @returns Whether applying changes at least one file.
   */
  async applies(ctx: MigrationContext): Promise<boolean> {
    return (await this.plan(ctx, await callerEdits(ctx.projectDir))) !== null;
  }

  /**
   * Write the equivalent declaration before removing any remaining old input.
   * @param ctx - Update context.
   * @returns The files changed, with dry-run behavior preserved.
   */
  async apply(ctx: MigrationContext): Promise<MigrationResult> {
    const plan = await this.plan(ctx, await callerEdits(ctx.projectDir));
    if (plan === null) return { name: this.name, action: "noop" };
    const changedFiles = [
      ...(plan.seed ? [CONFIG] : []),
      ...plan.edits.map(edit => edit.relative),
    ];
    const message =
      "Preserved the project's verification-check choice and removed its retired workflow input.";
    if (ctx.dryRun) ctx.logger.dry(message);
    else {
      if (plan.seed)
        await writeJson(path.join(ctx.projectDir, CONFIG), plan.config);
      for (const edit of plan.edits)
        await writeFile(path.join(ctx.projectDir, edit.relative), edit.source);
      this.capturedOptIn = false;
      ctx.logger.success(message);
    }
    return { name: this.name, action: "applied", changedFiles, message };
  }
}

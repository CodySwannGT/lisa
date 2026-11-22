/**
 * `lisa controls seed [path]`: say which road the configure step takes for a
 * repository and, on the paved road, declare the checks Lisa ships for it.
 *
 * When the whole repository or every audited folder has a supported project
 * type, the checks come from the shipped gate registry. This command declares
 * them in the `gates` block of
 * `.lisa.config.json` with the same seeding `lisa apply` uses (`seedGates` in
 * the shipped gate registry), which declares a check only when the task that
 * runs it is a script the repository actually has, and never changes a
 * declaration that is already there. A supported repository that has none of
 * those tasks yet gets nothing declared. Folder checks use each part's own
 * task runner and scope. A second run declares nothing new.
 *
 * Anywhere else it writes nothing and says so: the checks are then declared
 * from what the audit found, by the configure step, one decision at a time.
 *
 * The output is one JSON document on stdout, {@link SeedOutput}. An audit
 * report is not needed on the paved road; when one exists it is read to see
 * whether the audit found separate parts, and one that cannot be relied on is
 * refused rather than ignored.
 *
 * The same goes for `package.json`. Both the project type and the tasks a
 * check can run are read from it, so one that is there and cannot be read is
 * refused before anything is decided. Read as "this repository has no
 * tasks", it would have the command declare nothing and report success.
 * @module controls/commands/seed
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import type { Command } from "commander";

import { importGateRegistry } from "../../cli/gate-registry-source.js";
import { detectRunner } from "../../migrations/ensure-seeded-gates.js";
import { isJsonObject, type JsonObject } from "../../sync/json-path.js";
import { writeJson } from "../../utils/json-utils.js";
import {
  loadAuditReport,
  pathKind,
  resolveRepositoryRoot,
} from "../audit-report-file.js";
import { AUDIT_REPORT_JSON_PATH } from "../audit-report.js";
import { decideConfigureRoad, type ConfigureRoad } from "../configure-road.js";
import {
  GATES_DECLARATION_PATH,
  readGatesDeclaration,
} from "../gates-declaration.js";
import { WHOLE_REPOSITORY_SCOPE } from "../register-types.js";
import {
  detectSupportedTypes,
  MANIFEST_PATH,
  planShippedPartGates,
  readProjectScripts,
  readShippedFolder,
  type ProjectRead,
  type SeededGate,
  type SeedingGatesModule,
  type ShippedFolder,
} from "../shipped-parts.js";

/** The subcommand's name under `lisa controls`. */
export const SEED_COMMAND = "seed";

/** The version of {@link SeedOutput}. A changed shape gets a new one. */
export const SEED_SCHEMA_VERSION = 1;

/** What `lisa controls seed` prints on stdout. */
export interface SeedOutput {
  readonly schema_version: typeof SEED_SCHEMA_VERSION;
  /** `paved` or `discovery`; see `../configure-road.ts`. */
  readonly road: ConfigureRoad;
  /** Why that road, in words an operator can be told. */
  readonly reason: string;
  /** The supported project types detected at the repository root. */
  readonly project_types: readonly string[];
  /** Whether an audit report was found at its path. */
  readonly audit_report: "found" | "missing";
  /** The parts the audit report names, or `null` when there is no report. */
  readonly parts: readonly string[] | null;
  /** The file the declaration lives in, from the repository root. */
  readonly declaration: string;
  /** Whether this run changed the declaration. */
  readonly wrote: boolean;
  /** The checks this run declared. Empty on the discovery road. */
  readonly seeded: readonly SeededGate[];
  /** How many gates the declaration holds once this run is done. */
  readonly declared_gates: number;
}

/** What the command needs from outside, each replaceable in a test. */
export interface SeedDependencies {
  /** The directory the path argument is resolved from. */
  readonly cwd?: string;
  /** The current time, used to judge whether evidence is still fresh. */
  readonly now?: Date;
  /** Where the JSON document goes, in one call. */
  readonly stdout?: (text: string) => void;
  /** Where problems go, one per call. */
  readonly stderr?: (line: string) => void;
  /** Detects the supported project types at a folder. */
  readonly detectProjectTypes?: (root: string) => Promise<readonly string[]>;
}

/**
 * Read the parts the audit report names.
 * @param root - Real path of the repository
 * @param now - The current time
 * @returns The parts, `null` when there is no report, or why a report that
 *   exists cannot be relied on
 */
async function readParts(
  root: string,
  now: Date
): Promise<ProjectRead<readonly string[] | null>> {
  const kind = await pathKind(path.join(root, AUDIT_REPORT_JSON_PATH));
  if (kind === "missing") return { problems: null, value: null };
  const loaded = await loadAuditReport(root, now);
  return loaded.problems === null
    ? { problems: null, value: loaded.report.scopes }
    : { problems: loaded.problems };
}

/**
 * Read `.lisa.config.json` as it is written, or an empty one when absent.
 * @param root - Real path of the repository
 * @returns The parsed file, or why it cannot be used
 */
async function readConfig(root: string): Promise<ProjectRead<JsonObject>> {
  const file = path.join(root, GATES_DECLARATION_PATH);
  const kind = await pathKind(file);
  if (kind === "missing") return { problems: null, value: {} };
  if (kind !== "file") {
    return {
      problems: [
        `${GATES_DECLARATION_PATH} is not an ordinary file (it may be a link), so it was not read or written.`,
      ],
    };
  }
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as unknown;
    return isJsonObject(parsed)
      ? { problems: null, value: parsed }
      : {
          problems: [
            `${GATES_DECLARATION_PATH} does not hold a JSON object, so nothing was added to it.`,
          ],
        };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      problems: [
        `${GATES_DECLARATION_PATH} is not valid JSON, so nothing was added to it. (${detail})`,
      ],
    };
  }
}

/** What seeding did to the declaration. */
interface Seeding {
  readonly wrote: boolean;
  readonly seeded: readonly SeededGate[];
}

/**
 * Declare the checks Lisa ships that this repository has a task for.
 *
 * A declaration already there is never changed, and the file is written only
 * when something was declared, so a second run leaves it as it is.
 * @param root - Real path of the repository
 * @param registry - The shipped gate registry
 * @param scripts - The scripts of the repository's `package.json`
 * @param folders - The per-folder projects, when the audit named folders
 * @returns What was declared, or why nothing could be
 */
async function seedDeclaration(
  root: string,
  registry: SeedingGatesModule,
  scripts: Record<string, string>,
  folders: readonly ShippedFolder[]
): Promise<ProjectRead<Seeding>> {
  const config = await readConfig(root);
  if (config.problems !== null) return config;

  const gates = isJsonObject(config.value.gates) ? config.value.gates : {};
  const result =
    folders.length > 0
      ? seedFolderDeclarations(gates, folders, registry)
      : registry.seedGates({
          gates,
          scripts,
          runner:
            typeof gates.runner === "string"
              ? gates.runner
              : await detectRunner(root),
        });
  const seeded = result.seeded.map(({ gate, moment, run }) => ({
    gate,
    moment,
    run,
  }));
  if (seeded.length === 0) {
    return { problems: null, value: { wrote: false, seeded } };
  }
  await writeJson(path.join(root, GATES_DECLARATION_PATH), {
    ...config.value,
    gates: result.gates,
  });
  return { problems: null, value: { wrote: true, seeded } };
}

/**
 * Add scoped defaults for new gates while preserving existing declarations.
 * @param gates - The existing declaration
 * @param folders - Projects identified by the audit
 * @param registry - The shipped gate registry
 * @returns The merged declaration and newly seeded moments
 */
function seedFolderDeclarations(
  gates: JsonObject,
  folders: readonly ShippedFolder[],
  registry: SeedingGatesModule
): { gates: Record<string, unknown>; seeded: SeededGate[] } {
  const planned = [...planShippedPartGates(folders, registry)].filter(
    ([gate]) => !Object.hasOwn(gates, gate)
  );
  return {
    gates: {
      ...gates,
      ...Object.fromEntries(
        planned.map(([gate, row]) => [gate, row.declaration])
      ),
    },
    seeded: planned.flatMap(([, row]) => row.seeded),
  };
}

/** Why nothing was decided: the problems, and the one line that sums up. */
interface SeedRefusal {
  readonly problems: readonly string[];
  readonly summary: string;
}

/**
 * Read the audited folder projects before writing any declaration.
 * @param root - Real path of the repository
 * @param parts - The audit's scoped folders and repository root
 * @param detect - The supported project type detector
 * @returns The folder projects or their read errors
 */
async function readFolderProjects(
  root: string,
  parts: readonly string[] | null,
  detect: typeof detectSupportedTypes
): Promise<ProjectRead<ShippedFolder[]>> {
  const scopes = (parts ?? []).filter(
    scope => scope !== WHOLE_REPOSITORY_SCOPE
  );
  const reads = await Promise.all(
    scopes.map(scope => readShippedFolder(root, scope, detect))
  );
  const problems = reads.flatMap(read => read.problems ?? []);
  return problems.length > 0
    ? { problems }
    : {
        problems: null,
        value: reads.flatMap(read =>
          read.problems === null ? [read.value] : []
        ),
      };
}

/**
 * Decide the road for a repository and, on the paved road, seed its
 * declaration.
 * @param root - Real path of the repository
 * @param dependencies - Replaceable collaborators
 * @returns What the command prints, or why nothing was decided
 */
async function decideAndSeed(
  root: string,
  dependencies: SeedDependencies
): Promise<SeedOutput | SeedRefusal> {
  const registry = await importGateRegistry<SeedingGatesModule>();
  if (registry === null) {
    return {
      problems: [
        "The gate registry is missing from this copy of Lisa (expected all/copy-overwrite/scripts/lisa-gates.mjs).",
      ],
      summary: "Reinstall Lisa, then run this again",
    };
  }
  const declared = readGatesDeclaration(root, registry);
  if (declared.problems !== null) {
    return {
      problems: declared.problems,
      summary: `The gates declaration in ${GATES_DECLARATION_PATH} is not valid as it stands, so nothing was decided or declared. Fix it, then run this again`,
    };
  }
  const parts = await readParts(root, dependencies.now ?? new Date());
  if (parts.problems !== null) {
    return {
      problems: parts.problems,
      summary: `${AUDIT_REPORT_JSON_PATH} cannot be relied on, so nothing was decided or declared. Run the audit again, then run this again`,
    };
  }
  // Read before the road is decided: the project type is detected from the
  // same file, so nothing is decided from one that cannot be read.
  const scripts = await readProjectScripts(root);
  if (scripts.problems !== null) {
    return {
      problems: scripts.problems,
      summary: `${MANIFEST_PATH} cannot be relied on, so nothing was decided or declared. Correct it, then run this again`,
    };
  }
  const detect = dependencies.detectProjectTypes ?? detectSupportedTypes;
  const [projectTypes, folderProjects] = await Promise.all([
    detect(root),
    readFolderProjects(root, parts.value, detect),
  ]);
  if (folderProjects.problems !== null) {
    return {
      problems: folderProjects.problems,
      summary:
        "The audited folders could not be read, so nothing was declared. Fix the problems above, then run this again",
    };
  }
  const folders = folderProjects.value;
  const decision = decideConfigureRoad({
    projectTypes,
    parts: parts.value,
    partTypes: Object.fromEntries(
      folders.map(({ scope, types }) => [scope, types])
    ),
  });
  const seeding: ProjectRead<Seeding> =
    decision.road === "paved"
      ? await seedDeclaration(root, registry, scripts.value, folders)
      : { problems: null, value: { wrote: false, seeded: [] } };
  if (seeding.problems !== null) {
    return {
      problems: seeding.problems,
      summary: `Nothing was declared in ${GATES_DECLARATION_PATH}. Fix the problem above, then run this again`,
    };
  }
  return {
    schema_version: SEED_SCHEMA_VERSION,
    ...decision,
    project_types: projectTypes,
    audit_report: parts.value === null ? "missing" : "found",
    parts: parts.value,
    declaration: GATES_DECLARATION_PATH,
    ...seeding.value,
    declared_gates: Object.keys(registry.readGates(root).gates).length,
  };
}

/**
 * Say which road one repository takes and, on the paved road, seed its
 * declaration.
 * @param targetPath - The repository; the working directory when left out
 * @param dependencies - Replaceable collaborators
 * @returns The exit code: 0 when the road was printed, 1 when the audit
 *   report or the declaration could not be relied on and nothing was printed
 *   on stdout
 */
export async function runSeed(
  targetPath: string | undefined,
  dependencies: SeedDependencies = {}
): Promise<number> {
  const stdout =
    dependencies.stdout ?? (text => process.stdout.write(`${text}\n`));
  const stderr =
    dependencies.stderr ?? (line => process.stderr.write(`${line}\n`));
  const named = path.resolve(
    dependencies.cwd ?? process.cwd(),
    targetPath ?? "."
  );
  const root = await resolveRepositoryRoot(named);
  const outcome: SeedOutput | SeedRefusal =
    root === null
      ? {
          problems: [`${targetPath ?? named} is not a folder.`],
          summary: "Give the path of the repository to configure",
        }
      : await decideAndSeed(root, dependencies);
  if ("problems" in outcome) {
    outcome.problems.forEach(problem => {
      stderr(problem.replaceAll(/\s+/gu, " "));
    });
    stderr(`${SEED_COMMAND}: FAIL. ${outcome.summary}`);
    return 1;
  }
  stdout(JSON.stringify(outcome, null, 2));
  return 0;
}

/** The collaborator the registration needs, replaceable in a test. */
export interface SeedCommandDependencies {
  readonly runSeed: (targetPath: string | undefined) => Promise<number>;
}

/**
 * Register `seed` under the `lisa controls` group.
 * @param group - The `controls` command
 * @param dependencies - Replaceable collaborators
 */
export function registerSeed(
  group: Command,
  dependencies: SeedCommandDependencies = {
    runSeed: targetPath => runSeed(targetPath),
  }
): void {
  group
    .command(SEED_COMMAND)
    .description(
      `Say whether this repository's checks come from the ones Lisa ships for its project type and, when they do, declare them in the gates block of ${GATES_DECLARATION_PATH}`
    )
    .argument("[path]", "Project path (default: current directory)")
    .action(async (targetPath: string | undefined) => {
      const code = await dependencies.runSeed(targetPath);
      if (code !== 0) process.exitCode = code;
    });
}

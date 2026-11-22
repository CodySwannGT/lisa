/** Read and declare the checks Lisa ships for each supported folder. */
import { readFile } from "node:fs/promises";
import path from "node:path";

import { createDetectorRegistry } from "../detection/index.js";
import { detectRunner } from "../migrations/ensure-seeded-gates.js";
import { isJsonObject } from "../sync/json-path.js";
import { pathKind, resolveRepositoryRoot } from "./audit-report-file.js";
import { canonicalText, compareCodeUnits } from "./canonical-json.js";
import type { GatesDeclaration, GatesModule } from "./gates-declaration.js";
import { WHOLE_REPOSITORY_SCOPE } from "./register-types.js";
import {
  createRepositoryReader,
  recordKeepingPlace,
} from "./repository-reader.js";
import { parseProblemWithoutExcerpt } from "./secret-scan-json.js";

/** The package manifest a project declares its tasks in. */
export const MANIFEST_PATH = "package.json";

/** Something read, or the lines saying why it could not be. */
export type ProjectRead<Value> =
  | { readonly problems: null; readonly value: Value }
  | { readonly problems: readonly string[] };

/** The existing seed command's report for one declared moment. */
export interface SeededGate {
  readonly gate: string;
  readonly moment: string;
  readonly run: string | null;
}

/** Library that can seed supported project checks as well as resolve them. */
export interface SeedingGatesModule extends GatesModule {
  readonly seedGates: (options: {
    readonly gates?: Record<string, unknown>;
    readonly scripts?: Record<string, string>;
    readonly runner?: string;
  }) => {
    readonly gates: Record<string, unknown>;
    readonly seeded: readonly SeededGate[];
  };
}

/**
 * Detect the shipped types for a project, including any parent types.
 * @param root - The project directory
 * @returns The supported types, in Lisa's order
 */
export async function detectSupportedTypes(
  root: string
): Promise<readonly string[]> {
  const registry = createDetectorRegistry();
  return registry.expandAndOrderTypes(await registry.detectAll(root));
}

/**
 * Read the project's tasks. A missing manifest means no scripts. An unreadable
 * manifest leaves the project's tasks unknown.
 * @param root - The project directory
 * @param scope - The project path in the repository, for diagnostics
 * @returns The parsed scripts or the reason they could not be read
 */
export async function readProjectScripts(
  root: string,
  scope = WHOLE_REPOSITORY_SCOPE
): Promise<ProjectRead<Record<string, string>>> {
  const file = path.join(root, MANIFEST_PATH);
  const kind = await pathKind(file);
  if (kind === "missing") return { problems: null, value: {} };
  const manifestPath =
    scope === WHOLE_REPOSITORY_SCOPE
      ? MANIFEST_PATH
      : `${scope}/${MANIFEST_PATH}`;
  const refused = (why: string): ProjectRead<Record<string, string>> => ({
    problems: [
      `${manifestPath} ${why}, so the tasks this repository has cannot be read from it.`,
    ],
  });
  if (scope !== WHOLE_REPOSITORY_SCOPE && kind !== "file") {
    return refused("is not an ordinary file");
  }
  try {
    const manifest = JSON.parse(await readFile(file, "utf8")) as unknown;
    if (!isJsonObject(manifest)) return refused("does not hold a JSON object");
    if (manifest.scripts === undefined) return { problems: null, value: {} };
    return isJsonObject(manifest.scripts)
      ? { problems: null, value: manifest.scripts as Record<string, string> }
      : refused(`has a "scripts" entry that is not an object`);
  } catch (error) {
    return refused(
      `cannot be read as JSON (${parseProblemWithoutExcerpt(error)})`
    );
  }
}

/** A folder's project types, declared tasks, and lockfile-selected runner. */
export interface ShippedFolder {
  readonly scope: string;
  readonly types: readonly string[];
  readonly scripts: Record<string, string>;
  readonly runner: string;
}

/**
 * Read an audited folder of this repository without following a folder link.
 * @param root - Real repository path
 * @param scope - The folder path, relative to the repository
 * @param detect - The same project type detector used for a single project
 * @returns The folder's facts, or a manifest read error
 */
export async function readShippedFolder(
  root: string,
  scope: string,
  detect = detectSupportedTypes
): Promise<ProjectRead<ShippedFolder>> {
  const folder = path.resolve(root, scope);
  if (
    folder === root ||
    recordKeepingPlace(scope) !== null ||
    !createRepositoryReader(root).isFolder(scope) ||
    (await resolveRepositoryRoot(folder)) !== folder
  ) {
    return {
      problems: null,
      value: { scope, types: [], scripts: {}, runner: "" },
    };
  }
  const scripts = await readProjectScripts(folder, scope);
  if (scripts.problems !== null) return scripts;
  const [types, runner] = await Promise.all([
    detect(folder),
    detectRunner(folder),
  ]);
  return {
    problems: null,
    value: { scope, types, scripts: scripts.value, runner },
  };
}

/**
 * Detect support at the scope where each declared control runs.
 * @param root - The repository root
 * @param scopes - The scopes in the control register
 * @returns Scopes whose own project type provides shipped checks
 */
export async function supportedControlScopes(
  root: string,
  scopes: readonly string[]
): Promise<ReadonlySet<string>> {
  const supported = await Promise.all(
    [...new Set(scopes)].map(async scope => {
      if (scope === WHOLE_REPOSITORY_SCOPE)
        return (await detectSupportedTypes(root)).length > 0 ? scope : null;
      const folder = await readShippedFolder(root, scope);
      return folder.problems === null && folder.value.types.length > 0
        ? scope
        : null;
    })
  );
  return new Set(supported.filter(scope => scope !== null));
}

/** A shipped gate with one fixed argv for each covered folder. */
interface ShippedGate {
  readonly declaration: Record<string, unknown>;
  readonly seeded: readonly SeededGate[];
}

/** A task the existing registry can seed for one folder and moment. */
interface PartTask extends SeededGate {
  readonly scope: string;
  readonly task: string;
  readonly runner: string;
}

/**
 * Resolve the actual tasks through the same registry as whole-project seeding.
 * @param folder - A supported folder's project facts
 * @param registry - The shipped gate registry
 * @returns The tasks the registry can seed
 */
function folderTasks(
  folder: ShippedFolder,
  registry: SeedingGatesModule
): PartTask[] {
  const { scope, scripts, runner } = folder;
  const { gates, seeded } = registry.seedGates({ scripts, runner });
  return seeded.flatMap(row => {
    const resolved = registry.resolveMoment({
      gates,
      scripts,
      runner,
      moment: row.moment,
    });
    const task = resolved.find(gate => gate.id === row.gate)?.task;
    return typeof task === "string" ? [{ ...row, scope, task, runner }] : [];
  });
}

/**
 * Group a gate's candidate tasks for comparing its folders and moments.
 * @param tasks - The candidate tasks
 * @param field - The task field identifying each group
 * @returns Tasks grouped in their original order
 */
function groupTasks(
  tasks: readonly PartTask[],
  field: "gate" | "scope" | "moment"
): Map<string, PartTask[]> {
  const keys = [...new Set(tasks.map(task => task[field]))];
  return new Map(
    keys.map(key => [key, tasks.filter(task => task[field] === key)])
  );
}

/**
 * Compose the scoped checks that can be represented without changing when
 * they run. Each configured moment runs every part of a gate with the same
 * argv, so only keep moments that all its participating folders share.
 * @param folders - The supported folder projects
 * @param registry - The shipped gate registry
 * @returns Gates and the moments to report as seeded
 */
export function planShippedPartGates(
  folders: readonly ShippedFolder[],
  registry: SeedingGatesModule
): Map<string, ShippedGate> {
  return assemblePartGates(
    [...folders]
      .sort((left, right) => compareCodeUnits(left.scope, right.scope))
      .filter(folder => folder.types.length > 0)
      .flatMap(folder => folderTasks(folder, registry))
  );
}

/**
 * Assemble representable declarations from observed tasks.
 * @param tasks - The tasks selected for each folder
 * @returns Scoped gates and their reported moments
 */
function assemblePartGates(
  tasks: readonly PartTask[]
): Map<string, ShippedGate> {
  return new Map(
    [...groupTasks(tasks, "gate")].flatMap(([gate, rows]) => {
      const byFolder = groupTasks(rows, "scope");
      const moments = [...groupTasks(rows, "moment")]
        .filter(([, matches]) => matches.length === byFolder.size)
        .map(([moment]) => moment);
      if (moments.length === 0) return [];
      const parts = [...byFolder].flatMap(([scope, folderRows]) => {
        const chosen = folderRows.filter(row => moments.includes(row.moment));
        const [first] = chosen;
        return first !== undefined &&
          chosen.every(row => row.task === first.task)
          ? [{ scope, command: [...first.runner.split(" "), first.task] }]
          : [];
      });
      if (parts.length !== byFolder.size) return [];
      return [
        [
          gate,
          {
            declaration: {
              ...Object.fromEntries(
                moments.map(moment => [moment, "required"])
              ),
              parts,
            },
            seeded: moments.map(moment => ({ gate, moment, run: null })),
          },
        ] as const,
      ];
    })
  );
}

/**
 * Identify folder declarations that can be reproduced exactly from shipping
 * defaults and the checked-out project. Only these can support the register
 * without an audit locator or answered question.
 * @param root - Real repository path
 * @param declaration - The validated gates declaration
 * @param registry - The shipped gate registry
 * @returns Gate IDs with a confirmed shipped declaration
 */
export async function confirmedShippedPartGates(
  root: string,
  declaration: GatesDeclaration,
  registry: GatesModule
): Promise<ReadonlySet<string>> {
  if (!("seedGates" in registry) || typeof registry.seedGates !== "function")
    return new Set();
  const seedingRegistry = registry as SeedingGatesModule;
  const candidates = Object.entries(declaration.gates).flatMap(([id, gate]) => {
    if (!Array.isArray(gate.parts)) return [];
    const parts = gate.parts as readonly {
      scope: string;
      evidence?: unknown;
    }[];
    return parts.some(part => part.evidence !== undefined)
      ? []
      : [{ id, gate, parts }];
  });
  const scopes = [
    ...new Set(
      candidates.flatMap(({ parts }) => parts.map(part => part.scope))
    ),
  ].sort(compareCodeUnits);
  const tasks = new Map(
    await Promise.all(
      scopes.map(async scope => {
        const read = await readShippedFolder(root, scope);
        return [
          scope,
          read.problems === null && read.value.types.length > 0
            ? folderTasks(read.value, seedingRegistry)
            : [],
        ] as const;
      })
    )
  );
  return new Set(
    candidates.flatMap(({ id, gate, parts }) => {
      const included = new Set(parts.map(part => part.scope));
      const selected = scopes
        .filter(scope => included.has(scope))
        .flatMap(scope =>
          (tasks.get(scope) ?? []).filter(task => task.gate === id)
        );
      const expected = assemblePartGates(selected).get(id);
      return expected !== undefined &&
        canonicalText(gate) === canonicalText(expected.declaration)
        ? [id]
        : [];
    })
  );
}

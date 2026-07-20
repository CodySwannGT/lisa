/** Safe read-only template ownership and conformance inspection. */
/* eslint-disable jsdoc/require-param-description, jsdoc/require-returns, max-lines -- ownership planning and exact comparators stay colocated */
import { lstat, readFile } from "node:fs/promises";
import * as fse from "fs-extra";
import path from "node:path";

import {
  PROJECT_TYPE_HIERARCHY,
  PROJECT_TYPE_ORDER,
  type CopyStrategy,
  type ProjectType,
} from "../core/config.js";
import {
  decideTemplateOwnership,
  pendingDeletionPaths,
} from "../core/template-ownership.js";
import {
  DEFAULT_PROJECT_LEARNINGS_FILE,
  resolveLegacyProjectLearningsFile,
  resolveProjectLearningsFile,
  type ProjectConfig,
} from "../core/project-config.js";
import { mergeCopyContents } from "../strategies/copy-contents.js";
import { mergeTemplateJson } from "../strategies/merge.js";
import { PackageLisaStrategy } from "../strategies/package-lisa.js";
import { TaggedMergeStrategy } from "../strategies/tagged-merge.js";
import { listFilesRecursive } from "../utils/file-operations.js";
import {
  matchesAnyPattern,
  parseIgnorePatterns,
} from "../utils/ignore-patterns.js";
import {
  diffStaleKeys,
  extractCallerJobs,
  extractDeclaredInputs,
} from "../../scripts/lib/reusable-workflow-contract.mjs";
import {
  projectPathKind,
  readProjectFile,
  readProjectJsonObject,
  readProjectText,
} from "./read-only-fs.js";

const COPY_OVERWRITE = "copy-overwrite";
const COPY_CONTENTS = "copy-contents";
const CREATE_ONLY = "create-only";
const MANAGED = "managed";
const HOOKS = "hooks";
const WORKFLOWS = "workflows";
const HARPER_APP = "harper-app";
const LISA_WORKFLOW_OWNER = "codyswanngt";
const LISA_WORKFLOW_REPO = "lisa";
const STRATEGIES: readonly CopyStrategy[] = [
  COPY_OVERWRITE,
  COPY_CONTENTS,
  CREATE_ONLY,
  "merge",
  "tagged-merge",
];
const MAX_TEMPLATE_BYTES = 1024 * 1024;
const PROJECT_LEARNINGS_SOURCE = path.join(".lisa", "PROJECT_LEARNINGS.md");

/** Template categories reported by separate deterministic findings. */
export type ManagedTemplateCategory =
  | typeof MANAGED
  | typeof HOOKS
  | typeof WORKFLOWS;

/** One applicable template after Lisa ownership filters. */
interface TemplateCandidate {
  readonly type: string;
  readonly strategy: CopyStrategy;
  readonly source: string;
  readonly destination: string;
}

/** In-memory destination after one or more factory strategy applications. */
interface ComposedDestination {
  readonly bytes: Buffer;
  readonly comparison: "bytes" | "json";
  readonly requiresExecutable: boolean;
}

/** Stale or unresolvable reusable-workflow inputs. */
export interface WorkflowInputInspection {
  readonly stale: readonly string[];
  readonly unknown: readonly string[];
}

/** Safely-detected project shape reused by health probes. */
export interface HealthProjectShape {
  readonly types: readonly ProjectType[];
  readonly packageJson: Readonly<Record<string, unknown>> | undefined;
}

/**
 * Resolve whether a caller contract is shipped by Lisa, local, or external.
 * @param owner
 * @param repo
 * @param config
 */
function workflowContractOwner(
  owner: string | null,
  repo: string | null,
  config: Readonly<Record<string, unknown>>
): "lisa" | "project" | undefined {
  if (owner === null && repo === null) return "project";
  const normalizedOwner = owner?.toLowerCase();
  const normalizedRepo = repo?.toLowerCase();
  if (
    normalizedOwner === LISA_WORKFLOW_OWNER &&
    normalizedRepo === LISA_WORKFLOW_REPO
  ) {
    return "lisa";
  }
  const github = config.github;
  if (github === null || typeof github !== "object" || Array.isArray(github)) {
    return undefined;
  }
  const configuredOwner = Reflect.get(github, "org");
  const configuredRepo = Reflect.get(github, "repo");
  return typeof configuredOwner === "string" &&
    typeof configuredRepo === "string" &&
    normalizedOwner === configuredOwner.toLowerCase() &&
    normalizedRepo === configuredRepo.toLowerCase()
    ? "project"
    : undefined;
}

/**
 * Read a safe file signal, rejecting unsafe path types.
 * @param root
 * @param relativePath
 */
async function fileSignal(
  root: string,
  relativePath: string
): Promise<boolean> {
  const kind = await projectPathKind(root, relativePath);
  if (kind === "directory") throw new Error("Project signal is not a file");
  return kind === "file";
}

/**
 * Return dependency maps from a safe package document.
 * @param packageJson
 */
function dependencyNames(
  packageJson: Readonly<Record<string, unknown>> | undefined
): readonly string[] {
  if (packageJson === undefined) return [];
  return ["dependencies", "devDependencies"].flatMap(field => {
    const value = packageJson[field];
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? Object.keys(value)
      : [];
  });
}

/**
 * Expand detected types using Lisa's canonical hierarchy and ordering.
 * @param types
 */
function expandTypes(types: ReadonlySet<ProjectType>): readonly ProjectType[] {
  const expanded = new Set([
    ...types,
    ...[...types].flatMap(type => {
      const parent = PROJECT_TYPE_HIERARCHY[type];
      return parent === undefined ? [] : [parent];
    }),
  ]);
  return PROJECT_TYPE_ORDER.filter(type => expanded.has(type));
}

/**
 * Detect project types using only confined, bounded project reads.
 * @param projectRoot - Canonical host project root
 * @returns Safe project shape
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- explicit signals keep stack detection auditable
export async function detectHealthProjectShape(
  projectRoot: string
): Promise<HealthProjectShape> {
  const packageJson = await readProjectJsonObject(projectRoot, "package.json");
  const dependencies = dependencyNames(packageJson);
  const hasDependency = (name: string): boolean => dependencies.includes(name);
  const hasPrefix = (prefix: string): boolean =>
    dependencies.some(name => name.startsWith(prefix));
  const [
    tsconfig,
    app,
    eas,
    nest,
    cdk,
    railsBin,
    railsApp,
    harperConfig,
    harperSchema,
  ] = await Promise.all([
    fileSignal(projectRoot, "tsconfig.json"),
    fileSignal(projectRoot, "app.json"),
    fileSignal(projectRoot, "eas.json"),
    fileSignal(projectRoot, "nest-cli.json"),
    fileSignal(projectRoot, "cdk.json"),
    fileSignal(projectRoot, path.join("bin", "rails")),
    fileSignal(projectRoot, path.join("config", "application.rb")),
    fileSignal(projectRoot, path.join(HARPER_APP, "config.yaml")),
    fileSignal(projectRoot, path.join(HARPER_APP, "schema.graphql")),
  ]);
  const harperText = harperConfig
    ? await readProjectText(projectRoot, path.join(HARPER_APP, "config.yaml"))
    : undefined;
  const harperSignals =
    harperText?.includes("graphqlSchema:") === true &&
    harperText.includes("jsResource:") &&
    harperText.includes("static:");
  const harper =
    harperConfig &&
    harperSchema &&
    (harperSignals || hasDependency("harperdb"));
  const publishable =
    packageJson !== undefined &&
    packageJson.private !== true &&
    ["main", "bin", "exports", "files"].some(field =>
      Object.hasOwn(packageJson, field)
    );
  const detected = new Set<ProjectType>([
    ...(tsconfig || hasDependency("typescript") ? ["typescript" as const] : []),
    ...(app || eas || hasDependency("expo") ? ["expo" as const] : []),
    ...(nest || hasPrefix("@nestjs") ? ["nestjs" as const] : []),
    ...(cdk || hasPrefix("aws-cdk") ? ["cdk" as const] : []),
    ...(harper ? ["harper-fabric" as const] : []),
    ...(hasDependency("phaser") ? ["phaser" as const] : []),
    ...(publishable ? ["npm-package" as const] : []),
    ...(railsBin || railsApp ? ["rails" as const] : []),
  ]);
  return { types: expandTypes(detected), packageJson };
}

/**
 * Backward-compatible type-only detector surface.
 * @param projectRoot
 */
export async function detectHealthProjectTypes(
  projectRoot: string
): Promise<readonly ProjectType[]> {
  return (await detectHealthProjectShape(projectRoot)).types;
}

/**
 * Normalize a template destination exactly as apply does.
 * @param relativePath
 * @param strategy
 * @param type
 * @param learningsFile
 */
function destinationFor(
  relativePath: string,
  strategy: CopyStrategy,
  type: string,
  learningsFile: string
): string {
  if (
    type === "all" &&
    strategy === CREATE_ONLY &&
    relativePath === PROJECT_LEARNINGS_SOURCE
  ) {
    return learningsFile;
  }
  if (
    strategy === COPY_CONTENTS &&
    path.basename(relativePath) === "gitignore"
  ) {
    return path.join(path.dirname(relativePath), ".gitignore");
  }
  return relativePath;
}

/**
 * Collect all trusted template candidates.
 * @param lisaRoot
 * @param types
 * @param learningsFile
 */
async function collectCandidates(
  lisaRoot: string,
  types: readonly ProjectType[],
  learningsFile: string
): Promise<readonly TemplateCandidate[]> {
  const groups = await Promise.all(
    ["all", ...types].flatMap(type =>
      STRATEGIES.map(async strategy => {
        const directory = path.join(lisaRoot, type, strategy);
        if (!(await fse.pathExists(directory))) return [];
        return (await listFilesRecursive(directory)).map(source => {
          const relativePath = path.relative(directory, source);
          return {
            type,
            strategy,
            source,
            destination: destinationFor(
              relativePath,
              strategy,
              type,
              learningsFile
            ),
          } satisfies TemplateCandidate;
        });
      })
    )
  );
  return groups.flat();
}

/**
 * Resolve most-specific path ownership for one strategy.
 * @param candidates
 * @param strategy
 */
function owners(
  candidates: readonly TemplateCandidate[],
  strategy: CopyStrategy
): ReadonlyMap<string, string> {
  return new Map(
    candidates
      .filter(candidate => candidate.strategy === strategy)
      .map(candidate => [candidate.destination, candidate.type] as const)
  );
}

/**
 * Read pending deletion paths from trusted Lisa manifests.
 * @param lisaRoot
 * @param types
 */
async function pendingDeletions(
  lisaRoot: string,
  types: readonly ProjectType[]
): Promise<ReadonlySet<string>> {
  const all = await Promise.all(
    ["all", ...types].map(async type => {
      try {
        const parsed = JSON.parse(
          await readFile(path.join(lisaRoot, type, "deletions.json"), "utf8")
        ) as unknown;
        return pendingDeletionPaths(parsed).map(item => path.normalize(item));
      } catch {
        return [];
      }
    })
  );
  return new Set(all.flat());
}

/**
 * Build the exact applicable template plan without touching the host.
 * @param lisaRoot
 * @param projectRoot
 * @param types
 * @param config
 */
async function applicableCandidates(
  lisaRoot: string,
  projectRoot: string,
  types: readonly ProjectType[],
  config: Readonly<Record<string, unknown>>
): Promise<readonly TemplateCandidate[]> {
  const projectConfig = config as ProjectConfig;
  const learningsFile = path.normalize(
    resolveProjectLearningsFile(projectConfig)
  );
  const candidates = await collectCandidates(lisaRoot, types, learningsFile);
  const createOwners = owners(candidates, CREATE_ONLY);
  const overwriteOwners = owners(candidates, COPY_OVERWRITE);
  const deletions = await pendingDeletions(lisaRoot, types);
  const ignoreText = await readProjectText(projectRoot, ".lisaignore");
  const ignorePatterns = parseIgnorePatterns(ignoreText ?? "");
  const canonicalLearning = candidates.some(
    candidate =>
      candidate.type === "all" &&
      candidate.strategy === CREATE_ONLY &&
      candidate.destination === learningsFile
  );
  const legacyFile = path.normalize(
    resolveLegacyProjectLearningsFile(projectConfig)
  );
  const suppressLearning =
    canonicalLearning &&
    legacyFile !== learningsFile &&
    (await projectPathKind(projectRoot, legacyFile)) === "file" &&
    (await projectPathKind(projectRoot, learningsFile)) === "missing";
  const orderedTypes = ["all", ...types];
  return candidates.filter(
    candidate =>
      decideTemplateOwnership({
        relativePath: candidate.destination,
        strategy: candidate.strategy,
        currentType: candidate.type,
        orderedTypes,
        ignored: matchesAnyPattern(candidate.destination, ignorePatterns),
        pendingDeletion: deletions.has(path.normalize(candidate.destination)),
        projectLearningsPath: canonicalLearning ? learningsFile : undefined,
        suppressLearningsSeed: suppressLearning,
        createOnlyOwner: createOwners.get(candidate.destination),
        copyOverwriteOwner: overwriteOwners.get(candidate.destination),
      }).process
  );
}

/**
 * Classify a template destination into its health finding.
 * @param relativePath
 */
function categoryFor(relativePath: string): ManagedTemplateCategory {
  const normalized = relativePath.split(path.sep).join("/");
  if (normalized === "lefthook.yml" || normalized.startsWith(".husky/")) {
    return HOOKS;
  }
  if (normalized.startsWith(".github/workflows/")) return WORKFLOWS;
  return MANAGED;
}

/**
 * Decode trusted or safely captured bytes as strict UTF-8.
 * @param bytes
 */
function decode(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

/**
 * Canonicalize JSON object key order while preserving array order.
 * @param value
 */
function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalJson(item)])
    );
  }
  return value;
}

/**
 * Apply one candidate to an in-memory destination in factory order.
 * @param current
 * @param candidate
 */
async function composeCandidate(
  current: ComposedDestination,
  candidate: TemplateCandidate
): Promise<ComposedDestination> {
  const sourceStat = await lstat(candidate.source);
  if (!sourceStat.isFile() || sourceStat.size > MAX_TEMPLATE_BYTES) {
    throw new Error("Unsafe health template source");
  }
  const source = await readFile(candidate.source);
  const executable =
    current.requiresExecutable || (sourceStat.mode & 0o100) !== 0;
  if (candidate.strategy === COPY_OVERWRITE) {
    return {
      bytes: source,
      comparison: "bytes",
      requiresExecutable: executable,
    };
  }
  if (candidate.strategy === COPY_CONTENTS) {
    return {
      bytes: Buffer.from(
        mergeCopyContents(decode(source), decode(current.bytes))
      ),
      comparison: "bytes",
      requiresExecutable: executable,
    };
  }
  const sourceJson = JSON.parse(decode(source)) as Record<string, unknown>;
  const targetJson = JSON.parse(decode(current.bytes)) as Record<
    string,
    unknown
  >;
  const merged =
    candidate.strategy === "merge"
      ? mergeTemplateJson(sourceJson, targetJson)
      : new TaggedMergeStrategy().mergeJson(sourceJson, targetJson);
  return {
    bytes: Buffer.from(JSON.stringify(merged, null, 2)),
    comparison: "json",
    requiresExecutable: executable,
  };
}

/**
 * Compare one final composed destination against its captured host state.
 * @param projectRoot
 * @param candidates
 */
async function destinationConforms(
  projectRoot: string,
  candidates: readonly TemplateCandidate[]
): Promise<boolean> {
  const first = candidates[0];
  if (first === undefined) return true;
  const target = await readProjectFile(projectRoot, first.destination);
  if (target === undefined) return false;
  const initial: ComposedDestination = {
    bytes: target.bytes,
    comparison: "bytes",
    requiresExecutable: false,
  };
  const planned = await candidates.reduce<Promise<ComposedDestination>>(
    async (state, candidate) => composeCandidate(await state, candidate),
    Promise.resolve(initial)
  );
  const normalizedDestination = first.destination.split(path.sep).join("/");
  if (
    normalizedDestination.startsWith(".husky/") &&
    planned.requiresExecutable &&
    (target.mode & 0o100) === 0
  ) {
    return false;
  }
  if (planned.comparison === "bytes") return planned.bytes.equals(target.bytes);
  return (
    JSON.stringify(canonicalJson(JSON.parse(decode(planned.bytes)))) ===
    JSON.stringify(canonicalJson(JSON.parse(decode(target.bytes))))
  );
}

/**
 * Inspect one category using Lisa's shared ownership and pure comparators.
 * @param lisaRoot - Lisa package root
 * @param projectRoot - Canonical host root
 * @param types - Canonically ordered types
 * @param category - Health category
 * @param config - Safe project config
 * @returns Sorted project-relative drift paths
 */
export async function inspectManagedTemplates(
  lisaRoot: string,
  projectRoot: string,
  types: readonly ProjectType[],
  category: ManagedTemplateCategory,
  config: Readonly<Record<string, unknown>> = {}
): Promise<readonly string[]> {
  const candidates = (
    await applicableCandidates(lisaRoot, projectRoot, types, config)
  ).filter(
    candidate =>
      candidate.strategy !== CREATE_ONLY &&
      categoryFor(candidate.destination) === category
  );
  const destinations = [...new Set(candidates.map(item => item.destination))];
  const checks = await Promise.all(
    destinations.map(async destination => ({
      destination,
      conforms: await destinationConforms(
        projectRoot,
        candidates.filter(candidate => candidate.destination === destination)
      ).catch(() => false),
    }))
  );
  return [
    ...new Set(
      checks
        .filter(check => !check.conforms)
        .map(check => check.destination.split(path.sep).join("/"))
    ),
  ].sort((left, right) => left.localeCompare(right));
}

/**
 * Require applicable create-only workflow presence while preserving bytes.
 * @param lisaRoot - Lisa package root
 * @param projectRoot - Canonical host root
 * @param types - Canonically ordered types
 * @param config - Safe project config
 * @returns Missing workflow paths
 */
export async function inspectCreateOnlyWorkflows(
  lisaRoot: string,
  projectRoot: string,
  types: readonly ProjectType[],
  config: Readonly<Record<string, unknown>> = {}
): Promise<readonly string[]> {
  const candidates = (
    await applicableCandidates(lisaRoot, projectRoot, types, config)
  ).filter(
    candidate =>
      candidate.strategy === CREATE_ONLY &&
      categoryFor(candidate.destination) === WORKFLOWS
  );
  const missing = await Promise.all(
    candidates.map(async candidate =>
      (await projectPathKind(projectRoot, candidate.destination)) === "file"
        ? undefined
        : candidate.destination.split(path.sep).join("/")
    )
  );
  return missing
    .filter((item): item is string => item !== undefined)
    .sort((left, right) => left.localeCompare(right));
}

/**
 * Inspect applicable create-only workflow caller inputs against shipped contracts.
 * @param lisaRoot - Lisa package root
 * @param projectRoot - Canonical host root
 * @param types - Canonically ordered types
 * @param config - Safe project config
 * @returns Stale and unknown caller descriptions
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- parser outcomes remain explicit and bounded
export async function inspectWorkflowInputs(
  lisaRoot: string,
  projectRoot: string,
  types: readonly ProjectType[],
  config: Readonly<Record<string, unknown>> = {}
): Promise<WorkflowInputInspection> {
  const candidates = (
    await applicableCandidates(lisaRoot, projectRoot, types, config)
  ).filter(candidate => categoryFor(candidate.destination) === WORKFLOWS);
  const stale: string[] = [];
  const unknown: string[] = [];
  for (const candidate of candidates) {
    const caller = await readProjectText(projectRoot, candidate.destination);
    if (caller === undefined) continue;
    for (const job of extractCallerJobs(caller)) {
      const label = `${candidate.destination.split(path.sep).join("/")}#${job.reusableFile}`;
      const contractOwner = workflowContractOwner(job.owner, job.repo, config);
      if (contractOwner === undefined) {
        // eslint-disable-next-line functional/immutable-data -- bounded local result collector
        unknown.push(label);
        continue;
      }
      const declared =
        contractOwner === "lisa"
          ? await readFile(
              path.join(
                lisaRoot,
                ".github",
                WORKFLOWS,
                path.basename(job.reusableFile)
              ),
              "utf8"
            )
              .then(content => extractDeclaredInputs(content))
              .catch(() => null)
          : await readProjectText(
              projectRoot,
              path.join(".github", WORKFLOWS, job.reusableFile)
            )
              .then(content =>
                content === undefined ? null : extractDeclaredInputs(content)
              )
              .catch(() => null);
      if (declared === null) {
        // eslint-disable-next-line functional/immutable-data -- bounded local result collector
        unknown.push(label);
        continue;
      }
      for (const key of diffStaleKeys(job.withKeys, declared)) {
        // eslint-disable-next-line functional/immutable-data -- bounded local result collector
        stale.push(`${label}:${key}`);
      }
    }
  }
  return {
    stale: [...new Set(stale)].sort((left, right) => left.localeCompare(right)),
    unknown: [...new Set(unknown)].sort((left, right) =>
      left.localeCompare(right)
    ),
  };
}

/**
 * Inspect package.json through the exact pure package-lisa planner.
 * @param lisaRoot - Lisa package root
 * @param projectRoot - Canonical host root
 * @param types - Safely detected project types
 * @param packageJson - Safely captured package document
 * @returns Whether package.json conforms
 */
export async function packageJsonConforms(
  lisaRoot: string,
  projectRoot: string,
  types?: readonly ProjectType[],
  packageJson?: Readonly<Record<string, unknown>>
): Promise<boolean> {
  const safePackage =
    packageJson ?? (await readProjectJsonObject(projectRoot, "package.json"));
  if (safePackage === undefined) return false;
  const safeTypes = types ?? (await detectHealthProjectTypes(projectRoot));
  const planned = await new PackageLisaStrategy().planPackageJson(
    { ...safePackage },
    safeTypes,
    lisaRoot
  );
  return (
    JSON.stringify(planned, null, 2) === JSON.stringify(safePackage, null, 2)
  );
}

export { DEFAULT_PROJECT_LEARNINGS_FILE };
/* eslint-enable jsdoc/require-param-description, jsdoc/require-returns, max-lines -- restore repository defaults */

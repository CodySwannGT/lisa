/**
 * The exact applicable template plan for a host project, resolved with Lisa's
 * shared ownership rules and without touching the host.
 * @module health/template-plan
 */
import { readFile } from "node:fs/promises";
import * as fse from "fs-extra";
import path from "node:path";

import type { CopyStrategy, ProjectType } from "../core/config.js";
import {
  resolveLegacyProjectLearningsFile,
  resolveProjectLearningsFile,
  type ProjectConfig,
} from "../core/project-config.js";
import {
  decideTemplateOwnership,
  pendingDeletionPaths,
} from "../core/template-ownership.js";
import { listFilesRecursive } from "../utils/file-operations.js";
import {
  matchesAnyPattern,
  parseIgnorePatterns,
} from "../utils/ignore-patterns.js";
import { projectPathKind, readProjectText } from "./read-only-fs.js";

export const COPY_OVERWRITE = "copy-overwrite";
export const COPY_CONTENTS = "copy-contents";
export const CREATE_ONLY = "create-only";
const MANAGED = "managed";
const HOOKS = "hooks";
export const WORKFLOWS = "workflows";
const STRATEGIES: readonly CopyStrategy[] = [
  COPY_OVERWRITE,
  COPY_CONTENTS,
  CREATE_ONLY,
  "merge",
  "tagged-merge",
];
const PROJECT_LEARNINGS_SOURCE = path.join(".lisa", "PROJECT_LEARNINGS.md");

/** Template categories reported by separate deterministic findings. */
export type ManagedTemplateCategory =
  | typeof MANAGED
  | typeof HOOKS
  | typeof WORKFLOWS;

/** One applicable template after Lisa ownership filters. */
export interface TemplateCandidate {
  readonly type: string;
  readonly strategy: CopyStrategy;
  readonly source: string;
  readonly destination: string;
}

/**
 * Normalize a template destination exactly as apply does.
 * @param relativePath - Project-relative path
 * @param strategy - Copy strategy the template ships under
 * @param type - Template type directory (`all` or a stack)
 * @param learningsFile - Configured project-learnings ledger path, if overridden
 * @returns The destination path apply writes
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
 * @param lisaRoot - Lisa package root holding the shipped templates
 * @param types - Detected project stack types
 * @param learningsFile - Configured project-learnings ledger path, if overridden
 * @returns Every shipped template with its destination
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
 * @param candidates - Every template candidate
 * @param strategy - Strategy whose ownership to resolve
 * @returns The owning type for each destination
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
 * @param lisaRoot - Lisa package root holding the shipped templates
 * @param types - Detected project stack types
 * @returns Normalized paths awaiting deletion
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
 * @param lisaRoot - Lisa package root holding the shipped templates
 * @param projectRoot - Canonical host project root
 * @param types - Detected project stack types
 * @param config - Safe project config
 * @returns The templates apply would process
 */
export async function applicableCandidates(
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
 * @param relativePath - Project-relative path
 * @returns The category whose finding reports the path
 */
export function categoryFor(relativePath: string): ManagedTemplateCategory {
  const normalized = relativePath.split(path.sep).join("/");
  if (normalized === "lefthook.yml" || normalized.startsWith(".husky/")) {
    return HOOKS;
  }
  if (normalized.startsWith(".github/workflows/")) return WORKFLOWS;
  return MANAGED;
}

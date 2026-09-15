import type { StarterTemplate } from "../core/project-config-starter.js";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { validateProjectConfig } from "../core/project-config.js";
import {
  readProjectFile,
  type ProjectFileSnapshot,
} from "../health/read-only-fs.js";
import {
  applicableCandidates,
  detectHealthProjectTypes,
  type TemplateCandidate,
} from "../health/template-inspection.js";
import { isJsonObject } from "../sync/json-path.js";
import {
  readStarterChanges,
  starterRelativePath,
  type StarterChange,
  type StarterChanges,
} from "./starter-sync-source.js";
import {
  mergeStarterBlocks,
  mergeStarterJson,
  starterBlockMarkers,
} from "./starter-sync-content.js";
import { writeStarterFile } from "./starter-sync-write.js";

const CONFIG = ".lisa.config.json";

/** Result for one independently tracked starter. */
export interface StarterSyncResult {
  readonly repo: string;
  readonly state: "updated" | "current" | "failed";
  readonly changed: readonly string[];
  readonly error?: string;
}

/** The caller supplies the isolated landing worktree; this is not a CLI default. */
export interface StarterSyncOptions {
  readonly lisaRoot: string;
  readonly projectRoot: string;
  readonly readChanges?: (
    template: StarterTemplate,
    accepts: (name: string) => boolean
  ) => Promise<StarterChanges>;
}

/**
 * Apply each starter independently using the existing template ownership rules.
 * @param options - Lisa installation and caller-owned landing worktree.
 * @returns Per-template outcomes, preserving failed baselines for retries.
 */
export async function syncStarterTemplates(
  options: StarterSyncOptions
): Promise<readonly StarterSyncResult[]> {
  const root = await realpath(options.projectRoot);
  const document = await readConfig(root);
  const templates = document.config.starter?.templates ?? [];
  const candidates = await applicableCandidates(
    options.lisaRoot,
    root,
    await detectHealthProjectTypes(root),
    document.raw
  );
  return templates.reduce<Promise<readonly StarterSyncResult[]>>(
    async (pending, template, index) => {
      const completed = await pending;
      const result = await syncOne(
        root,
        template,
        index,
        candidates,
        options.readChanges
      );
      return [...completed, result];
    },
    Promise.resolve([])
  );
}

/**
 * Read a confined configuration while retaining every unknown extension.
 * @param root - Canonical consumer root.
 * @returns Validated settings, original fields, and the guarded file snapshot.
 */
async function readConfig(root: string) {
  const snapshot = await readProjectFile(root, CONFIG);
  const raw: unknown = JSON.parse(snapshot?.bytes.toString("utf8") ?? "{}");
  if (!isJsonObject(raw))
    throw new Error("Starter project config must be an object");
  return { raw, snapshot, config: validateProjectConfig(raw, CONFIG) };
}

/**
 * Compare a scoped path using the same portable validation as the source reader.
 * @param name - Repository path.
 * @param scopes - Optional validated path restrictions.
 * @returns Whether the file is included.
 */
function inScope(name: string, scopes: readonly string[] | undefined): boolean {
  return (
    scopes === undefined ||
    scopes.some(scope => name === scope || name.startsWith(`${scope}/`))
  );
}

/**
 * Apply one independent source without letting its failure stop later templates.
 * @param root - Canonical landing worktree.
 * @param template - Original independently tracked entry.
 * @param index - Stable position in the recorded template list.
 * @param candidates - Existing canonical ownership plan.
 * @param reader - Optional real-source adapter for the caller.
 * @returns Applied paths and success, current, or retryable failure.
 */
async function syncOne(
  root: string,
  template: StarterTemplate,
  index: number,
  candidates: readonly TemplateCandidate[],
  reader: StarterSyncOptions["readChanges"]
): Promise<StarterSyncResult> {
  const initial: StarterSyncResult = {
    repo: template.repo,
    state: "updated",
    changed: [],
  };
  try {
    const scopes = template.paths?.map(starterRelativePath);
    const names = new Set(
      candidates.map(candidate =>
        candidate.destination.split(path.sep).join("/")
      )
    );
    const accepts = (name: string): boolean =>
      name !== CONFIG &&
      name !== ".lisa.workspaces.json" &&
      names.has(name) &&
      inScope(name, scopes);
    const source = await (
      reader ??
      ((entry, filter) => readStarterChanges(entry, undefined, filter))
    )(template, accepts);
    if (source.sha === template.lastSync.sha)
      return { ...initial, state: "current" };
    const result = await source.changes
      .filter(change => accepts(change.path))
      .reduce<Promise<StarterSyncResult>>(async (pending, change) => {
        const prior = await pending;
        if (prior.state === "failed") return prior;
        try {
          const changed = await applyChange(
            root,
            change,
            candidates.filter(
              candidate =>
                candidate.destination.split(path.sep).join("/") === change.path
            )
          );
          return changed
            ? { ...prior, changed: [...prior.changed, change.path] }
            : prior;
        } catch (error) {
          return failure(prior, error);
        }
      }, Promise.resolve(initial));
    if (result.state === "failed") return result;
    try {
      await advance(root, template, index, source.sha);
      return result;
    } catch (error) {
      return failure(result, error);
    }
  } catch (error) {
    return failure(initial, error);
  }
}

/**
 * Preserve partial-apply evidence when an operation needs to be retried.
 * @param result - Paths already applied.
 * @param error - Refusal from the source, filesystem, or config writer.
 * @returns Failed result without falsely claiming that nothing changed.
 */
function failure(result: StarterSyncResult, error: unknown): StarterSyncResult {
  return {
    ...result,
    state: "failed",
    error: error instanceof Error ? error.message : String(error),
  };
}

/**
 * Respect existing ownership and refuse local conflicts in governed files.
 * @param root - Canonical consumer root.
 * @param change - Pinned starter change.
 * @param candidates - Applicable strategies for exactly this path.
 * @returns Whether consumer bytes or executable mode changed.
 */
async function applyChange(
  root: string,
  change: StarterChange,
  candidates: readonly TemplateCandidate[]
): Promise<boolean> {
  const name = starterRelativePath(change.path);
  const current = await readProjectFile(root, name);
  const writable = candidates.filter(
    candidate => candidate.strategy !== "create-only"
  );
  if (
    writable.length === 0 &&
    candidates.some(candidate => candidate.strategy === "create-only")
  ) {
    if (current !== undefined || change.after === undefined) return false;
  } else if (
    !candidates.some(candidate =>
      ["copy-overwrite", "copy-contents", "merge", "tagged-merge"].includes(
        candidate.strategy
      )
    )
  ) {
    throw new Error(
      `Starter change requires its existing merge strategy: ${name}`
    );
  }
  if (
    [change.before?.mode, change.after?.mode].some(
      mode => mode !== undefined && !["100644", "100755"].includes(mode)
    )
  )
    throw new Error(`Starter change is not a regular file: ${name}`);
  const blocks = await starterBlockMarkers(
    candidates.filter(candidate => candidate.strategy === "copy-contents")
  );
  const json = candidates.filter(candidate =>
    ["merge", "tagged-merge"].includes(candidate.strategy)
  );
  const bytes = await desiredBytes(change, current?.bytes, blocks, json);
  const partial = blocks.length > 0 || json.length > 0;
  const mode = destinationMode(current, change, partial);
  if (sameDestination(current, bytes, mode)) return false;
  if (
    !partial &&
    current !== undefined &&
    !current.bytes.equals(change.before?.bytes ?? Buffer.alloc(0))
  )
    throw new Error(`Starter change conflicts with local changes: ${name}`);
  await writeStarterFile(root, name, current, bytes, mode);
  return true;
}

/**
 * Select the existing content strategy without inventing starter ownership rules.
 * @param change - Pinned starter change.
 * @param current - Existing consumer bytes.
 * @param blocks - Applicable managed-block templates.
 * @param json - Applicable JSON templates.
 * @returns Desired file bytes, or undefined for whole-file removal.
 */
async function desiredBytes(
  change: StarterChange,
  current: Buffer | undefined,
  blocks: readonly string[],
  json: readonly TemplateCandidate[]
): Promise<Buffer | undefined> {
  if (blocks.length > 0) return mergeStarterBlocks(change, current, blocks);
  if (json.length > 0) return mergeStarterJson(change, current, json);
  return change.after?.bytes;
}

/**
 * Preserve consumer permissions outside the part governed by the strategy.
 * @param current - Existing file snapshot.
 * @param change - Source mode and contents.
 * @param managed - Whether only content blocks belong to Lisa.
 * @returns Permission bits for the new file.
 */
function destinationMode(
  current: ProjectFileSnapshot | undefined,
  change: StarterChange,
  managed: boolean
): number {
  if (managed && current !== undefined) return current.mode & 0o777;
  return (
    ((current?.mode ?? 0o644) & 0o666) |
    (change.after?.mode === "100755" ? 0o111 : 0)
  );
}

/**
 * Recognize an already applied file after an interrupted template sync.
 * @param current - Existing consumer snapshot.
 * @param bytes - Desired bytes, or an absent file.
 * @param mode - Desired permission bits.
 * @returns Whether another write would change nothing.
 */
function sameDestination(
  current: ProjectFileSnapshot | undefined,
  bytes: Buffer | undefined,
  mode: number
): boolean {
  if (bytes === undefined) return current === undefined;
  return (
    current !== undefined &&
    current.bytes.equals(bytes) &&
    (current.mode & 0o777) === mode
  );
}

/**
 * Advance only after apply succeeds, preserving concurrent unrelated config edits.
 * @param root - Canonical consumer root.
 * @param template - Entry as it existed when this sync started.
 * @param index - Entry position, verified again before publication.
 * @param sha - Exact successfully applied source revision.
 */
async function advance(
  root: string,
  template: StarterTemplate,
  index: number,
  sha: string
): Promise<void> {
  const document = await readConfig(root);
  const starter = document.config.starter;
  const templates = starter?.templates ?? [];
  if (JSON.stringify(templates[index]) !== JSON.stringify(template))
    throw new Error(
      "Starter configuration changed during sync; baseline was not advanced"
    );
  const updated = templates.map((entry, at) =>
    at === index
      ? {
          ...entry,
          lastSync: { ...entry.lastSync, sha, at: new Date().toISOString() },
        }
      : entry
  );
  const bytes = Buffer.from(
    `${JSON.stringify({ ...document.raw, starter: { ...starter, templates: updated } }, null, 2)}\n`
  );
  await writeStarterFile(
    root,
    CONFIG,
    document.snapshot,
    bytes,
    (document.snapshot?.mode ?? 0o644) & 0o777
  );
}

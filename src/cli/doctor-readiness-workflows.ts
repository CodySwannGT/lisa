/**
 * Offline GitHub Actions workflow parser for the readiness producers
 * (PRD #1739, #1896).
 *
 * The delivery/authority readiness questions — does the thing that ships equal
 * the thing that was validated, and does the shipping credential carry only the
 * authority it needs — are answered from what the repository's CI *declares*,
 * not from what a live API reports. Parsing is therefore deliberately offline by
 * construction: nothing in this module reaches the network, so `lisa doctor
 * --offline --readiness` needs no flag threading to stay honest.
 *
 * Reading is best-effort by design. A workflow file that cannot be parsed is
 * skipped rather than aborting the readiness run, because one malformed YAML
 * file must not turn the whole report into an error the operator cannot act on.
 * @module cli/doctor-readiness-workflows
 */
import { readdir, readFile } from "node:fs/promises";
import * as path from "node:path";
import yaml from "js-yaml";
import { isJsonObject } from "../sync/json-path.js";

/** The workflows directory every GitHub repository declares its CI in. */
const WORKFLOWS_DIR = path.join(".github", "workflows");

/**
 * A `permissions`/`secrets` declaration: GitHub allows either a map of scopes
 * or a bare scalar (`write-all`, `read-all`, `inherit`); `null` means the block
 * was not declared at all, which is itself load-bearing evidence.
 */
export type WorkflowBlock = Record<string, unknown> | string | null;

/** One step inside a parsed workflow job. */
export interface ParsedWorkflowStep {
  readonly name: string;
  /** The shell command the step runs, or `""` for an action step. */
  readonly run: string;
  /** The action the step uses, or `""` for a `run` step. */
  readonly uses: string;
  /** Raw serialized `env` + `with` text, used for credential evidence. */
  readonly inputs: string;
}

/** One job inside a parsed workflow. */
export interface ParsedWorkflowJob {
  readonly id: string;
  /** Repo-relative path of the workflow file declaring this job. */
  readonly workflow: string;
  readonly needs: readonly string[];
  readonly steps: readonly ParsedWorkflowStep[];
  /** The reusable workflow this job calls, or `""` when it runs steps. */
  readonly uses: string;
  /** Job-level `permissions`: a map, a scalar such as `write-all`, or null. */
  readonly permissions: WorkflowBlock;
  /** Job-level `secrets`: a map, the scalar `inherit`, or null. */
  readonly secrets: WorkflowBlock;
  /** Declared deployment environments (a scalar or list, normalized). */
  readonly environment: readonly string[];
}

/** One parsed `.github/workflows/*.yml` file. */
export interface ParsedWorkflow {
  /** Repo-relative path, always with forward slashes. */
  readonly file: string;
  readonly name: string;
  /** Workflow-level `permissions`: a map, a scalar, or null. */
  readonly permissions: WorkflowBlock;
  readonly jobs: readonly ParsedWorkflowJob[];
}

/**
 * Normalize a YAML scalar-or-list into a list of trimmed strings.
 * @param value - Candidate YAML value
 * @returns Normalized string list (empty when unreadable)
 */
function asStringList(value: unknown): readonly string[] {
  if (typeof value === "string") {
    return value.trim() === "" ? [] : [value.trim()];
  }
  if (Array.isArray(value)) {
    return value
      .filter((entry): entry is string => typeof entry === "string")
      .map(entry => entry.trim())
      .filter(entry => entry !== "");
  }
  return [];
}

/**
 * Normalize a `permissions`/`secrets` block, which GitHub allows as either a
 * map or a bare scalar (`write-all`, `read-all`, `inherit`).
 * @param value - Candidate YAML value
 * @returns The map, the scalar string, or null when absent
 */
function asBlock(value: unknown): WorkflowBlock {
  if (typeof value === "string") {
    return value.trim();
  }
  return isJsonObject(value) ? (value as Record<string, unknown>) : null;
}

/**
 * Normalize a job's `environment`, which may be a scalar name, a list, or a
 * `{ name, url }` map.
 * @param value - Candidate YAML value
 * @returns Declared environment names
 */
function asEnvironments(value: unknown): readonly string[] {
  if (isJsonObject(value)) {
    return typeof value.name === "string" ? [value.name.trim()] : [];
  }
  return asStringList(value);
}

/**
 * Serialize a step's `env` and `with` blocks to searchable text so credential
 * evidence can quote the offending line without a second traversal.
 * @param step - The raw step object
 * @returns Flattened `key: value` text, one pair per line
 */
function serializeStepInputs(step: Record<string, unknown>): string {
  return ["env", "with"]
    .flatMap(key => {
      const block = step[key];
      return isJsonObject(block) ? Object.entries(block) : [];
    })
    .map(
      ([name, value]) =>
        `${name}: ${typeof value === "string" ? value : String(value)}`
    )
    .join("\n");
}

/**
 * Parse one job's `steps` list.
 * @param value - Candidate YAML `steps` value
 * @returns Normalized steps
 */
function parseSteps(value: unknown): readonly ParsedWorkflowStep[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isJsonObject).map(step => ({
    name: typeof step.name === "string" ? step.name : "",
    run: typeof step.run === "string" ? step.run.trim() : "",
    uses: typeof step.uses === "string" ? step.uses.trim() : "",
    inputs: serializeStepInputs(step as Record<string, unknown>),
  }));
}

/**
 * Parse the `jobs` map of one workflow document.
 * @param document - Parsed workflow root
 * @param file - Repo-relative workflow path (stamped on each job)
 * @returns Normalized jobs, in declaration order
 */
function parseJobs(
  document: Record<string, unknown>,
  file: string
): readonly ParsedWorkflowJob[] {
  const jobs = document.jobs;
  if (!isJsonObject(jobs)) {
    return [];
  }
  return Object.entries(jobs).flatMap(([id, raw]) => {
    if (!isJsonObject(raw)) {
      return [];
    }
    const job = raw as Record<string, unknown>;
    return [
      {
        id,
        workflow: file,
        needs: asStringList(job.needs),
        steps: parseSteps(job.steps),
        uses: typeof job.uses === "string" ? job.uses.trim() : "",
        permissions: asBlock(job.permissions),
        secrets: asBlock(job.secrets),
        environment: asEnvironments(job.environment),
      },
    ];
  });
}

/**
 * List the workflow files a repository declares, in stable name order.
 * @param root - Repository root
 * @returns Workflow file names, or an empty list when the directory is absent
 */
async function listWorkflowFiles(root: string): Promise<readonly string[]> {
  try {
    const entries = await readdir(path.join(root, WORKFLOWS_DIR));
    return entries
      .filter(entry => entry.endsWith(".yml") || entry.endsWith(".yaml"))
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

/**
 * Parse one workflow file, returning null when it cannot be read or parsed.
 * @param root - Repository root
 * @param fileName - Workflow file name
 * @returns The parsed workflow, or null
 */
async function parseOneWorkflow(
  root: string,
  fileName: string
): Promise<ParsedWorkflow | null> {
  const file = `${WORKFLOWS_DIR.split(path.sep).join("/")}/${fileName}`;
  try {
    const source = await readFile(
      path.join(root, WORKFLOWS_DIR, fileName),
      "utf8"
    );
    const document: unknown = yaml.load(source);
    if (!isJsonObject(document)) {
      return null;
    }
    const record = document as Record<string, unknown>;
    return {
      file,
      name: typeof record.name === "string" ? record.name : fileName,
      permissions: asBlock(record.permissions),
      jobs: parseJobs(record, file),
    };
  } catch {
    // A malformed workflow is skipped, never fatal: one bad file must not turn
    // the readiness report into an error the operator cannot act on.
    return null;
  }
}

/**
 * Read and parse every `.github/workflows/*.yml` file in a repository, offline.
 * @param root - Repository root
 * @returns Parsed workflows in stable file-name order (empty when there are none)
 */
export async function parseRepositoryWorkflows(
  root: string
): Promise<readonly ParsedWorkflow[]> {
  const fileNames = await listWorkflowFiles(root);
  const parsed = await Promise.all(
    fileNames.map(async fileName => await parseOneWorkflow(root, fileName))
  );
  return parsed.filter(
    (workflow): workflow is ParsedWorkflow => workflow !== null
  );
}

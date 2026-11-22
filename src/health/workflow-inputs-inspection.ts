/**
 * Compare the inputs host workflow callers pass with the inputs the reusable
 * workflows they call actually declare.
 * @module health/workflow-inputs-inspection
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import type { ProjectType } from "../core/config.js";
import {
  diffStaleKeys,
  extractCallerJobs,
  extractDeclaredInputs,
  findUnparsedLisaCallerLines,
} from "../../scripts/lib/reusable-workflow-contract.mjs";
import { readProjectText } from "./read-only-fs.js";
import {
  applicableCandidates,
  categoryFor,
  WORKFLOWS,
} from "./template-plan.js";

const LISA_WORKFLOW_OWNER = "codyswanngt";
const LISA_WORKFLOW_REPO = "lisa";

/** Stale or unresolvable reusable-workflow inputs. */
export interface WorkflowInputInspection {
  readonly stale: readonly string[];
  readonly unknown: readonly string[];
}

/**
 * Resolve whether a caller contract is shipped by Lisa, local, or external.
 * @param owner - GitHub repository owner
 * @param repo - GitHub repository name
 * @param config - Safe project config
 * @returns Who ships the contract, or undefined for an external caller
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
 * Read a reusable workflow's declared inputs from whichever side owns it.
 * @param lisaRoot - Lisa package root
 * @param projectRoot - Canonical host root
 * @param contractOwner - Which repository ships the reusable workflow
 * @param reusableFile - Basename of the reusable workflow
 * @returns Declared input names, or null when the contract is unreadable
 */
async function declaredWorkflowInputs(
  lisaRoot: string,
  projectRoot: string,
  contractOwner: "lisa" | "project",
  reusableFile: string
): Promise<readonly string[] | null> {
  if (contractOwner === "lisa") {
    return readFile(
      path.join(lisaRoot, ".github", WORKFLOWS, path.basename(reusableFile)),
      "utf8"
    )
      .then(content => extractDeclaredInputs(content))
      .catch(() => null);
  }
  return readProjectText(
    projectRoot,
    path.join(".github", WORKFLOWS, reusableFile)
  )
    .then(content =>
      content === undefined ? null : extractDeclaredInputs(content)
    )
    .catch(() => null);
}

/**
 * Compare one caller file's reusable-workflow jobs with their contracts.
 *
 * A Lisa `uses:` line the shared parser cannot read is reported as unknown
 * rather than skipped (CodySwannGT/lisa#4641): skipping it made `ci.workflows`
 * pass on every pinned host having compared nothing.
 * @param lisaRoot - Lisa package root
 * @param projectRoot - Canonical host root
 * @param destination - Caller path relative to the host root
 * @param caller - Caller file text
 * @param config - Safe project config
 * @returns Stale and unknown caller descriptions for this file
 */
async function inspectCallerFile(
  lisaRoot: string,
  projectRoot: string,
  destination: string,
  caller: string,
  config: Readonly<Record<string, unknown>>
): Promise<WorkflowInputInspection> {
  const file = destination.split(path.sep).join("/");
  const unparsed = findUnparsedLisaCallerLines(caller).map(
    entry => `${file} line ${entry.line} (unreadable uses line)`
  );
  const jobs = await Promise.all(
    extractCallerJobs(caller).map(async job => {
      const label = `${file}#${job.reusableFile}`;
      const contractOwner = workflowContractOwner(job.owner, job.repo, config);
      const declared =
        contractOwner === undefined
          ? null
          : await declaredWorkflowInputs(
              lisaRoot,
              projectRoot,
              contractOwner,
              job.reusableFile
            );
      return declared === null
        ? { stale: [], unknown: [label] }
        : {
            stale: diffStaleKeys(job.withKeys, declared).map(
              key => `${label}:${key}`
            ),
            unknown: [],
          };
    })
  );
  return {
    stale: jobs.flatMap(job => job.stale),
    unknown: [...jobs.flatMap(job => job.unknown), ...unparsed],
  };
}

/**
 * Inspect applicable create-only workflow caller inputs against shipped contracts.
 * @param lisaRoot - Lisa package root
 * @param projectRoot - Canonical host root
 * @param types - Canonically ordered types
 * @param config - Safe project config
 * @returns Stale and unknown caller descriptions
 */
export async function inspectWorkflowInputs(
  lisaRoot: string,
  projectRoot: string,
  types: readonly ProjectType[],
  config: Readonly<Record<string, unknown>> = {}
): Promise<WorkflowInputInspection> {
  const candidates = (
    await applicableCandidates(lisaRoot, projectRoot, types, config)
  ).filter(candidate => categoryFor(candidate.destination) === WORKFLOWS);
  const files = await Promise.all(
    candidates.map(async candidate => {
      const caller = await readProjectText(projectRoot, candidate.destination);
      return caller === undefined
        ? { stale: [], unknown: [] }
        : inspectCallerFile(
            lisaRoot,
            projectRoot,
            candidate.destination,
            caller,
            config
          );
    })
  );
  const sortedUnique = (items: readonly string[]): readonly string[] =>
    [...new Set(items)].sort((left, right) => left.localeCompare(right));
  return {
    stale: sortedUnique(files.flatMap(file => file.stale)),
    unknown: sortedUnique(files.flatMap(file => file.unknown)),
  };
}

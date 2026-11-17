/**
 * Safe read-only template ownership and conformance inspection. Detection,
 * planning, composition and workflow-input comparison live in sibling modules;
 * this module keeps the category inspections and the stable import surface.
 * @module health/template-inspection
 */
import path from "node:path";

import type { ProjectType } from "../core/config.js";
import { DEFAULT_PROJECT_LEARNINGS_FILE } from "../core/project-config.js";
import { PackageLisaStrategy } from "../strategies/package-lisa.js";
import { projectPathKind, readProjectJsonObject } from "./read-only-fs.js";
import { destinationConforms } from "./template-compose.js";
import {
  applicableCandidates,
  categoryFor,
  CREATE_ONLY,
  WORKFLOWS,
  type ManagedTemplateCategory,
} from "./template-plan.js";
import { detectHealthProjectTypes } from "./template-shape.js";

export {
  applicableCandidates,
  type ManagedTemplateCategory,
  type TemplateCandidate,
} from "./template-plan.js";
export {
  detectHealthProjectShape,
  detectHealthProjectTypes,
  type HealthProjectShape,
} from "./template-shape.js";
export {
  inspectWorkflowInputs,
  type WorkflowInputInspection,
} from "./workflow-inputs-inspection.js";

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
    lisaRoot,
    false,
    projectRoot
  );
  return (
    JSON.stringify(planned, null, 2) === JSON.stringify(safePackage, null, 2)
  );
}

export { DEFAULT_PROJECT_LEARNINGS_FILE };

import { existsSync } from "node:fs";
import * as path from "node:path";
import type { ProjectType } from "../core/config.js";
import { createDetectorRegistry } from "../detection/index.js";
import type { DoctorCheck } from "./doctor.js";

const PROJECT_TYPE_CHECK = "Project type detection";

/**
 * Detect the target project type, including a wiki-only repository that owns
 * a wiki but intentionally has no software-stack marker.
 * @param targetPath - Project path to inspect
 * @returns Doctor check result
 */
export async function checkProjectType(
  targetPath: string
): Promise<DoctorCheck> {
  return (await inspectProjectType(targetPath)).check;
}

/**
 * Keep detected stack types alongside their human-readable doctor result.
 * @param targetPath - Project path to inspect
 * @returns Detected types and the existing project-type check
 */
export async function inspectProjectType(targetPath: string): Promise<{
  readonly detectedTypes: readonly ProjectType[];
  readonly check: DoctorCheck;
}> {
  const detectorRegistry = createDetectorRegistry();
  const detectedTypes = detectorRegistry.expandAndOrderTypes(
    await detectorRegistry.detectAll(targetPath)
  );
  if (detectedTypes.length > 0) {
    return {
      detectedTypes,
      check: {
        name: PROJECT_TYPE_CHECK,
        status: "ok",
        detail: detectedTypes.join(", "),
      },
    };
  }

  const check: DoctorCheck = existsSync(
    path.join(targetPath, "wiki", "lisa-wiki.config.json")
  )
    ? {
        name: PROJECT_TYPE_CHECK,
        status: "ok",
        detail: "wiki (no software stack)",
      }
    : {
        name: PROJECT_TYPE_CHECK,
        status: "warn",
        detail: "No Lisa project type detected",
      };
  return { detectedTypes, check };
}

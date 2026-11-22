import {
  inspectHookInstallation,
  readCoreHooksPath,
} from "../health/hook-inspection.js";
import { projectRegularFileExists } from "../health/read-only-fs.js";
import { RAILS_HOOK_INSTALL_COMMAND } from "../../scripts/lib/rails-hooks.mjs";
import type { DoctorCheck } from "./doctor.js";
import { inspectProjectType } from "./doctor-project-type.js";

/**
 * Check project detection and its installed hooks together.
 * @param projectRoot Host checkout
 * @returns Existing project-type result followed by applicable hook checks
 */
export async function checkProjectTypeAndHooks(
  projectRoot: string
): Promise<readonly DoctorCheck[]> {
  const projectType = await inspectProjectType(projectRoot);
  return [
    projectType.check,
    ...(projectType.detectedTypes.includes("rails")
      ? await checkGitHookInstallation(projectRoot)
      : []),
  ];
}

/**
 * Report actual Rails wrappers without installing or executing them.
 * @param projectRoot - Host checkout to inspect
 * @returns A Rails check, or no extra check for a project without Lefthook
 */
async function checkGitHookInstallation(
  projectRoot: string
): Promise<readonly DoctorCheck[]> {
  try {
    if (!(await projectRegularFileExists(projectRoot, "lefthook.yml")))
      return [];
    const inspection = await inspectHookInstallation(
      projectRoot,
      ["rails"],
      readCoreHooksPath,
      10_000,
      new AbortController().signal
    );
    return [
      {
        name: "Git hooks installed?",
        status: inspection.status === "pass" ? "ok" : inspection.status,
        detail:
          inspection.status === "pass"
            ? "All four executable Lefthook wrappers are installed."
            : `Rails hook installation: ${inspection.drift.join(", ")}. Run ${RAILS_HOOK_INSTALL_COMMAND}.`,
      },
    ];
  } catch {
    return [
      {
        name: "Git hooks installed?",
        status: "fail",
        detail: `Rails Git hooks could not be inspected. Run ${RAILS_HOOK_INSTALL_COMMAND}.`,
      },
    ];
  }
}

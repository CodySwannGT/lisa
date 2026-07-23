/** Doctor check for the optional SonarQube MCP provider. */
import { probeSonarReadiness } from "../core/sonar-integration.js";
import type { DoctorCheck } from "./doctor.js";

/** Dependencies used by the Sonar doctor check. */
export interface SonarDoctorDependencies {
  readonly probeSonarReadiness: typeof probeSonarReadiness;
}

/**
 * Check the optional SonarQube MCP provider when configured.
 * @param targetPath - Downstream project path
 * @param deps - Injectable readiness probe
 * @returns Doctor check result
 */
export async function checkSonarProvider(
  targetPath: string,
  deps: SonarDoctorDependencies
): Promise<DoctorCheck> {
  try {
    const readiness = await deps.probeSonarReadiness(targetPath);
    return {
      name: "SonarQube MCP provider ready?",
      status:
        readiness.status === "fail"
          ? "fail"
          : readiness.status === "warn"
            ? "warn"
            : "ok",
      detail: readiness.detail,
    };
  } catch (error) {
    return {
      name: "SonarQube MCP provider ready?",
      status: "fail",
      detail: `Sonar provider config could not be evaluated: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

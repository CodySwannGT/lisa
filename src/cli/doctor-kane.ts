/** Doctor check for the optional Kane empirical-browser provider. */
import { probeKaneReadiness } from "../core/kane-cli.js";
import type { DoctorCheck } from "./doctor.js";

/** Dependencies used by the Kane doctor check. */
export interface KaneDoctorDependencies {
  readonly probeKaneReadiness: typeof probeKaneReadiness;
}

/**
 * Check the optional Kane provider when configured.
 * @param targetPath - Downstream project path
 * @param deps - Injectable readiness probe
 * @returns Doctor check result
 */
export async function checkKaneProvider(
  targetPath: string,
  deps: KaneDoctorDependencies
): Promise<DoctorCheck> {
  try {
    const readiness = await deps.probeKaneReadiness(targetPath);
    return {
      name: "Kane browser provider ready?",
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
      name: "Kane browser provider ready?",
      status: "fail",
      detail: `Kane provider config could not be evaluated: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

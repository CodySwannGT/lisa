/**
 * Assemble and write one doctor result.
 *
 * A separate module because the two renderings answer different questions and
 * only one of them can carry the gate report. Human output is a line per check;
 * the machine payload additionally carries a structure whose whole contract is
 * that "not checkable here" is a distinct state, which `DoctorStatus`
 * (`ok | warn | fail`) cannot express. Keeping the split here means neither
 * rendering can quietly acquire the other's shape.
 * @module cli/doctor-render
 */
import type { DoctorCheck, DoctorOptions, DoctorResult } from "./doctor.js";
import { buildGateReport } from "./gate-report.js";

/**
 * Build the result and write it in the requested form.
 * @param checks - Every doctor check, already run
 * @param resolvedTarget - Absolute project root
 * @param options - Parsed command options
 * @param write - Output sink
 * @returns The result, for callers that consume it directly
 */
export async function renderDoctorResult(
  checks: DoctorCheck[],
  resolvedTarget: string,
  options: DoctorOptions,
  write: (message: string) => void
): Promise<DoctorResult> {
  if (options.json !== true) {
    write(
      checks
        .map(
          check =>
            `${check.status.toUpperCase()} ${check.name}: ${check.detail}`
        )
        .join("\n")
    );
    return { checks };
  }
  const result: DoctorResult = {
    checks,
    gateReport: await buildGateReport({
      projectRoot: resolvedTarget,
      offline: options.offline === true,
    }),
  };
  write(JSON.stringify(result, null, 2));
  return result;
}

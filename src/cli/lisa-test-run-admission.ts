/**
 * Headroom admission for every suite `lisa-test-run` starts (CodySwannGT/lisa#4596).
 *
 * Off unless the project's `.lisa.config.json` sets `pushGate.admission: true`;
 * then the run starts immediately exactly as before. When on, the suite asks
 * for the pool it would have sized itself to and accepts as few as
 * {@link MIN_FLEET_WORKERS}: the grant is sized to the headroom, handed to the
 * Vitest presets as `LISA_ADMITTED_WORKERS` (which `resolveMaxWorkers` reads
 * first), and released when the suite ends.
 * @module cli/lisa-test-run-admission
 */
import {
  MAX_WORKERS_OVERRIDE_VAR,
  MIN_FLEET_WORKERS,
} from "../configs/vitest/base.js";
import {
  ADMISSION_REFUSED_EXIT,
  type AdmissionRuntime,
  defaultAdmissionRuntime,
  requestAdmission,
} from "../core/admission.js";
import {
  ADMISSION_HOLDER_ENV,
  ADMITTED_WORKERS_ENV,
  admissionSwitchOn,
  resolveAdmissionSettings,
} from "../core/admission-settings.js";

/**
 * Workers this suite declares: the explicit override, else half the cores.
 * @param environment - Environment
 * @param cores - Logical cores
 * @returns Declared demand
 */
export function declaredTestWorkers(
  environment: NodeJS.ProcessEnv,
  cores: number
): number {
  const override = Number(environment[MAX_WORKERS_OVERRIDE_VAR]?.trim());
  return Number.isInteger(override) && override > 0
    ? override
    : Math.max(MIN_FLEET_WORKERS, Math.floor(cores / 2));
}

/**
 * Admit this suite, or refuse it.
 * @param argv - Payload argv, named in the reservation
 * @param environment - Environment; receives the grant when admitted
 * @param cwd - Project root holding `.lisa.config.json`
 * @param runtime - Seams; defaults to this machine
 * @returns A release function, or the exit status of a refusal
 */
export async function admitTestRun(
  argv: readonly string[],
  environment: NodeJS.ProcessEnv,
  cwd: string,
  runtime: AdmissionRuntime = defaultAdmissionRuntime()
): Promise<(() => void) | number> {
  if (!admissionSwitchOn(cwd)) return () => {};
  // The demand is sized from the same machine reading the headroom comes from,
  // so the runtime seam decides both; the host's own core count is the default
  // runtime's answer, not a second source.
  const workers = declaredTestWorkers(environment, runtime.readMachine().cores);
  const outcome = await requestAdmission(
    {
      workers,
      minimumWorkers: Math.min(workers, MIN_FLEET_WORKERS),
      command: argv.join(" "),
      cwd,
      environment,
      settings: resolveAdmissionSettings({ environment, cwd }),
    },
    runtime
  );
  if (outcome.kind === "refused") {
    runtime.log(outcome.message);
    return ADMISSION_REFUSED_EXIT;
  }
  if (outcome.kind === "skipped") return () => {};
  Object.assign(environment, {
    [ADMITTED_WORKERS_ENV]: String(outcome.granted),
    [ADMISSION_HOLDER_ENV]: String(runtime.pid),
  });
  return outcome.release;
}

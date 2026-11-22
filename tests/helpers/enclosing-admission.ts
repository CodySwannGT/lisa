/**
 * Hand a nested host run the enclosing test run's admission decision.
 *
 * Host fixtures start a fresh `lisa-test-run` or push gate and strip every
 * `LISA_*` variable so the host behaves as it does on a developer's machine.
 * That also stripped the enclosing run's reservation, so the host asked for
 * admission a second time for work its parent had already been admitted for.
 * `src/core/admission.ts` forbids exactly that for a nested run: reserving
 * again counts one unit of work twice and can deadlock parent against child.
 * Under machine load the host queued for headroom, and the spawn budget, which
 * exists to bound the host's own work, expired in the queue
 * (CodySwannGT/lisa#4938).
 *
 * So the host inherits the parent's decision. When the parent holds a
 * reservation, the host runs inside it. When the parent holds none, it was
 * skipped or switched off, and the nested work follows the same decision.
 * Nothing here touches a budget or a timeout: a host that hangs still dies by
 * name.
 * @module tests/helpers/enclosing-admission
 */
import { currentEnvironment } from "../../src/utils/process-environment.js";

import {
  ADMISSION_HOLDER_ENV,
  ADMITTED_WORKERS_ENV,
} from "../../src/core/admission-settings.js";

/** Prefix of every input a case can state to drive the host's own admission. */
const ADMISSION_INPUT_PREFIX = "LISA_ADMISSION";

/**
 * The environment that carries the enclosing run's admission into a host.
 * @param environment - The enclosing run's environment
 * @returns The parent's reservation, or the switch that says it holds none
 */
export function enclosingAdmissionEnv(
  environment: NodeJS.ProcessEnv = currentEnvironment()
): Record<string, string> {
  const holder = environment[ADMISSION_HOLDER_ENV];
  const workers = environment[ADMITTED_WORKERS_ENV];
  if (holder !== undefined && holder !== "" && workers !== undefined) {
    return { [ADMISSION_HOLDER_ENV]: holder, [ADMITTED_WORKERS_ENV]: workers };
  }
  return { LISA_ADMISSION: "off" };
}

/**
 * Whether a case states its own admission inputs, such as a fake busy
 * machine. Such a case is testing the host's admission, so it must not
 * inherit the parent's: a nested run skips admission entirely.
 * @param extra - The case's additional environment
 * @returns True when any key drives admission
 */
export function statesOwnAdmission(
  extra: Readonly<Record<string, string>>
): boolean {
  return Object.keys(extra).some(key => key.startsWith(ADMISSION_INPUT_PREFIX));
}

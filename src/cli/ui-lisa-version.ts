/**
 * Live-status probe for the console top-bar Lisa version chip.
 *
 * Reuses doctor `checkVersion` so `/api/status` and `lisa doctor` cannot drift.
 * @module cli/ui-lisa-version
 */
import {
  checkVersion,
  type DoctorCheck,
  type DoctorDependencies,
} from "./doctor.js";
import { runUpdateCheck } from "./update-check.js";
import type { JsonValue } from "../sync/json-path.js";
import type { ProbeResult, StatusProbe } from "./ui-status.js";

/** Structured value emitted by the lisa-version live-status probe. */
export type LisaVersionValue = {
  readonly [key: string]: JsonValue;
  readonly current: string;
  readonly latest: string;
  readonly outdated: boolean;
};

const LISA_VERSION_PROBE_ID = "lisa-version";
const INSTALLED_LATEST_DETAIL = /^Installed (.+); latest is (.+)$/u;
const LATEST_UNAVAILABLE_DETAIL = /^Latest version unavailable(?: \((.+)\))?$/u;
const OFFLINE_SKIP_DETAIL = "Skipped network check in offline mode";
const UNRECOGNIZED_MESSAGE = "Version check returned an unrecognized result";

/**
 * Default collaborator for the shared doctor version check.
 */
const DEFAULT_VERSION_PROBE_DEPS: Pick<DoctorDependencies, "runUpdateCheck"> = {
  runUpdateCheck,
};

/**
 * Map a `checkVersion` doctor result onto the live-status tri-state contract.
 *
 * Doctor's offline skip returns status "ok" — that must become unknown here so
 * the top bar never shows a false green when latest was never fetched.
 * Latest-unavailable is also doctor "warn"; surface it as unknown, not amber.
 * @param check - Result from the shared doctor version check
 * @returns Probe result for `#healthChip`
 */
export function mapLisaVersionCheck(
  check: DoctorCheck
): ProbeResult<LisaVersionValue> {
  if (check.detail === OFFLINE_SKIP_DETAIL) {
    return {
      state: "unknown",
      reason: "offline-skipped",
      message: check.detail,
    };
  }
  const unavailable = LATEST_UNAVAILABLE_DETAIL.exec(check.detail);
  if (unavailable !== null) {
    return {
      state: "unknown",
      reason: unavailable[1] ?? "latest-unavailable",
      message: check.detail,
    };
  }
  const installed = INSTALLED_LATEST_DETAIL.exec(check.detail);
  if (
    installed !== null &&
    (check.status === "ok" || check.status === "warn")
  ) {
    return {
      state: "value",
      value: {
        current: installed[1] ?? "",
        latest: installed[2] ?? "",
        outdated: check.status === "warn",
      },
    };
  }
  return {
    state: "unknown",
    reason: "unrecognized-version-check",
    message:
      check.detail.trim().length > 0 ? check.detail : UNRECOGNIZED_MESSAGE,
  };
}

/**
 * Create the probe that reports whether the installed Lisa matches npm latest.
 *
 * Always calls `checkVersion(deps, false)` — never offline:true, which would
 * produce doctor's false-green "Skipped network check in offline mode" ok.
 * @param dependencies - Injectable doctor collaborators for focused tests
 * @returns Probe emitting current/latest/outdated or an honest unknown
 */
export function createLisaVersionProbe(
  dependencies: Partial<DoctorDependencies> = {}
): StatusProbe<LisaVersionValue> {
  const deps = { ...DEFAULT_VERSION_PROBE_DEPS, ...dependencies };
  return {
    id: LISA_VERSION_PROBE_ID,
    timeoutMs: 5_000,
    run: async () => {
      const check = await checkVersion(deps, false);
      return mapLisaVersionCheck(check);
    },
  };
}

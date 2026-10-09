/** Only closed native driver diagnostic facts cross the qualification boundary. */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { required } from "../../../all/copy-overwrite/scripts/lib/npm-update-contract.mjs";
import { DRIVER_PHASES } from "./driver-probe.mjs";

const REPORT_DIFFERS = "driver diagnostic report differs";
const DRIVER_BOOLEANS = [
  "driverLaunchVerified",
  "driverSessionVerified",
  "nativeSandboxVerified",
  "suidSandboxActive",
  "sessionDeleted",
  "driverClosed",
];

/**
 * @typedef {object} DriverReport
 * @property {true} diagnosticOnly No primary acceptance authority.
 * @property {boolean} driverLaunchVerified Native readiness reached.
 * @property {boolean} driverSessionVerified Native session reached.
 * @property {boolean} nativeSandboxVerified Original sandbox text reached.
 * @property {boolean} suidSandboxActive Original active SUID row reached.
 * @property {boolean} sessionDeleted Owned session deletion completed.
 * @property {boolean} driverClosed Owned child close completed.
 * @property {string | null} failureStage Closed failing phase, if any.
 * @property {string | null} failureSha256 Private failure fingerprint, if any.
 */

/**
 * @typedef {object} DriverDiagnostic
 * @property {true} diagnosticOnly No primary acceptance authority.
 * @property {string[]} phases Closed native progress.
 * @property {{refusalStage: string, messageSha256: string} | null} refusal Closed refusal, if any.
 * @property {boolean} reportReceived Native final report reached.
 * @property {DriverReport | null} report Validated native final report, if any.
 */

/**
 * Closed phase progress survives native timeout without exporting URLs or profiles.
 * @param {Buffer} bytes Actual bounded helper output.
 * @returns {DriverDiagnostic} Closed diagnostic progress and optional final report.
 */
export function driverDiagnostic(bytes) {
  const lines = bytes.toString().trim().split("\n").filter(Boolean);
  const state = { phases: [], refusal: null, result: null };
  required(
    lines.length <= 16 && bytes.length <= 65536,
    "driver diagnostic exceeds bound"
  );
  for (const line of lines) {
    const value = (() => {
      try {
        return JSON.parse(line);
      } catch {
        throw new Error("driver diagnostic malformed; raw proof withheld");
      }
    })();
    required(
      value !== null &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        state.result === null,
      REPORT_DIFFERS
    );
    const fields = Object.keys(value).sort().join(",");
    if (fields === "phase" && DRIVER_PHASES.includes(value.phase))
      state.phases.push(value.phase);
    else if (
      fields === "messageSha256,refusalStage" &&
      DRIVER_PHASES.includes(value.refusalStage) &&
      typeof value.messageSha256 === "string" &&
      /^[a-f0-9]{64}$/.test(value.messageSha256) &&
      state.refusal === null
    )
      state.refusal = value;
    else if (fields === "result" && state.result === null) {
      const result = value.result;
      required(
        result &&
          Object.keys(result).sort().join(",") ===
            [
              ...DRIVER_BOOLEANS,
              "diagnosticOnly",
              "failureStage",
              "failureSha256",
            ]
              .sort()
              .join(",") &&
          result.diagnosticOnly === true &&
          DRIVER_BOOLEANS.every(name => typeof result[name] === "boolean") &&
          (result.failureStage === null ||
            DRIVER_PHASES.includes(result.failureStage)) &&
          (result.failureSha256 === null ||
            (typeof result.failureSha256 === "string" &&
              /^[a-f0-9]{64}$/.test(result.failureSha256))),
        REPORT_DIFFERS
      );
      state.result = result;
    } else throw new Error(REPORT_DIFFERS);
  }
  return {
    diagnosticOnly: true,
    phases: state.phases,
    refusal: state.refusal,
    reportReceived: state.result !== null,
    report: state.result,
  };
}
/**
 * The real driver route diagnoses standalone capture while preserving its primary failure.
 * @param {string} root Original owned runtime root.
 * @param {object} application Original frozen fixture and qualified tool paths.
 * @param {function} native Original supervised native recorder.
 * @returns {Promise<DriverDiagnostic>} Closed diagnostic observation, never primary acceptance.
 */
export async function browserDriverControl(root, application, native) {
  const profile = join(root, "browser-driver-profile");
  const state = {};
  mkdirSync(profile, { mode: 0o700 });
  try {
    state.result = await native(
      "browser-driver",
      application.cwd,
      application.env,
      process.execPath,
      [
        fileURLToPath(new URL("./driver-probe.mjs", import.meta.url)),
        profile,
        application.env.CHROME_BINARY,
        application.env.CHROMEDRIVER,
      ]
    );
  } catch (error) {
    state.result = error;
  }
  return driverDiagnostic(state.result.stdout ?? Buffer.alloc(0));
}

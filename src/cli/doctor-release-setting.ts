/**
 * Doctor check for the always-promotable setting (CodySwannGT/lisa#5188).
 *
 * `release.liveUsers` decides whether the always-promotable rule applies to a
 * project. This check states which way it resolved, so an opt-out stays visible
 * instead of being a line nobody rereads, and names any invalid `release.*`
 * value. An invalid value is a failure even though it is treated as the
 * stricter option at run time: the project meant to say something and what it
 * wrote says nothing.
 * @module cli/doctor-release-setting
 */
import {
  FALLBACK_MECHANISM,
  readProjectConfig,
  resolveReleaseSetting,
  turnOnProblems,
  type ReleaseSetting,
} from "../../all/copy-overwrite/scripts/lib/release-switch.mjs";
import type { DoctorCheck } from "./doctor.js";

const NAME = "Always-promotable setting";

/**
 * The detail line for a setting with no problems.
 * @param setting - Resolved `release.*` setting
 * @returns Plain-English description of what is in force
 */
function healthyDetail(setting: ReleaseSetting): string {
  if (!setting.liveUsers)
    return "release.liveUsers is false: this project is marked as having no live users, so the always-promotable rule is off. Set it to true, or remove it, when the project launches.";
  const declared =
    setting.liveUsersSource === "declared"
      ? "release.liveUsers is true"
      : "release.liveUsers is not set, which means true";
  const guide = setting.guide === null ? "" : ` (see ${setting.guide})`;
  const mechanism =
    setting.mechanismSource === "declared"
      ? `Switch mechanism: ${setting.mechanism}${guide}.`
      : `Switch mechanism: none named, so a plain configuration value that defaults to off (${FALLBACK_MECHANISM}).`;
  return `This project has live users (${declared}), so the always-promotable rule applies. ${mechanism}`;
}

/**
 * The detail line for a setting with invalid values: each problem by name,
 * then what is in force anyway, so an opt-out is never hidden by a typo
 * elsewhere in the block.
 * @param setting - Resolved `release.*` setting
 * @returns Problems followed by the effective state
 */
function problemDetail(setting: ReleaseSetting): string {
  const inForce = setting.liveUsers
    ? "In force: the project is treated as having live users, so the always-promotable rule applies."
    : "In force: release.liveUsers is false, so the always-promotable rule is off.";
  return `${setting.problems.join(" ")} ${inForce}`;
}

/**
 * Report how `release.*` resolved for a project.
 * @param targetPath - Downstream project path
 * @returns Doctor check result
 */
export function checkReleaseSetting(targetPath: string): DoctorCheck {
  try {
    const config = readProjectConfig(targetPath);
    const resolved = resolveReleaseSetting(config);
    // A mistyped humanGate.humanOnly changes who turns a finished feature on
    // in production, so it is reported with the release settings.
    const setting = {
      ...resolved,
      problems: [...resolved.problems, ...turnOnProblems(config)],
    };
    return setting.problems.length > 0
      ? { name: NAME, status: "fail", detail: problemDetail(setting) }
      : { name: NAME, status: "ok", detail: healthyDetail(setting) };
  } catch (error) {
    return {
      name: NAME,
      status: "fail",
      detail: `The release setting could not be read: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

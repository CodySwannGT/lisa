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
} from "../../all/copy-overwrite/scripts/lib/release-switch.mjs";
import type { DoctorCheck } from "./doctor.js";

const NAME = "Always-promotable setting";

/**
 * Report how `release.*` resolved for a project.
 * @param targetPath - Downstream project path
 * @returns Doctor check result
 */
export function checkReleaseSetting(targetPath: string): DoctorCheck {
  try {
    const setting = resolveReleaseSetting(readProjectConfig(targetPath));
    if (setting.problems.length > 0)
      return { name: NAME, status: "fail", detail: setting.problems.join(" ") };
    const mechanism =
      setting.mechanismSource === "declared"
        ? `Switch mechanism: ${setting.mechanism}${setting.guide === null ? "" : ` (see ${setting.guide})`}.`
        : `Switch mechanism: none named, so a plain configuration value that defaults to off (${FALLBACK_MECHANISM}).`;
    return {
      name: NAME,
      status: "ok",
      detail: setting.liveUsers
        ? `This project has live users (${setting.liveUsersSource === "declared" ? "release.liveUsers is true" : "release.liveUsers is not set, which means true"}), so the always-promotable rule applies. ${mechanism}`
        : "release.liveUsers is false: this project is marked as having no live users, so the always-promotable rule is off. Set it to true, or remove it, when the project launches.",
    };
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

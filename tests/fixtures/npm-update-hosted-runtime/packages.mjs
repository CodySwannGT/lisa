/** Only disposable CI qualification may normalize newer preinstalled packages to the signed pins. */
import { installRailsPackages } from "../../../all/copy-overwrite/scripts/lib/npm-update-rails-tools.mjs";
import { required } from "../../../all/copy-overwrite/scripts/lib/npm-update-contract.mjs";
import {
  SUPPORTED_RAILS_CLIENT,
  SUPPORTED_RAILS_BROWSER,
} from "../../../all/copy-overwrite/scripts/lib/npm-update-rails-tool-identity.mjs";
import { isDeepStrictEqual } from "node:util";

const PREFIX = ["-n", "/usr/bin/apt-get", "--snapshot=20261013T000000Z"];
const UPDATE = [...PREFIX, "update"];
const INSTALL = [
  ...PREFIX,
  "install",
  "--yes",
  "--no-install-recommends",
  `libmariadb-dev=${SUPPORTED_RAILS_CLIENT}`,
  `libmariadb-dev-compat=${SUPPORTED_RAILS_CLIENT}`,
  ...SUPPORTED_RAILS_BROWSER,
];

/**
 * Reuse the fixed snapshot/roster, then qualify without production downgrade consent.
 * @param {function(string, Array<string>): Promise<object>} step Original supervised native operation.
 * @returns {Promise<Array<string>>} Fixed browser package roster after prerequisite normalization.
 */
export async function normalizeQualificationPackages(step) {
  return installRailsPackages((command, args) => {
    const install = isDeepStrictEqual(args, INSTALL);
    required(
      command === "/usr/bin/sudo" &&
        (install || isDeepStrictEqual(args, UPDATE)),
      "qualification package operation differs"
    );
    return step(command, install ? [...args, "--allow-downgrades"] : args);
  }, true);
}

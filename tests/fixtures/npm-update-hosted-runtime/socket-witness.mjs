/** Nested hook cleanup facts must come from the native socket witness. */
import { lstatSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { required } from "../../../all/copy-overwrite/scripts/lib/npm-update-contract.mjs";

/**
 * Only native ENOENT proves absence; dangling aliases and unreadable paths refuse.
 * @param {unknown} root Original witness root.
 * @returns {boolean} Whether a valid root is positively absent.
 */
function absentRoot(root) {
  if (typeof root !== "string" || !isAbsolute(root) || resolve(root) !== root)
    return false;
  try {
    lstatSync(root);
    return false;
  } catch (error) {
    return error.code === "ENOENT";
  }
}

/**
 * Check the actual original-hook witness before recording cleanup facts.
 * @param {object} witness Native socket hook JSON.
 * @returns {object} Checked outward facts without the private root.
 */
export function hookSocketWitness(witness) {
  required(
    witness?.nativeBind === true &&
      witness?.socketAbsent === true &&
      witness?.tokenBytes === 32 &&
      witness?.socketBytes === 95 &&
      absentRoot(witness?.root),
    "original hook scratch socket differs"
  );
  return {
    syntheticSocketNativeBind: true,
    ownedRootAbsent: true,
    socketBytes: witness.socketBytes,
  };
}

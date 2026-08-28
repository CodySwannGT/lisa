/** Exact equality predicates for immutable test-run authority. */
import type {
  ExactProcessIdentity,
  ExactScratchRootIdentity,
} from "./lisa-test-run-exact-process-state.js";

/**
 * Compare two exact PID/birth identities.
 * @param left - Previously bound identity
 * @param right - Proposed identity
 * @returns Whether both values describe the same process birth
 */
export function sameExactProcess(
  left: ExactProcessIdentity | undefined,
  right: ExactProcessIdentity | undefined
): boolean {
  return left === undefined || right === undefined
    ? left === right
    : left.pid === right.pid && left.birth === right.birth;
}

/**
 * Compare two token-bound filesystem identities.
 * @param left - Previously bound root identity
 * @param right - Proposed root identity
 * @returns Whether path, inode, device, and token are unchanged
 */
export function sameExactRootIdentity(
  left: ExactScratchRootIdentity | undefined,
  right: ExactScratchRootIdentity | undefined
): boolean {
  return left === undefined || right === undefined
    ? left === right
    : left.canonicalPath === right.canonicalPath &&
        left.dev === right.dev &&
        left.ino === right.ino &&
        left.token === right.token;
}

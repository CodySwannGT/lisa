/**
 * Shared vocabulary for the doctor checks' errno tests.
 *
 * Each `*-errno.test.ts` replaces one `node:fs/promises` call and makes it
 * reject with a chosen code, because a permission bit does not stop root and a
 * real over-long path cannot be built portably. These constants keep the two
 * sides of the classification identical across every check, so a check that
 * drifts from the shared definition of absence fails its own test
 * (CodySwannGT/lisa#4629).
 * @module tests/helpers/fs-errno
 */
import type { PathLike } from "node:fs";
import { vi } from "vitest";

/** The `node:fs/promises` module, as the errno tests replace parts of it. */
export type FsPromises = typeof import("node:fs/promises");

/**
 * Codes that mean the check could not look. `ENAMETOOLONG` is here because it
 * describes the path the check built, not the file.
 */
export const UNDETERMINABLE_CODES = [
  "EACCES",
  "EPERM",
  "EIO",
  "ELOOP",
  "ENAMETOOLONG",
] as const;

/** Codes that mean the path is genuinely not there. */
export const ABSENT_CODES = ["ENOENT", "ENOTDIR"] as const;

/**
 * A filesystem failure carrying one errno, as Node reports it.
 * @param code - The errno code
 * @returns The rejection value
 */
export function errnoFailure(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code}: simulated filesystem failure`), {
    code,
  });
}

/**
 * Wrap a real `node:fs/promises` call so it rejects for one path only.
 *
 * Scoping the refusal to a path rather than to the next call keeps a case
 * independent of the order the check probes in: every other path still reads
 * the real disk, so the check reaches the refused path exactly as it would in
 * production.
 * @param real - The unmocked filesystem call
 * @param refused - Absolute path that should reject
 * @param code - Errno code to reject with
 * @returns An implementation for the mocked call
 */
export function refusingAt<
  F extends (target: PathLike, ...rest: never[]) => Promise<unknown>,
>(real: F, refused: string, code: string): F {
  const refusing = async (
    target: PathLike,
    ...rest: never[]
  ): Promise<unknown> => {
    if (String(target) === refused) throw errnoFailure(code);
    return real(target, ...rest);
  };
  return refusing as F;
}

/**
 * The unmocked `node:fs/promises`, so a refusing implementation can fall
 * through to the real disk for every path it does not refuse.
 * @returns The real module
 */
export async function realFsPromises(): Promise<FsPromises> {
  return vi.importActual<FsPromises>("node:fs/promises");
}

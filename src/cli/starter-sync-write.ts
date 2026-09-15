import { lstat, mkdir, realpath, rm } from "node:fs/promises";
import path from "node:path";
import {
  readProjectFile,
  resolveProjectPath,
  type ProjectFileSnapshot,
} from "../health/read-only-fs.js";
import { writeFileAtomically } from "../utils/atomic-file-write.js";

/**
 * Verify every destination parent and create only missing consumer directories.
 * @param root - Canonical consumer root.
 * @param name - Validated relative file path.
 * @param create - Whether missing parents may be created.
 */
async function parents(
  root: string,
  name: string,
  create: boolean
): Promise<void> {
  if ((await realpath(root)) !== root || (await lstat(root)).isSymbolicLink())
    throw new Error("Starter consumer root changed");
  const target = resolveProjectPath(root, name);
  const parts = path
    .relative(root, path.dirname(target))
    .split(path.sep)
    .filter(Boolean);
  await parts.reduce(async (pending, part) => {
    const parent = path.join(await pending, part);
    if (create) {
      try {
        await mkdir(parent);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    }
    const stat = await lstat(parent);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error("Unsafe starter destination parent");
    return parent;
  }, Promise.resolve(root));
}

/**
 * Refuse concurrent edits rather than overwriting a newer consumer snapshot.
 * @param root - Canonical consumer root.
 * @param name - Validated file path.
 * @param expected - Snapshot used to decide this update.
 */
async function unchanged(
  root: string,
  name: string,
  expected: ProjectFileSnapshot | undefined
): Promise<void> {
  await parents(root, name, false);
  const actual = await readProjectFile(root, name);
  const sameBytes =
    actual === undefined
      ? expected === undefined
      : expected !== undefined && actual.bytes.equals(expected.bytes);
  if (!sameBytes || actual?.mode !== expected?.mode)
    throw new Error(`Starter destination changed during sync: ${name}`);
}

/**
 * Publish one guarded file update; an interrupted apply retains its old baseline.
 * @param root - Canonical consumer root.
 * @param name - Validated relative path.
 * @param expected - Previously inspected bytes and mode.
 * @param bytes - Replacement payload, or undefined to remove an owned file.
 * @param mode - Final file permission bits.
 */
export async function writeStarterFile(
  root: string,
  name: string,
  expected: ProjectFileSnapshot | undefined,
  bytes: Buffer | undefined,
  mode: number
): Promise<void> {
  if (process.platform === "win32" && /[:<>"|?*]|[. ](?:\/|$)/u.test(name))
    throw new Error("Starter path is not representable safely on Windows");
  await parents(root, name, bytes !== undefined);
  await unchanged(root, name, expected);
  const target = resolveProjectPath(root, name);
  if (bytes === undefined) {
    if (expected !== undefined) await rm(target);
    return;
  }
  await writeFileAtomically(target, bytes, {
    mode,
    beforeRename: () => unchanged(root, name, expected),
  });
}

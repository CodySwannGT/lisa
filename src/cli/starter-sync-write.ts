import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  realpath,
  rename,
  rmdir,
  unlink,
} from "node:fs/promises";
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
 * Restore a displaced entry without overwriting another concurrent replacement.
 * @param root - Canonical consumer root.
 * @param name - Original relative path.
 * @param quarantine - Private path holding the displaced entry.
 */
async function restoreDisplaced(
  root: string,
  name: string,
  quarantine: string
): Promise<void> {
  try {
    await parents(root, name, false);
    await link(quarantine, resolveProjectPath(root, name));
    await unlink(quarantine);
  } catch {
    throw new Error(
      `Starter destination changed during sync: ${name}; displaced entry preserved at ${path.relative(root, quarantine)}`
    );
  }
}

/**
 * Pin a deletion by moving it privately and checking identity before unlinking.
 * @param root - Canonical consumer root.
 * @param name - Relative owned-file path.
 * @param expected - Contents and permissions that justified deletion.
 */
async function removeUnchanged(
  root: string,
  name: string,
  expected: ProjectFileSnapshot
): Promise<void> {
  const target = resolveProjectPath(root, name);
  const directory = await mkdtemp(
    path.join(path.dirname(target), ".lisa-starter-remove-")
  );
  const quarantine = path.join(directory, "entry");
  try {
    const before = await lstat(target);
    await unchanged(root, name, expected);
    await rename(target, quarantine);
    try {
      const after = await lstat(quarantine);
      if (before.dev !== after.dev || before.ino !== after.ino)
        throw new Error(`Starter destination changed during sync: ${name}`);
      await unchanged(root, path.relative(root, quarantine), expected);
      await unchanged(root, name, undefined);
      await unlink(quarantine);
    } catch (error) {
      await restoreDisplaced(root, name, quarantine);
      throw error;
    }
  } finally {
    await rmdir(directory).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOTEMPTY") throw error;
    });
  }
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
    if (expected !== undefined) await removeUnchanged(root, name, expected);
    return;
  }
  await writeFileAtomically(target, bytes, {
    mode,
    beforeRename: () => unchanged(root, name, expected),
  });
}

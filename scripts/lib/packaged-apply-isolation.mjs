/** Shared fail-closed boundary for verification, never ordinary apply. */
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readlink, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

/**
 * Local cwd/PATH/env routing cannot prove ownership of vendor and cache paths.
 * @param {string} harness - Selected native harness.
 * @param {string} agyDestination - Actual installed user-scope resolver result.
 * @returns {never} Always refuses before a host apply.
 */
export function refuseHostApply(harness, agyDestination) {
  const global = ["fleet", "all", "agy"].includes(harness)
    ? ` Uncontained Antigravity destination: ${agyDestination}.`
    : ` Uncontained temporary-backup root: ${os.tmpdir()}. Unresolved vendor registration and package-cache destinations.`;
  throw new Error(
    `Refused before spawning apply.${global} Use the inspected disposable Docker route; a temporary project or missing agent CLI is not isolation.`
  );
}

/**
 * Inspect the actual newly created container, not the requested docker flags.
 * No host mount (even read-only), device, privileged or shared namespace passes.
 * @param {Record<string, any>} row - Native docker inspect object.
 * @param {string} id - Exact ID returned by create.
 * @returns {void}
 */
export function assertDisposableContainer(row, id) {
  const h = row.HostConfig;
  if (
    !/^[a-f0-9]{64}$/u.test(id) ||
    row.Id !== id ||
    row.State?.Status !== "created" ||
    row.State?.Running !== false ||
    !Array.isArray(row.Mounts) ||
    row.Mounts.length !== 0 ||
    !h
  ) {
    throw new Error(
      "Isolation preflight: incomplete, started or mounted container"
    );
  }
  // Docker omits optional HostConfig.Mounts when no --mount was requested.
  const empty = value =>
    value === undefined ||
    value === null ||
    (Array.isArray(value) && value.length === 0);
  const noHostResources = [
    "Binds",
    "Mounts",
    "VolumesFrom",
    "Devices",
    "DeviceRequests",
    "CapAdd",
  ].every(key => empty(h[key]));
  if (
    !noHostResources ||
    h.Privileged !== false ||
    !h.CapDrop?.includes("ALL") ||
    !Array.isArray(h.SecurityOpt) ||
    h.SecurityOpt.length !== 1 ||
    h.SecurityOpt[0] !== "no-new-privileges" ||
    h.NetworkMode !== "bridge" ||
    h.PidMode !== "" ||
    h.IpcMode !== "private" ||
    h.UsernsMode !== "" ||
    h.CgroupnsMode !== "private"
  ) {
    throw new Error(
      "Isolation preflight: host resources or unsafe namespace/privileges"
    );
  }
}

/**
 * Capture complete file bytes by digest or absence; never print config contents.
 * Refuse initial symlinks. After execution, capture changed link bytes without
 * following the link or exposing its target in the public observation.
 * @param {readonly string[]} files - Every declared outside file, no exclusions.
 * @param {string} [evidenceDirectory] - Private directory for complete before/after images.
 * @param {{phase?: "before" | "after"}} [options] - Only the post-run observation accepts changed symlinks.
 * @returns {Promise<Record<string, object>>} Ordered path-to-observation map.
 */
export async function snapshotFiles(files, evidenceDirectory, options = {}) {
  const result = {};
  if (evidenceDirectory) await privateDirectory(evidenceDirectory);
  for (const file of files) {
    try {
      const info = await lstat(file);
      const postRunLink = options.phase === "after" && info.isSymbolicLink();
      if (!info.isFile() && !postRunLink)
        throw new Error(`Preservation path is not a regular file: ${file}`);
      const bytes = postRunLink
        ? await readlink(file, { encoding: "buffer" })
        : await readFile(file);
      if (evidenceDirectory) {
        const name = `${createHash("sha256").update(file).digest("hex")}.private`;
        await writeFile(path.join(evidenceDirectory, name), bytes, {
          mode: 0o600,
          flag: "wx",
        });
      }
      result[file] = {
        present: true,
        ...(postRunLink ? { kind: "symlink" } : {}),
        bytes: bytes.length,
        mode: info.mode & 0o777,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      result[file] = { present: false };
    }
  }
  return result;
}

/**
 * @param {Record<string, object>} before - Complete before observation.
 * @param {Record<string, object>} after - Complete after observation.
 * @returns {string[]} Changed paths, including newly observed destinations.
 */
export function compareSnapshots(before, after) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
    file => JSON.stringify(before[file]) !== JSON.stringify(after[file])
  );
}

/**
 * Preserve observed current bytes without altering the original or guessing its
 * history. Caller must stop the writer before invoking this recovery operation.
 * @param {string} file - Unexpected destination, possibly without a before-image.
 * @param {string} evidenceDirectory - Private recovery directory.
 * @returns {Promise<{copy: string, prior_content: "unknown", restored: false}>}
 */
export async function preserveUnexpectedWrite(file, evidenceDirectory) {
  await privateDirectory(evidenceDirectory);
  const copy = path.join(evidenceDirectory, `${randomUUID()}.private`);
  const info = await lstat(file);
  const current = info.isSymbolicLink()
    ? await readlink(file, { encoding: "buffer" })
    : await readFile(file);
  await writeFile(copy, current, { mode: 0o600, flag: "wx" });
  return { copy, prior_content: "unknown", restored: false };
}

/**
 * @param {string} evidenceDirectory - Owned evidence path.
 * @returns {Promise<void>} Reject public or symlinked recovery directories.
 */
async function privateDirectory(evidenceDirectory) {
  await mkdir(evidenceDirectory, { mode: 0o700, recursive: true });
  const directory = await lstat(evidenceDirectory);
  if (!directory.isDirectory() || (directory.mode & 0o077) !== 0) {
    throw new Error(
      "Recovery requires a private directory without symlink redirection"
    );
  }
}

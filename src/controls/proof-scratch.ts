/** Recover only Lisa's private proof copies whose owning process has exited. */
import { randomUUID } from "node:crypto";
import type { Stats } from "node:fs";
import {
  lstat,
  readFile,
  readdir,
  rm,
  rmdir,
  writeFile,
} from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import path from "node:path";

export const PROOF_SCRATCH_PREFIX = "lisa-attest-";
export const PROOF_SCRATCH_LIFETIME_MS = 2 * 60 * 60 * 1_000;
export const PROOF_SCRATCH_OWNER = ".lisa-proof-owner.json";

const RUN_NAME =
  /^lisa-attest-(?<created>\d{13})-(?<run>[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/u;
const OWNER_RECORD_MAX_BYTES = 1_024;
const MAX_PID = 2_147_483_647;

/**
 *
 */
interface OwnerRecord {
  readonly schema: 1;
  readonly folder: string;
  readonly pid: number;
  readonly host: string;
}

/**
 * Name a fresh folder in the machine's temporary root.
 * @returns The path before anything is created.
 */
export function proofScratchFolder(): string {
  return path.join(
    tmpdir(),
    `${PROOF_SCRATCH_PREFIX}${Date.now()}-${randomUUID()}`
  );
}

/**
 * Record the run identity immediately after creating its private directory.
 * @param folder - The directory just created by the proof builder.
 * @returns Once the owner record is written, or immediately for custom folders.
 */
export async function recordProofScratchOwner(folder: string): Promise<void> {
  const name = path.basename(folder);
  if (!RUN_NAME.test(name)) return;
  const contents: OwnerRecord = {
    schema: 1,
    folder: name,
    pid: process.pid,
    host: hostname(),
  };
  await writeFile(
    path.join(folder, PROOF_SCRATCH_OWNER),
    JSON.stringify(contents),
    {
      flag: "wx",
      mode: 0o600,
    }
  );
}

/**
 *
 */
type Outcome = "removed" | "young" | "active" | "unverified" | "failed";

/** Counts for recognised run names only. Other temporary folders are ignored. */
export type ProofScratchSweep = Record<Outcome, number> & {
  scanFailed: boolean;
};

/**
 *
 */
interface SweepOptions {
  /** Age reference used for deciding whether a directory is old enough. */
  readonly now?: number;
  /** Removes one payload entry in a directory that passed ownership checks. */
  readonly remove?: (entry: string) => Promise<void>;
}

/**
 * Read a bounded owner record from a candidate already checked as private.
 * @param file - Owner record path
 * @param name - Exact run folder name encoded in the record
 * @param uid - Owner of this process, when available
 * @returns The verified process id and owner record, or undefined.
 */
async function readOwner(file: string, name: string, uid: number | undefined) {
  const stat = await lstat(file);
  if (
    !stat.isFile() ||
    stat.size > OWNER_RECORD_MAX_BYTES ||
    (uid !== undefined && (stat.uid !== uid || (stat.mode & 0o077) !== 0))
  )
    return undefined;
  const contents = await readFile(file, "utf8");
  const record = JSON.parse(contents) as Partial<OwnerRecord> | null;
  if (
    record?.schema !== 1 ||
    record.folder !== name ||
    record.host !== hostname() ||
    typeof record.pid !== "number" ||
    !Number.isSafeInteger(record.pid) ||
    record.pid < 1 ||
    record.pid > MAX_PID
  )
    return undefined;
  return { pid: record.pid, contents };
}

/**
 * Check whether the operating system can prove the recorded process is gone.
 * Permission errors and recycled process identifiers leave the folder alone.
 * @param pid - The recorded local process id
 * @returns True when the PID is absent, false when active, or undefined if unknown.
 */
function ownerHasExited(pid: number): boolean | undefined {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH" ? true : undefined;
  }
}

/**
 * Delete a proof copy's payload before discarding the evidence of ownership.
 * @param folder - Verified copy directory.
 * @param original - Identity of the verified directory.
 * @param contents - Verified owner record, saved for a failed final removal.
 * @param remove - Remove one payload entry.
 */
async function removeVerifiedCopy(
  folder: string,
  original: Stats,
  contents: string,
  remove: (entry: string) => Promise<void>
): Promise<void> {
  const owner = path.join(folder, PROOF_SCRATCH_OWNER);
  const entries = (await readdir(folder)).filter(
    name => name !== PROOF_SCRATCH_OWNER
  );
  for (const entry of entries) await remove(path.join(folder, entry));
  await rm(owner, { force: true });
  try {
    await rmdir(folder);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    const remaining = await lstat(folder).catch(() => undefined);
    if (
      remaining?.isDirectory() &&
      remaining.dev === original.dev &&
      remaining.ino === original.ino
    ) {
      await writeFile(owner, contents, { flag: "wx", mode: 0o600 });
    }
    throw error;
  }
}

/**
 * Remove a single recognised old run only after verifying both ownership and exit.
 * @param folder - The candidate directory
 * @param remove - Removes one entry of a verified abandoned copy
 * @returns Whether the copy could be removed and why it was kept otherwise.
 */
async function removeOldCopy(
  folder: string,
  remove: (entry: string) => Promise<void>
): Promise<Outcome> {
  try {
    const uid = process.getuid?.();
    const before = await lstat(folder);
    if (
      !before.isDirectory() ||
      (uid !== undefined && (before.uid !== uid || (before.mode & 0o077) !== 0))
    )
      return "unverified";
    const owner = await readOwner(
      path.join(folder, PROOF_SCRATCH_OWNER),
      path.basename(folder),
      uid
    );
    if (owner === undefined) return "unverified";
    const exited = ownerHasExited(owner.pid);
    if (exited === undefined) return "unverified";
    if (!exited) return "active";
    const after = await lstat(folder);
    if (
      !after.isDirectory() ||
      before.dev !== after.dev ||
      before.ino !== after.ino
    )
      return "unverified";
    return await removeVerifiedCopy(folder, after, owner.contents, remove).then(
      (): Outcome => "removed",
      (): Outcome => "failed"
    );
  } catch {
    // A peer may already have removed the folder. Unreadable records are left.
    return "unverified";
  }
}

/**
 * Recover abandoned proof copy folders without failing the new proof run.
 * @param root - Temporary root
 * @param options - Optional clock or removal override
 * @param options.now - Time used to decide whether a copy is old enough
 * @param options.remove - Removes one entry in a verified copy
 * @returns Counts that explain what happened to each recognised run folder.
 */
export async function sweepProofScratch(
  root: string,
  {
    now = Date.now(),
    remove = entry => rm(entry, { recursive: true, force: true }),
  }: SweepOptions = {}
): Promise<ProofScratchSweep> {
  const empty: ProofScratchSweep = {
    removed: 0,
    young: 0,
    active: 0,
    unverified: 0,
    failed: 0,
    scanFailed: false,
  };
  const names = await readdir(root).catch(() => undefined);
  if (names === undefined) return { ...empty, scanFailed: true };
  // Avoid removing several repository copies at once against the same disk.
  return names.reduce(async (previous, name) => {
    const result = await previous;
    const created = RUN_NAME.exec(name)?.groups?.created;
    if (created === undefined) return result;
    const outcome =
      now - Number(created) < PROOF_SCRATCH_LIFETIME_MS
        ? "young"
        : await removeOldCopy(path.join(root, name), remove);
    return { ...result, [outcome]: result[outcome] + 1 };
  }, Promise.resolve(empty));
}

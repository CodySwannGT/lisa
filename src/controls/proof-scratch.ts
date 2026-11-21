/** Recover only Lisa's private proof copies whose owning process has exited. */
import { randomUUID } from "node:crypto";
import { lstat, readFile, readdir, rm, writeFile } from "node:fs/promises";
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
  /** Removes a directory which has passed all ownership checks. */
  readonly remove?: (folder: string) => Promise<void>;
}

/**
 * Read a bounded owner record from a candidate already checked as private.
 * @param file - Owner record path
 * @param name - Exact run folder name encoded in the record
 * @param uid - Owner of this process, when available
 * @returns An identified local owner, or undefined if it cannot be proved.
 */
async function readOwnerPid(
  file: string,
  name: string,
  uid: number | undefined
): Promise<number | undefined> {
  const stat = await lstat(file);
  if (
    !stat.isFile() ||
    stat.size > OWNER_RECORD_MAX_BYTES ||
    (uid !== undefined && (stat.uid !== uid || (stat.mode & 0o077) !== 0))
  )
    return undefined;
  const record = JSON.parse(
    await readFile(file, "utf8")
  ) as Partial<OwnerRecord> | null;
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
  return record.pid;
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
 * Remove a single recognised old run only after verifying both ownership and exit.
 * @param folder - The candidate directory
 * @param remove - Removes a verified abandoned copy
 * @returns Whether the copy could be removed and why it was kept otherwise.
 */
async function removeOldCopy(
  folder: string,
  remove: (folder: string) => Promise<void>
): Promise<Outcome> {
  try {
    const uid = process.getuid?.();
    const before = await lstat(folder);
    if (
      !before.isDirectory() ||
      (uid !== undefined && (before.uid !== uid || (before.mode & 0o077) !== 0))
    )
      return "unverified";
    const owner = await readOwnerPid(
      path.join(folder, PROOF_SCRATCH_OWNER),
      path.basename(folder),
      uid
    );
    if (owner === undefined) return "unverified";
    const exited = ownerHasExited(owner);
    if (exited === undefined) return "unverified";
    if (!exited) return "active";
    const after = await lstat(folder);
    if (
      !after.isDirectory() ||
      before.dev !== after.dev ||
      before.ino !== after.ino
    )
      return "unverified";
  } catch {
    // A peer may already have removed the folder. Unreadable records are left.
    return "unverified";
  }
  try {
    await remove(folder);
    return "removed";
  } catch {
    return "failed";
  }
}

/**
 * Recover abandoned proof copy folders without failing the new proof run.
 * @param root - Temporary root
 * @param options - Optional clock or removal override
 * @param options.now - Time used to decide whether a copy is old enough
 * @param options.remove - Removes a verified copy
 * @returns Counts that explain what happened to each recognised run folder.
 */
export async function sweepProofScratch(
  root: string,
  {
    now = Date.now(),
    remove = folder => rm(folder, { recursive: true, force: true }),
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

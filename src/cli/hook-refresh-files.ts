/** Confine refresh IO and rollback to held native file identities. */
import { constants, type BigIntStats } from "node:fs";
import { lstat, open, type FileHandle } from "node:fs/promises";
import path from "node:path";

const MAXIMUM = 4 * 1024 * 1024;

/** Retained object; pathname replacement never supplies write authority. */
export interface Pin {
  readonly filename: string;
  readonly handle: FileHandle;
  readonly identity: BigIntStats;
}

/**
 * Compare native objects; failed observations never mean absence.
 * @param left - Fresh native metadata.
 * @param right - Retained metadata.
 * @returns Same device and inode.
 */
function sameIdentity(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

/**
 * Require the pathname still selects its retained object.
 * @param pin - Original native object.
 */
export async function checkPath(pin: Pin): Promise<void> {
  const actual = await lstat(pin.filename, { bigint: true });
  if (actual.isSymbolicLink() || !sameIdentity(actual, pin.identity))
    throw new Error("Hook path changed after preflight");
}

/**
 * Read a bounded regular descriptor, detecting growth or torn observations.
 * @param pin - Retained file.
 * @returns Complete bytes.
 */
export async function bytes(pin: Pin): Promise<Buffer> {
  const before = await pin.handle.stat({ bigint: true });
  if (
    !before.isFile() ||
    !sameIdentity(before, pin.identity) ||
    before.size < 0n ||
    before.size > BigInt(MAXIMUM)
  )
    throw new Error("Hook refresh requires bounded regular files");
  const size = Number(before.size);
  const buffer = Buffer.alloc(size + 1);
  const cursor = { value: 0 };
  while (cursor.value < buffer.length) {
    const result = await pin.handle.read(
      buffer,
      cursor.value,
      buffer.length - cursor.value,
      cursor.value
    );
    if (result.bytesRead === 0) break;
    cursor.value += result.bytesRead;
  }
  const after = await pin.handle.stat({ bigint: true });
  if (
    cursor.value !== size ||
    before.size !== after.size ||
    before.mtimeNs !== after.mtimeNs ||
    before.ctimeNs !== after.ctimeNs
  )
    throw new Error("Hook changed during descriptor read");
  return buffer.subarray(0, cursor.value);
}

/** Bounded original bytes and acknowledged writes on one retained destination. */
export class HookPair {
  private expected: Buffer;
  private expectedMode: number;

  /**
   * Keep source and destination authority for one operation.
   * @param source - Read-only package descriptor.
   * @param host - Original writable host descriptor.
   * @param sourceBytes - Authenticated release bytes.
   * @param hostBytes - Bounded original backup.
   */
  constructor(
    readonly source: Pin,
    readonly host: Pin,
    readonly sourceBytes: Buffer,
    readonly hostBytes: Buffer
  ) {
    this.expected = hostBytes;
    this.expectedMode = Number(host.identity.mode & 0o777n);
  }

  /**
   * Write only the held inode; verify each acknowledged write before truncation.
   * @param content - Complete replacement or backup bytes.
   */
  async write(content: Buffer): Promise<void> {
    const cursor = { value: 0 };
    while (cursor.value < content.length) {
      await this.assertOwnWrites();
      const result = await this.host.handle.write(
        content,
        cursor.value,
        content.length - cursor.value,
        cursor.value
      );
      if (result.bytesWritten <= 0)
        throw new Error("Hook descriptor write made no progress");
      const next = Buffer.alloc(
        Math.max(this.expected.length, cursor.value + result.bytesWritten)
      );
      this.expected.copy(next);
      content.copy(
        next,
        cursor.value,
        cursor.value,
        cursor.value + result.bytesWritten
      );
      this.expected = next;
      cursor.value += result.bytesWritten;
      await this.assertOwnWrites();
    }
    await this.assertOwnWrites();
    await this.host.handle.truncate(content.length);
    this.expected = Buffer.from(content);
  }

  /** Reject shared inodes or concurrent bytes before any further mutation. */
  private async assertOwnWrites(): Promise<void> {
    const info = await this.host.handle.stat({ bigint: true });
    if (
      info.nlink > 1n ||
      Number(info.mode & 0o777n) !== this.expectedMode ||
      !(await bytes(this.host)).equals(this.expected)
    )
      throw new Error(
        "Concurrent hook edit or hardlink preserved; rollback refused"
      );
  }

  /**
   * Change permissions only on the retained inode containing our writes.
   * @param mode - Original authenticated source or backup permissions.
   */
  async chmod(mode: number): Promise<void> {
    await this.assertOwnWrites();
    await this.host.handle.chmod(mode);
    this.expectedMode = mode;
  }

  /** Restore only this original inode while it contains our acknowledged writes. */
  async restore(): Promise<void> {
    await this.assertOwnWrites();
    await this.write(this.hostBytes);
    await this.chmod(Number(this.host.identity.mode & 0o777n));
    if (!(await bytes(this.host)).equals(this.hostBytes))
      throw new Error("Descriptor rollback readback differs");
  }
}

/** Operation-local native resources and error accumulation, always finally-closed. */
export class HookFiles {
  private readonly pins: Pin[] = [];
  private readonly changed: HookPair[] = [];
  private readonly failures: unknown[] = [];

  /**
   * Retain a no-follow object before subsequent validation can fail.
   * @param filename - Confined absolute path.
   * @param flags - Native access flags.
   * @returns Original object.
   */
  async retain(filename: string, flags: number): Promise<Pin> {
    const identity = await lstat(filename, { bigint: true });
    if (
      identity.isSymbolicLink() ||
      (!identity.isFile() && !identity.isDirectory())
    )
      throw new Error("Hook refresh requires regular objects");
    const handle = await open(filename, flags | constants.O_NOFOLLOW);
    const pin = { filename, handle, identity };
    this.pins.push(pin);
    if (!sameIdentity(await handle.stat({ bigint: true }), identity))
      throw new Error("Hook identity changed during open");
    return pin;
  }

  /**
   * Hold every closed directory component including the resolved root.
   * @param root - Canonical package or host root.
   * @param relative - Closed directory suffix.
   * @returns Pinned ancestors.
   */
  async directories(root: string, relative: string): Promise<Pin[]> {
    const parts = relative.split("/");
    const filenames = [
      root,
      ...parts.map((_part, index) =>
        path.join(root, ...parts.slice(0, index + 1))
      ),
    ];
    const results: Pin[] = [];
    for (const filename of filenames) {
      const pin = await this.retain(
        filename,
        constants.O_RDONLY | constants.O_DIRECTORY
      );
      if (!pin.identity.isDirectory())
        throw new Error("Hook refresh requires regular directory components");
      results.push(pin);
    }
    return results;
  }

  /**
   * Register a backup immediately before the first possible write.
   * @param pair - Original descriptor and bytes.
   */
  mark(pair: HookPair): void {
    this.changed.push(pair);
  }

  /**
   * Preserve the original failure and attempt every descriptor-bound rollback.
   * @param original - Original refresh failure.
   */
  async rollback(original: unknown): Promise<void> {
    this.failures.push(original);
    for (const pair of [...this.changed].reverse()) {
      try {
        await pair.restore();
      } catch (error) {
        this.failures.push(error);
      }
    }
  }

  /** Close every retained handle even after preflight, write or rollback errors. */
  async close(): Promise<void> {
    for (const pin of [...this.pins].reverse()) {
      try {
        await pin.handle.close();
      } catch (error) {
        this.failures.push(error);
      }
    }
  }

  /** Surface all native failures, preserving the original error object first. */
  assertSuccess(): void {
    if (this.failures.length === 1) throw this.failures[0];
    if (this.failures.length > 1)
      throw new AggregateError(
        this.failures,
        "Hook refresh failed; rollback or close also failed"
      );
  }
}

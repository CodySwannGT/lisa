/**
 * Where the headroom-admission decision lock listens (CodySwannGT/lisa#4596).
 * macOS binds a silently truncated path once a Unix socket path passes its
 * `sun_path` limit, so a deep state directory must move the lock somewhere
 * short instead of leaving every acquirer spinning on a socket it cannot see.
 */
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  acquireDecisionLock,
  lockAddress,
  lockPathProblem,
  privateLockDirProblem,
  UNIX_SOCKET_PATH_LIMIT,
} from "../../../src/core/admission-lock.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

/**
 * A fresh scratch directory removed after the test.
 * @returns Path
 */
const scratch = (): string => {
  const root = mkdtempSync(join(tmpdir(), "lisa-lock-"));
  roots.push(root);
  return root;
};

const SELF_UID = process.getuid?.() ?? 0;
const DEEP = `/private/tmp/${"d".repeat(UNIX_SOCKET_PATH_LIMIT)}`;

describe("lockAddress", () => {
  it("keeps the lock beside the state when the path fits", () => {
    expect(lockAddress("/home/u/.cache/lisa/admission", "darwin")).toBe(
      "/home/u/.cache/lisa/admission/admission.sock"
    );
  });

  it("moves a lock that would pass the socket limit to a short per-user path named by the state", () => {
    const address = lockAddress(DEEP, "linux", "/tmp", 501);

    expect(address).toMatch(/^\/tmp\/lisa-admission-501\/[0-9a-f]{16}\.sock$/u);
    expect(Buffer.byteLength(address)).toBeLessThanOrEqual(
      UNIX_SOCKET_PATH_LIMIT
    );
    expect(lockAddress(DEEP, "linux", "/tmp", 501)).toBe(address);
    expect(lockAddress(`${DEEP}x`, "linux", "/tmp", 501)).not.toBe(address);
    expect(lockAddress(DEEP, "linux", "/tmp", 502)).not.toBe(address);
  });

  it("prefers the user's temp directory and falls back to /tmp when it is too deep", () => {
    expect(lockAddress(DEEP, "darwin", "/var/folders/ab/T", 501)).toMatch(
      /^\/var\/folders\/ab\/T\/lisa-admission-501\/[0-9a-f]{16}\.sock$/u
    );
    expect(lockAddress(DEEP, "darwin", DEEP, 501)).toMatch(
      /^\/tmp\/lisa-admission-501\//u
    );
  });

  it("uses a named pipe on Windows", () => {
    expect(lockAddress("C:\\state", "win32")).toMatch(
      /^\\\\\.\\pipe\\lisa-admission-[0-9a-f]{16}$/u
    );
  });
});

describe("lock path ownership", () => {
  it("accepts an absent path and refuses another user's file or a non-socket", () => {
    const dir = scratch();
    const file = join(dir, "admission.sock");
    expect(lockPathProblem(file, SELF_UID)).toBeNull();
    writeFileSync(file, "x");
    expect(lockPathProblem(file, SELF_UID)).toMatch(/is not a socket/u);
    expect(lockPathProblem(file, SELF_UID + 1)).toMatch(
      /belongs to another user/u
    );
  });

  it("refuses a fallback directory that is a symlink or another user's, and tightens a loose one", () => {
    const dir = scratch();
    const loose = join(dir, "loose");
    mkdirSync(loose, { mode: 0o755 });
    chmodSync(loose, 0o755);
    expect(privateLockDirProblem(loose, SELF_UID)).toBeNull();
    expect(statSync(loose).mode & 0o777).toBe(0o700);
    expect(privateLockDirProblem(loose, SELF_UID + 1)).toMatch(
      /belongs to another user/u
    );
    const link = join(dir, "link");
    symlinkSync(loose, link);
    expect(privateLockDirProblem(link, SELF_UID)).toMatch(
      /is not a directory/u
    );
  });

  it("creates the fallback directory 0700 when it takes the lock", async () => {
    const deep = join(scratch(), "d".repeat(UNIX_SOCKET_PATH_LIMIT));
    const lock = await acquireDecisionLock(deep, {
      sleep: async () => {},
      now: () => 0,
      until: 1_000,
    });
    expect("release" in lock).toBe(true);
    const address = lockAddress(deep);
    expect(address.startsWith(deep)).toBe(false);
    expect(statSync(dirname(address)).mode & 0o777).toBe(0o700);
    expect(statSync(address).isSocket()).toBe(true);
    if ("release" in lock) await lock.release();
  });
});

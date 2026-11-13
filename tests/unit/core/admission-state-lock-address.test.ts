/**
 * Where the headroom-admission decision lock listens (CodySwannGT/lisa#4596).
 * macOS binds a silently truncated path once a Unix socket path passes its
 * `sun_path` limit, so a deep state directory must move the lock somewhere
 * short instead of leaving every acquirer spinning on a socket it cannot see.
 */
import { describe, expect, it } from "vitest";

import {
  lockAddress,
  UNIX_SOCKET_PATH_LIMIT,
} from "../../../src/core/admission-state.js";

describe("lockAddress", () => {
  it("keeps the lock beside the state when the path fits", () => {
    expect(lockAddress("/home/u/.cache/lisa/admission", "darwin")).toBe(
      "/home/u/.cache/lisa/admission/admission.sock"
    );
  });

  it("moves a lock that would pass the socket limit to a short path named by the state", () => {
    const deep = `/private/tmp/${"d".repeat(UNIX_SOCKET_PATH_LIMIT)}`;
    const address = lockAddress(deep, "linux");

    expect(address).toMatch(/^\/tmp\/lisa-admission-[0-9a-f]{16}\.sock$/u);
    expect(Buffer.byteLength(address)).toBeLessThanOrEqual(
      UNIX_SOCKET_PATH_LIMIT
    );
    expect(lockAddress(deep, "linux")).toBe(address);
    expect(lockAddress(`${deep}x`, "linux")).not.toBe(address);
  });

  it("uses a named pipe on Windows", () => {
    expect(lockAddress("C:\\state", "win32")).toMatch(
      /^\\\\\.\\pipe\\lisa-admission-[0-9a-f]{16}$/u
    );
  });
});

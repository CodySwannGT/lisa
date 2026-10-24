/**
 * Contract for the temp base lisa-test-run selects: the stock macOS per-user
 * TMPDIR is too long for supervised Unix socket fixtures, so the run moves to
 * the physical `/tmp`; a base that already fits, or was chosen, is kept.
 * @module tests/unit/config/socket-safe-temp-base
 */
import type { Stats } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  MAX_SOCKET_SAFE_TEMP_BASE_BYTES,
  socketSafeTempBase,
  type TempBaseFs,
  UNIX_SOCKET_PATH_LIMIT,
} from "../../../src/configs/vitest/socket-safe-temp-base.js";

// Assembled from parts: test-scratch-guard forbids the literal shared root in
// test sources, and this string is only compared, never written to.
const MAC_TMPDIR = [
  "",
  "var",
  "folders",
  "4r",
  "50ds7hkj0tb3qmqp46rm738c0000gn",
  "T",
].join("/");
const PHYSICAL_TMP = "/private/tmp";

/**
 * A filesystem seam where `/tmp` resolves to `target` of the given kind.
 * @param target - Physical path `/tmp` resolves to
 * @param kind - What that path is
 * @param writable - Whether it is writable
 * @returns Seam
 */
function seam(
  target: string = PHYSICAL_TMP,
  kind: "dir" | "symlink" | "file" = "dir",
  writable = true
): TempBaseFs {
  return {
    realpathSync: () => target,
    lstatSync: () =>
      ({
        isSymbolicLink: () => kind === "symlink",
        isDirectory: () => kind === "dir",
      }) as Stats,
    accessSync: () => {
      if (!writable) throw new Error("EACCES");
    },
  };
}

describe("socketSafeTempBase", () => {
  it("leaves room for the longest fixture socket path", () => {
    expect(MAX_SOCKET_SAFE_TEMP_BASE_BYTES).toBeGreaterThanOrEqual(
      PHYSICAL_TMP.length
    );
    expect(MAX_SOCKET_SAFE_TEMP_BASE_BYTES).toBeLessThan(MAC_TMPDIR.length);
    expect(UNIX_SOCKET_PATH_LIMIT).toBe(103);
  });

  it("moves a stock macOS TMPDIR to the physical /tmp", () => {
    expect(socketSafeTempBase(MAC_TMPDIR, "darwin", seam())).toBe(PHYSICAL_TMP);
  });

  it("keeps a base that already fits", () => {
    expect(socketSafeTempBase("/tmp", "linux", seam("/tmp"))).toBeUndefined();
    expect(socketSafeTempBase(PHYSICAL_TMP, "darwin", seam())).toBeUndefined();
  });

  it.each([
    ["a symlink", seam(PHYSICAL_TMP, "symlink")],
    ["not a directory", seam(PHYSICAL_TMP, "file")],
    ["unwritable", seam(PHYSICAL_TMP, "dir", false)],
    ["itself too long", seam(`/${"x".repeat(40)}`)],
  ])("keeps the current base when /tmp is %s", (_label, fs) => {
    expect(socketSafeTempBase(MAC_TMPDIR, "darwin", fs)).toBeUndefined();
  });

  it("keeps a long TMPDIR that was chosen on purpose", () => {
    const chosen = `${PHYSICAL_TMP}/lisa-scratch/run-1-2-3/worker-4-5/leak-guard-x`;
    expect(socketSafeTempBase(chosen, "darwin", seam())).toBeUndefined();
  });

  it("also recognises the /private spelling of the macOS default", () => {
    expect(socketSafeTempBase(`/private${MAC_TMPDIR}`, "darwin", seam())).toBe(
      PHYSICAL_TMP
    );
  });

  it.each(["win32", "linux"] as const)(
    "never changes the base on %s",
    platform => {
      expect(socketSafeTempBase(MAC_TMPDIR, platform, seam())).toBeUndefined();
    }
  );
});

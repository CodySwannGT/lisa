/** The native Unix fixture directory is private, short enough, and removed on close. */
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import { UNIX_SOCKET_PATH_LIMIT } from "../../../src/configs/vitest/socket-safe-temp-base.js";
import { createSupervisedUnixFixture } from "../../helpers/supervised-unix-fixture.js";
import { createSymlink } from "../../support/borrowed-node-modules.mjs";

const CONTROLLER_SOCKET = "controller.sock";

describe("native Unix fixtures", () => {
  it("creates a private shallow directory under the temp base and removes it on close", () => {
    const fixture = createSupervisedUnixFixture(CONTROLLER_SOCKET);
    expect(dirname(fixture.root)).toBe(realpathSync(tmpdir()));
    expect(lstatSync(fixture.root).mode & 0o077).toBe(0);
    expect(
      Buffer.byteLength(join(fixture.root, CONTROLLER_SOCKET))
    ).toBeLessThanOrEqual(UNIX_SOCKET_PATH_LIMIT);
    fixture.close();
    expect(existsSync(fixture.root)).toBe(false);
  });

  it("returns a canonical root when the temp base is reached through a symlink", () => {
    // The alias lives under its own short base, not the run's temp base, so a
    // valid but long TMPDIR cannot push the aliased socket path over the bound.
    const holder = realpathSync(mkdtempSync(join("/tmp", "lisa-u-l-")));
    try {
      const target = join(holder, "r");
      mkdirSync(target);
      const linked = join(holder, "l");
      createSymlink(target, linked, "dir");
      const fixture = createSupervisedUnixFixture(CONTROLLER_SOCKET, linked);
      try {
        expect(realpathSync(fixture.root)).toBe(fixture.root);
        expect(dirname(fixture.root)).toBe(target);
      } finally {
        fixture.close();
      }
    } finally {
      rmSync(holder, { recursive: true, force: true });
    }
  });

  it("refuses a temp base too long to bind the socket, before creating anything", () => {
    const parent = mkdtempSync(join(tmpdir(), "lisa-u-long-"));
    try {
      const longBase = join(parent, "x".repeat(UNIX_SOCKET_PATH_LIMIT));
      expect(() =>
        createSupervisedUnixFixture("hook-reader.sock", longBase)
      ).toThrow(/too long/);
      expect(existsSync(longBase)).toBe(false);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });
});

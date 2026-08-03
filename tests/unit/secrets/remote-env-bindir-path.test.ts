/**
 * Regression tests for putting the install directory on PATH.
 *
 * The toolchain step installs pinned binaries into `~/.local/bin` and then the
 * secrets step spawns them by bare name. That directory is on PATH by default
 * on a developer workstation and is NOT on a minimal container, so the step
 * reported `install bws`, the file landed correctly at mode 755, and the next
 * step died with `spawnSync bws ENOENT`.
 *
 * Every local run passed while every container run failed, because the shell
 * used to verify already exported the directory. The environment doing the
 * verifying was the environment hiding the bug — which is why this is asserted
 * against an explicit PATH string rather than against `process.env`.
 * @module tests/unit/secrets/remote-env-bindir-path
 */
import { delimiter } from "node:path";

import { describe, expect, it } from "vitest";

import { pathContains } from "../../../plugins/src/base/skills/lisa-setup-remote-env/scripts/setup-remote-env.mjs";

/** The directory pinned tools are installed into. */
const BIN_DIR = "/root/.local/bin";

describe("pathContains", () => {
  it("finds the directory when it is present", () => {
    expect(pathContains(BIN_DIR, ["/usr/bin", BIN_DIR].join(delimiter))).toBe(
      true
    );
  });

  it("reports absent on a container-shaped PATH", () => {
    // The exact PATH a fresh ubuntu:24.04 container presents.
    const container = [
      "/usr/local/sbin",
      "/usr/local/bin",
      "/usr/sbin",
      "/usr/bin",
      "/sbin",
      "/bin",
    ].join(delimiter);

    expect(pathContains(BIN_DIR, container)).toBe(false);
  });

  // A substring test would call this present because the string appears inside
  // a longer entry, skip the prepend, and leave the binary unfindable — the
  // same end state as the original bug, reached a different way.
  it("does not mistake a longer entry for the directory", () => {
    expect(
      pathContains(BIN_DIR, ["/usr/bin", `${BIN_DIR}/extra`].join(delimiter))
    ).toBe(false);
  });

  it("does not mistake a prefix of the directory for it", () => {
    expect(pathContains(BIN_DIR, ["/root/.local"].join(delimiter))).toBe(false);
  });

  it("tolerates empty entries rather than matching them", () => {
    expect(pathContains(BIN_DIR, `${delimiter}${delimiter}/usr/bin`)).toBe(
      false
    );
    expect(pathContains("", "/usr/bin")).toBe(false);
  });

  it("handles an entirely empty PATH", () => {
    expect(pathContains(BIN_DIR, "")).toBe(false);
  });
});

/** These controls use the real inherited suite lease; no fixture is provider evidence. */
import { existsSync, lstatSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSupervisedUnixFixture } from "../../helpers/supervised-unix-fixture.js";
import {
  parseScratchSupervisionLease,
  SCRATCH_SUPERVISION_LEASE_ENV,
} from "../../../src/configs/vitest/scratch-supervision.js";
import { SCRATCH_OWNER_FILE } from "../../../src/configs/vitest/scratch-owner.js";

const CONTROLLER_SOCKET = "controller.sock";

afterEach(() => vi.unstubAllEnvs());

describe("supervised native Unix fixtures", () => {
  it("creates a private shallow child inside the genuine suite and removes only its owned inode", () => {
    const raw = process.env[SCRATCH_SUPERVISION_LEASE_ENV];
    if (!raw) throw new Error("Missing genuine supervised test lease");
    const lease = parseScratchSupervisionLease(raw);
    const fixture = createSupervisedUnixFixture(CONTROLLER_SOCKET, raw);
    expect(dirname(fixture.root)).toBe(lease.suiteRoot.canonicalPath);
    expect(lstatSync(fixture.root).mode & 0o077).toBe(0);
    expect(
      Buffer.byteLength(join(fixture.root, CONTROLLER_SOCKET))
    ).toBeLessThanOrEqual(103);
    fixture.close();
    expect(existsSync(fixture.root)).toBe(false);
  });

  it("refuses absent or malformed lease authority before creating a fixture", () => {
    vi.stubEnv(SCRATCH_SUPERVISION_LEASE_ENV, "");
    expect(() =>
      createSupervisedUnixFixture(
        CONTROLLER_SOCKET,
        process.env[SCRATCH_SUPERVISION_LEASE_ENV]
      )
    ).toThrow(/supervision lease/);
    vi.stubEnv(SCRATCH_SUPERVISION_LEASE_ENV, "{}");
    expect(() =>
      createSupervisedUnixFixture(
        CONTROLLER_SOCKET,
        process.env[SCRATCH_SUPERVISION_LEASE_ENV]
      )
    ).toThrow(/lease schema/);
  });

  it("refuses an altered owner without deleting that root and recovers after authentic owner restoration", () => {
    const fixture = createSupervisedUnixFixture(
      "hook-reader.sock",
      process.env[SCRATCH_SUPERVISION_LEASE_ENV]
    );
    const file = join(fixture.root, SCRATCH_OWNER_FILE);
    const bytes = readFileSync(file);
    try {
      const marker = JSON.parse(bytes.toString());
      marker.token = "0".repeat(32);
      writeFileSync(file, JSON.stringify(marker));
      expect(() => fixture.close()).toThrow(/owner changed/);
      expect(existsSync(fixture.root)).toBe(true);
    } finally {
      writeFileSync(file, bytes);
      fixture.close();
    }
    expect(existsSync(fixture.root)).toBe(false);
  });
});

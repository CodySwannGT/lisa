/**
 * Deadline handling for the deliberately non-fatal package postinstall.
 *
 * The shared bounded child throws on a timeout. That fail-closed default is
 * correct for gates, but a postinstall has a stronger public contract: a
 * failed template apply is loud and durable without aborting dependency
 * installation. These tests pin the exception at that one boundary.
 * @module tests/unit/scripts/lisa-postinstall-timeout
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const { boundedSpawnSync } = vi.hoisted(() => ({
  boundedSpawnSync: vi.fn(),
}));

vi.mock(
  "../../../all/copy-overwrite/scripts/lib/bounded-spawn.mjs",
  async importActual => ({
    ...(await importActual<object>()),
    boundedSpawnSync,
  })
);

function project(): string {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-postinstall-timeout-"));
  const dir = path.join(root, "node_modules", "@codyswann", "lisa", "dist");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "index.js"), "process.exit(0);\n");
  return root;
}

function killedError(): Error & { code: string } {
  return Object.assign(new Error("spawnSync ETIMEDOUT"), {
    code: "ETIMEDOUT",
  });
}

/** An error the module must NOT relabel as a timeout — it is not one. */
const UNKNOWN_FAILURE = "postinstall module failure";

afterEach(() => {
  boundedSpawnSync.mockReset();
  vi.restoreAllMocks();
});

describe("a postinstall apply killed at its deadline", () => {
  it("records and reports the failure without aborting dependency installation", async () => {
    boundedSpawnSync.mockImplementation(() => {
      throw killedError();
    });
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const { APPLY_FAILURE_MARKER, runPostinstall } =
      await import("../../../all/copy-overwrite/scripts/lisa-postinstall.mjs");
    const root = project();

    expect(() => runPostinstall(root, {})).not.toThrow();

    const marker = path.join(root, APPLY_FAILURE_MARKER);
    expect(existsSync(marker)).toBe(true);
    expect(JSON.parse(readFileSync(marker, "utf8"))).toMatchObject({
      exitCode: null,
    });
    expect(readFileSync(marker, "utf8")).toContain("ten-minute deadline");
    expect(stderr.mock.calls.flat().join("")).toContain(
      "could not apply its templates"
    );
  });

  it("does not relabel an unknown module failure as a child timeout", async () => {
    boundedSpawnSync.mockImplementation(() => {
      throw new Error(UNKNOWN_FAILURE);
    });
    const { runPostinstall } =
      await import("../../../all/copy-overwrite/scripts/lisa-postinstall.mjs");

    expect(() => runPostinstall(project(), {})).toThrow(UNKNOWN_FAILURE);
  });

  // The escaping throw is deliberate and stays. What did not stay is its
  // SILENCE: the invocation this module is chained into ends in `|| true`, so
  // the non-zero exit reaches nothing, and the stack trace scrolls past once.
  // Every later instrument then reads a project whose templates were simply
  // not applied — the exact condition this module's header was written to end.
  // `lisa doctor` asks the marker, so the marker has to be there.
  it("leaves the durable marker before an unknown failure escapes", async () => {
    boundedSpawnSync.mockImplementation(() => {
      throw new Error(UNKNOWN_FAILURE);
    });
    const { APPLY_FAILURE_MARKER, runPostinstall } =
      await import("../../../all/copy-overwrite/scripts/lisa-postinstall.mjs");
    const root = project();

    expect(() => runPostinstall(root, {})).toThrow(UNKNOWN_FAILURE);

    const marker = path.join(root, APPLY_FAILURE_MARKER);
    expect(existsSync(marker)).toBe(true);
    expect(readFileSync(marker, "utf8")).toContain(UNKNOWN_FAILURE);
  });
});

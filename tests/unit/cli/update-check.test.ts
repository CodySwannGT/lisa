import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { printUpdateWarning } from "../../../src/cli/print-update-warning.js";
import { runUpdateCheck } from "../../../src/cli/update-check.js";
import { getPackageVersion } from "../../../src/cli/version.js";

let tempDir: string | undefined;

/**
 * Create the temporary directory shared by one test case.
 * @returns Temporary directory path
 */
async function getTempDir(): Promise<string> {
  tempDir ??= await mkdtemp(path.join(os.tmpdir(), "lisa-update-check-"));
  return tempDir;
}

/**
 * Resolve the update-check cache path inside the current test temp directory.
 * @returns Temporary cache path
 */
async function getCachePath(): Promise<string> {
  return path.join(await getTempDir(), "update-check.json");
}

afterEach(async () => {
  vi.restoreAllMocks();
  if (tempDir) {
    await rm(tempDir, { force: true, recursive: true });
    tempDir = undefined;
  }
});

describe("getPackageVersion", () => {
  it("reads the package.json version", () => {
    expect(getPackageVersion()).toBe("2.118.0");
  });
});

describe("runUpdateCheck", () => {
  it("skips the registry when the env opt-out is set", async () => {
    const fetchImpl = vi.fn<typeof fetch>();

    await expect(
      runUpdateCheck({
        cachePath: await getCachePath(),
        currentVersion: "2.63.2",
        env: { LISA_SKIP_UPDATE_CHECK: "1" },
        fetchImpl,
      })
    ).resolves.toMatchObject({
      latest: null,
      isOutdated: false,
      reason: "skipped",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("skips the registry when the CLI flag opt-out is set", async () => {
    const fetchImpl = vi.fn<typeof fetch>();

    await runUpdateCheck({
      argv: ["node", "dist/index.js", "--no-update-check"],
      cachePath: await getCachePath(),
      currentVersion: "2.63.2",
      env: {},
      fetchImpl,
    });

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("detects a newer npm version and writes the cache", async () => {
    const cachePath = await getCachePath();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      json: async () => ({ version: "2.64.0" }),
    } as Response);

    await expect(
      runUpdateCheck({
        cachePath,
        currentVersion: "2.63.2",
        env: {},
        fetchImpl,
        now: () => new Date("2026-05-28T12:00:00.000Z"),
      })
    ).resolves.toMatchObject({
      current: "2.63.2",
      latest: "2.64.0",
      isOutdated: true,
    });

    await expect(readFile(cachePath, "utf8")).resolves.toContain(
      '"latest": "2.64.0"'
    );
  });

  it("reuses a fresh cache instead of querying npm again", async () => {
    const cachePath = await getCachePath();
    await writeFile(
      cachePath,
      JSON.stringify({
        latest: "2.64.0",
        fetchedAt: "2026-05-28T11:00:00.000Z",
      }),
      "utf8"
    );
    const fetchImpl = vi.fn<typeof fetch>();

    await expect(
      runUpdateCheck({
        cachePath,
        currentVersion: "2.63.2",
        env: {},
        fetchImpl,
        now: () => new Date("2026-05-28T12:00:00.000Z"),
      })
    ).resolves.toMatchObject({
      latest: "2.64.0",
      isOutdated: true,
      reason: "cached",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns a non-fatal reason when the registry is unreachable", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("offline"));

    await expect(
      runUpdateCheck({
        cachePath: await getCachePath(),
        currentVersion: "2.63.2",
        env: {},
        fetchImpl,
      })
    ).resolves.toMatchObject({
      latest: null,
      isOutdated: false,
      reason: "network-error",
    });
  });
});

describe("printUpdateWarning", () => {
  it("prints the PRD warning copy only for outdated installs", () => {
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    printUpdateWarning({
      current: "2.63.2",
      latest: "2.64.0",
      isOutdated: true,
    });

    expect(error).toHaveBeenCalledWith(
      [
        "Lisa 2.64.0 is available; you are running 2.63.2.",
        "Update with: npm install -g @codyswann/lisa@latest",
        "Continuing with the installed version.",
      ].join("\n")
    );
  });
});

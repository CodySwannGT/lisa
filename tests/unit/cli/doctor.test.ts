import { mkdtemp, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runDoctor } from "../../../src/cli/doctor.js";

let tempDir: string | undefined;

/**
 * Resolve the temporary directory for one doctor test case.
 * @returns Temporary directory path
 */
async function getTempDir(): Promise<string> {
  tempDir ??= await mkdtemp(path.join(os.tmpdir(), "lisa-doctor-"));
  return tempDir;
}

afterEach(async () => {
  vi.restoreAllMocks();
  if (tempDir) {
    await rm(tempDir, { force: true, recursive: true });
    tempDir = undefined;
  }
});

describe("runDoctor", () => {
  it("emits structured JSON and warns on stale Lisa versions", async () => {
    const cwd = await getTempDir();
    await writeFile(path.join(cwd, ".lisa.config.json"), "{}\n");
    const write = vi.fn();

    const result = await runDoctor(
      cwd,
      { json: true },
      {
        fetchImpl: vi.fn<typeof fetch>().mockResolvedValue({
          ok: true,
          json: async () => ({ is_template: true }),
        } as Response),
        runUpdateCheck: vi.fn(async () => ({
          current: "2.63.2",
          latest: "2.64.0",
          isOutdated: true,
        })),
        write,
      }
    );

    expect(result.checks).toContainEqual(
      expect.objectContaining({
        name: "Lisa version current?",
        status: "warn",
      })
    );
    expect(() => JSON.parse(write.mock.calls[0][0])).not.toThrow();
  });

  it("sets a failing exit code when config JSON is malformed", async () => {
    const cwd = await getTempDir();
    await writeFile(path.join(cwd, ".lisa.config.json"), "{");
    const setExitCode = vi.fn();

    await runDoctor(
      cwd,
      { offline: true },
      { runUpdateCheck: vi.fn(), setExitCode, write: vi.fn() }
    );

    expect(setExitCode).toHaveBeenCalledWith(1);
  });

  it("warns when starter repositories are missing or not templates", async () => {
    const cwd = await getTempDir();
    const result = await runDoctor(
      cwd,
      {},
      {
        fetchImpl: vi.fn<typeof fetch>().mockResolvedValue({
          ok: true,
          json: async () => ({ is_template: false }),
        } as Response),
        runUpdateCheck: vi.fn(async () => ({
          current: "2.63.2",
          latest: "2.63.2",
          isOutdated: false,
        })),
        write: vi.fn(),
      }
    );

    expect(result.checks).toContainEqual(
      expect.objectContaining({
        name: "Starter health",
        status: "warn",
      })
    );
  });
});

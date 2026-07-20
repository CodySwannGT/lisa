import { mkdtemp, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runDoctor } from "../../../src/cli/doctor.js";

const KANE_CHECK = "Kane browser provider ready?";
const tempDirectories: string[] = [];

/**
 * Create a minimal Lisa project fixture.
 * @returns Temporary project path
 */
async function projectFixture(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "lisa-doctor-kane-"));
  tempDirectories.push(directory);
  await writeFile(path.join(directory, ".lisa.config.json"), "{}\n");
  return directory;
}

afterEach(async () => {
  await Promise.all(
    tempDirectories
      .splice(0)
      .map(directory => rm(directory, { force: true, recursive: true }))
  );
});

describe("Kane doctor check", () => {
  it("reports a disabled optional provider as healthy", async () => {
    const result = await runDoctor(
      await projectFixture(),
      { offline: true },
      {
        runUpdateCheck: vi.fn(),
        write: vi.fn(),
        probeKaneReadiness: vi.fn(async () => ({
          status: "disabled",
          detail: "Kane CLI provider is not enabled",
        })),
      }
    );

    expect(result.checks).toContainEqual({
      name: KANE_CHECK,
      status: "ok",
      detail: "Kane CLI provider is not enabled",
    });
  });

  it("makes a configured readiness failure fail doctor", async () => {
    const setExitCode = vi.fn();
    const result = await runDoctor(
      await projectFixture(),
      { offline: true },
      {
        runUpdateCheck: vi.fn(),
        write: vi.fn(),
        setExitCode,
        probeKaneReadiness: vi.fn(async () => ({
          status: "fail",
          detail: "Kane CLI authentication failed",
        })),
      }
    );

    expect(result.checks).toContainEqual({
      name: KANE_CHECK,
      status: "fail",
      detail: "Kane CLI authentication failed",
    });
    expect(setExitCode).toHaveBeenCalledWith(1);
  });
});

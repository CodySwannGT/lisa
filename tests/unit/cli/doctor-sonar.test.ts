import { mkdtemp, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runDoctor } from "../../../src/cli/doctor.js";

const SONAR_CHECK = "SonarQube MCP provider ready?";
const tempDirectories: string[] = [];

/**
 * Create a minimal Lisa project fixture.
 * @returns Temporary project path
 */
async function projectFixture(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "lisa-doctor-sonar-"));
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

describe("Sonar doctor check", () => {
  it("reports a disabled optional provider as healthy", async () => {
    const result = await runDoctor(
      await projectFixture(),
      { offline: true },
      {
        runUpdateCheck: vi.fn(),
        write: vi.fn(),
        probeSonarReadiness: vi.fn(async () => ({
          status: "disabled" as const,
          detail: "SonarQube MCP provider is not enabled",
        })),
      }
    );
    const check = result.checks.find(entry => entry.name === SONAR_CHECK);
    expect(check?.status).toBe("ok");
  });

  it("surfaces a failed readiness probe as a failed check", async () => {
    const result = await runDoctor(
      await projectFixture(),
      { offline: true },
      {
        runUpdateCheck: vi.fn(),
        write: vi.fn(),
        probeSonarReadiness: vi.fn(async () => ({
          status: "fail" as const,
          detail: "SonarQube CLI unavailable; run /lisa:setup:sonar",
        })),
      }
    );
    const check = result.checks.find(entry => entry.name === SONAR_CHECK);
    expect(check?.status).toBe("fail");
    expect(check?.detail).toContain("/lisa:setup:sonar");
  });
});

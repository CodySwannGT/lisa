import { mkdtemp, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  probeSonarReadiness,
  type SonarCommandRunner,
} from "../../../src/core/sonar-integration.js";

const tempDirectories: string[] = [];

/**
 * Create a Lisa project fixture with the given config JSON.
 * @param config - `.lisa.config.json` contents
 * @returns Temporary project path
 */
async function fixture(config: unknown): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "lisa-sonar-"));
  tempDirectories.push(directory);
  await writeFile(
    path.join(directory, ".lisa.config.json"),
    `${JSON.stringify(config)}\n`
  );
  return directory;
}

/**
 * Build a runner whose per-argv results come from a lookup map.
 * @param results - Map of first-arg to ok result
 * @returns Injectable runner
 */
function runnerFor(results: Record<string, boolean>): SonarCommandRunner {
  return async args => ({ ok: results[args[0] ?? ""] ?? false });
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    tempDirectories
      .splice(0)
      .map(directory => rm(directory, { force: true, recursive: true }))
  );
});

describe("probeSonarReadiness", () => {
  it("reports disabled (healthy) when the provider is not enabled", async () => {
    const readiness = await probeSonarReadiness(
      await fixture({}),
      runnerFor({})
    );
    expect(readiness.status).toBe("disabled");
  });

  it("reports disabled when sonar is present but not enabled", async () => {
    const readiness = await probeSonarReadiness(
      await fixture({ verification: { sonar: { enabled: false } } }),
      runnerFor({ "--version": true, auth: true })
    );
    expect(readiness.status).toBe("disabled");
  });

  it("fails when the SonarQube CLI is unavailable", async () => {
    const readiness = await probeSonarReadiness(
      await fixture({ verification: { sonar: { enabled: true } } }),
      runnerFor({ "--version": false })
    );
    expect(readiness.status).toBe("fail");
    expect(readiness.detail).toContain("/lisa:setup:sonar");
  });

  it("fails when the CLI is not authenticated", async () => {
    const readiness = await probeSonarReadiness(
      await fixture({ verification: { sonar: { enabled: true } } }),
      runnerFor({ "--version": true, auth: false })
    );
    expect(readiness.status).toBe("fail");
    expect(readiness.detail).toContain("SONARQUBE_TOKEN");
  });

  it("prefers the project key in the ready detail", async () => {
    const readiness = await probeSonarReadiness(
      await fixture({
        verification: { sonar: { enabled: true, projectKey: "acme_web" } },
      }),
      runnerFor({ "--version": true, auth: true })
    );
    expect(readiness.status).toBe("ready");
    expect(readiness.detail).toContain("acme_web");
  });

  it("is ready when the CLI is installed and authenticated", async () => {
    const readiness = await probeSonarReadiness(
      await fixture({
        verification: { sonar: { enabled: true, organization: "acme" } },
      }),
      runnerFor({ "--version": true, auth: true })
    );
    expect(readiness.status).toBe("ready");
    expect(readiness.detail).toContain("acme");
  });
});

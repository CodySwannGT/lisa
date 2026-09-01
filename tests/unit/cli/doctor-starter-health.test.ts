import { mkdtemp, rm } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runDoctor } from "../../../src/cli/doctor.js";

let tempDir: string | undefined;

/**
 * Run doctor with a successful starter response and the supplied environment.
 * @param env - Environment exposed to doctor
 * @returns The injected fetch mock
 */
async function runStarterDoctor(
  env: NodeJS.ProcessEnv
): Promise<ReturnType<typeof vi.fn<typeof fetch>>> {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "lisa-doctor-starters-"));
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue({
    ok: true,
    json: async () => ({ is_template: true }),
  } as Response);

  await runDoctor(
    tempDir,
    {},
    {
      env,
      fetchImpl,
      runUpdateCheck: vi.fn(async () => ({
        current: "2.63.2",
        latest: "2.63.2",
        isOutdated: false,
      })),
      write: vi.fn(),
    }
  );

  return fetchImpl;
}

afterEach(async () => {
  vi.restoreAllMocks();
  if (tempDir) {
    await rm(tempDir, { force: true, recursive: true });
    tempDir = undefined;
  }
});

describe("doctor starter health", () => {
  it("prefers GH_TOKEN and sends GitHub request headers", async () => {
    const fetchImpl = await runStarterDoctor({
      GH_TOKEN: "preferred-token",
      GITHUB_TOKEN: "fallback-token",
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining("api.github.com/repos/"),
      expect.objectContaining({
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: "Bearer preferred-token",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      })
    );
  });

  it("uses GITHUB_TOKEN as the fallback", async () => {
    const fetchImpl = await runStarterDoctor({
      GITHUB_TOKEN: "fallback-token",
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer fallback-token",
        }),
      })
    );
  });

  it("leaves probes unauthenticated when no token is available", async () => {
    const fetchImpl = await runStarterDoctor({});

    expect(fetchImpl).toHaveBeenCalledWith(expect.any(String), undefined);
  });
});

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SUPPORTED_KANE_VERSION,
  probeKaneReadiness,
  type KaneCommandRunner,
} from "../../../src/core/kane-cli.js";

const PROJECT_ID = "project-123";

/**
 * Build a successful readiness runner with configurable balance output.
 * @param balanceOutput - Human-readable Kane balance response
 * @returns Stubbed fixed-argv runner
 */
function readinessRunner(
  balanceOutput = "Balance: 20 credits"
): KaneCommandRunner {
  return vi.fn(async (_executable, args) => {
    const command = args.join(" ");
    if (command === "--version") {
      return {
        exitCode: 0,
        stdout: `kane-cli ${SUPPORTED_KANE_VERSION}`,
        stderr: "",
      };
    }
    if (command === "config show") {
      return {
        exitCode: 0,
        stdout: `${PROJECT_ID} folder-456`,
        stderr: "",
      };
    }
    if (command === "balance") {
      return { exitCode: 0, stdout: balanceOutput, stderr: "" };
    }
    return { exitCode: 0, stdout: "user@example.test", stderr: "" };
  });
}

describe("Kane readiness", () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(path.join(os.tmpdir(), "lisa-kane-ready-"));
    await writeFile(
      path.join(projectRoot, ".lisa.config.json"),
      JSON.stringify({
        verification: {
          browser: {
            kane: {
              enabled: true,
              version: SUPPORTED_KANE_VERSION,
              cloudUploadApproved: true,
              allowedEnvironments: ["staging"],
              projectId: PROJECT_ID,
              folderId: "folder-456",
            },
          },
        },
      })
    );
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("reports ready only after version, auth, target, balance, and Chrome pass", async () => {
    await expect(
      probeKaneReadiness(projectRoot, readinessRunner(), () => true)
    ).resolves.toEqual(
      expect.objectContaining({
        status: "ready",
        detail: expect.stringContaining(PROJECT_ID),
      })
    );
  });

  it.each([
    ["Balance: 0 credits", "fail"],
    ["Balance: 0.5 credits", "ready"],
    ["balance unavailable", "warn"],
  ] as const)("classifies credit output %s as %s", async (output, status) => {
    await expect(
      probeKaneReadiness(projectRoot, readinessRunner(output), () => true)
    ).resolves.toMatchObject({ status });
  });

  it("fails when Chrome is unavailable before invoking Kane", async () => {
    const runner = vi.fn<KaneCommandRunner>();

    await expect(
      probeKaneReadiness(projectRoot, runner, () => false)
    ).resolves.toMatchObject({
      status: "fail",
      detail: expect.stringContaining("Chrome"),
    });
    expect(runner).not.toHaveBeenCalled();
  });

  it("keeps authentication failure separate from product failure", async () => {
    const runner: KaneCommandRunner = vi.fn(async (_executable, args) =>
      args[0] === "--version"
        ? {
            exitCode: 0,
            stdout: `kane-cli ${SUPPORTED_KANE_VERSION}`,
            stderr: "",
          }
        : { exitCode: 2, stdout: "", stderr: "not authenticated" }
    );

    await expect(
      probeKaneReadiness(projectRoot, runner, () => true)
    ).resolves.toMatchObject({
      status: "fail",
      detail: expect.stringContaining("authentication failed"),
    });
  });

  it("fails when the active Test Manager target differs from config", async () => {
    const runner: KaneCommandRunner = vi.fn(async (_executable, args) => {
      const command = args.join(" ");
      if (command === "--version") {
        return {
          exitCode: 0,
          stdout: `kane-cli ${SUPPORTED_KANE_VERSION}`,
          stderr: "",
        };
      }
      if (command === "config show") {
        return { exitCode: 0, stdout: "other-project", stderr: "" };
      }
      return { exitCode: 0, stdout: "user@example.test", stderr: "" };
    });

    await expect(
      probeKaneReadiness(projectRoot, runner, () => true)
    ).resolves.toMatchObject({
      status: "fail",
      detail: expect.stringContaining(PROJECT_ID),
    });
  });

  it.each(["kane-cli 0.7.0", "kane-cli 10.6.30"])(
    "fails on exact-version drift: %s",
    async stdout => {
      const runner = vi.fn<KaneCommandRunner>().mockResolvedValue({
        exitCode: 0,
        stdout,
        stderr: "",
      });

      await expect(
        probeKaneReadiness(projectRoot, runner, () => true)
      ).resolves.toMatchObject({
        status: "fail",
        detail: expect.stringContaining("required"),
      });
    }
  );
});

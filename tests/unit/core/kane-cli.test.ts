import { mkdtemp, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SUPPORTED_KANE_VERSION,
  assertKaneRunAllowed,
  parseKaneResult,
  readEffectiveKaneConfig,
  runKane,
  type KaneCommandRunner,
} from "../../../src/core/kane-cli.js";

const TERMINAL_PASS = JSON.stringify({
  type: "run_end",
  status: "passed",
  summary: "journey passed",
  duration: 20,
  credits: 1.5,
  test_url: "https://app.testmu.ai/test/1",
  evidence_pack: ".lisa/evidence/kane-1.zip",
});
const PROJECT_ID = "project-123";

describe("Kane CLI adapter", () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(path.join(os.tmpdir(), "lisa-kane-"));
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
              timeoutSeconds: 45,
            },
          },
        },
      })
    );
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("accepts both known progress schemas and trusts only run_end", () => {
    const result = parseKaneResult({
      exitCode: 0,
      stdout: [
        JSON.stringify({ step: 1, message: "old schema" }),
        JSON.stringify({ type: "step_start", step: 2 }),
        JSON.stringify({ type: "step_end", step: 2 }),
        TERMINAL_PASS,
      ].join("\n"),
      stderr: "",
    });

    expect(result).toMatchObject({
      outcome: "passed",
      progressCount: 3,
      confirmedProductBug: false,
      evidencePack: ".lisa/evidence/kane-1.zip",
      terminal: { status: "passed", summary: "journey passed" },
    });
  });

  it("tolerates malformed progress lines but fails closed without a terminal", () => {
    const result = parseKaneResult({
      exitCode: 0,
      stdout: 'not-json\n{"type":"step_start"}',
      stderr: "",
    });

    expect(result.outcome).toBe("tool_failed");
    expect(result.parseWarnings).toEqual(["stdout line 1 was not JSON"]);
  });

  it.each([
    { exitCode: 1, status: "failed", outcome: "product_failed" },
    { exitCode: 2, status: "passed", outcome: "tool_failed" },
    { exitCode: 3, status: "passed", outcome: "timed_out" },
    { exitCode: 9, status: "passed", outcome: "tool_failed" },
  ] as const)("maps exit $exitCode to $outcome", item => {
    const result = parseKaneResult({
      exitCode: item.exitCode,
      stdout: JSON.stringify({ type: "run_end", status: item.status }),
      stderr: "",
    });

    expect(result.outcome).toBe(item.outcome);
  });

  it("recognizes Kane result code 740 as a confirmed product bug", () => {
    const result = parseKaneResult({
      exitCode: 1,
      stdout: JSON.stringify({
        type: "run_end",
        status: "failed",
        result_code: 740,
      }),
      stderr: "Evidence pack: .lisa/evidence/failure.zip",
    });

    expect(result.confirmedProductBug).toBe(true);
    expect(result.evidencePack).toBe(".lisa/evidence/failure.zip");
  });

  it("merges local provider keys over committed configuration", async () => {
    await writeFile(
      path.join(projectRoot, ".lisa.config.local.json"),
      JSON.stringify({
        verification: {
          browser: { kane: { timeoutSeconds: 90, folderId: "local-folder" } },
        },
      })
    );

    await expect(readEffectiveKaneConfig(projectRoot)).resolves.toMatchObject({
      enabled: true,
      timeoutSeconds: 90,
      projectId: PROJECT_ID,
      folderId: "local-folder",
    });
  });

  it.each([
    [{}, "not enabled"],
    [
      {
        enabled: true,
        cloudUploadApproved: true,
        allowedEnvironments: ["staging"],
        projectId: "p",
      },
      "version must be",
    ],
    [
      {
        enabled: true,
        version: SUPPORTED_KANE_VERSION,
        allowedEnvironments: ["staging"],
        projectId: "p",
      },
      "cloud upload",
    ],
    [
      {
        enabled: true,
        version: SUPPORTED_KANE_VERSION,
        cloudUploadApproved: true,
        allowedEnvironments: ["staging"],
        projectId: "p",
      },
      "mutation policy",
      "read-only",
    ],
  ] as const)(
    "rejects unsafe provider policy: %s",
    (config, message, mutation) => {
      expect(() =>
        assertKaneRunAllowed(config, {
          environment: "staging",
          mutation: mutation ?? "full",
        })
      ).toThrow(message);
    }
  );

  it("rejects production even if an unvalidated config tries to allow it", () => {
    expect(() =>
      assertKaneRunAllowed(
        {
          enabled: true,
          version: SUPPORTED_KANE_VERSION,
          cloudUploadApproved: true,
          allowedEnvironments: ["production"],
          projectId: "p",
        },
        { environment: "production", mutation: "full" }
      )
    ).toThrow("not allowed");
  });

  it("invokes fixed Kane agent-mode arguments through the injected runner", async () => {
    const runner = vi.fn<KaneCommandRunner>().mockResolvedValue({
      exitCode: 0,
      stdout: TERMINAL_PASS,
      stderr: "",
    });

    const result = await runKane(
      {
        projectRoot,
        environment: "staging",
        mutation: "full",
        objective: "Sign in and verify the dashboard",
        url: "https://staging.example.test",
        maxSteps: 12,
      },
      runner
    );

    expect(result.outcome).toBe("passed");
    expect(runner).toHaveBeenCalledWith(
      "kane-cli",
      [
        "run",
        "Sign in and verify the dashboard",
        "--agent",
        "--headless",
        "--timeout",
        "45",
        "--max-steps",
        "12",
        "--url",
        "https://staging.example.test",
      ],
      expect.objectContaining({ cwd: projectRoot, timeoutMs: 60_000 })
    );
  });

  it("rejects an out-of-bounds direct adapter step limit", async () => {
    const runner = vi.fn<KaneCommandRunner>();

    await expect(
      runKane(
        {
          projectRoot,
          environment: "staging",
          mutation: "full",
          objective: "Verify checkout",
          maxSteps: 101,
        },
        runner
      )
    ).rejects.toThrow("integer from 1 to 100");
    expect(runner).not.toHaveBeenCalled();
  });
});

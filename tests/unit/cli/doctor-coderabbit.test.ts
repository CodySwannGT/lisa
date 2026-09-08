import { mkdtemp, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkCodeRabbitProvider,
  probeCodeRabbitReadiness,
  type CodeRabbitCommandRunner,
} from "../../../src/cli/doctor-coderabbit.js";

const tempDirectories: string[] = [];

/**
 * Create a project with committed and optional local Lisa config.
 * @param committed - Committed configuration
 * @param local - Optional local overlay
 * @returns Temporary project root
 */
async function projectFixture(
  committed: unknown,
  local?: unknown
): Promise<string> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "lisa-doctor-coderabbit-")
  );
  tempDirectories.push(directory);
  await writeFile(
    path.join(directory, ".lisa.config.json"),
    `${JSON.stringify(committed)}\n`
  );
  if (local !== undefined) {
    await writeFile(
      path.join(directory, ".lisa.config.local.json"),
      `${JSON.stringify(local)}\n`
    );
  }
  return directory;
}

/**
 * Build a runner from results keyed by the complete argument vector.
 * @param results - Command outcomes
 * @returns Injectable command runner
 */
function runnerFor(
  results: Record<string, boolean | string>
): CodeRabbitCommandRunner {
  return async args => {
    const result = results[args.join(" ")] ?? false;
    return typeof result === "boolean"
      ? { ok: result, stdout: "" }
      : { ok: true, stdout: result };
  };
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    tempDirectories
      .splice(0)
      .map(directory => rm(directory, { force: true, recursive: true }))
  );
});

describe("CodeRabbit doctor check", () => {
  it("stays healthy when no gate awaits CodeRabbit", async () => {
    const readiness = await probeCodeRabbitReadiness(
      await projectFixture({ gates: { "code-review": { push: "off" } } }),
      runnerFor({})
    );
    expect(readiness).toEqual({
      status: "disabled",
      detail: "No configured gate awaits CodeRabbit",
    });
  });

  it("fails with install guidance when CodeRabbit is configured but absent", async () => {
    const readiness = await probeCodeRabbitReadiness(
      await projectFixture({
        gates: {
          "code-review": {
            "pull-request": { level: "required", await: "CodeRabbit" },
          },
        },
      }),
      runnerFor({ "--version": false })
    );
    expect(readiness.status).toBe("fail");
    expect(readiness.detail).toContain("install it");
    expect(readiness.detail).toContain("https://www.coderabbit.ai/cli");
  });

  it("does not mistake a zero-exit signed-out status for authentication", async () => {
    vi.stubEnv("CODERABBIT_API_KEY", "fixture-agentic-key");
    const readiness = await probeCodeRabbitReadiness(
      await projectFixture({
        gates: { review: { commit: { await: "coderabbit" } } },
      }),
      runnerFor({
        "--version": true,
        "auth status --agent":
          '{"type":"status","phase":"auth","status":"not_authenticated","authenticated":false}\n',
      })
    );
    expect(readiness).toEqual({
      status: "fail",
      detail:
        'CodeRabbit CLI is installed but not authenticated; headless credentials are available, so run `coderabbit auth login --api-key "$CODERABBIT_API_KEY"`',
    });
  });

  it("offers Agentic-key setup before browser OAuth when no headless key is available", async () => {
    vi.stubEnv("CODERABBIT_API_KEY", "");
    const readiness = await probeCodeRabbitReadiness(
      await projectFixture({
        gates: { review: { commit: { await: "coderabbit" } } },
      }),
      runnerFor({
        "--version": true,
        "auth status --agent":
          '{"type":"status","phase":"auth","status":"not_authenticated","authenticated":false}\n',
      })
    );
    expect(readiness.status).toBe("fail");
    expect(readiness.detail).toContain("Agentic API key");
    expect(readiness.detail).toContain("CODERABBIT_API_KEY");
    expect(readiness.detail).toContain("interactive fallback");
    expect(readiness.detail).toContain("coderabbit auth login");
  });

  it("fails closed when the machine-readable authentication result is malformed", async () => {
    const readiness = await probeCodeRabbitReadiness(
      await projectFixture({
        gates: { review: { commit: { await: "coderabbit" } } },
      }),
      runnerFor({
        "--version": true,
        "auth status --agent": "not-json\n",
      })
    );
    expect(readiness.status).toBe("fail");
    expect(readiness.detail).toContain("could not verify authentication");
  });

  it("fails closed when machine-readable authentication status cannot run", async () => {
    const readiness = await probeCodeRabbitReadiness(
      await projectFixture({
        gates: { review: { commit: { await: "coderabbit" } } },
      }),
      runnerFor({
        "--version": true,
        "auth status --agent": false,
      })
    );
    expect(readiness.status).toBe("fail");
    expect(readiness.detail).toContain("could not verify authentication");
  });

  it("accepts a configured, installed, authenticated CLI", async () => {
    const readiness = await probeCodeRabbitReadiness(
      await projectFixture({
        gates: { review: { commit: { await: "CodeRabbit" } } },
      }),
      runnerFor({
        "--version": true,
        "auth status --agent":
          '{"type":"status","phase":"auth","status":"authenticated","authenticated":true,"authType":"api_key","region":"us"}\n',
      })
    );
    expect(readiness.status).toBe("ready");
  });

  it("honors a local CodeRabbit gate overlay", async () => {
    const readiness = await probeCodeRabbitReadiness(
      await projectFixture(
        { gates: { review: { push: "off" } } },
        { gates: { review: { pull: { await: "CodeRabbit" } } } }
      ),
      runnerFor({ "--version": false })
    );
    expect(readiness.status).toBe("fail");
  });

  it("maps a probe failure to a failing doctor row", async () => {
    const check = await checkCodeRabbitProvider("/project", {
      probeCodeRabbitReadiness: vi.fn(async () => ({
        status: "fail" as const,
        detail: "install CodeRabbit",
      })),
    });
    expect(check).toEqual({
      name: "CodeRabbit CLI ready?",
      status: "fail",
      detail: "install CodeRabbit",
    });
  });
});

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
const HOSTED_PROOF = "hosted check run";
const LOCAL_GATE_MOMENT = "code-review at push";

const LOCAL_REVIEW = {
  gates: {
    "code-review": {
      needs: { tools: ["coderabbit"] },
      push: { level: "required", run: "review:local" },
    },
  },
};

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
      detail: "No active gate uses CodeRabbit",
    });
  });

  it("keeps a hosted pull-request gate healthy without the local CLI", async () => {
    const project = await projectFixture({
      gates: {
        "code-review": {
          "pull-request": { level: "required", await: "CodeRabbit" },
        },
      },
    });
    const check = await checkCodeRabbitProvider(project, {
      probeCodeRabbitReadiness: root =>
        probeCodeRabbitReadiness(root, runnerFor({ "--version": false })),
    });
    expect(check.status).toBe("ok");
    expect(check.detail).toContain(HOSTED_PROOF);
    expect(check.detail).toContain("optional");
  });

  it("warns when a hosted gate has an installed but unauthenticated optional CLI", async () => {
    const project = await projectFixture({
      gates: {
        "code-review": {
          "pull-request": { level: "required", await: "CodeRabbit" },
        },
      },
    });
    const check = await checkCodeRabbitProvider(project, {
      probeCodeRabbitReadiness: root =>
        probeCodeRabbitReadiness(
          root,
          runnerFor({
            "--version": true,
            "auth status --agent": '{"type":"status","authenticated":false}\n',
          })
        ),
    });
    expect(check.status).toBe("warn");
    expect(check.detail).toContain(HOSTED_PROOF);
    expect(check.detail).toContain("not authenticated");
  });

  it("fails with gate and moment when local CodeRabbit review is configured but absent", async () => {
    const readiness = await probeCodeRabbitReadiness(
      await projectFixture(LOCAL_REVIEW),
      runnerFor({ "--version": false })
    );
    expect(readiness.status).toBe("fail");
    expect(readiness.detail).toContain("install it");
    expect(readiness.detail).toContain("https://www.coderabbit.ai/cli");
    expect(readiness.detail).toContain("code-review");
    expect(readiness.detail).toContain("push");
  });

  it("does not mistake a zero-exit signed-out status for authentication", async () => {
    vi.stubEnv("CODERABBIT_API_KEY", "fixture-agentic-key");
    const readiness = await probeCodeRabbitReadiness(
      await projectFixture(LOCAL_REVIEW),
      runnerFor({
        "--version": true,
        "auth status --agent":
          '{"type":"status","phase":"auth","status":"not_authenticated","authenticated":false}\n',
      })
    );
    expect(readiness.status).toBe("fail");
    expect(readiness.detail).toContain("headless credentials are available");
    expect(readiness.detail).toContain(
      'coderabbit auth login --api-key "$CODERABBIT_API_KEY"'
    );
    expect(readiness.detail).not.toContain("fixture-agentic-key");
  });

  it("offers Agentic-key setup before browser OAuth when no headless key is available", async () => {
    vi.stubEnv("CODERABBIT_API_KEY", "");
    const readiness = await probeCodeRabbitReadiness(
      await projectFixture(LOCAL_REVIEW),
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
      await projectFixture(LOCAL_REVIEW),
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
      await projectFixture(LOCAL_REVIEW),
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
      await projectFixture(LOCAL_REVIEW),
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
        { gates: { "code-review": { push: "off" } } },
        LOCAL_REVIEW
      ),
      runnerFor({ "--version": false })
    );
    expect(readiness.status).toBe("fail");
  });

  it.each(["off", { level: "off", run: "review:local" }])(
    "does not probe a locally disabled run task: %j",
    async push => {
      const runner = vi.fn(runnerFor({}));
      const readiness = await probeCodeRabbitReadiness(
        await projectFixture(LOCAL_REVIEW, {
          gates: { "code-review": { push } },
        }),
        runner
      );
      expect(readiness.status).toBe("disabled");
      expect(runner).not.toHaveBeenCalled();
    }
  );

  it("warns rather than fails for a missing optional local prover", async () => {
    const readiness = await probeCodeRabbitReadiness(
      await projectFixture(LOCAL_REVIEW, {
        gates: { "code-review": { push: { level: "optional" } } },
      }),
      runnerFor({ "--version": false })
    );
    expect(readiness.status).toBe("warn");
    expect(readiness.detail).toContain(LOCAL_GATE_MOMENT);
    expect(readiness.detail).toContain("optional");
  });

  it("does not turn gate-level tool metadata on an awaited signal into local execution", async () => {
    const readiness = await probeCodeRabbitReadiness(
      await projectFixture({
        gates: {
          runner: "bun run",
          unproven: "block",
          "code-review": {
            needs: { tools: ["coderabbit"] },
            "pull-request": { level: "required", await: "CodeRabbit" },
          },
        },
      }),
      runnerFor({ "--version": false })
    );
    expect(readiness.status).toBe("disabled");
    expect(readiness.detail).toContain(HOSTED_PROOF);
  });

  it.each(["push", "pull"])(
    "reports unsupported awaited moment %s as a config failure without probing",
    async moment => {
      const runner = vi.fn(runnerFor({}));
      const project = await projectFixture({
        gates: {
          "code-review": {
            [moment]: { level: "required", await: "CodeRabbit" },
          },
        },
      });
      const check = await checkCodeRabbitProvider(project, {
        probeCodeRabbitReadiness: root =>
          probeCodeRabbitReadiness(root, runner),
      });
      expect(check.status).toBe("fail");
      expect(check.detail).toContain("config could not be evaluated");
      expect(check.detail).toContain("code-review");
      expect(check.detail).toContain(moment);
      expect(runner).not.toHaveBeenCalled();
    }
  );

  it("ignores an unrelated nested await rather than inventing a review flow", async () => {
    const runner = vi.fn(runnerFor({}));
    const readiness = await probeCodeRabbitReadiness(
      await projectFixture({
        gates: { metadata: { example: [{ await: "CodeRabbit" }] } },
      }),
      runner
    );
    expect(readiness.status).toBe("disabled");
    expect(runner).not.toHaveBeenCalled();
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

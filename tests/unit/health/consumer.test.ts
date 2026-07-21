/* eslint-disable max-lines -- two-phase protocol modes share one mocked composition boundary */
import { mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AgenticHealthEvaluation,
  AgenticHealthRequest,
  HealthOptions,
} from "../../../src/health/agentic.js";
import type { HealthResult } from "../../../src/health/contract.js";

const mocks = vi.hoisted(() => ({
  runHealth: vi.fn(),
  writeLatestHealthResult: vi.fn(),
}));

vi.mock("../../../src/health/agentic.js", async importOriginal => {
  const actual =
    await importOriginal<typeof import("../../../src/health/agentic.js")>();
  return { ...actual, runHealth: mocks.runHealth };
});

vi.mock("../../../src/health/storage.js", async importOriginal => {
  const actual =
    await importOriginal<typeof import("../../../src/health/storage.js")>();
  return {
    ...actual,
    writeLatestHealthResult: mocks.writeLatestHealthResult,
  };
});

import { runPersistedHealth } from "../../../src/health/consumer.js";
import {
  HEALTH_EVALUATION_PROTOCOL_VERSION,
  serializeHealthEvaluationRequest,
} from "../../../src/health/evaluation-protocol.js";
import { prepareHealthEvaluation } from "../../../src/health/prepare.js";
import { serializeHealthResult } from "../../../src/health/storage.js";

const STARTED_AT = "2026-07-21T12:00:00.000Z";
const COMPLETED_AT = "2026-07-21T12:01:00.000Z";

const deterministicResult = (overrides: Partial<HealthResult> = {}) =>
  Object.freeze({
    schemaVersion: 1 as const,
    runId: "health-consumer-run",
    mode: "deterministic" as const,
    startedAt: STARTED_AT,
    completedAt: COMPLETED_AT,
    findings: Object.freeze([
      Object.freeze({
        check: "config.sync",
        layer: "deterministic" as const,
        status: "pass" as const,
        reason: "Configuration is synchronized.",
      }),
    ]),
    summary: Object.freeze({
      verdict: "in band" as const,
      counts: Object.freeze({ pass: 1, warn: 0, fail: 0 }),
    }),
    ...overrides,
  });

const evaluationRequest = (
  artifactContent = "skip_jobs: []"
): AgenticHealthRequest =>
  Object.freeze({
    schemaVersion: 1 as const,
    deterministicFindings: deterministicResult().findings,
    config: Object.freeze({
      quality: Object.freeze({
        mutation: Object.freeze({
          gate: Object.freeze({ enabled: true }),
        }),
      }),
    }),
    artifacts: Object.freeze([
      Object.freeze({
        kind: "workflow" as const,
        path: ".github/workflows/ci.yml",
        content: artifactContent,
      }),
    ]),
  });

/**
 * Compose the result shape that the shipped runHealth API would return.
 * @param deterministic - Deterministic intermediate
 * @param evaluation - Completed evaluator judgments
 * @returns Full Health v1 result
 */
function fullResult(
  deterministic: HealthResult,
  evaluation: Extract<AgenticHealthEvaluation, { readonly status: "completed" }>
): HealthResult {
  const findings = Object.freeze([
    ...deterministic.findings,
    ...evaluation.judgments.map(judgment =>
      Object.freeze({
        ...judgment,
        layer: "agentic" as const,
        status: "warn" as const,
      })
    ),
  ]);
  return deterministicResult({
    mode: "full",
    findings,
    summary: Object.freeze({
      verdict: "in band",
      counts: Object.freeze({
        pass: 1,
        warn: evaluation.judgments.length,
        fail: 0,
      }),
    }),
  });
}

let projectRoot = "";
let currentRequest = evaluationRequest();

beforeEach(async () => {
  projectRoot = await mkdtemp(path.join(tmpdir(), "lisa-health-consumer-"));
  currentRequest = evaluationRequest();
  mocks.runHealth.mockImplementation(
    async (_projectPath: string, options: HealthOptions = {}) => {
      const deterministic = deterministicResult();
      const evaluator = options.agentic?.evaluator;
      if (options.agentic?.enabled !== true || evaluator === undefined) {
        return deterministic;
      }
      try {
        const evaluation = await evaluator(
          currentRequest,
          new AbortController().signal
        );
        return evaluation.status === "completed"
          ? fullResult(deterministic, evaluation)
          : deterministic;
      } catch {
        return deterministic;
      }
    }
  );
  mocks.writeLatestHealthResult.mockImplementation(
    async (root: string, result: HealthResult) =>
      Object.freeze({
        status: "written" as const,
        path: path.join(root, ".lisa/health/latest.json"),
        result,
      })
  );
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe("two-phase Health consumer", () => {
  it("prepares one bounded digest-bound request with zero storage writes", async () => {
    const prepared = await prepareHealthEvaluation(projectRoot);

    expect(mocks.runHealth).toHaveBeenCalledOnce();
    expect(mocks.writeLatestHealthResult).not.toHaveBeenCalled();
    expect(prepared).toMatchObject({
      protocolVersion: HEALTH_EVALUATION_PROTOCOL_VERSION,
      request: currentRequest,
    });
    expect(prepared?.requestDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(Buffer.byteLength(serializeHealthEvaluationRequest(prepared!))).toBe(
      Buffer.byteLength(`${JSON.stringify(prepared, null, 2)}\n`, "utf8")
    );
  });

  it("accepts a matching completed response and writes one full result", async () => {
    const prepared = await prepareHealthEvaluation(projectRoot);
    mocks.runHealth.mockClear();
    const run = await runPersistedHealth(projectRoot, {
      agentic: {
        enabled: true,
        response: {
          protocolVersion: HEALTH_EVALUATION_PROTOCOL_VERSION,
          requestDigest: prepared!.requestDigest,
          evaluation: {
            status: "completed",
            judgments: [
              {
                check: "agentic.ci.skip.lint",
                reason: "The skipped lint job has no recorded reason.",
              },
            ],
          },
        },
      },
    });

    expect(mocks.runHealth).toHaveBeenCalledOnce();
    expect(mocks.writeLatestHealthResult).toHaveBeenCalledOnce();
    expect(run.result.mode).toBe("full");
    expect(run.writeOutcome.result).toBe(run.result);
    expect(run.serialized).toBe(serializeHealthResult(run.result));
  });

  it.each([
    ["disabled", { enabled: false }],
    ["missing response", { enabled: true }],
  ] as const)(
    "persists one deterministic result when agentic is %s",
    async (_name, agentic) => {
      const run = await runPersistedHealth(projectRoot, { agentic });

      expect(mocks.runHealth).toHaveBeenCalledOnce();
      expect(mocks.writeLatestHealthResult).toHaveBeenCalledOnce();
      expect(run.result.mode).toBe("deterministic");
    }
  );

  it("persists deterministic mode for a matching unavailable response", async () => {
    const prepared = await prepareHealthEvaluation(projectRoot);
    mocks.runHealth.mockClear();
    const run = await runPersistedHealth(projectRoot, {
      agentic: {
        enabled: true,
        response: {
          protocolVersion: HEALTH_EVALUATION_PROTOCOL_VERSION,
          requestDigest: prepared!.requestDigest,
          evaluation: { status: "unavailable" },
        },
      },
    });

    expect(run.result.mode).toBe("deterministic");
    expect(mocks.writeLatestHealthResult).toHaveBeenCalledOnce();
  });

  it("degrades a stale request digest and writes deterministic mode once", async () => {
    const prepared = await prepareHealthEvaluation(projectRoot);
    currentRequest = evaluationRequest("skip_jobs: [lint]");
    mocks.runHealth.mockClear();
    const run = await runPersistedHealth(projectRoot, {
      agentic: {
        enabled: true,
        response: {
          protocolVersion: HEALTH_EVALUATION_PROTOCOL_VERSION,
          requestDigest: prepared!.requestDigest,
          evaluation: {
            status: "completed",
            judgments: [
              {
                check: "agentic.stale",
                reason: "This judgment belongs to stale evidence.",
              },
            ],
          },
        },
      },
    });

    expect(run.result.mode).toBe("deterministic");
    expect(mocks.runHealth).toHaveBeenCalledOnce();
    expect(mocks.writeLatestHealthResult).toHaveBeenCalledOnce();
  });

  it.each([
    [
      "extra response field",
      (digest: string) => ({
        protocolVersion: HEALTH_EVALUATION_PROTOCOL_VERSION,
        requestDigest: digest,
        evaluation: { status: "unavailable" },
        extra: true,
      }),
    ],
    [
      "unsupported protocol",
      (digest: string) => ({
        protocolVersion: 2,
        requestDigest: digest,
        evaluation: { status: "unavailable" },
      }),
    ],
    [
      "oversized judgment",
      (digest: string) => ({
        protocolVersion: HEALTH_EVALUATION_PROTOCOL_VERSION,
        requestDigest: digest,
        evaluation: {
          status: "completed",
          judgments: [
            { check: "agentic.oversized", reason: "x".repeat(2_001) },
          ],
        },
      }),
    ],
  ] as const)(
    "degrades a hostile %s before one deterministic write",
    async (_name, response) => {
      const prepared = await prepareHealthEvaluation(projectRoot);
      mocks.runHealth.mockClear();
      const run = await runPersistedHealth(projectRoot, {
        agentic: {
          enabled: true,
          response: response(prepared!.requestDigest),
        },
      });

      expect(run.result.mode).toBe("deterministic");
      expect(mocks.runHealth).toHaveBeenCalledOnce();
      expect(mocks.writeLatestHealthResult).toHaveBeenCalledOnce();
    }
  );

  it("binds the digest to the canonical project root", async () => {
    const prepared = await prepareHealthEvaluation(projectRoot);
    const otherRoot = await mkdtemp(path.join(tmpdir(), "lisa-health-other-"));
    try {
      const run = await runPersistedHealth(otherRoot, {
        agentic: {
          enabled: true,
          response: {
            protocolVersion: HEALTH_EVALUATION_PROTOCOL_VERSION,
            requestDigest: prepared!.requestDigest,
            evaluation: { status: "completed", judgments: [] },
          },
        },
      });
      expect(await realpath(otherRoot)).not.toBe(await realpath(projectRoot));
      expect(run.result.mode).toBe("deterministic");
      expect(mocks.writeLatestHealthResult).toHaveBeenCalledOnce();
    } finally {
      await rm(otherRoot, { recursive: true, force: true });
    }
  });

  it("uses one canonical root even when a supplied symlink is retargeted", async () => {
    const otherRoot = await mkdtemp(path.join(tmpdir(), "lisa-health-other-"));
    const alias = path.join(
      tmpdir(),
      `lisa-health-alias-${path.basename(projectRoot)}`
    );
    await symlink(projectRoot, alias);
    const canonicalRoot = await realpath(projectRoot);
    mocks.runHealth.mockImplementationOnce(async receivedRoot => {
      expect(receivedRoot).toBe(canonicalRoot);
      await rm(alias);
      await symlink(otherRoot, alias);
      return deterministicResult();
    });
    try {
      await runPersistedHealth(alias, { agentic: { enabled: false } });

      expect(mocks.writeLatestHealthResult).toHaveBeenCalledWith(
        canonicalRoot,
        expect.anything()
      );
    } finally {
      await rm(alias, { force: true });
      await rm(otherRoot, { recursive: true, force: true });
    }
  });

  it("serializes the storage outcome result for monotonic unchanged writes", async () => {
    const persisted = deterministicResult({
      runId: "health-newer-persisted",
      completedAt: "2026-07-21T12:05:00.000Z",
    });
    mocks.writeLatestHealthResult.mockResolvedValueOnce(
      Object.freeze({
        status: "unchanged",
        path: path.join(projectRoot, ".lisa/health/latest.json"),
        result: persisted,
      })
    );

    const run = await runPersistedHealth(projectRoot, {
      agentic: { enabled: false },
    });

    expect(run.writeOutcome.status).toBe("unchanged");
    expect(run.result).toBe(persisted);
    expect(run.serialized).toBe(serializeHealthResult(persisted));
    expect(JSON.parse(run.serialized)).toEqual(persisted);
  });
});

/* eslint-enable max-lines -- restore repository default */

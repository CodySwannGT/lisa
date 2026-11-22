/**
 * Two-phase Health consumer: preparation and well-formed evaluator responses.
 * @module tests/unit/health/consumer.test
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
import {
  evaluationRequest,
  fakeRunHealth,
  fakeWriteLatestHealthResult,
} from "./consumer-fixtures.js";

let projectRoot = "";
let currentRequest = evaluationRequest();

beforeEach(async () => {
  projectRoot = await mkdtemp(path.join(tmpdir(), "lisa-health-consumer-"));
  currentRequest = evaluationRequest();
  mocks.runHealth.mockImplementation(fakeRunHealth(() => currentRequest));
  mocks.writeLatestHealthResult.mockImplementation(fakeWriteLatestHealthResult);
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
    expect(run.serialized).toBe(`${JSON.stringify(run.result, null, 2)}\n`);
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
});

/**
 * Two-phase Health consumer: hostile responses, canonical roots, and storage outcomes.
 * @module tests/unit/health/consumer-boundaries.test
 */
import { mkdtemp, realpath, rm } from "node:fs/promises";
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
import { HEALTH_EVALUATION_PROTOCOL_VERSION } from "../../../src/health/evaluation-protocol.js";
import { prepareHealthEvaluation } from "../../../src/health/prepare.js";
import {
  deterministicResult,
  evaluationRequest,
  fakeRunHealth,
  fakeWriteLatestHealthResult,
  LATEST_HEALTH_PATH,
} from "./consumer-fixtures.js";
import { createSymlink } from "../../support/borrowed-node-modules.mjs";

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
    createSymlink(projectRoot, alias);
    const canonicalRoot = await realpath(projectRoot);
    mocks.runHealth.mockImplementationOnce(async receivedRoot => {
      expect(receivedRoot).toBe(canonicalRoot);
      await rm(alias);
      createSymlink(otherRoot, alias);
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
        path: path.join(projectRoot, LATEST_HEALTH_PATH),
        result: persisted,
      })
    );

    const run = await runPersistedHealth(projectRoot, {
      agentic: { enabled: false },
    });

    expect(run.writeOutcome.status).toBe("unchanged");
    expect(run.result).toBe(persisted);
    expect(run.serialized).toBe(`${JSON.stringify(persisted, null, 2)}\n`);
    expect(JSON.parse(run.serialized)).toEqual(persisted);
  });
});
